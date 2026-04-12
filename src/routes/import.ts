import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { auth } from '../auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

type PostType = 'text' | 'image' | 'link';
type PostStatus = 'draft' | 'scheduled';

interface ExcelRow {
  content?: string;
  post_type?: string;
  link_url?: string;
  scheduled_at?: string | number;
  publish_now?: string | boolean;
}

// Excel serial date → JS Date
function excelDateToJSDate(serial: number): Date {
  const utcDays = Math.floor(serial - 25569);
  return new Date(utcDays * 86400 * 1000);
}

function parseScheduledAt(value: string | number | undefined): Date | null {
  if (!value) return null;
  if (typeof value === 'number') {
    return excelDateToJSDate(value);
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function parseBoolean(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', 'yes', '1'].includes(value.toLowerCase().trim());
  return false;
}

export default async function importRoutes(fastify: FastifyInstance) {

  // GET /posts/import/template — download an Excel template
  fastify.get('/posts/import/template', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: request.headers as any });
    if (!session) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const wb = XLSX.utils.book_new();

    const templateData = [
      {
        content: 'Your post content goes here',
        post_type: 'text',
        link_url: '',
        scheduled_at: '2026-05-01T10:00:00',
        publish_now: 'false',
      },
      {
        content: 'Another post with a link',
        post_type: 'link',
        link_url: 'https://example.com',
        scheduled_at: '2026-05-02T10:00:00',
        publish_now: 'false',
      },
      {
        content: 'Publish this immediately',
        post_type: 'text',
        link_url: '',
        scheduled_at: '',
        publish_now: 'true',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);

    // Set column widths
    ws['!cols'] = [
      { wch: 50 }, // content
      { wch: 12 }, // post_type
      { wch: 40 }, // link_url
      { wch: 25 }, // scheduled_at
      { wch: 15 }, // publish_now
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Posts');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="posts_template.xlsx"')
      .send(buffer);
  });

  // POST /posts/import — upload Excel file and bulk create posts
  fastify.post('/posts/import', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: request.headers as any });
    if (!session) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = session.user.id;

    let fileBuffer: Buffer;

    try {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const filename = data.filename.toLowerCase();
      if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls') && !filename.endsWith('.csv')) {
        return reply.status(400).send({
          error: 'Invalid file type',
          message: 'Only .xlsx, .xls, and .csv files are supported',
        });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      fileBuffer = Buffer.concat(chunks);
    } catch (err: any) {
      return reply.status(400).send({ error: 'Failed to read uploaded file', message: err.message });
    }

    // Parse the workbook
    let rows: ExcelRow[];
    try {
      const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: false });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json<ExcelRow>(ws, { defval: '' });
    } catch (err: any) {
      return reply.status(400).send({ error: 'Failed to parse file', message: err.message });
    }

    if (rows.length === 0) {
      return reply.status(400).send({ error: 'File is empty or has no data rows' });
    }

    if (rows.length > 50) {
      return reply.status(400).send({
        error: 'Too many rows',
        message: 'Maximum 50 posts per import. Split your file into batches.',
      });
    }

    const created: any[] = [];
    const errors: Array<{ row: number; message: string }> = [];

    // Track staggering for posts scheduled at the same time
    const scheduledAtCount: Record<string, number> = {};

    const client = await pool.connect();
    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // +2 because row 1 is header

        // Validate content
        const content = String(row.content || '').trim();
        if (!content) {
          errors.push({ row: rowNum, message: 'content is required' });
          continue;
        }

        // Validate post_type
        const validTypes: PostType[] = ['text', 'image', 'link'];
        const post_type: PostType = validTypes.includes(row.post_type as PostType)
          ? (row.post_type as PostType)
          : 'text';

        const link_url = String(row.link_url || '').trim() || null;
        const publish_now = parseBoolean(row.publish_now);

        let scheduledDate: Date | null = null;
        let status: PostStatus = 'draft';

        if (publish_now) {
          scheduledDate = new Date();
          status = 'scheduled';
        } else {
          const parsedDate = parseScheduledAt(row.scheduled_at);
          if (parsedDate) {
            if (parsedDate <= new Date()) {
              errors.push({ row: rowNum, message: 'scheduled_at must be a future date' });
              continue;
            }

            // Auto-stagger posts with the same scheduled_at
            const key = parsedDate.toISOString();
            const offset = scheduledAtCount[key] ?? 0;
            scheduledAtCount[key] = offset + 1;

            scheduledDate = new Date(parsedDate.getTime() + offset * 60 * 1000);
            status = 'scheduled';
          }
        }

        try {
          const result = await client.query(
            `INSERT INTO public.posts
               (user_id, content, post_type, link_url, status, scheduled_at)
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
}
