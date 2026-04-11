"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduler = startScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const pg_1 = require("pg");
const linkedin_service_1 = __importDefault(require("./linkedin.service"));
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});
function startScheduler(fastify) {
    const linkedinService = new linkedin_service_1.default(fastify);
    // Runs every minute
    node_cron_1.default.schedule('* * * * *', () => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const client = yield pool.connect();
        try {
            // Fetch all posts due to be published
            const { rows: duePosts } = yield client.query(`SELECT id, user_id, content, link_url, image_base64, image_type
         FROM public.posts
         WHERE status = 'scheduled' AND scheduled_at <= NOW()`);
            if (duePosts.length === 0)
                return;
            fastify.log.info(`Scheduler: ${duePosts.length} post(s) due for publishing`);
            for (const post of duePosts) {
                try {
                    // Fetch LinkedIn token for this user
                    const tokenResult = yield client.query(`SELECT access_token, person_urn, expires_at
             FROM public.linkedin_tokens
             WHERE user_id = $1`, [post.user_id]);
                    if (tokenResult.rows.length === 0) {
                        fastify.log.warn(`Scheduler: no LinkedIn token for user ${post.user_id}, marking post ${post.id} as failed`);
                        yield client.query(`UPDATE public.posts SET status = 'failed', updated_at = NOW() WHERE id = $1`, [post.id]);
                        continue;
                    }
                    const tokenData = tokenResult.rows[0];
                    if (new Date(tokenData.expires_at) <= new Date()) {
                        fastify.log.warn(`Scheduler: LinkedIn token expired for user ${post.user_id}, marking post ${post.id} as failed`);
                        yield client.query(`UPDATE public.posts SET status = 'failed', updated_at = NOW() WHERE id = $1`, [post.id]);
                        continue;
                    }
                    const imagePayload = post.image_base64
                        ? { buffer: Buffer.from(post.image_base64, 'base64'), type: post.image_type || 'image/jpeg' }
                        : undefined;
                    const linkedinResponse = yield linkedinService.createUnifiedPost(tokenData, {
                        text: post.content,
                        linkUrl: (_a = post.link_url) !== null && _a !== void 0 ? _a : undefined,
                        image: imagePayload,
                    });
                    yield client.query(`UPDATE public.posts
             SET status = 'published',
                 linkedin_post_id = $1,
                 published_at = NOW(),
                 updated_at = NOW(),
                 image_base64 = NULL,
                 image_type = NULL
             WHERE id = $2`, [(linkedinResponse === null || linkedinResponse === void 0 ? void 0 : linkedinResponse.id) || null, post.id]);
                    fastify.log.info(`Scheduler: post ${post.id} published successfully`);
                }
                catch (err) {
                    fastify.log.error(`Scheduler: failed to publish post ${post.id}: ${err.message}`);
                    yield client.query(`UPDATE public.posts SET status = 'failed', updated_at = NOW() WHERE id = $1`, [post.id]);
                }
            }
        }
        catch (err) {
            fastify.log.error(`Scheduler: unexpected error: ${err.message}`);
        }
        finally {
            client.release();
        }
    }));
    fastify.log.info('Scheduler started — checking for scheduled posts every minute');
}
