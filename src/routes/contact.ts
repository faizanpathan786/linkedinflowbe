import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sendContactEmail } from '../lib/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ContactBody {
  name: string;
  email: string;
  message: string;
}

export default async function contactRoutes(fastify: FastifyInstance) {
  // POST /api/contact — public, no auth required
  fastify.post(
    '/api/contact',
    async (request: FastifyRequest<{ Body: ContactBody }>, reply: FastifyReply) => {
      const { name, email, message } = request.body ?? {};

      if (!name || typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
        return reply.status(400).send({ success: false, error: 'A valid name is required' });
      }
      if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
        return reply.status(400).send({ success: false, error: 'A valid email is required' });
      }
      if (!message || typeof message !== 'string' || !message.trim() || message.trim().length > 5000) {
        return reply.status(400).send({ success: false, error: 'A valid message is required (max 5000 characters)' });
      }

      try {
        await sendContactEmail(name.trim(), email.trim().toLowerCase(), message.trim());
        fastify.log.info({ from: email.trim().toLowerCase() }, 'Contact email sent');
        return reply.send({ success: true });
      } catch (err: any) {
        fastify.log.error({ err: err.message }, 'Contact email failed');
        return reply.status(500).send({ success: false, error: 'Failed to send message. Please try again.' });
      }
    }
  );
}
