import Fastify from 'fastify';
import cors from '@fastify/cors';
import linkedinRoutes from './routes/linkedin';
import oauthRoutes from './routes/oauth';
import postsRoutes from './routes/posts';
import authRoutes from './routes/auth';

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean) as string[];

server.register(cors, {
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['set-cookie'],
});

server.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

server.register(linkedinRoutes);
server.register(oauthRoutes);
server.register(postsRoutes);
server.register(authRoutes);

export default server;
