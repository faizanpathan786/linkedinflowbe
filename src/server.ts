import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import linkedinRoutes from './routes/linkedin';
import oauthRoutes from './routes/oauth';
import postsRoutes from './routes/posts';
import authRoutes from './routes/auth';
import schedulerRoutes from './routes/scheduler';
import aiRoutes from './routes/ai';
import { auth } from './auth';

const importPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

server.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['set-cookie'],
});

server.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));
server.get('/debug/routes', async () => ({ routes: server.printRoutes() }));

// POST /posts/import — registered at top level to guarantee route registration
server.post('/posts/import', async (request: FastifyRequest, reply: FastifyReply) => {
  const session = await auth.api.getSession({ headers: request.headers as any });
  if (!session) return reply.status(401).send({ error: 'Unauthorized' });

  const userId = session.user.id;
  const body = request.body as any;
  const { file, filename } = body || {};

  if (!file || !filename) {
    return reply.status(400).send({ error: 'file and filename are required' });
  }

  const fname = String(filename).toLowerCase();
  if (!fname.endsWith('.xlsx') && !fname.endsWith('.xls') && !fname.endsWith('.csv')) {
    return reply.status(400).send({ error: 'Only .xlsx, .xls, and .csv files are supported' });
  }

  const XLSX = await import('xlsx');
  let rows: any[];
  try {
    const fileBuffer = Buffer.from(String(file), 'base64');
    const wb = XLSX.read(fileBuffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  } catch (err: any) {
    return reply.status(400).send({ error: 'Failed to parse file', message: err.message });
  }

  if (rows.length === 0) return reply.status(400).send({ error: 'File has no data rows' });
  if (rows.length > 50) return reply.status(400).send({ error: 'Maximum 50 rows per import' });

  const created: any[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  const scheduledAtCount: Record<string, number> = {};

  const client = await importPool.connect();
  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const content = String(row.content || '').trim();
      if (!content) { errors.push({ row: rowNum, message: 'content is required' }); continue; }

      const validTypes = ['text', 'image', 'link'];
      const post_type = validTypes.includes(row.post_type) ? row.post_type : 'text';
      const link_url = String(row.link_url || '').trim() || null;
      const publish_now = ['true', 'yes', '1', true].includes(
        typeof row.publish_now === 'string' ? row.publish_now.toLowerCase().trim() : row.publish_now
      );

      let scheduledDate: Date | null = null;
      let status = 'draft';

      if (publish_now) {
        scheduledDate = new Date();
        status = 'scheduled';
      } else if (row.scheduled_at) {
        const parsed = typeof row.scheduled_at === 'number'
          ? new Date((row.scheduled_at - 25569) * 86400 * 1000)
          : new Date(row.scheduled_at);
        if (isNaN(parsed.getTime())) { errors.push({ row: rowNum, message: 'Invalid scheduled_at format' }); continue; }
        if (parsed <= new Date()) { errors.push({ row: rowNum, message: 'scheduled_at must be a future date' }); continue; }
        const key = parsed.toISOString();
        const offset = scheduledAtCount[key] ?? 0;
        scheduledAtCount[key] = offset + 1;
        scheduledDate = new Date(parsed.getTime() + offset * 60 * 1000);
        status = 'scheduled';
      }

      try {
        const result = await client.query(
          `INSERT INTO public.posts (user_id, content, post_type, link_url, status, scheduled_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, content, post_type, link_url, status, scheduled_at, created_at`,
          [userId, content, post_type, link_url, status, scheduledDate]
        );
        created.push({ row: rowNum, ...result.rows[0] });
      } catch (err: any) {
        errors.push({ row: rowNum, message: err.message });
      }
    }
  } finally {
    client.release();
  }

  return reply.status(201).send({
    success: true,
    imported: created.length,
    failed: errors.length,
    total: rows.length,
    posts: created,
    errors: errors.length > 0 ? errors : undefined,
  });
});

server.register(linkedinRoutes);
server.register(oauthRoutes);
server.register(postsRoutes);
server.register(authRoutes);
server.register(schedulerRoutes);
server.register(aiRoutes);

export default server;
