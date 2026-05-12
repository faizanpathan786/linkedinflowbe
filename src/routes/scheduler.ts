import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import crypto from 'crypto';
import LinkedInService from '../services/linkedin.service';
import { sendPostPublishedEmail } from '../lib/email';
import { downloadVideoFromStorage, deleteVideoFromStorage } from '../lib/supabase';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    // Never let log writes break the main flow
    console.error(`Failed to write publish log for post ${params.post_id}:`, logErr.message);
  }
}

export default async function schedulerRoutes(fastify: FastifyInstance) {
  const linkedinService = new LinkedInService(fastify);

  fastify.get('/scheduler/run', async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const authHeader = request.headers['authorization'];
      if (authHeader !== `Bearer ${secret}`) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    }

    const client = await pool.connect();
    try {
      // Rescue posts stuck in 'publishing' for more than 10 minutes
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
        fastify.log.warn(`Scheduler: rescued ${stuckResult.rows.length} stuck publishing post(s)`);

        // Write timeout logs for rescued posts
        for (const stuck of stuckResult.rows) {
          await writePublishLog(client, {
            post_id: stuck.id,
            status: 'timeout',
            error_message: 'TIMEOUT: publish job did not complete within 10 minutes',
            duration_ms: 10 * 60 * 1000,
          });
        }
      }

      // Claim due posts atomically with SELECT FOR UPDATE SKIP LOCKED
      await client.query('BEGIN');
      let claimedPosts: any[] = [];
      try {
        const { rows: duePosts } = await client.query(
          `SELECT id, user_id, content, link_url, image_base64, image_type,
                  video_storage_path, idempotency_key, scheduled_at, created_at
           FROM public.posts
           WHERE status = 'scheduled' AND scheduled_at <= NOW()
           ORDER BY scheduled_at ASC
           LIMIT 30
           FOR UPDATE SKIP LOCKED`
        );

        if (duePosts.length === 0) {
          await client.query('COMMIT');
          return reply.send({ success: true, published: 0, failed: 0 });
        }

        // Transition all claimed posts to 'publishing' in one batch
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

      fastify.log.info(`Scheduler: claimed ${claimedPosts.length} post(s) for publishing`);

      let published = 0;
      let failed = 0;

      const BATCH_SIZE = 3;
      const DELAY_BETWEEN_BATCHES_MS = 1000;

      for (let i = 0; i < claimedPosts.length; i += BATCH_SIZE) {
        const batch = claimedPosts.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (post) => {
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
                  post_id: post.id,
                  status: 'failed',
                  error_code: 'NO_TOKEN',
                  error_message: 'No LinkedIn token found',
                  duration_ms: Date.now() - startTime,
                });
                failed++;
                return;
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
                  post_id: post.id,
                  status: 'failed',
                  error_code: 'TOKEN_EXPIRED',
                  error_message: 'LinkedIn token expired',
                  duration_ms: Date.now() - startTime,
                });
                failed++;
                return;
              }

              const imagePayload = post.image_base64
                ? { buffer: Buffer.from(post.image_base64, 'base64'), type: post.image_type || 'image/jpeg' }
                : undefined;

              let videoPayload: { buffer: Buffer; type: string } | undefined;
              if (post.video_storage_path) {
                try {
                  const { buffer, contentType } = await downloadVideoFromStorage(post.video_storage_path);
                  videoPayload = { buffer, type: contentType };
                } catch (videoErr: any) {
                  fastify.log.error(`Scheduler: failed to download video for post ${post.id}: ${videoErr.message}`);
                  await client.query(
                    `UPDATE public.posts
                     SET status = 'failed', failure_reason = $1, updated_at = NOW()
                     WHERE id = $2`,
                    [`Video download failed: ${videoErr.message}`, post.id]
                  );
                  await writePublishLog(client, {
                    post_id: post.id,
                    status: 'failed',
                    error_code: 'VIDEO_DOWNLOAD_FAILED',
                    error_message: videoErr.message,
                    duration_ms: Date.now() - startTime,
                  });
                  failed++;
                  return;
                }
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
                post_id: post.id,
                status: 'success',
                http_status: 201,
                linkedin_urn: linkedinUrn,
                response_body: linkedinResponse,
                duration_ms: durationMs,
              });

              if (post.video_storage_path) {
                deleteVideoFromStorage(post.video_storage_path).catch((e: any) =>
                  fastify.log.error(`Scheduler: failed to delete video for post ${post.id}: ${e.message}`)
                );
              }

              fastify.log.info(`Scheduler: post ${post.id} published (${durationMs}ms)`);
              published++;

              // Fire-and-forget email notification
              try {
                const userResult = await client.query(
                  `SELECT name, email FROM public."user" WHERE id = $1`,
                  [post.user_id]
                );
                if (userResult.rows.length > 0) {
                  const { name, email } = userResult.rows[0];
                  sendPostPublishedEmail(email, name, post.content, new Date().toISOString())
                    .catch((err: any) => fastify.log.error(`Scheduler: email failed for post ${post.id}: ${err.message}`));
                }
              } catch (emailErr: any) {
                fastify.log.error(`Scheduler: could not fetch user for email: ${emailErr.message}`);
              }
            } catch (err: any) {
              const durationMs = Date.now() - startTime;

              // Rate limit — leave in 'publishing' so the next run's rescue logic doesn't time it out for 10 min
              // Instead, reset it back to 'scheduled' immediately
              if (err?.response?.status === 429) {
                fastify.log.warn(`Scheduler: LinkedIn rate limit for post ${post.id}, re-queuing`);
                await client.query(
                  `UPDATE public.posts
                   SET status = 'scheduled', publishing_started_at = NULL, updated_at = NOW()
                   WHERE id = $1`,
                  [post.id]
                );
                return;
              }

              fastify.log.error(`Scheduler: failed to publish post ${post.id}: ${err.message}`);
              const errorCode = err?.response?.data?.serviceErrorCode?.toString() ?? err?.code ?? null;
              const errorMessage = err?.response?.data?.message ?? err?.message ?? 'Unknown error';
              const httpStatus = err?.response?.status ?? null;

              await client.query(
                `UPDATE public.posts
                 SET status = 'failed', failure_reason = $1, updated_at = NOW()
                 WHERE id = $2`,
                [errorMessage, post.id]
              );

              await writePublishLog(client, {
                post_id: post.id,
                status: 'failed',
                http_status: httpStatus,
                error_code: errorCode,
                error_message: errorMessage,
                response_body: err?.response?.data,
                duration_ms: durationMs,
              });

              failed++;
            }
          })
        );

        if (i + BATCH_SIZE < claimedPosts.length) {
          await delay(DELAY_BETWEEN_BATCHES_MS);
        }
      }

      return reply.send({ success: true, published, failed, total: claimedPosts.length });
    } catch (err: any) {
      fastify.log.error(`Scheduler: unexpected error: ${err.message}`);
      return reply.status(500).send({ error: err.message });
    } finally {
      client.release();
    }
  });
}
