import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import LinkedInService from '../services/linkedin.service';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export default async function schedulerRoutes(fastify: FastifyInstance) {
  const linkedinService = new LinkedInService(fastify);

  fastify.get('/scheduler/run', async (request: FastifyRequest, reply: FastifyReply) => {
    // Verify request is from Vercel Cron
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = request.headers['authorization'];
      if (auth !== `Bearer ${secret}`) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    }

    const client = await pool.connect();
    try {
      const { rows: duePosts } = await client.query<{
        id: string;
        user_id: string;
        content: string;
        link_url: string | null;
        image_base64: string | null;
        image_type: string | null;
      }>(
        `SELECT id, user_id, content, link_url, image_base64, image_type
         FROM public.posts
         WHERE status = 'scheduled' AND scheduled_at <= NOW()`
      );

      if (duePosts.length === 0) {
        return reply.send({ success: true, published: 0, failed: 0 });
      }

      fastify.log.info(`Scheduler: ${duePosts.length} post(s) due for publishing`);

      let published = 0;
      let failed = 0;

      // Process in sequential batches of 3 with a 1s delay between each batch
      // to stay well within LinkedIn's rate limits
      const BATCH_SIZE = 3;
      const DELAY_BETWEEN_BATCHES_MS = 1000;

      for (let i = 0; i < duePosts.length; i += BATCH_SIZE) {
        const batch = duePosts.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (post) => {
            try {
              const tokenResult = await client.query(
                `SELECT access_token, person_urn, expires_at
                 FROM public.linkedin_tokens
                 WHERE user_id = $1`,
                [post.user_id]
              );

              if (tokenResult.rows.length === 0) {
                fastify.log.warn(`Scheduler: no LinkedIn token for user ${post.user_id}, marking post ${post.id} as failed`);
                await client.query(
                  `UPDATE public.posts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
                  [post.id]
                );
                failed++;
                return;
              }

              const tokenData = tokenResult.rows[0];

              if (new Date(tokenData.expires_at) <= new Date()) {
                fastify.log.warn(`Scheduler: LinkedIn token expired for user ${post.user_id}, marking post ${post.id} as failed`);
                await client.query(
                  `UPDATE public.posts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
                  [post.id]
                );
                failed++;
                return;
              }

              const imagePayload = post.image_base64
                ? { buffer: Buffer.from(post.image_base64, 'base64'), type: post.image_type || 'image/jpeg' }
                : undefined;

              const linkedinResponse = await linkedinService.createUnifiedPost(tokenData, {
                text: post.content,
                linkUrl: post.link_url ?? undefined,
                image: imagePayload,
              });

              await client.query(
                `UPDATE public.posts
                 SET status = 'published',
                     linkedin_post_id = $1,
                     published_at = NOW(),
                     updated_at = NOW(),
                     image_base64 = NULL,
                     image_type = NULL
                 WHERE id = $2`,
                [linkedinResponse?.id || null, post.id]
              );

              fastify.log.info(`Scheduler: post ${post.id} published successfully`);
              published++;
            } catch (err: any) {
              // Handle LinkedIn rate limit — re-queue for next cron run instead of failing
              if (err?.response?.status === 429) {
                fastify.log.warn(`Scheduler: LinkedIn rate limit hit for post ${post.id}, will retry next run`);
                return;
              }
              fastify.log.error(`Scheduler: failed to publish post ${post.id}: ${err.message}`);
              await client.query(
                `UPDATE public.posts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
                [post.id]
              );
              failed++;
            }
          })
        );

        // Wait between batches to avoid hitting LinkedIn rate limits
        if (i + BATCH_SIZE < duePosts.length) {
          await delay(DELAY_BETWEEN_BATCHES_MS);
        }
      }

      return reply.send({ success: true, published, failed, total: duePosts.length });
    } catch (err: any) {
      fastify.log.error(`Scheduler: unexpected error: ${err.message}`);
      return reply.status(500).send({ error: err.message });
    } finally {
      client.release();
    }
  });
}
