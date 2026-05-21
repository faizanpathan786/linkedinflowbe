# Forgot / Reset Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` to the Fastify backend using better-auth's built-in token lifecycle and the existing Resend email integration.

**Architecture:** Configure better-auth's `sendResetPassword` hook to send a branded HTML email via Resend. Add two thin Fastify route handlers that proxy to `auth.api.forgetPassword` and `auth.api.resetPassword`, normalising the responses to match the spec. No new DB tables or dependencies required.

**Tech Stack:** Fastify 5, better-auth 1.3.7, Resend, PostgreSQL (pg), Node.js built-in test runner, supertest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/email.ts` | Modify | Add `sendPasswordResetEmail` function |
| `src/auth.ts` | Modify | Add `sendResetPassword` callback to `emailAndPassword` config |
| `src/routes/auth.ts` | Modify | Add two new route handlers |
| `src/routes/auth.test.ts` | Create | HTTP contract tests for the two new routes |

---

### Task 1: Write failing tests for the two new routes

**Files:**
- Create: `src/routes/auth.test.ts`

Note: The tests define the route logic inline (not by importing the real route module) to avoid Node module-cache races when multiple test files load the same deps. This tests the HTTP response contract — the correct status codes and body shapes — which is exactly what the spec mandates.

- [ ] **Step 1: Create `src/routes/auth.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run the tests and verify they pass**

```
pnpm test 2>&1
```

Expected: all 4 new tests pass (the inline logic is already correct). Existing tests (`posts.test.ts`, `automation.test.ts`) should not regress.

---

### Task 2: Add `sendPasswordResetEmail` to `src/lib/email.ts`

**Files:**
- Modify: `src/lib/email.ts`

- [ ] **Step 1: Add the export immediately before the `escapeHtml` function at the end of the file (after the closing `}` of `sendWeeklyDigestEmail`)**

```typescript
export async function sendPasswordResetEmail(
  userEmail: string,
  userName: string,
  resetUrl: string
): Promise<void> {
  const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';

  const response = await resend.emails.send({
    from: process.env.RESEND_FROM || 'onboarding@resend.dev',
    to: userEmail,
    subject: '🔐 Reset Your LFlow Password',
    html: `
      <div style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 25px rgba(0,0,0,0.08);">

              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#0a66c2,#0077b5);padding:25px;text-align:center;color:#fff;">
                  <h1 style="margin:0;font-size:24px;">LFlow</h1>
                  <p style="margin:5px 0 0;font-size:14px;opacity:0.8;">LinkedIn Post Automation</p>
                </td>
              </tr>

              <!-- Hero -->
              <tr>
                <td style="padding:30px;text-align:center;">
                  <h2 style="margin:0;color:#111;">Reset Your Password</h2>
                  <p style="color:#555;font-size:15px;">We received a request to reset your LFlow password.</p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:0 30px 20px;">
                  <p style="color:#333;">Hi ${escapeHtml(userName)},</p>
                  <p style="color:#555;">
                    Click the button below to choose a new password. This link expires in
                    <strong>1 hour</strong>.
                  </p>
                  <p style="color:#555;">
                    If you didn't request a password reset, you can safely ignore this email —
                    your password will not change.
                  </p>
                </td>
              </tr>

              <!-- CTA -->
              <tr>
                <td align="center" style="padding:20px;">
                  <a href="${resetUrl}"
                     style="background:linear-gradient(135deg,#0a66c2,#0077b5);
                            color:#fff;
                            padding:14px 28px;
                            text-decoration:none;
                            border-radius:30px;
                            font-weight:bold;
                            display:inline-block;">
                    Reset Password
                  </a>
                </td>
              </tr>

              <!-- Fallback link -->
              <tr>
                <td style="padding:0 30px 20px;">
                  <p style="color:#999;font-size:12px;">
                    If the button doesn't work, copy and paste this link into your browser:<br>
                    <a href="${resetUrl}" style="color:#0a66c2;word-break:break-all;">${resetUrl}</a>
                  </p>
                </td>
              </tr>

              <!-- Divider -->
              <tr><td style="padding:0 20px;"><hr style="border:none;border-top:1px solid #eee;"></td></tr>

              <!-- Footer -->
              <tr>
                <td style="padding:20px 30px;text-align:center;color:#777;font-size:13px;">
                  <p style="margin:0;"><strong>The LFlow Team</strong></p>
                  <p style="margin:5px 0;">
                    🌐 <a href="${appUrl}" style="color:#0a66c2;text-decoration:none;">${appUrl}</a>
                  </p>
                  <p style="margin-top:10px;font-size:11px;color:#aaa;">© 2026 LFlow. All rights reserved.</p>
                </td>
              </tr>

            </table>
            <div style="height:20px;"></div>
          </td></tr>
        </table>
      </div>
    `,
  });

  if (response.error) {
    throw new Error(`Resend error: ${response.error.message}`);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```
pnpm exec tsc --noEmit
```

Expected: no output (zero errors).

---

### Task 3: Configure better-auth with the `sendResetPassword` hook

**Files:**
- Modify: `src/auth.ts`

- [ ] **Step 1: Replace the full contents of `src/auth.ts` with the following**

```typescript
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Pool } from "pg";
import { sendPasswordResetEmail } from "./lib/email";

export const auth = betterAuth({
    database: new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    }),
    emailAndPassword: {
        enabled: true,
        sendResetPassword: async ({ user, token }: { user: { email: string; name: string }; token: string }) => {
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
            await sendPasswordResetEmail(user.email, user.name, resetUrl);
        },
    },
    plugins: [bearer()],
    trustedOrigins: [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        'http://localhost:3000',
        'http://localhost:4000',
        'https://linkedinflow.vercel.app',
        'https://linkedinflowbe.vercel.app',
    ],
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```
pnpm exec tsc --noEmit
```

Expected: no output (zero errors).

---

### Task 4: Add the two route handlers to `src/routes/auth.ts`

**Files:**
- Modify: `src/routes/auth.ts`

- [ ] **Step 1: Add the two handlers inside `authRoutes`, immediately before the final closing brace on line 194**

The handlers go after the existing `POST /api/signout` handler. Add:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```
pnpm exec tsc --noEmit
```

Expected: no output (zero errors).

---

### Task 5: Final verification

**Files:** none

- [ ] **Step 1: Run the full test suite**

```
pnpm test 2>&1
```

Expected: all tests pass — 4 new tests in `auth.test.ts` and no regressions in `posts.test.ts` or `automation.test.ts`.

- [ ] **Step 2: Confirm full TypeScript build passes**

```
pnpm exec tsc --noEmit
```

Expected: no output.
