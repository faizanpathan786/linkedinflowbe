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
const supabase_js_1 = require("@supabase/supabase-js");
const pg_1 = require("pg");
const auth_1 = require("../auth");
const linkedin_service_1 = __importDefault(require("../services/linkedin.service"));
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL || '', process.env.SUPABASE_ANON_KEY || '');
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});
function oauthRoutes(fastify, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const linkedinService = new linkedin_service_1.default(fastify);
        // Get LinkedIn connection status
        fastify.get('/oauth/linkedin/status', (request, reply) => __awaiter(this, void 0, void 0, function* () {
            const session = yield auth_1.auth.api.getSession({ headers: request.headers });
            if (!session) {
                return reply.status(401).send({ error: 'Unauthorized', message: 'No active session found' });
            }
            const { data: linkedinData, error: linkedinError } = yield supabase
                .from('linkedin_tokens')
                .select('*')
                .eq('user_id', session.user.id)
                .single();
            if (linkedinError && linkedinError.code !== 'PGRST116') {
                return reply.status(500).send({ error: 'Database Error', message: linkedinError.message });
            }
            if (!linkedinData) {
                return reply.status(200).send({ isConnected: false, data: null });
            }
            const isExpired = new Date(linkedinData.expires_at) <= new Date();
            return reply.status(200).send({
                isConnected: true,
                isExpired,
                data: {
                    vanityName: linkedinData.vanity_name,
                    personUrn: linkedinData.person_urn,
                    profile: linkedinData.metadata,
                    expiresAt: linkedinData.expires_at,
                    connectedAt: linkedinData.created_at,
                },
            });
        }));
        // Initiate LinkedIn OAuth — returns auth URL with userId in state
        fastify.get('/oauth/linkedin', (request, reply) => __awaiter(this, void 0, void 0, function* () {
            const session = yield auth_1.auth.api.getSession({ headers: request.headers });
            if (!session) {
                return reply.status(401).send({ error: 'Unauthorized', message: 'No active session found' });
            }
            const authUrl = linkedinService.getAuthUrl(JSON.stringify({ userId: session.user.id }));
            return reply.status(200).send({ authUrl });
        }));
        // Handle LinkedIn OAuth callback
        fastify.get('/oauth/linkedin/callback', (request, reply) => __awaiter(this, void 0, void 0, function* () {
            const { code, state } = request.query;
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            if (!code) {
                return reply.redirect(`${frontendUrl}?linkedin=error&message=${encodeURIComponent('Authorization code missing')}`);
            }
            // Extract userId from state (passed during OAuth initiation)
            let userId = null;
            if (state) {
                try {
                    const parsed = JSON.parse(decodeURIComponent(state));
                    userId = parsed.userId || null;
                }
                catch (_a) {
                    // state is not JSON, ignore
                }
            }
            if (!userId) {
                return reply.redirect(`${frontendUrl}?linkedin=error&message=${encodeURIComponent('User not identified. Please try again.')}`);
            }
            try {
                const tokenData = yield linkedinService.getAccessToken(code);
                const profile = yield linkedinService.getUserProfile(tokenData.access_token);
                const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
                const dbClient = yield pool.connect();
                try {
                    yield dbClient.query(`INSERT INTO public.linkedin_tokens (user_id, access_token, refresh_token, expires_at, person_urn, vanity_name, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (user_id) DO UPDATE SET
               access_token = EXCLUDED.access_token,
               refresh_token = EXCLUDED.refresh_token,
               expires_at = EXCLUDED.expires_at,
               person_urn = EXCLUDED.person_urn,
               vanity_name = EXCLUDED.vanity_name,
               metadata = EXCLUDED.metadata,
               updated_at = CURRENT_TIMESTAMP`, [
                        userId,
                        tokenData.access_token,
                        tokenData.refresh_token || null,
                        expiresAt.toISOString(),
                        profile.id,
                        profile.vanity_name || null,
                        JSON.stringify(profile),
                    ]);
                }
                finally {
                    dbClient.release();
                }
                return reply.redirect(`${frontendUrl}?linkedin=connected`);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                fastify.log.error(`OAuth callback error: ${message}`);
                return reply.redirect(`${frontendUrl}?linkedin=error&message=${encodeURIComponent(message)}`);
            }
        }));
        // Get LinkedIn profile
        fastify.get('/oauth/linkedin/profile', (request, reply) => __awaiter(this, void 0, void 0, function* () {
            const session = yield auth_1.auth.api.getSession({ headers: request.headers });
            if (!session) {
                return reply.status(401).send({ error: 'Unauthorized', message: 'No active session found' });
            }
            const { data: linkedinData, error: linkedinError } = yield supabase
                .from('linkedin_tokens')
                .select('*')
                .eq('user_id', session.user.id)
                .single();
            if (linkedinError && linkedinError.code !== 'PGRST116') {
                return reply.status(500).send({ error: 'Database Error', message: linkedinError.message });
            }
            if (!linkedinData) {
                return reply.status(404).send({ error: 'Not Found', message: 'Please connect your LinkedIn account first' });
            }
            return reply.status(200).send({
                profile: Object.assign(Object.assign({ id: linkedinData.person_urn, vanityName: linkedinData.vanity_name }, linkedinData.metadata), { connectedAt: linkedinData.created_at, lastUpdated: linkedinData.updated_at }),
            });
        }));
    });
}
exports.default = oauthRoutes;
