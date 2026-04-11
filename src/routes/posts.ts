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
}
