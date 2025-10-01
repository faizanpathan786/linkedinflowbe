import type { FastifyRequest, FastifyReply } from 'fastify';
import { auth, type User } from '../auth';

// Define session type based on better-auth response
type AuthSession = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  expiresAt: Date;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

// Extend FastifyRequest to include user and session
declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    session?: AuthSession;
  }
}

/**
 * Authentication middleware that checks if the user is authenticated
 * and adds user/session to the request object
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers as any,
    });

    if (session) {
      request.user = session.user;
      request.session = session.session;
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    // Don't fail the request, just don't add auth info
  }
}

/**
 * Middleware that requires authentication
 * Use this for protected routes
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers as any,
    });

    if (!session) {
      return reply.code(401).send({ 
        error: 'Authentication required',
        message: 'You must be logged in to access this resource'
      });
    }

    request.user = session.user;
    request.session = session.session;
  } catch (error) {
    console.error('Auth requirement check error:', error);
    return reply.code(500).send({ 
      error: 'Authentication error',
      message: 'Failed to verify authentication'
    });
  }
}

/**
 * Middleware that requires admin role
 * Use this for admin-only routes
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // First check if user is authenticated
  await requireAuth(request, reply);
  
  if (reply.sent) {
    return; // Authentication failed
  }

  // Check if user has admin role
  // You'll need to add role field to your user model
  const user = request.user as any;
  if (!user || user.role !== 'admin') {
    return reply.code(403).send({ 
      error: 'Admin access required',
      message: 'You must be an admin to access this resource'
    });
  }
}