import Fastify from 'fastify';
import linkedinRoutes from './routes/linkedin';
import oauthRoutes from './routes/oauth';
import postsRoutes from './routes/posts';
import authRoutes from './routes/auth';

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

server.register(require('@fastify/cors'), {
  origin: true,
  credentials: true,
});

server.register(linkedinRoutes);
server.register(oauthRoutes);
server.register(postsRoutes);
server.register(authRoutes);

export default server;
