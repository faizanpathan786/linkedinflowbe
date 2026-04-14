import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { auth } from '../auth';
import LinkedInService from '../services/linkedin.service';
import { sendPostPublishedEmail } from '../lib/email';
import { downloadVideoFromUrl, uploadVideoToStorage, downloadVideoFromStorage, deleteVideoFromStorage, getVideoPublicUrl } from '../lib/supabase';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

type PostType = 'text' | 'image' | 'link' | 'video';
type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed';

interface CreatePostBody {
  content: string;
  post_type?: PostType;
  link_url?: string;
  publish_now?: boolean;
  scheduled_at?: string;
  image_base64?: string;
  image_type?: string;
  video_url?: string;    // public HTTP URL — backend downloads and stores in Supabase
  video_base64?: string; // base64-encoded video — sent directly from browser file picker
  video_type?: string;   // e.g. 'video/mp4'
}

interface PostParams {
  id: string;
}

export default async function postsRoutes(fastify: FastifyInstance) {
  const linkedinService = new LinkedInService(fastify);

  function addMediaPreviewFields(post: any) {
    const hasImage = !!post.image_base64;
    const hasVideo = !!post.video_storage_path;

    return {
      ...post,
      has_image: hasImage,
      has_video: hasVideo,
      video_url: hasVideo ? getVideoPublicUrl(post.video_storage_path) : null,
    };
  }

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
      video_storage_path?: string;
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

      let videoPayload: { buffer: Buffer; type: string } | undefined;
      if (postContent.video_storage_path) {
        const { buffer, contentType } = await downloadVideoFromStorage(postContent.video_storage_path);
        videoPayload = { buffer, type: contentType };
      }

      const linkedinResponse = await linkedinService.createUnifiedPost(tokenData, {
        text: postContent.content,
        linkUrl: postContent.link_url ?? undefined,
        image: imagePayload,
        video: videoPayload,
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
  // Accepts both JSON and multipart/form-data (for video file uploads)
  fastify.post(
    '/posts',
    async (
      request: FastifyRequest<{ Body: CreatePostBody }>,
      reply: FastifyReply
    ) => {
      let session: any;
      try {
        session = await auth.api.getSession({ headers: request.headers as any });
      } catch { /* ignore */ }
      if (!session) return reply.status(401).send({ error: 'Unauthorized' });

      const userId = session.user.id;

      // ── Parse body: multipart (video file upload) OR JSON ──────────────────
      let parsedBody: CreatePostBody = {} as CreatePostBody;

      if (request.isMultipart()) {
        const fields: Record<string, any> = {};
        let imageBuffer: Buffer | null = null;
        let imageMime = 'image/jpeg';
        let videoBuffer: Buffer | null = null;
        let videoMime = 'video/mp4';

        for await (const part of (request as any).parts()) {
          if (part.type === 'file' && part.fieldname === 'image') {
            imageBuffer = await part.toBuffer();
            imageMime = part.mimetype || 'image/jpeg';
          } else if (part.type === 'file' && part.fieldname === 'video') {
            videoBuffer = await part.toBuffer();
            videoMime = part.mimetype || 'video/mp4';
          } else {
            fields[part.fieldname] = part.value;
          }
        }

        parsedBody = {
          content: fields.content,
          post_type: fields.post_type || 'video',
          link_url: fields.link_url,
          publish_now: fields.publish_now === 'true' || fields.publish_now === true,
          scheduled_at: fields.scheduled_at,
          image_base64: imageBuffer ? imageBuffer.toString('base64') : undefined,
          image_type: imageMime,
          video_base64: videoBuffer ? videoBuffer.toString('base64') : undefined,
          video_type: videoMime,
        };
      } else {
        parsedBody = request.body || ({} as CreatePostBody);
      }

      const {
        content, post_type = 'text', link_url, publish_now = false,
        scheduled_at, image_base64, image_type,
        video_url, video_base64, video_type,
      } = parsedBody;

      if (!content) return reply.status(400).send({ error: 'content is required' });

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

      // Handle video — either base64 from browser file picker or a public URL
      let videoStoragePath: string | null = null;
      if (video_base64) {
        // Browser sent the file as base64 (file picker flow)
        try {
          const buffer = Buffer.from(video_base64, 'base64');
          const ct = video_type || 'video/mp4';
          const { storagePath } = await uploadVideoToStorage(buffer, ct, userId);
          videoStoragePath = storagePath;
          fastify.log.info(`Video (base64) stored at: ${storagePath}`);
        } catch (err: any) {
          return reply.status(400).send({ error: 'Failed to upload video', message: err.message });
        }
      } else if (video_url) {
        // Public HTTP URL — download then store
        try {
          fastify.log.info(`Downloading video from URL: ${video_url}`);
          const { buffer, contentType } = await downloadVideoFromUrl(video_url);
          const { storagePath } = await uploadVideoToStorage(buffer, contentType, userId);
          videoStoragePath = storagePath;
          fastify.log.info(`Video (url) stored at: ${storagePath}`);
        } catch (err: any) {
          return reply.status(400).send({ error: 'Failed to process video', message: err.message });
        }
      }

      const client = await pool.connect();
      try {
        let linkedin_post_id: string | null = null;
        let status: PostStatus = isScheduled ? 'scheduled' : 'draft';

        if (publish_now) {
          try {
            fastify.log.info({ post_type, has_video: !!videoStoragePath, has_image: !!image_base64 }, 'POST /posts publish payload');

            linkedin_post_id = await publishPostToLinkedIn(userId, {
              content, link_url, image_base64, image_type,
              video_storage_path: videoStoragePath ?? undefined,
            });
            status = 'published';
            // Clean up video from storage after publishing
            if (videoStoragePath) {
              deleteVideoFromStorage(videoStoragePath).catch((e) =>
                fastify.log.error(`Failed to delete video from storage: ${e.message}`)
              );
              videoStoragePath = null;
            }
            notifyPublished(userId, content, new Date());
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

        const storeImage = status !== 'published';

        const result = await client.query(
          `INSERT INTO public.posts
             (user_id, content, post_type, link_url, linkedin_post_id, status, scheduled_at, published_at, image_base64, image_type, video_storage_path)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id, user_id, content, post_type, link_url, linkedin_post_id, status, scheduled_at, published_at, image_type, video_storage_path, created_at, updated_at`,
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
            videoStoragePath,
          ]
        );

        return reply.status(201).send({
          success: true,
          post: addMediaPreviewFields(result.rows[0]),
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
            video_storage_path: post.video_storage_path ?? undefined,
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
               image_base64 = NULL, image_type = NULL, video_storage_path = NULL
           WHERE id = $2
           RETURNING id, user_id, content, post_type, link_url, linkedin_post_id, status, scheduled_at, published_at, created_at, updated_at`,
          [linkedin_post_id, id]
        );

        if (post.video_storage_path) {
          deleteVideoFromStorage(post.video_storage_path).catch((e) =>
            fastify.log.error(`Failed to delete video from storage: ${e.message}`)
          );
        }

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
                scheduled_at, published_at, image_type, image_base64, video_storage_path, created_at, updated_at
         FROM public.posts WHERE user_id = $1 ORDER BY created_at DESC`,
        [session.user.id]
      );
      return reply.send({ posts: result.rows.map(addMediaPreviewFields) });
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

        return reply.send({ post: addMediaPreviewFields(result.rows[0]) });
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

  // POST /posts/upload-video — upload a local video file to Supabase Storage
  // Frontend sends { video_base64, video_type, filename } and gets back a public URL.
  // The returned video_url can then be used in POST /posts as video_url.
  fastify.post(
    '/posts/upload-video',
    async (
      request: FastifyRequest<{ Body: { video_base64: string; video_type?: string; filename?: string } }>,
      reply: FastifyReply
    ) => {
      let session: any;
      try {
        session = await auth.api.getSession({ headers: request.headers as any });
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      if (!session) return reply.status(401).send({ error: 'Unauthorized' });

      let video_base64: string | undefined;
      let video_type: string | undefined;
      let filename: string | undefined;

      if (request.isMultipart()) {
        const fields: Record<string, any> = {};
        let videoBuffer: Buffer | null = null;

        for await (const part of (request as any).parts()) {
          if (part.type === 'file' && part.fieldname === 'video') {
            videoBuffer = await part.toBuffer();
            video_type = part.mimetype || 'video/mp4';
            filename = part.filename;
          } else {
            fields[part.fieldname] = part.value;
          }
        }

        if (videoBuffer) {
          video_base64 = videoBuffer.toString('base64');
        } else {
          video_base64 = fields.video_base64;
          video_type = video_type || fields.video_type;
          filename = filename || fields.filename;
        }
      } else {
        const body = request.body || ({} as any);
        video_base64 = body.video_base64;
        video_type = body.video_type;
        filename = body.filename;
      }

      if (!video_base64) {
        return reply.status(400).send({ error: 'video_base64 is required' });
      }

      // Validate it looks like a video
      const ct = video_type || 'video/mp4';
      if (!ct.startsWith('video/')) {
        return reply.status(400).send({ error: 'Only video files are supported' });
      }

      // Size guard — base64 string length * 0.75 ≈ bytes
      const estimatedBytes = Math.round(video_base64.length * 0.75);
      const MAX_BYTES = 200 * 1024 * 1024; // 200 MB
      if (estimatedBytes > MAX_BYTES) {
        return reply.status(400).send({ error: 'Video exceeds 200 MB limit' });
      }

      try {
        const buffer = Buffer.from(video_base64, 'base64');
        const { storagePath, publicUrl } = await uploadVideoToStorage(buffer, ct, session.user.id);
        fastify.log.info(`Video uploaded: ${storagePath} (${buffer.length} bytes)`);
        return reply.status(201).send({
          success: true,
          video_url: publicUrl,
          storage_path: storagePath,
          size_bytes: buffer.length,
          filename: filename || storagePath.split('/').pop(),
        });
      } catch (err: any) {
        fastify.log.error('Video upload error:', err.message);
        return reply.status(500).send({ error: 'Failed to upload video', message: err.message });
      }
    }
  );

  // NOTE: POST /posts/import is registered in server.ts directly
  // This is a placeholder to avoid duplicate route errors
  fastify.get('/posts/import/template', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: request.headers as any });
    if (!session) return reply.status(401).send({ error: 'Unauthorized' });
    return reply.send({
      columns: ['content', 'post_type', 'link_url', 'scheduled_at', 'publish_now'],
      example_rows: [
        { content: 'Your post text here', post_type: 'text', link_url: '', scheduled_at: '2026-05-01T10:00:00', publish_now: 'false' },
        { content: 'Post with a link', post_type: 'link', link_url: 'https://example.com', scheduled_at: '2026-05-02T10:00:00', publish_now: 'false' },
        { content: 'Publish immediately', post_type: 'text', link_url: '', scheduled_at: '', publish_now: 'true' },
      ],
    });
  });

  // DEAD CODE — kept to avoid breaking the file structure
  // The actual POST /posts/import handler lives in server.ts
  if (false) fastify.post('/posts/import', async (
    request: FastifyRequest<{ Body: { file: string; filename: string } }>,
    reply: FastifyReply
  ) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) return reply.status(401).send({ error: 'Unauthorized' });

      const userId = session.user.id;
      const { file, filename } = request.body;

      const fname = filename.toLowerCase();
      if (!fname.endsWith('.xlsx') && !fname.endsWith('.xls') && !fname.endsWith('.csv')) {
        return reply.status(400).send({ error: 'Only .xlsx, .xls, and .csv files are supported' });
      }

      const XLSX = await import('xlsx');
      let rows: any[];
      try {
        const fileBuffer = Buffer.from(file, 'base64');
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
    }
  );
}
