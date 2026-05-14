import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { auth } from '../auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function getUserId(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: request.headers as any });
    if (!session) {
      reply.code(401).send({ error: 'Authentication required' });
      return null;
    }
    return session.user.id;
  } catch {
    reply.code(401).send({ error: 'Authentication required' });
    return null;
  }
}

export default async function contentRoutes(fastify: FastifyInstance) {
  // ── Ideas ──────────────────────────────────────────────────────────────────

  fastify.get('/ideas', async (request, reply) => {
    const userId = await getUserId(request, reply);
    if (!userId) return;

    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, user_id, text, tag, captured_at FROM public.ideas
         WHERE user_id = $1 ORDER BY captured_at DESC`,
        [userId]
      );
      return reply.send({ success: true, data: rows });
    } finally {
      client.release();
    }
  });

  fastify.post(
    '/ideas',
    {
      schema: {
        body: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string' },
            tag: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { text: string; tag?: string } }>, reply) => {
      const userId = await getUserId(request, reply);
      if (!userId) return;

      const { text, tag } = request.body;
      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          `INSERT INTO public.ideas (user_id, text, tag, captured_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, user_id, text, tag, captured_at`,
          [userId, text, tag ?? null]
        );
        return reply.code(201).send({ success: true, data: rows[0] });
      } finally {
        client.release();
      }
    }
  );

  fastify.delete('/ideas/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const userId = await getUserId(request, reply);
    if (!userId) return;

    const { id } = request.params;
    const client = await pool.connect();
    try {
      const { rowCount } = await client.query(
        `DELETE FROM public.ideas WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      if (rowCount === 0) {
        return reply.code(404).send({ success: false, error: 'Idea not found' });
      }
      return reply.send({ success: true });
    } finally {
      client.release();
    }
  });

  // ── Queue settings ─────────────────────────────────────────────────────────

  fastify.get('/queue-settings', async (request, reply) => {
    const userId = await getUserId(request, reply);
    if (!userId) return;

    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT user_id, days, time FROM public.queue_settings WHERE user_id = $1`,
        [userId]
      );
      const data = rows.length > 0 ? rows[0] : { days: [1, 3, 5], time: '09:00' };
      return reply.send({ success: true, data });
    } finally {
      client.release();
    }
  });

  fastify.put(
    '/queue-settings',
    {
      schema: {
        body: {
          type: 'object',
          required: ['days', 'time'],
          properties: {
            days: { type: 'array', items: { type: 'integer' } },
            time: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { days: number[]; time: string } }>, reply) => {
      const userId = await getUserId(request, reply);
      if (!userId) return;

      const { days, time } = request.body;
      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          `INSERT INTO public.queue_settings (user_id, days, time)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET days = EXCLUDED.days, time = EXCLUDED.time
           RETURNING user_id, days, time`,
          [userId, days, time]
        );
        return reply.send({ success: true, data: rows[0] });
      } finally {
        client.release();
      }
    }
  );

  // ── Brand voice ────────────────────────────────────────────────────────────

  fastify.get('/brand-voice', async (request, reply) => {
    const userId = await getUserId(request, reply);
    if (!userId) return;

    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT user_id, tone, style, examples FROM public.brand_voice WHERE user_id = $1`,
        [userId]
      );
      return reply.send({ success: true, data: rows.length > 0 ? rows[0] : {} });
    } finally {
      client.release();
    }
  });

  fastify.put(
    '/brand-voice',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            tone: { type: 'string' },
            style: { type: 'string' },
            examples: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { tone?: string; style?: string; examples?: string } }>, reply) => {
      const userId = await getUserId(request, reply);
      if (!userId) return;

      const { tone, style, examples } = request.body;
      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          `INSERT INTO public.brand_voice (user_id, tone, style, examples)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id) DO UPDATE SET tone = EXCLUDED.tone, style = EXCLUDED.style, examples = EXCLUDED.examples
           RETURNING user_id, tone, style, examples`,
          [userId, tone ?? null, style ?? null, examples ?? null]
        );
        return reply.send({ success: true, data: rows[0] });
      } finally {
        client.release();
      }
    }
  );
}
