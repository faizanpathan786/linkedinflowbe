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
exports.default = linkedinRoutes;
const axios_1 = __importDefault(require("axios"));
const pg_1 = require("pg");
const linkedin_service_1 = __importDefault(require("../services/linkedin.service"));
// Create PostgreSQL connection pool
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});
const LINKEDIN_SCOPES = 'openid profile email w_member_social';
// Function to save LinkedIn token to database using plain SQL
function saveLinkedInToken(userId, accessToken, refreshToken, expiresAt, personUrn, linkedinUserId, vanityName) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            // Plain SQL query to insert/update LinkedIn token
            const query = `
      INSERT INTO public.linkedin_tokens (
        user_id,
        access_token,
        refresh_token,
        expires_at,
        person_urn,
        linkedin_user_id,
        vanity_name,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) 
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        person_urn = EXCLUDED.person_urn,
        linkedin_user_id = EXCLUDED.linkedin_user_id,
        vanity_name = EXCLUDED.vanity_name,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;
            const values = [
                userId,
                accessToken,
                refreshToken,
                expiresAt,
                personUrn,
                linkedinUserId,
                vanityName
            ];
            console.log('Executing SQL query to save LinkedIn token for user:', userId);
            const result = yield client.query(query, values);
            console.log('LinkedIn token saved successfully with ID:', result.rows[0].id);
            return result.rows[0].id;
        }
        catch (error) {
            console.error('Error saving LinkedIn token to database:', error);
            throw error;
        }
        finally {
            client.release();
        }
    });
}
// Function to get LinkedIn token from database using plain SQL
function getLinkedInToken(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            // Plain SQL query to get LinkedIn token
            const query = `
      SELECT 
        id,
        access_token,
        refresh_token,
        expires_at,
        person_urn,
        linkedin_user_id,
        vanity_name,
        created_at,
        updated_at
      FROM public.linkedin_tokens
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
            const result = yield client.query(query, [userId]);
            if (result.rows.length === 0) {
                return null;
            }
            console.log('LinkedIn token retrieved from database for user:', userId);
            return result.rows[0];
        }
        catch (error) {
            console.error('Error getting LinkedIn token from database:', error);
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function getLinkedInUserProfile(access_token) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        try {
            // /v2/userinfo is the correct endpoint for openid+profile scopes (OIDC)
            // /v2/me requires the deprecated r_liteprofile scope and returns 403 with OIDC tokens
            const response = yield axios_1.default.get('https://api.linkedin.com/v2/userinfo', {
                headers: {
                    Authorization: `Bearer ${access_token}`,
                },
            });
            // userinfo returns { sub, name, given_name, family_name, picture, email, locale }
            // normalise to the shape the rest of this file expects: .id and .vanityName
            const data = response.data;
            return Object.assign(Object.assign({}, data), { id: data.sub, vanityName: data.name });
        }
        catch (error) {
            console.error('Error fetching LinkedIn profile:', {
                message: error.message,
                status: (_a = error.response) === null || _a === void 0 ? void 0 : _a.status,
                data: (_b = error.response) === null || _b === void 0 ? void 0 : _b.data,
            });
            if (((_d = (_c = error.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.code) === 'REVOKED_ACCESS_TOKEN' || ((_e = error.response) === null || _e === void 0 ? void 0 : _e.status) === 401) {
                throw new Error('LinkedIn access token has been revoked. Please reconnect your LinkedIn account.');
            }
            throw error;
        }
    });
}
function linkedinRoutes(fastify) {
    return __awaiter(this, void 0, void 0, function* () {
        const linkedinService = new linkedin_service_1.default(fastify);
        // Generate LinkedIn OAuth URL
        fastify.post('/linkedin/connect', {
            schema: {
                body: {
                    type: 'object',
                    properties: {
                        userId: { type: 'string' },
                        status: { type: 'string' },
                    },
                    required: ['userId'],
                },
            },
        }, (request, reply) => __awaiter(this, void 0, void 0, function* () {
            const { userId, status } = request.body;
            try {
                const state = JSON.stringify({
                    userId,
                    status,
                });
                const authUrl = `https://www.linkedin.com/oauth/v2/authorization?` +
                    `response_type=code&` +
                    `client_id=${process.env.LINKEDIN_CLIENT_ID}&` +
                    `redirect_uri=${encodeURIComponent(process.env.LINKEDIN_REDIRECT_URI || '')}&` +
                    `state=${encodeURIComponent(state)}&` +
                    `scope=${encodeURIComponent(LINKEDIN_SCOPES)}`;
                reply.send({ url: authUrl, state });
            }
            catch (error) {
                console.error('Error generating LinkedIn auth URL:', error);
                reply.status(500).send({
                    message: 'Error generating LinkedIn authentication URL',
                    success: false,
                });
            }
        }));
        // Handle LinkedIn OAuth callback
        // No auth required — session is lost during the OAuth redirect.
        // userId is accepted directly in the body and also extracted from state as a fallback.
        fastify.post('/linkedin/finish', {
            schema: {
                body: {
                    type: 'object',
                    properties: {
                        code: { type: 'string' },
                        state: { type: 'string' },
                        userId: { type: 'string' },
                    },
                    required: ['code'],
                },
            },
        }, (request, reply) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const { code, state, userId: bodyUserId } = request.body;
            try {
                // Resolve userId: body takes priority, then fall back to state JSON
                let userId = bodyUserId || null;
                if (!userId && state) {
                    try {
                        const stateData = JSON.parse(decodeURIComponent(state));
                        userId = stateData.userId || null;
                    }
                    catch (e) {
                        console.log('Could not parse state');
                    }
                }
                if (!userId) {
                    return reply.status(400).send({
                        message: 'userId is required — provide it in the request body or encoded in state',
                        success: false,
                        error: 'MISSING_USER_ID',
                    });
                }
                console.log('Processing LinkedIn OAuth for user:', userId);
                // Exchange code for access token
                const tokens = yield linkedinService.getAccessToken(code);
                console.log('LinkedIn tokens received successfully');
                // Get user profile
                const userProfile = yield getLinkedInUserProfile(tokens.access_token);
                const vanityName = userProfile.vanityName;
                const linkedinUserId = userProfile.id;
                console.log('LinkedIn profile retrieved:', {
                    vanityName,
                    linkedinUserId,
                    userId
                });
                // Calculate token expiration (LinkedIn tokens typically last 60 days)
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + 60);
                // Save token to database using plain SQL
                const tokenId = yield saveLinkedInToken(userId, tokens.access_token, tokens.refresh_token || null, expiresAt, `urn:li:person:${linkedinUserId}`, // person_urn
                linkedinUserId, // linkedin_user_id
                vanityName);
                console.log('LinkedIn token saved to database with ID:', tokenId);
                reply.send({
                    message: 'LinkedIn connected successfully',
                    success: true,
                    data: {
                        vanityName,
                        userId: linkedinUserId,
                        tokenId,
                        expiresAt: expiresAt.toISOString()
                    }
                });
            }
            catch (error) {
                console.error('Error processing LinkedIn authentication:', {
                    message: error.message,
                    stack: error.stack,
                    response: (_a = error.response) === null || _a === void 0 ? void 0 : _a.data
                });
                // Handle specific error cases
                if ((_b = error.message) === null || _b === void 0 ? void 0 : _b.includes('revoked')) {
                    reply.status(401).send({
                        message: 'LinkedIn access has been revoked. Please reconnect your account.',
                        success: false,
                        error: 'REVOKED_ACCESS_TOKEN',
                        requiresReauth: true
                    });
                }
                else if ((_c = error.message) === null || _c === void 0 ? void 0 : _c.includes('access token')) {
                    reply.status(401).send({
                        message: 'Invalid or expired LinkedIn access token. Please try connecting again.',
                        success: false,
                        error: 'INVALID_TOKEN',
                        requiresReauth: true
                    });
                }
                else if ((_d = error.message) === null || _d === void 0 ? void 0 : _d.includes('database')) {
                    reply.status(500).send({
                        message: 'Error saving token to database',
                        success: false,
                        error: 'DATABASE_ERROR'
                    });
                }
                else {
                    reply.status(500).send({
                        message: 'Error processing LinkedIn authentication',
                        success: false,
                        error: 'AUTHENTICATION_FAILED'
                    });
                }
            }
        }));
        // Get saved LinkedIn token for a user
        fastify.get('/linkedin/token/:userId', (request, reply) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { userId } = request.params;
                const tokenData = yield getLinkedInToken(userId);
                if (!tokenData) {
                    reply.status(404).send({
                        message: 'No LinkedIn token found for this user',
                        success: false
                    });
                    return;
                }
                // Don't return the actual access token for security
                reply.send({
                    message: 'LinkedIn token found',
                    success: true,
                    data: {
                        id: tokenData.id,
                        expires_at: tokenData.expires_at,
                        person_urn: tokenData.person_urn,
                        linkedin_user_id: tokenData.linkedin_user_id,
                        vanity_name: tokenData.vanity_name,
                        created_at: tokenData.created_at,
                        updated_at: tokenData.updated_at
                    }
                });
            }
            catch (error) {
                console.error('Error retrieving LinkedIn token:', error);
                reply.status(500).send({
                    message: 'Error retrieving LinkedIn token',
                    success: false,
                    error: 'DATABASE_ERROR'
                });
            }
        }));
        // Delete LinkedIn token for a user
        fastify.delete('/linkedin/token/:userId', (request, reply) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { userId } = request.params;
                const client = yield pool.connect();
                try {
                    const deleteQuery = `
            DELETE FROM public.linkedin_tokens 
            WHERE user_id = $1 
            RETURNING id;
          `;
                    const result = yield client.query(deleteQuery, [userId]);
                    if (result.rows.length === 0) {
                        reply.status(404).send({
                            message: 'No LinkedIn token found for this user',
                            success: false
                        });
                        return;
                    }
                    console.log('LinkedIn token deleted for user:', userId);
                    reply.send({
                        message: 'LinkedIn token deleted successfully',
                        success: true
                    });
                }
                finally {
                    client.release();
                }
            }
            catch (error) {
                console.error('Error deleting LinkedIn token:', error);
                reply.status(500).send({
                    message: 'Error deleting LinkedIn token',
                    success: false,
                    error: 'DATABASE_ERROR'
                });
            }
        }));
    });
}
