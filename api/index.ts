import 'dotenv/config';
import type { IncomingMessage, ServerResponse } from 'http';
import server from '../src/server';

// Vercel serverless entry point — wraps Fastify for serverless execution
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await server.ready();
  server.server.emit('request', req, res);
}
