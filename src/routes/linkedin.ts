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
    // /v2/userinfo is the correct endpoint for openid+profile scopes (OIDC)
    // /v2/me requires the deprecated r_liteprofile scope and returns 403 with OIDC tokens
    const response = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });
    // userinfo returns { sub, name, given_name, family_name, picture, email, locale }
    // normalise to the shape the rest of this file expects: .id and .vanityName
    const data = response.data;
    return {
      ...data,
      id: data.sub,          // sub is the stable LinkedIn member ID
      vanityName: data.name, // vanityName is not available via userinfo; use display name
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