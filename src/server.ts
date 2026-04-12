import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import linkedinRoutes from './routes/linkedin';
import oauthRoutes from './routes/oauth';
import postsRoutes from './routes/posts';
import authRoutes from './routes/auth';
import schedulerRoutes from './routes/scheduler';
import aiRoutes from './routes/ai';
import importRoutes from './routes/import';

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

server.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
});

server.register(cors, {
  origin: true,
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
server.register(schedulerRoutes);
server.register(aiRoutes);
server.register(importRoutes);

export default server;
