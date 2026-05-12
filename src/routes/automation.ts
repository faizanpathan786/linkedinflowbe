import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { auth } from '../auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Default settings
const DEFAULT_SETTINGS = {
  autoRetry: true,
  retryAttempts: 3,
  delayBetweenPosts: 5,
  enableScheduling: true,
  maxDailyPosts: 10,
};

// Validation constraints
const CONSTRAINTS = {
  retryAttempts: { min: 1, max: 5 },
  delayBetweenPosts: { min: 1, max: 60 },
  maxDailyPosts: { min: 1, max: 50 },
};

// Ensure table exists
async function ensureTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.automation_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
        auto_retry BOOLEAN DEFAULT true,
        retry_attempts INTEGER DEFAULT 3 CHECK (retry_attempts >= 1 AND retry_attempts <= 5),
        delay_between_posts INTEGER DEFAULT 5 CHECK (delay_between_posts >= 1 AND delay_between_posts <= 60),
        enable_scheduling BOOLEAN DEFAULT true,
        max_daily_posts INTEGER DEFAULT 10 CHECK (max_daily_posts >= 1 AND max_daily_posts <= 50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_automation_settings_user_id ON public.automation_settings(user_id);
    `);
  } finally {
    client.release();
  }
}

// Validate settings
function validateSettings(settings: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof settings.autoRetry !== 'boolean') {
    errors.push('autoRetry must be a boolean');
  }

  if (
    !Number.isInteger(settings.retryAttempts) ||
    settings.retryAttempts < CONSTRAINTS.retryAttempts.min ||
    settings.retryAttempts > CONSTRAINTS.retryAttempts.max
  ) {
    errors.push(
      `retryAttempts must be an integer between ${CONSTRAINTS.retryAttempts.min} and ${CONSTRAINTS.retryAttempts.max}`
    );
  }

  if (
    !Number.isInteger(settings.delayBetweenPosts) ||
    settings.delayBetweenPosts < CONSTRAINTS.delayBetweenPosts.min ||
    settings.delayBetweenPosts > CONSTRAINTS.delayBetweenPosts.max
  ) {
    errors.push(
      `delayBetweenPosts must be an integer between ${CONSTRAINTS.delayBetweenPosts.min} and ${CONSTRAINTS.delayBetweenPosts.max}`
    );
  }

  if (typeof settings.enableScheduling !== 'boolean') {
    errors.push('enableScheduling must be a boolean');
  }

  if (
    !Number.isInteger(settings.maxDailyPosts) ||
    settings.maxDailyPosts < CONSTRAINTS.maxDailyPosts.min ||
    settings.maxDailyPosts > CONSTRAINTS.maxDailyPosts.max
  ) {
    errors.push(
      `maxDailyPosts must be an integer between ${CONSTRAINTS.maxDailyPosts.min} and ${CONSTRAINTS.maxDailyPosts.max}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export default async function automationRoutes(fastify: FastifyInstance) {
  // Ensure table exists on startup
  try {
    await ensureTable();
  } catch (err: any) {
    fastify.log.error('Failed to create automation_settings table:', err.message);
  }

  // GET /api/automation/settings
  fastify.get(
    '/api/automation/settings',
    async (request: FastifyRequest, reply: FastifyReply) => {
      let session: any;
      try {
        session = await auth.api.getSession({ headers: request.headers as any });
      } catch (err: any) {
        fastify.log.error('Auth error:', err.message);
      }

      if (!session) {
        return reply.status(401).send({ message: 'Unauthorized' });
      }

      const userId = session.user.id;
      const client = await pool.connect();

      try {
        const result = await client.query(
          `SELECT auto_retry, retry_attempts, delay_between_posts, enable_scheduling, max_daily_posts
           FROM public.automation_settings
           WHERE user_id = $1`,
          [userId]
        );

        if (result.rows.length > 0) {
          const row = result.rows[0];
          return reply.send({
            settings: {
              autoRetry: row.auto_retry,
              retryAttempts: row.retry_attempts,
              delayBetweenPosts: row.delay_between_posts,
              enableScheduling: row.enable_scheduling,
              maxDailyPosts: row.max_daily_posts,
            },
          });
        }
        return reply.send({ settings: DEFAULT_SETTINGS });
      } catch (err: any) {
        // Table doesn't exist yet — return defaults rather than 500
        if ((err as any).code === '42P01') {
          return reply.send({ settings: DEFAULT_SETTINGS });
        }
        fastify.log.error('Failed to fetch automation settings:', err.message);
        return reply.status(500).send({ message: 'Failed to fetch automation settings' });
      } finally {
        client.release();
      }
    }
  );

  // POST /api/automation/settings
  fastify.post(
    '/api/automation/settings',
    async (
      request: FastifyRequest<{
        Body: {
          autoRetry: boolean;
          retryAttempts: number;
          delayBetweenPosts: number;
          enableScheduling: boolean;
          maxDailyPosts: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      let session: any;
      try {
        session = await auth.api.getSession({ headers: request.headers as any });
      } catch (err: any) {
        fastify.log.error('Auth error:', err.message);
      }

      if (!session) {
        return reply.status(401).send({ message: 'Unauthorized' });
      }

      const userId = session.user.id;
      const settings = request.body;

      // Validate input
      const validation = validateSettings(settings);
      if (!validation.valid) {
        return reply.status(400).send({
          message: 'Invalid automation settings',
          errors: validation.errors,
        });
      }

      const client = await pool.connect();

      try {
        // Upsert: try update first, then insert if not found
        const updateResult = await client.query(
          `UPDATE public.automation_settings
           SET auto_retry = $1,
               retry_attempts = $2,
               delay_between_posts = $3,
               enable_scheduling = $4,
               max_daily_posts = $5,
               updated_at = NOW()
           WHERE user_id = $6
           RETURNING auto_retry, retry_attempts, delay_between_posts, enable_scheduling, max_daily_posts`,
          [
            settings.autoRetry,
            settings.retryAttempts,
            settings.delayBetweenPosts,
            settings.enableScheduling,
            settings.maxDailyPosts,
            userId,
          ]
        );

        let row = updateResult.rows[0];

        // If no rows were updated, insert new record
        if (!row) {
          const insertResult = await client.query(
            `INSERT INTO public.automation_settings
             (user_id, auto_retry, retry_attempts, delay_between_posts, enable_scheduling, max_daily_posts)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING auto_retry, retry_attempts, delay_between_posts, enable_scheduling, max_daily_posts`,
            [
              userId,
              settings.autoRetry,
              settings.retryAttempts,
              settings.delayBetweenPosts,
              settings.enableScheduling,
              settings.maxDailyPosts,
            ]
          );

          row = insertResult.rows[0];
        }

        return reply.send({
          success: true,
          settings: {
            autoRetry: row.auto_retry,
            retryAttempts: row.retry_attempts,
            delayBetweenPosts: row.delay_between_posts,
            enableScheduling: row.enable_scheduling,
            maxDailyPosts: row.max_daily_posts,
          },
        });
      } catch (err: any) {
        fastify.log.error('Failed to update automation settings:', err.message);
        return reply.status(500).send({
          message: 'Failed to update automation settings',
        });
      } finally {
        client.release();
      }
    }
  );
}
