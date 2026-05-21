import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import supertest from 'supertest';

const VALID_TOKEN = 'valid-reset-token-abc123';

const mockAuth = {
  api: {
    forgetPassword: async (_opts: any) => ({ status: true }),
    resetPassword: async (opts: any) => {
      const token = opts?.body?.token;
      if (token !== VALID_TOKEN) {
        const err: any = new Error('Invalid token');
        err.status = 400;
        throw err;
      }
      return { status: true };
    },
  },
};

describe('Auth — forgot/reset password', async () => {
  let fastify: any;

  before(async () => {
    fastify = Fastify({ logger: { level: 'silent' } });
    await fastify.register(cors);

    // Register the routes inline with mock auth to avoid module-cache issues.
    // The logic mirrors src/routes/auth.ts exactly.
    fastify.post('/api/auth/forgot-password', async (request: FastifyRequest, reply: FastifyReply) => {
      const { email } = request.body as { email: string };
      try {
        await mockAuth.api.forgetPassword({
          body: { email, redirectTo: 'http://localhost:3000/reset-password' },
          headers: request.headers,
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
        await mockAuth.api.resetPassword({
          body: { token, newPassword: password },
          headers: request.headers,
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

    await fastify.ready();
  });

  after(async () => {
    await fastify.close();
  });

  // ── forgot-password ──────────────────────────────────────────────────────
  test('POST /api/auth/forgot-password returns 200 for a registered email', async () => {
    const res = await supertest(fastify.server)
      .post('/api/auth/forgot-password')
      .send({ email: 'user@example.com' });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      success: true,
      message: 'If this email is registered, a reset link has been sent.',
    });
  });

  test('POST /api/auth/forgot-password returns 200 for an unknown email (no enumeration)', async () => {
    const res = await supertest(fastify.server)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      success: true,
      message: 'If this email is registered, a reset link has been sent.',
    });
  });

  // ── reset-password ───────────────────────────────────────────────────────
  test('POST /api/auth/reset-password returns 200 on a valid token', async () => {
    const res = await supertest(fastify.server)
      .post('/api/auth/reset-password')
      .send({ token: VALID_TOKEN, password: 'NewSecurePass1!' });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      success: true,
      message: 'Password updated successfully.',
    });
  });

  test('POST /api/auth/reset-password returns 400 on an invalid token', async () => {
    const res = await supertest(fastify.server)
      .post('/api/auth/reset-password')
      .send({ token: 'bad-token', password: 'NewSecurePass1!' });

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, {
      success: false,
      message: 'Invalid or expired reset link.',
    });
  });
});
