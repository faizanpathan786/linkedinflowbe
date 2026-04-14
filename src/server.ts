import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { Pool } from 'pg';
import axios from 'axios';
import linkedinRoutes from './routes/linkedin';
import oauthRoutes from './routes/oauth';
import postsRoutes from './routes/posts';
import authRoutes from './routes/auth';
import schedulerRoutes from './routes/scheduler';
import aiRoutes from './routes/ai';
import { auth } from './auth';
import { downloadVideoFromUrl, uploadVideoToStorage, ensureVideoBucket } from './lib/supabase';

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

server.register(multipart, {
  limits: { fileSize: 250 * 1024 * 1024 }, // 250 MB
});

// Ensure Supabase Storage bucket exists for videos
ensureVideoBucket().catch((err) => server.log.error('Failed to create video storage bucket:', err?.message));

server.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString(), version: 'v7-video' }));
server.get('/debug/routes', async () => ({ routes: server.printRoutes() }));

// POST /posts/import — registered at top level to guarantee route registration
server.post('/posts/import', async (request: FastifyRequest, reply: FastifyReply) => {
  let session: any;
  try {
    session = await auth.api.getSession({ headers: request.headers as any });
  } catch (err: any) {
    server.log.error('getSession error on /posts/import:', err?.message);
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  if (!session) return reply.status(401).send({ error: 'Unauthorized' });

  const userId = session.user.id;
  let file: string | undefined;
  let filename: string | undefined;

  if ((request as any).isMultipart?.()) {
    for await (const part of (request as any).parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const buffer = await part.toBuffer();
        file = buffer.toString('base64');
        filename = part.filename;
      } else if (part.fieldname === 'filename') {
        filename = String(part.value);
      }
    }
  } else {
    const body = request.body as any;
    file = body?.file;
    filename = body?.filename;
  }

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
  const warnings: Array<{ row: number; message: string }> = [];
  const scheduledAtCount: Record<string, number> = {};

  const client = await importPool.connect();
  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const content = String(row.content || '').trim();
      if (!content) { errors.push({ row: rowNum, message: 'content is required' }); continue; }

      const validTypes = ['text', 'image', 'link', 'video'];
      const post_type = validTypes.includes(row.post_type) ? row.post_type : 'text';
      const link_url = String(row.link_url || '').trim() || null;
      const image_url = String(row.image_url || '').trim() || null;
      const video_url = String(row.video_url || '').trim() || null;
      const publish_now = ['true', 'yes', '1', true].includes(
        typeof row.publish_now === 'string' ? row.publish_now.toLowerCase().trim() : row.publish_now
      );

      // Fetch image from URL and convert to base64 if provided
      let image_base64: string | null = null;
      let image_type: string | null = null;
      if (image_url) {
        try {
          const imgRes = await axios.get(image_url, { responseType: 'arraybuffer', timeout: 10000 });
          image_base64 = Buffer.from(imgRes.data).toString('base64');
          image_type = (imgRes.headers['content-type'] as string) || 'image/jpeg';
        } catch (imgErr: any) {
          warnings.push({ row: rowNum, message: `Image skipped: ${imgErr.message}` });
        }
      }

      // Download video from URL and upload to Supabase Storage
      let video_storage_path: string | null = null;
      if (video_url) {
        try {
          const { buffer, contentType } = await downloadVideoFromUrl(video_url);
          const { storagePath } = await uploadVideoToStorage(buffer, contentType, userId);
          video_storage_path = storagePath;
        } catch (vidErr: any) {
          warnings.push({ row: rowNum, message: `Video skipped: ${vidErr.message}` });
        }
      }

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
          `INSERT INTO public.posts (user_id, content, post_type, link_url, status, scheduled_at, image_base64, image_type, video_storage_path)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, content, post_type, link_url, status, scheduled_at, image_type, video_storage_path, created_at`,
          [userId, content, post_type, link_url, status, scheduledDate, image_base64, image_type, video_storage_path]
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
    warnings: warnings.length > 0 ? warnings : undefined,
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
