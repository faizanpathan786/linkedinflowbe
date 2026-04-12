import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { auth } from '../auth';
import LinkedInService from '../services/linkedin.service';
import { sendPostPublishedEmail } from '../lib/email';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

type PostType = 'text' | 'image' | 'link';
type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed';

interface CreatePostBody {
  content: string;
  post_type?: PostType;
  link_url?: string;
  publish_now?: boolean;
  scheduled_at?: string; // ISO 8601 datetime string — if set and in the future, post is scheduled
  image_base64?: string;
  image_type?: string;
}

interface PostParams {
  id: string;
}

export default async function postsRoutes(fastify: FastifyInstance) {
  const linkedinService = new LinkedInService(fastify);

  // ── Shared helper ──────────────────────────────────────────────────────────
  // Fetches the user's LinkedIn token, validates it, and publishes via the
  // LinkedIn API. Returns the linkedin_post_id on success, throws on failure.
  async function publishPostToLinkedIn(
    userId: string,
    postContent: {
      content: string;
      link_url?: string | null;
      image_base64?: string;
      image_type?: string;
    }
  ): Promise<string | null> {
    const client = await pool.connect();
    try {
      const tokenResult = await client.query(
        `SELECT access_token, person_urn, expires_at FROM public.linkedin_tokens WHERE user_id = $1`,
        [userId]
      );

      if (tokenResult.rows.length === 0) {
        const err: any = new Error('Please connect your LinkedIn account first');
        err.statusCode = 400;
        err.code = 'LINKEDIN_NOT_CONNECTED';
        throw err;
      }

      const tokenData = tokenResult.rows[0];

      if (new Date(tokenData.expires_at) <= new Date()) {
        const err: any = new Error('Please reconnect your LinkedIn account');
        err.statusCode = 401;
        err.code = 'LINKEDIN_TOKEN_EXPIRED';
        throw err;
      }

      const imagePayload = postContent.image_base64
        ? {
            buffer: Buffer.from(postContent.image_base64, 'base64'),
            type: postContent.image_type || 'image/jpeg',
          }
        : undefined;

      const linkedinResponse = await linkedinService.createUnifiedPost(tokenData, {
        text: postContent.content,
        linkUrl: postContent.link_url ?? undefined,
        image: imagePayload,
      });

      return linkedinResponse?.id || null;
    } finally {
      client.release();
    }
  }

  // Fire-and-forget email notification after a successful publish
  async function notifyPublished(userId: string, postContent: string, publishedAt: Date) {
    try {
      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          `SELECT name, email FROM public."user" WHERE id = $1`,
          [userId]
        );
        if (rows.length === 0) return;
        const { name, email } = rows[0];
        await sendPostPublishedEmail(email, name, postContent, publishedAt.toISOString());
        fastify.log.info(`Published email sent to ${email}`);
      } finally {
        client.release();
      }
    } catch (err: any) {
      fastify.log.error(`Failed to send publish notification email: ${err.message}`);
    }
  }

  // POST /posts — create (and optionally publish) a post
  fastify.post(
    '/posts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1 },
            post_type: { type: 'string', enum: ['text', 'image', 'link'], default: 'text' },
            link_url: { type: 'string' },
            publish_now: { type: 'boolean', default: false },
            scheduled_at: { type: 'string', format: 'date-time' },
            image_base64: { type: 'string' },
            image_type: { type: 'string' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: CreatePostBody }>,
      reply: FastifyReply
    ) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const userId = session.user.id;
      const { content, post_type = 'text', link_url, publish_now = false, scheduled_at, image_base64, image_type } = request.body;

      // scheduled_at takes priority over publish_now
      const scheduledDate = scheduled_at ? new Date(scheduled_at) : null;
      const isScheduled = !!scheduledDate && scheduledDate > new Date();

      if (isScheduled && publish_now) {
        return reply.status(400).send({
          error: 'Conflicting options',
          message: 'Cannot use publish_now and scheduled_at together',
        });
      }

      if (scheduledDate && !isScheduled) {
        return reply.status(400).send({
          error: 'Invalid scheduled_at',
          message: 'scheduled_at must be a future datetime',
        });
      }

      const client = await pool.connect();
      try {
        let linkedin_post_id: string | null = null;
        let status: PostStatus = isScheduled ? 'scheduled' : 'draft';

        if (publish_now) {
          try {
            fastify.log.info({
              has_image_base64: !!image_base64,
              image_base64_length: image_base64?.length,
              image_type,
              post_type,
            }, 'POST /posts publish payload');

            linkedin_post_id = await publishPostToLinkedIn(userId, {
              content, link_url, image_base64, image_type,
            });
            status = 'published';
            notifyPublished(userId, content, new Date()); // fire-and-forget
          } catch (err: any) {
            fastify.log.error('LinkedIn publish error:', err.message);
            await client.query(
              `INSERT INTO public.posts (user_id, content, post_type, link_url, status)
               VALUES ($1, $2, $3, $4, 'failed')`,
              [userId, content, post_type, link_url || null]
            );
            return reply.status(err.statusCode || 502).send({
              success: false,
              error: err.code || 'LINKEDIN_PUBLISH_FAILED',
              message: err.message || 'Failed to publish to LinkedIn',
            });
          }
        }

        // Store image data for draft/scheduled posts so PATCH /publish can use it later.
        // For already-published posts the image was consumed; no need to persist it.
        const storeImage = status !== 'published';

        const result = await client.query(
          `INSERT INTO public.posts
             (user_id, content, post_type, link_url, linkedin_post_id, status, scheduled_at, published_at, image_base64, image_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, user_id, content, post_type, link_url, linkedin_post_id, status, scheduled_at, published_at, image_type, created_at, updated_at`,
          [
            userId,
            content,
            post_type,
            link_url || null,
            linkedin_post_id,
            status,
            scheduledDate ?? null,
            status === 'published' ? new Date() : null,
            storeImage ? (image_base64 || null) : null,
            storeImage ? (image_type || null) : null,
          ]
        );

        return reply.status(201).send({
          success: true,
          post: result.rows[0], // image_base64 excluded from RETURNING
        });
      } finally {
        client.release();
      }
    }
  );

  // PATCH /posts/:id — update content, link_url, post_type, scheduled_at
  fastify.patch(
    '/posts/:id',
    async (
      request: FastifyRequest<{
        Params: PostParams;
        Body: {
          content?: string;
          post_type?: PostType;
          link_url?: string | null;
          scheduled_at?: string | null;
        };
      }>,
      reply: FastifyReply
    ) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const userId = session.user.id;
      const { id } = request.params;
      const { content, post_type, link_url, scheduled_at } = request.body;

      const client = await pool.connect();
      try {
        // First check post exists at all
        const existsResult = await client.query(
          `SELECT * FROM public.posts WHERE id = $1`,
          [id]
        );

        if (existsResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Post not found' });
        }

        // Then check ownership separately so we can return 403
        if (existsResult.rows[0].user_id !== userId) {
          return reply.status(403).send({ error: 'Forbidden' });
        }

        const post = existsResult.rows[0];

        if (post.status !== 'draft' && post.status !== 'scheduled') {
          return reply.status(400).send({
            error: 'Cannot edit post',
            message: `Only draft or scheduled posts can be edited. This post is "${post.status}".`,
          });
        }

        // Determine new scheduled_at and status
        let newScheduledAt: Date | null = post.scheduled_at;
        let newStatus: PostStatus = post.status;

        if ('scheduled_at' in request.body) {
          if (scheduled_at === null || scheduled_at === '') {
            newScheduledAt = null;
            newStatus = 'draft';
          } else {
            const parsed = new Date(scheduled_at!);
            if (isNaN(parsed.getTime())) {
              return reply.status(400).send({ message: 'Invalid scheduled_at format' });
            }
            if (parsed <= new Date()) {
              return reply.status(400).send({ message: 'scheduled_at must be in the future' });
            }
            newScheduledAt = parsed;
            newStatus = 'scheduled';
          }
        }

        const updated = await client.query(
          `UPDATE public.posts
           SET content      = COALESCE($1, content),
               post_type    = COALESCE($2, post_type),
               link_url     = $3,
               scheduled_at = $4,
               status       = $5,
               updated_at   = NOW()
           WHERE id = $6 AND user_id = $7
           RETURNING id, user_id, content, post_type, link_url, status, scheduled_at, published_at, image_type, created_at, updated_at`,
          [
            content ?? null,
            post_type ?? null,
            'link_url' in request.body ? (link_url ?? null) : post.link_url,
            newScheduledAt,
            newStatus,
            id,
            userId,
          ]
        );

        return reply.send({ success: true, post: updated.rows[0] });
      } finally {
        client.release();
      }
    }
  );

  // PATCH /posts/:id/publish — publish a draft post to LinkedIn
  fastify.patch(
    '/posts/:id/publish',
    async (request: FastifyRequest<{ Params: PostParams }>, reply: FastifyReply) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const userId = session.user.id;
      const { id } = request.params;

      const client = await pool.connect();
      try {
        // 1. Find the post and verify ownership
        const postResult = await client.query(
          `SELECT * FROM public.posts WHERE id = $1 AND user_id = $2`,
          [id, userId]
        );

        if (postResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Post not found' });
        }

        const post = postResult.rows[0];

        // 2. Must be a draft or scheduled (allow manual early publish of scheduled posts)
        if (post.status !== 'draft' && post.status !== 'scheduled') {
          return reply.status(400).send({
            error: 'Post cannot be published',
            message: `Cannot publish a post with status "${post.status}"`,
          });
        }

        // 3 & 4. Publish to LinkedIn — use stored image data if present
        let linkedin_post_id: string | null = null;
        try {
          linkedin_post_id = await publishPostToLinkedIn(userId, {
            content: post.content,
            link_url: post.link_url,
            image_base64: post.image_base64 ?? undefined,
            image_type: post.image_type ?? undefined,
          });
        } catch (err: any) {
          fastify.log.error('LinkedIn publish error on PATCH /publish:', err.message);

          // Mark as failed in DB
          await client.query(
            `UPDATE public.posts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
            [id]
          );

          return reply.status(err.statusCode || 502).send({
            success: false,
            error: err.code || 'LINKEDIN_PUBLISH_FAILED',
            message: err.message || 'Failed to publish to LinkedIn',
          });
        }

        // 5. Update post to published — clear stored image data (no longer needed)
        const updated = await client.query(
          `UPDATE public.posts
           SET status = 'published', linkedin_post_id = $1, published_at = NOW(), updated_at = NOW(),
               image_base64 = NULL, image_type = NULL
           WHERE id = $2
           RETURNING id, user_id, content, post_type, link_url, linkedin_post_id, status, scheduled_at, published_at, created_at, updated_at`,
          [linkedin_post_id, id]
        );

        notifyPublished(userId, post.content, new Date()); // fire-and-forget

        // 6. Return updated post
        return reply.send({
          success: true,
          post: updated.rows[0],
        });
      } finally {
        client.release();
      }
    }
  );

  // GET /posts — list all posts for the authenticated user
  fastify.get('/posts', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: request.headers as any });
    if (!session) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, user_id, content, post_type, link_url, linkedin_post_id, status,
                scheduled_at, published_at, image_type, created_at, updated_at
         FROM public.posts WHERE user_id = $1 ORDER BY created_at DESC`,
        [session.user.id]
      );
      return reply.send({ posts: result.rows });
    } finally {
      client.release();
    }
  });

  // GET /posts/:id — get a single post
  fastify.get(
    '/posts/:id',
    async (request: FastifyRequest<{ Params: PostParams }>, reply: FastifyReply) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT * FROM public.posts WHERE id = $1 AND user_id = $2`,
          [request.params.id, session.user.id]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Post not found' });
        }

        return reply.send({ post: result.rows[0] });
      } finally {
        client.release();
      }
    }
  );

  // DELETE /posts/:id — delete a post
  fastify.delete(
    '/posts/:id',
    async (request: FastifyRequest<{ Params: PostParams }>, reply: FastifyReply) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const client = await pool.connect();
      try {
        const result = await client.query(
          `DELETE FROM public.posts WHERE id = $1 AND user_id = $2 RETURNING id`,
          [request.params.id, session.user.id]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Post not found' });
        }

        return reply.send({ success: true });
      } finally {
        client.release();
      }
    }
  );

  // POST /posts/bulk — create multiple posts at once
  // - publish_now: true  → sets scheduled_at = NOW() so cron publishes them immediately (respects rate limits)
  // - scheduled_at       → if multiple posts share the same time, they are auto-staggered 1 min apart
  // - neither            → saved as drafts
  fastify.post(
    '/posts/bulk',
    {
      schema: {
        body: {
          type: 'object',
          required: ['posts'],
          properties: {
            posts: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              items: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: { type: 'string', minLength: 1 },
                  post_type: { type: 'string', enum: ['text', 'image', 'link'], default: 'text' },
                  link_url: { type: 'string' },
                  publish_now: { type: 'boolean', default: false },
                  scheduled_at: { type: 'string', format: 'date-time' },
                  image_base64: { type: 'string' },
                  image_type: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: {
          posts: Array<CreatePostBody>;
        };
      }>,
      reply: FastifyReply
    ) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const userId = session.user.id;
      const { posts } = request.body;

      // Track how many posts are being queued for the same scheduled_at time
      // so we can stagger them 1 minute apart to avoid LinkedIn rate limits
      const scheduledAtCount: Record<string, number> = {};

      const client = await pool.connect();
      try {
        const created: any[] = [];
        const errors: Array<{ index: number; message: string }> = [];

        for (let i = 0; i < posts.length; i++) {
          const {
            content,
            post_type = 'text',
            link_url,
            publish_now = false,
            scheduled_at,
            image_base64,
            image_type,
          } = posts[i];

          try {
            let scheduledDate: Date | null = null;
            let status: PostStatus = 'draft';

            if (publish_now) {
              // Queue for immediate publish via cron — avoids Vercel timeout
              scheduledDate = new Date();
              status = 'scheduled';
            } else if (scheduled_at) {
              const parsed = new Date(scheduled_at);
              if (parsed <= new Date()) {
                errors.push({ index: i, message: 'scheduled_at must be a future datetime' });
                continue;
              }

              // Auto-stagger: if multiple posts share the same scheduled_at,
              // offset each by 1 minute to avoid LinkedIn rate limits
              const key = parsed.toISOString();
              const offset = scheduledAtCount[key] ?? 0;
              scheduledAtCount[key] = offset + 1;

              scheduledDate = new Date(parsed.getTime() + offset * 60 * 1000);
              status = 'scheduled';
            }

            const result = await client.query(
              `INSERT INTO public.posts
                 (user_id, content, post_type, link_url, status, scheduled_at, image_base64, image_type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id, user_id, content, post_type, link_url, status, scheduled_at, image_type, created_at`,
              [
                userId,
                content,
                post_type,
                link_url || null,
                status,
                scheduledDate,
                image_base64 || null,
                image_type || null,
              ]
            );

            created.push(result.rows[0]);
          } catch (err: any) {
            errors.push({ index: i, message: err.message });
          }
        }

        return reply.status(201).send({
          success: true,
          created: created.length,
          failed: errors.length,
          posts: created,
          errors: errors.length > 0 ? errors : undefined,
        });
      } finally {
        client.release();
      }
    }
  );

  // GET /posts/import/template — download Excel template
  fastify.get('/posts/import/template', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: request.headers as any });
    if (!session) return reply.status(401).send({ error: 'Unauthorized' });

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      { content: 'Your post text here', post_type: 'text', link_url: '', scheduled_at: '2026-05-01T10:00:00', publish_now: 'false' },
      { content: 'Post with a link', post_type: 'link', link_url: 'https://example.com', scheduled_at: '2026-05-02T10:00:00', publish_now: 'false' },
      { content: 'Publish immediately', post_type: 'text', link_url: '', scheduled_at: '', publish_now: 'true' },
    ]);
    ws['!cols'] = [{ wch: 50 }, { wch: 12 }, { wch: 40 }, { wch: 25 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Posts');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="posts_template.xlsx"')
      .send(buffer);
  });

  // POST /posts/import — upload Excel/CSV and bulk create posts
  fastify.post('/posts/import', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: request.headers as any });
    if (!session) return reply.status(401).send({ error: 'Unauthorized' });

    const userId = session.user.id;

    const XLSX = await import('xlsx');

    let fileBuffer: Buffer;
    try {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      const filename = data.filename.toLowerCase();
      if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls') && !filename.endsWith('.csv')) {
        return reply.status(400).send({ error: 'Only .xlsx, .xls, and .csv files are supported' });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) chunks.push(chunk);
      fileBuffer = Buffer.concat(chunks);
    } catch (err: any) {
      return reply.status(400).send({ error: 'Failed to read file', message: err.message });
    }

    let rows: any[];
    try {
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

    const client = await pool.connect();
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
        let status: PostStatus = 'draft';

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
}
