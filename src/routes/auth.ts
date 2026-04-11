import type { FastifyInstance, FastifyReply } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { auth } from '../auth';

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
    // better-auth throws APIError objects with a `status` and `body`
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
      return { user: session.user, session: session.session };
    } catch (error) {
      console.error('Session check error:', error);
      return reply.code(500).send({ error: 'Internal server error' });
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
      })
    );
  });

  fastify.post('/api/signin', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { email: string; password: string };
    return forwardAuthResponse(reply, () =>
      auth.api.signInEmail({
        body: { email: body.email, password: body.password },
        headers: request.headers as any,
        asResponse: true,
      })
    );
  });

  fastify.post('/api/signout', async (request: FastifyRequest, reply: FastifyReply) => {
    return forwardAuthResponse(reply, () =>
      auth.api.signOut({
        headers: request.headers as any,
        asResponse: true,
      })
    );
  });
}
