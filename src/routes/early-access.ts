import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { auth } from '../auth';
import { sendEarlyAccessNotificationEmail } from '../lib/email';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EarlyAccessBody {
  email: string;
}

export default async function earlyAccessRoutes(fastify: FastifyInstance) {
  // POST /api/early-access — public, no auth required
  fastify.post(
    '/api/early-access',
    async (request: FastifyRequest<{ Body: EarlyAccessBody }>, reply: FastifyReply) => {
      const { email } = request.body ?? {};

      if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
        return reply.status(400).send({ success: false, error: 'A valid email is required' });
      }

      let result;
      try {
        result = await pool.query(
          `INSERT INTO public.early_access_requests (email)
           VALUES ($1)
           ON CONFLICT (email) DO NOTHING
           RETURNING id`,
          [email.trim().toLowerCase()]
        );
      } catch (dbErr: any) {
        fastify.log.error({ err: dbErr.message }, 'Early access DB insert failed');
        return reply.status(500).send({ success: false, error: 'Database error' });
      }

      fastify.log.info({ rowCount: result.rowCount, adminEmail: process.env.ADMIN_EMAIL }, 'Early access insert result');

      if (result.rowCount && result.rowCount > 0) {
        try {
          await sendEarlyAccessNotificationEmail(email.trim().toLowerCase());
          fastify.log.info('Early access notification email sent');
        } catch (err: any) {
          fastify.log.error({ err: err.message }, 'Early access email failed');
        }
      }

      return reply.send({ success: true });
    }
  );

  // GET /api/early-access — requires auth, returns all signups
  fastify.get(
    '/api/early-access',
    async (request: FastifyRequest, reply: FastifyReply) => {
      let session: Awaited<ReturnType<typeof auth.api.getSession>>;
      try {
        session = await auth.api.getSession({ headers: request.headers as any });
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      if (!session) return reply.status(401).send({ error: 'Unauthorized' });

      const { rows } = await pool.query(
        `SELECT id, email, created_at FROM public.early_access_requests ORDER BY created_at DESC`
      );

      return reply.send({ success: true, data: rows, total: rows.length });
    }
  );
}
