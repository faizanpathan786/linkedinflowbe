import type { FastifyInstance, FastifyReply } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { auth } from '../auth';

export default async function authRoutes(fastify: FastifyInstance) {
  
  // Get current session
  fastify.get('/api/me', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const session = await auth.api.getSession({
        headers: request.headers as any,
      });
      
      if (!session) {
        return reply.code(401).send({ error: 'Not authenticated' });
      }
      
      return { user: session.user, session: session.session };
    } catch (error) {
      console.error('Session check error:', error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Sign up endpoint
  fastify.post('/api/signup', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { email: string; password: string; name?: string };
      
      const signupData: any = {
        email: body.email,
        password: body.password,
          emailVerification: {
        strategy: "code",
      },
      };
      
      if (body.name) {
        signupData.name = body.name;
      }
      
      const result = await auth.api.signUpEmail({
        body: signupData,
        headers: request.headers as any,
      });

      console.log('Signup result:', result);
      
      return result;
    } catch (error: any) {
      console.error('Signup error:', error);
      return reply.code(400).send({ error: error.message || 'Signup failed' });
    }
  });

  

  // Sign in endpoint
  fastify.post('/api/signin', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { email: string; password: string };
      
      const result = await auth.api.signInEmail({
        body: {
          email: body.email,
          password: body.password,
        },
        headers: request.headers as any,
      });
      
      return result;
    } catch (error: any) {
      console.error('Signin error:', error);
      return reply.code(400).send({ error: error.message || 'Signin failed' });
    }
  });

  // Sign out endpoint
  fastify.post('/api/signout', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // First check if there's an active session
      const session = await auth.api.getSession({
        headers: request.headers as any,
      });
      
      if (session) {
        await auth.api.signOut({
          headers: request.headers as any,
        });
      }
      return { success: true };
    } catch (error: any) {
      console.error('Signout error:', error);
      if (error.body?.code === 'FAILED_TO_GET_SESSION') {
        console.log('No active session found during signout, treating as success');
        return { success: true };
      }
      
      return reply.code(500).send({ error: error.message || 'Signout failed' });
    }
  });
}