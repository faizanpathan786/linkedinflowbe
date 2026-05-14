import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { auth } from '../auth';
import { DEFAULT_PREFS, mergePrefs, NotificationPrefs } from '../lib/notifications';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const ALLOWED_KEYS = new Set<keyof NotificationPrefs>([
  'emailNotifications',
  'pushNotifications',
  'postSuccess',
  'postFailure',
  'batchComplete',
  'weeklyReport',
]);

export default async function notificationsRoutes(fastify: FastifyInstance) {
  // GET /settings/notifications — return current preferences (or defaults)
  fastify.get(
    '/settings/notifications',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) return reply.status(401).send({ error: 'Unauthorized' });

      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          `SELECT notification_preferences FROM public."user" WHERE id = $1`,
          [session.user.id]
        );
        const prefs = mergePrefs(rows[0]?.notification_preferences ?? {});
        return reply.send({ success: true, data: prefs });
      } finally {
        client.release();
      }
    }
  );

  // PUT /settings/notifications — save preferences
  fastify.put(
    '/settings/notifications',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) return reply.status(401).send({ error: 'Unauthorized' });

      const body = request.body as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply.status(400).send({ error: 'Request body must be an object' });
      }

      const sanitized: Partial<NotificationPrefs> = {};
      for (const key of Object.keys(body)) {
        if (!ALLOWED_KEYS.has(key as keyof NotificationPrefs)) continue;
        if (typeof body[key] !== 'boolean') {
          return reply.status(400).send({ error: `Field "${key}" must be a boolean` });
        }
        (sanitized as any)[key] = body[key];
      }

      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          `SELECT notification_preferences FROM public."user" WHERE id = $1`,
          [session.user.id]
        );
        const existing = mergePrefs(rows[0]?.notification_preferences ?? {});
        const updated: NotificationPrefs = { ...existing, ...sanitized };

        await client.query(
          `UPDATE public."user" SET notification_preferences = $1, "updatedAt" = NOW() WHERE id = $2`,
          [JSON.stringify(updated), session.user.id]
        );

        return reply.send({ success: true, data: updated });
      } finally {
        client.release();
      }
    }
  );
}
