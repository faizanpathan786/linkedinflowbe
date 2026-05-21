import axios from 'axios';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import LinkedInService from '../services/linkedin.service';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const LINKEDIN_SCOPES = 'openid profile email w_member_social';

// In-memory profile cache — avoids a live LinkedIn API call on every Vault page load.
// TTL: 5 minutes. Keyed by userId.
const profileCache = new Map<string, { data: object; expiresAt: number }>();
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

// Function to save LinkedIn token to database using plain SQL
async function saveLinkedInToken(
  userId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date,
  personUrn: string,
  linkedinUserId: string,
  vanityName: string | null
): Promise<string> {
  const client = await pool.connect();
  
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
    const result = await client.query(query, values);
    
    console.log('LinkedIn token saved successfully with ID:', result.rows[0].id);
    return result.rows[0].id;
    
  } catch (error) {
    console.error('Error saving LinkedIn token to database:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Function to get LinkedIn token from database using plain SQL
async function getLinkedInToken(userId: string): Promise<any> {
  const client = await pool.connect();
  
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

    const result = await client.query(query, [userId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    console.log('LinkedIn token retrieved from database for user:', userId);
    return result.rows[0];
    
  } catch (error) {
    console.error('Error getting LinkedIn token from database:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function getLinkedInUserProfile(access_token: string) {
  try {
    // /v2/userinfo is the correct OIDC endpoint for openid+profile scopes
    const response = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const data = response.data;

    // Try to fetch the vanity name (URL slug) from /v2/me separately.
    // /v2/userinfo has no vanityName field; /v2/me?projection=(id,vanityName) does.
    let vanityName: string | null = null;
    try {
      const meResponse = await axios.get('https://api.linkedin.com/v2/me?projection=(id,vanityName)', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      vanityName = meResponse.data?.vanityName ?? null;
    } catch {
      // vanityName is optional — leave null rather than storing the display name
    }

    return {
      ...data,
      id: data.sub,
      vanityName,
    };
  } catch (error: any) {
    console.error('Error fetching LinkedIn profile:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });

    if (error.response?.data?.code === 'REVOKED_ACCESS_TOKEN' || error.response?.status === 401) {
      throw new Error('LinkedIn access token has been revoked. Please reconnect your LinkedIn account.');
    }

    throw error;
  }
}

export default async function linkedinRoutes(fastify: FastifyInstance) {
  const linkedinService = new LinkedInService(fastify);
  
  // Generate LinkedIn OAuth URL
  fastify.post(
    '/linkedin/connect',
    {
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
    },
    async (request: FastifyRequest<{ Body: { userId: string; status?: string } }>, reply: FastifyReply) => {
      const { userId, status } = request.body;

      try {
        const state = JSON.stringify({
          userId,
          status,
        });

        const authUrl =
          `https://www.linkedin.com/oauth/v2/authorization?` +
          `response_type=code&` +
          `client_id=${process.env.LINKEDIN_CLIENT_ID}&` +
          `redirect_uri=${encodeURIComponent(process.env.LINKEDIN_REDIRECT_URI || '')}&` +
          `state=${encodeURIComponent(state)}&` +
          `scope=${encodeURIComponent(LINKEDIN_SCOPES)}`;

        reply.send({ url: authUrl, state });
      } catch (error) {
        console.error('Error generating LinkedIn auth URL:', error);
        reply.status(500).send({
          message: 'Error generating LinkedIn authentication URL',
          success: false,
        });
      }
    }
  );

  // Handle LinkedIn OAuth callback
  // No auth required — session is lost during the OAuth redirect.
  // userId is accepted directly in the body and also extracted from state as a fallback.
  fastify.post(
    '/linkedin/finish',
    {
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
    },
    async (request: FastifyRequest<{ Body: { code: string; state?: string; userId?: string } }>, reply: FastifyReply) => {
      const { code, state, userId: bodyUserId } = request.body;

      try {
        // Resolve userId: body takes priority, then fall back to state JSON
        let userId: string | null = bodyUserId || null;
        if (!userId && state) {
          try {
            const stateData = JSON.parse(decodeURIComponent(state));
            userId = stateData.userId || null;
          } catch (e) {
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

        // One-time cleanup: vanity_name was previously set to the display name (e.g. "Faizan Pathan").
        // Clear any rows where it contains a space — those are not valid URL slugs.
        {
          const cleanupClient = await pool.connect();
          try {
            await cleanupClient.query(
              `UPDATE public.linkedin_tokens SET vanity_name = NULL WHERE vanity_name LIKE '% %'`
            );
          } catch { /* non-fatal */ } finally {
            cleanupClient.release();
          }
        }

        // Exchange code for access token
        const tokens = await linkedinService.getAccessToken(code);
        console.log('LinkedIn tokens received successfully');

        // Get user profile
        const userProfile = await getLinkedInUserProfile(tokens.access_token);
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
        const tokenId = await saveLinkedInToken(
          userId,
          tokens.access_token,
          tokens.refresh_token || null,
          expiresAt,
          `urn:li:person:${linkedinUserId}`, // person_urn
          linkedinUserId, // linkedin_user_id
          vanityName
        );

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
      } catch (error: any) {
        console.error('Error processing LinkedIn authentication:', {
          message: error.message,
          stack: error.stack,
          response: error.response?.data
        });
        
        // Handle specific error cases
        if (error.message?.includes('revoked')) {
          reply.status(401).send({
            message: 'LinkedIn access has been revoked. Please reconnect your account.',
            success: false,
            error: 'REVOKED_ACCESS_TOKEN',
            requiresReauth: true
          });
        } else if (error.message?.includes('access token')) {
          reply.status(401).send({
            message: 'Invalid or expired LinkedIn access token. Please try connecting again.',
            success: false,
            error: 'INVALID_TOKEN',
            requiresReauth: true
          });
        } else if (error.message?.includes('database')) {
          reply.status(500).send({
            message: 'Error saving token to database',
            success: false,
            error: 'DATABASE_ERROR'
          });
        } else {
          reply.status(500).send({
            message: 'Error processing LinkedIn authentication',
            success: false,
            error: 'AUTHENTICATION_FAILED'
          });
        }
      }
    }
  );

  // Get saved LinkedIn token for a user
  fastify.get(
    '/linkedin/token/:userId',
    async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
      try {
        const { userId } = request.params;
        const tokenData = await getLinkedInToken(userId);
        
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
      } catch (error: any) {
        console.error('Error retrieving LinkedIn token:', error);
        reply.status(500).send({
          message: 'Error retrieving LinkedIn token',
          success: false,
          error: 'DATABASE_ERROR'
        });
      }
    }
  );

  // Get analytics for a published post
  // GET /linkedin/posts/:postId/analytics
  // postId is the internal DB post ID; looks up linkedin_post_id and fetches social action stats
  fastify.get(
    '/linkedin/posts/:postId/analytics',
    async (request: FastifyRequest<{ Params: { postId: string } }>, reply: FastifyReply) => {
      const { postId } = request.params;
      const client = await pool.connect();
      try {
        // Fetch post — need linkedin_post_id and user_id
        const postResult = await client.query(
          `SELECT id, user_id, linkedin_post_id, status FROM public.posts WHERE id = $1`,
          [postId]
        );

        if (postResult.rows.length === 0) {
          return reply.status(404).send({ message: 'Post not found', success: false });
        }

        const post = postResult.rows[0];

        if (!post.linkedin_post_id) {
          return reply.status(400).send({
            message: 'Post has not been published to LinkedIn yet',
            success: false,
          });
        }

        const tokenData = await getLinkedInToken(post.user_id);
        if (!tokenData) {
          return reply.status(404).send({
            message: 'No LinkedIn token found for this user',
            success: false,
          });
        }

        const analytics = await linkedinService.getPostAnalytics(
          tokenData.access_token,
          post.linkedin_post_id
        );

        reply.send({
          success: true,
          data: {
            post_id: postId,
            linkedin_post_id: post.linkedin_post_id,
            likes: analytics.likesSummary?.totalLikes ?? 0,
            comments: analytics.commentsSummary?.totalFirstLevelComments ?? 0,
            shares: analytics.sharesSummary?.shareCount ?? 0,
            raw: analytics,
          },
        });
      } catch (error: any) {
        console.error('Error fetching LinkedIn analytics:', error.message);
        reply.status(500).send({
          message: error.message || 'Error fetching LinkedIn analytics',
          success: false,
        });
      } finally {
        client.release();
      }
    }
  );

  // Get LinkedIn profile for a user
  fastify.get(
    '/linkedin/profile/:userId',
    async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
      const { userId } = request.params;

      const tokenData = await getLinkedInToken(userId);
      if (!tokenData) {
        return reply.status(404).send({ success: false, message: 'Not connected' });
      }

      // Return cached profile if still fresh
      const cached = profileCache.get(userId);
      if (cached && cached.expiresAt > Date.now()) {
        return reply.send({ success: true, data: cached.data });
      }

      try {
        // /v2/userinfo is the correct endpoint for OIDC tokens (openid profile email scopes).
        // /v2/me with projection requires the deprecated r_liteprofile scope and returns 403/404.
        const response = await axios.get('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        const d = response.data;
        const profileData = {
          firstName: d.given_name ?? null,
          lastName: d.family_name ?? null,
          headline: null, // not available via OIDC userinfo
          pictureUrl: d.picture ?? null,
          vanityName: tokenData.vanity_name ?? null,
          personUrn: tokenData.person_urn ?? null,
        };

        profileCache.set(userId, { data: profileData, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });

        return reply.send({ success: true, data: profileData });
      } catch (error: any) {
        const status = error.response?.status;
        fastify.log.error({ status, data: error.response?.data }, 'LinkedIn /v2/userinfo error');

        if (status === 401) {
          // Evict stale cache on auth failure
          profileCache.delete(userId);
          return reply.status(401).send({ success: false, message: 'LinkedIn token expired — please reconnect' });
        }
        return reply.status(502).send({ success: false, message: 'Failed to fetch LinkedIn profile' });
      }
    }
  );

  // Delete LinkedIn token for a user
  fastify.delete(
    '/linkedin/token/:userId',
    async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
      try {
        const { userId } = request.params;
        const client = await pool.connect();
        
        try {
          const deleteQuery = `
            DELETE FROM public.linkedin_tokens 
            WHERE user_id = $1 
            RETURNING id;
          `;
          
          const result = await client.query(deleteQuery, [userId]);
          
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
        } finally {
          client.release();
        }
      } catch (error: any) {
        console.error('Error deleting LinkedIn token:', error);
        reply.status(500).send({
          message: 'Error deleting LinkedIn token',
          success: false,
          error: 'DATABASE_ERROR'
        });
      }
    }
  );
}