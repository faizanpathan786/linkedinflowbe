import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { auth } from '../auth';
import LinkedInService from '../services/linkedin.service';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function oauthRoutes(fastify: FastifyInstance, options: any) {
  const linkedinService = new LinkedInService(fastify);

  // Get LinkedIn connection status
  fastify.get('/oauth/linkedin/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: request.headers as any });

    if (!session) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'No active session found' });
    }

    const { data: linkedinData, error: linkedinError } = await supabase
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
  });

  // Initiate LinkedIn OAuth — returns auth URL with userId in state
  fastify.get('/oauth/linkedin', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: request.headers as any });

    if (!session) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'No active session found' });
    }

    const authUrl = linkedinService.getAuthUrl(JSON.stringify({ userId: session.user.id }));
    return reply.status(200).send({ authUrl });
  });

  // Handle LinkedIn OAuth callback
  fastify.get(
    '/oauth/linkedin/callback',
    async (
      request: FastifyRequest<{ Querystring: { code?: string; state?: string } }>,
      reply: FastifyReply
    ) => {
      const { code, state } = request.query;
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

      if (!code) {
        return reply.redirect(`${frontendUrl}?linkedin=error&message=${encodeURIComponent('Authorization code missing')}`);
      }

      // Extract userId from state (passed during OAuth initiation)
      let userId: string | null = null;
      if (state) {
        try {
          const parsed = JSON.parse(decodeURIComponent(state));
          userId = parsed.userId || null;
        } catch {
          // state is not JSON, ignore
        }
      }

      if (!userId) {
        return reply.redirect(`${frontendUrl}?linkedin=error&message=${encodeURIComponent('User not identified. Please try again.')}`);
      }

      try {
        const tokenData = await linkedinService.getAccessToken(code);
        const profile = await linkedinService.getUserProfile(tokenData.access_token);
        const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

        const dbClient = await pool.connect();
        try {
          await dbClient.query(
            `INSERT INTO public.linkedin_tokens (user_id, access_token, refresh_token, expires_at, person_urn, vanity_name, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (user_id) DO UPDATE SET
               access_token = EXCLUDED.access_token,
               refresh_token = EXCLUDED.refresh_token,
               expires_at = EXCLUDED.expires_at,
               person_urn = EXCLUDED.person_urn,
               vanity_name = EXCLUDED.vanity_name,
               metadata = EXCLUDED.metadata,
               updated_at = CURRENT_TIMESTAMP`,
            [
              userId,
              tokenData.access_token,
              tokenData.refresh_token || null,
              expiresAt.toISOString(),
              profile.id,
              profile.vanity_name || null,
              JSON.stringify(profile),
            ]
          );
        } finally {
          dbClient.release();
        }

        return reply.redirect(`${frontendUrl}?linkedin=connected`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        fastify.log.error(`OAuth callback error: ${message}`);
        return reply.redirect(`${frontendUrl}?linkedin=error&message=${encodeURIComponent(message)}`);
      }
    }
  );

  // Get LinkedIn profile
  fastify.get('/oauth/linkedin/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: request.headers as any });

    if (!session) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'No active session found' });
    }

    const { data: linkedinData, error: linkedinError } = await supabase
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
      profile: {
        id: linkedinData.person_urn,
        vanityName: linkedinData.vanity_name,
        ...linkedinData.metadata,
        connectedAt: linkedinData.created_at,
        lastUpdated: linkedinData.updated_at,
      },
    });
  });
}

export default oauthRoutes;
