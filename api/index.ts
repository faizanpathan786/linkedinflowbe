import 'dotenv/config';
import type { IncomingMessage, ServerResponse } from 'http';

let serverInstance: any = null;

function normalizeRequestUrl(url: string | undefined): string {
  const currentUrl = url ?? '/';
  const [pathname, queryString] = currentUrl.split('?');

  if (pathname === '/api') {
    return queryString ? `/?${queryString}` : '/';
  }

  if (pathname.startsWith('/api/')) {
    const normalizedPath = pathname.slice(4);
    return queryString ? `${normalizedPath}?${queryString}` : normalizedPath;
  }

  return currentUrl;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (!serverInstance) {
      const { default: server } = await import('../src/server');
      await server.ready();
      serverInstance = server;
    }

    (req as any).url = normalizeRequestUrl(req.url);
    serverInstance.server.emit('request', req, res);
  } catch (err: any) {
    console.error('Fastify startup error:', err?.message, err?.stack);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Server failed to start',
      message: err?.message,
      stack: err?.stack,
    }));
  }
}
