import 'dotenv/config';
import type { IncomingMessage, ServerResponse } from 'http';
import server from '../src/server';

let isReady = false;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (!isReady) {
      await server.ready();
      isReady = true;
    }
    server.server.emit('request', req, res);
  } catch (err: any) {
    console.error('Fastify startup error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server failed to start', message: err?.message }));
  }
}
