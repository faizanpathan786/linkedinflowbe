import cron from 'node-cron';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import LinkedInService from './linkedin.service';
import { downloadVideoFromStorage, deleteVideoFromStorage } from '../lib/supabase';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export function startScheduler(fastify: FastifyInstance) {
  const linkedinService = new LinkedInService(fastify);

  // Runs every minute
  cron.schedule('* * * * *', async () => {
    const client = await pool.connect();
    try {
      // Fetch all posts due to be published
      const { rows: duePosts } = await client.query<{
        id: string;
        user_id: string;
        content: string;
        link_url: string | null;
        image_base64: string | null;
        image_type: string | null;
        video_storage_path: string | null;
      }>(
        `SELECT id, user_id, content, link_url, image_base64, image_type, video_storage_path
         FROM public.posts
         WHERE status = 'scheduled' AND scheduled_at <= NOW()`
      );

      if (duePosts.length === 0) return;

      fastify.log.info(`Scheduler: ${duePosts.length} post(s) due for publishing`);

      for (const post of duePosts) {
        try {
          // Fetch LinkedIn token for this user
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
            continue;
          }

          const tokenData = tokenResult.rows[0];

          if (new Date(tokenData.expires_at) <= new Date()) {
            fastify.log.warn(`Scheduler: LinkedIn token expired for user ${post.user_id}, marking post ${post.id} as failed`);
            await client.query(
              `UPDATE public.posts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
              [post.id]
            );
            continue;
          }

          const imagePayload = post.image_base64
            ? { buffer: Buffer.from(post.image_base64, 'base64'), type: post.image_type || 'image/jpeg' }
            : undefined;

          let videoPayload: { buffer: Buffer; type: string } | undefined;
          if (post.video_storage_path) {
            const { buffer, contentType } = await downloadVideoFromStorage(post.video_storage_path);
            videoPayload = { buffer, type: contentType };
          }

          const linkedinResponse = await linkedinService.createUnifiedPost(tokenData, {
            text: post.content,
            linkUrl: post.link_url ?? undefined,
            image: imagePayload,
            video: videoPayload,
          });

          await client.query(
            `UPDATE public.posts
             SET status = 'published',
                 linkedin_post_id = $1,
                 published_at = NOW(),
                 updated_at = NOW(),
                 image_base64 = NULL,
                 image_type = NULL,
                 video_storage_path = NULL
             WHERE id = $2`,
            [linkedinResponse?.id || null, post.id]
          );

          if (post.video_storage_path) {
            deleteVideoFromStorage(post.video_storage_path).catch((e) =>
              fastify.log.error(`Scheduler: failed to delete video from storage for post ${post.id}: ${e.message}`)
            );
          }

          fastify.log.info(`Scheduler: post ${post.id} published successfully`);
        } catch (err: any) {
          fastify.log.error(`Scheduler: failed to publish post ${post.id}: ${err.message}`);
          await client.query(
            `UPDATE public.posts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
            [post.id]
          );
        }
      }
    } catch (err: any) {
      fastify.log.error(`Scheduler: unexpected error: ${err.message}`);
    } finally {
      client.release();
    }
  });  

  fastify.log.info('Scheduler started — checking for scheduled posts every minute');
}
