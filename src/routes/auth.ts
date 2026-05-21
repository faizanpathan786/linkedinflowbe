import type { FastifyInstance, FastifyReply } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { auth } from '../auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Helper: call a better-auth API method and forward the Response to Fastify
async function forwardAuthResponse(
  reply: FastifyReply,
  fn: () => Promise<Response>
) {
  try {
    const response = await fn();
    const text = await response.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
    return reply.status(response.status).send(body);
  } catch (err: any) {
    console.error('better-auth error:', err?.message, err?.stack);
    const status = err?.status ?? err?.statusCode ?? 400;
    const message = err?.body?.message ?? err?.message ?? 'Request failed';
    return reply.status(status).send({ error: message });
  }
}

export default async function authRoutes(fastify: FastifyInstance) {

  fastify.get('/api/me', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) return reply.code(401).send({ error: 'Not authenticated' });

      // Enrich with profile fields not stored in the session
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT timezone, notification_preferences FROM public."user" WHERE id = $1`,
          [session.user.id]
        );
        const extra = result.rows[0] ?? {};
        return {
          user: {
            ...session.user,
            timezone: extra.timezone ?? 'UTC',
            notification_preferences: extra.notification_preferences ?? {},
          },
          session: session.session,
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Session check error:', error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/api/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: request.headers as any });
    if (!session) return reply.code(401).send({ error: 'Not authenticated' });

    const body = request.body as {
      name?: string;
      timezone?: string;
      notification_preferences?: Record<string, unknown>;
    };

    const setClauses: string[] = [];
    const values: any[] = [];

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return reply.code(400).send({ success: false, message: 'Name must be a non-empty string' });
      }
      values.push(body.name.trim().slice(0, 100));
      setClauses.push(`name = $${values.length}`);
    }

    if (body.timezone !== undefined) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: body.timezone });
      } catch {
        return reply.code(400).send({
          success: false,
          message: `Invalid timezone: "${body.timezone}". Use an IANA timezone string like "America/New_York".`,
          code: 'INVALID_TIMEZONE',
        });
      }
      values.push(body.timezone);
      setClauses.push(`timezone = $${values.length}`);
    }

    if (body.notification_preferences !== undefined) {
      if (typeof body.notification_preferences !== 'object' || Array.isArray(body.notification_preferences)) {
        return reply.code(400).send({ success: false, message: 'notification_preferences must be an object' });
      }
      values.push(JSON.stringify(body.notification_preferences));
      setClauses.push(`notification_preferences = $${values.length}`);
    }

    if (setClauses.length === 0) {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT id, email, name, timezone FROM public."user" WHERE id = $1`,
          [session.user.id]
        );
        if (result.rows.length === 0) return reply.code(404).send({ error: 'User not found' });
        const u = result.rows[0];
        return reply.send({ success: true, user: { id: u.id, email: u.email, name: u.name, timezone: u.timezone } });
      } finally {
        client.release();
      }
    }

    values.push(new Date());
    setClauses.push(`"updatedAt" = $${values.length}`);

    values.push(session.user.id);
    const whereParam = `$${values.length}`;

    const client = await pool.connect();
    try {
      const result = await client.query(
        `UPDATE public."user"
         SET ${setClauses.join(', ')}
         WHERE id = ${whereParam}
         RETURNING id, email, name, timezone, notification_preferences`,
        values
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ success: false, message: 'User not found' });
      }

      const u = result.rows[0];
      return reply.send({
        success: true,
        user: {
          id: u.id,
          email: u.email,
          name: u.name,
          timezone: u.timezone,
          notification_preferences: u.notification_preferences,
        },
      });
    } finally {
      client.release();
    }
  });

  fastify.post('/api/signup', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { email: string; password: string; name?: string };
    return forwardAuthResponse(reply, () =>
      auth.api.signUpEmail({
        body: {
          email: body.email,
          password: body.password,
          name: body.name ?? body.email.split('@')[0],
        },
        headers: request.headers as any,
        asResponse: true,
      }) as unknown as Promise<Response>
    );
  });

  fastify.post('/api/signin', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { email: string; password: string };
    return forwardAuthResponse(reply, () =>
      auth.api.signInEmail({
        body: { email: body.email, password: body.password },
        headers: request.headers as any,
        asResponse: true,
      }) as unknown as Promise<Response>
    );
  });

  fastify.post('/api/signout', async (request: FastifyRequest, reply: FastifyReply) => {
    return forwardAuthResponse(reply, () =>
      auth.api.signOut({
        headers: request.headers as any,
        asResponse: true,
      }) as unknown as Promise<Response>
    );
  });

  fastify.post('/api/auth/forgot-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const { email } = request.body as { email: string };
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    try {
      await auth.api.forgetPassword({
        body: { email, redirectTo: `${frontendUrl}/reset-password` },
        headers: request.headers as any,
      });
    } catch {
      // swallow — never reveal whether the email exists
    }

    return reply.send({
      success: true,
      message: 'If this email is registered, a reset link has been sent.',
    });
  });

  fastify.post('/api/auth/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const { token, password } = request.body as { token: string; password: string };

    try {
      await auth.api.resetPassword({
        body: { token, newPassword: password },
        headers: request.headers as any,
      });
      return reply.send({
        success: true,
        message: 'Password updated successfully.',
      });
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode ?? 0;
      if (status >= 400 && status < 500) {
        return reply.status(400).send({
          success: false,
          message: 'Invalid or expired reset link.',
        });
      }
      throw err;
    }
  });
}
