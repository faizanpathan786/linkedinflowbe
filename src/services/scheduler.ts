import cron from 'node-cron';
import crypto from 'crypto';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import LinkedInService from './linkedin.service';
import { downloadVideoFromStorage, deleteVideoFromStorage } from '../lib/supabase';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function generateIdempotencyKey(post: { id: string; user_id: string; scheduled_at: string | null; created_at: string }): string {
  return crypto
    .createHash('sha256')
    .update(`${post.id}:${post.user_id}:${post.scheduled_at ?? post.created_at}`)
    .digest('hex')
    .slice(0, 32);
}

function redactAuthHeader(payload: any): any {
  if (!payload?.headers) return payload;
  return { ...payload, headers: { ...payload.headers, Authorization: 'Bearer [REDACTED]' } };
}

async function writePublishLog(
  client: any,
  params: {
    post_id: string;
    status: 'success' | 'failed' | 'timeout';
    http_status?: number | null;
    linkedin_urn?: string | null;
    error_code?: string | null;
    error_message?: string | null;
    request_payload?: any;
    response_body?: any;
    duration_ms: number;
  }
): Promise<void> {
  try {
    const countResult = await client.query(
      `SELECT COUNT(*) AS cnt FROM public.post_publish_logs WHERE post_id = $1`,
      [params.post_id]
    );
    const attemptNumber = parseInt(countResult.rows[0].cnt, 10) + 1;

    await client.query(
      `INSERT INTO public.post_publish_logs
         (post_id, attempt_number, status, http_status, linkedin_urn, error_code,
          error_message, request_payload, response_body, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.post_id,
        attemptNumber,
        params.status,
        params.http_status ?? null,
        params.linkedin_urn ?? null,
        params.error_code ?? null,
        params.error_message ?? null,
        params.request_payload ? JSON.stringify(redactAuthHeader(params.request_payload)) : null,
        params.response_body ? JSON.stringify(params.response_body) : null,
        params.duration_ms,
      ]
    );
  } catch (logErr: any) {
    console.error(`Failed to write publish log for post ${params.post_id}:`, logErr.message);
  }
}

export function startScheduler(fastify: FastifyInstance) {
  const linkedinService = new LinkedInService(fastify);

  // Every 5 minutes: rescue posts stuck in 'publishing' for more than 10 minutes
  cron.schedule('*/5 * * * *', async () => {
    const client = await pool.connect();
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const stuckResult = await client.query(
        `UPDATE public.posts
         SET status = 'failed',
             failure_reason = 'TIMEOUT: publish job did not complete within 10 minutes',
             updated_at = NOW()
         WHERE status = 'publishing' AND publishing_started_at < $1
         RETURNING id`,
        [tenMinutesAgo]
      );

      if (stuckResult.rows.length > 0) {
        fastify.log.warn(`[RESCUE] Marked ${stuckResult.rows.length} stuck publishing post(s) as failed`);
        for (const stuck of stuckResult.rows) {
          await writePublishLog(client, {
            post_id: stuck.id,
            status: 'timeout',
            error_message: 'TIMEOUT: publish job did not complete within 10 minutes',
            duration_ms: 10 * 60 * 1000,
          });
        }
      }
    } catch (err: any) {
      fastify.log.error(`[RESCUE] Error: ${err.message}`);
    } finally {
      client.release();
    }
  });

  // Every minute: publish due posts
  cron.schedule('* * * * *', async () => {
    const client = await pool.connect();
    try {
      // Claim due posts atomically
      await client.query('BEGIN');
      let claimedPosts: any[] = [];
      try {
        const { rows: duePosts } = await client.query(
          `SELECT id, user_id, content, link_url, image_base64, image_type,
                  video_storage_path, idempotency_key, scheduled_at, created_at
           FROM public.posts
           WHERE status = 'scheduled' AND scheduled_at <= NOW()
           FOR UPDATE SKIP LOCKED`
        );

        if (duePosts.length === 0) {
          await client.query('COMMIT');
          return;
        }

        for (const post of duePosts) {
          const idempotencyKey = post.idempotency_key ?? generateIdempotencyKey(post);
          await client.query(
            `UPDATE public.posts
             SET status = 'publishing',
                 idempotency_key = $1,
                 publishing_started_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
            [idempotencyKey, post.id]
          );
          claimedPosts.push({ ...post, idempotency_key: idempotencyKey });
        }
        await client.query('COMMIT');
      } catch (claimErr: any) {
        await client.query('ROLLBACK');
        throw claimErr;
      }

      fastify.log.info(`Scheduler: ${claimedPosts.length} post(s) due for publishing`);

      for (const post of claimedPosts) {
        const startTime = Date.now();
        try {
          const tokenResult = await client.query(
            `SELECT access_token, person_urn, expires_at
             FROM public.linkedin_tokens
             WHERE user_id = $1`,
            [post.user_id]
          );

          if (tokenResult.rows.length === 0) {
            fastify.log.warn(`Scheduler: no LinkedIn token for user ${post.user_id}, failing post ${post.id}`);
            await client.query(
              `UPDATE public.posts
               SET status = 'failed', failure_reason = 'No LinkedIn token found', updated_at = NOW()
               WHERE id = $1`,
              [post.id]
            );
            await writePublishLog(client, {
              post_id: post.id, status: 'failed',
              error_code: 'NO_TOKEN', error_message: 'No LinkedIn token found',
              duration_ms: Date.now() - startTime,
            });
            continue;
          }

          const tokenData = tokenResult.rows[0];

          if (new Date(tokenData.expires_at) <= new Date()) {
            fastify.log.warn(`Scheduler: LinkedIn token expired for user ${post.user_id}, failing post ${post.id}`);
            await client.query(
              `UPDATE public.posts
               SET status = 'failed', failure_reason = 'LinkedIn token expired', updated_at = NOW()
               WHERE id = $1`,
              [post.id]
            );
            await writePublishLog(client, {
              post_id: post.id, status: 'failed',
              error_code: 'TOKEN_EXPIRED', error_message: 'LinkedIn token expired',
              duration_ms: Date.now() - startTime,
            });
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

          const linkedinUrn = linkedinResponse?.id || null;
          const durationMs = Date.now() - startTime;

          await client.query(
            `UPDATE public.posts
             SET status = 'published',
                 linkedin_post_id = $1,
                 published_at = NOW(),
                 updated_at = NOW(),
                 failure_reason = NULL,
                 image_base64 = NULL,
                 image_type = NULL,
                 video_storage_path = NULL
             WHERE id = $2`,
            [linkedinUrn, post.id]
          );

          await writePublishLog(client, {
            post_id: post.id, status: 'success',
            http_status: 201, linkedin_urn: linkedinUrn,
            response_body: linkedinResponse,
            duration_ms: durationMs,
          });

          if (post.video_storage_path) {
            deleteVideoFromStorage(post.video_storage_path).catch((e: any) =>
              fastify.log.error(`Scheduler: failed to delete video for post ${post.id}: ${e.message}`)
            );
          }

          fastify.log.info(`Scheduler: post ${post.id} published successfully`);
        } catch (err: any) {
          const durationMs = Date.now() - startTime;

          if (err?.response?.status === 429) {
            fastify.log.warn(`Scheduler: LinkedIn rate limit for post ${post.id}, re-queuing`);
            await client.query(
              `UPDATE public.posts
               SET status = 'scheduled', publishing_started_at = NULL, updated_at = NOW()
               WHERE id = $1`,
              [post.id]
            );
            continue;
          }

          fastify.log.error(`Scheduler: failed to publish post ${post.id}: ${err.message}`);
          const errorCode = err?.response?.data?.serviceErrorCode?.toString() ?? err?.code ?? null;
          const errorMessage = err?.response?.data?.message ?? err?.message ?? 'Unknown error';

          await client.query(
            `UPDATE public.posts
             SET status = 'failed', failure_reason = $1, updated_at = NOW()
             WHERE id = $2`,
            [errorMessage, post.id]
          );

          await writePublishLog(client, {
            post_id: post.id, status: 'failed',
            http_status: err?.response?.status ?? null,
            error_code: errorCode, error_message: errorMessage,
            response_body: err?.response?.data,
            duration_ms: durationMs,
          });
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
