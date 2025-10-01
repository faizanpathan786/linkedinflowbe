# Better-Auth Integration Guide

This guide shows how better-auth has been integrated into your Fastify backend.

## 🚀 Quick Start

### 1. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required variables:
- `BETTER_AUTH_SECRET`: A secure secret key (minimum 32 characters)
- `PORT`: Server port (default: 3000)

Optional social providers:
- `GITHUB_CLIENT_ID` & `GITHUB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`

### 2. Database Setup

Better-auth will automatically create the required tables on first use. If you want to run migrations manually:

```bash
pnpm migrate
```

### 3. Start the Server

```bash
pnpm dev
```

## 📋 Available Endpoints

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/signup` | Register new user |
| `POST` | `/api/signin` | Sign in user |
| `POST` | `/api/signout` | Sign out user |
| `GET` | `/api/me` | Get current session |
| `ALL` | `/api/auth/*` | Better-auth handler (all auth operations) |

### Protected Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/api/protected` | Example protected route | ✅ |
| `GET` | `/api/profile` | Profile (optional auth) | ❌ |

## 🔧 Usage Examples

### Sign Up
```bash
curl -X POST http://localhost:3001/api/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "name": "John Doe"
  }'
```

### Sign In
```bash
curl -X POST http://localhost:3001/api/signin \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### Access Protected Route
```bash
curl -X GET http://localhost:3001/api/protected \
  -H "Cookie: better-auth.session_token=YOUR_SESSION_TOKEN"
```

### Check Current Session
```bash
curl -X GET http://localhost:3001/api/me \
  -H "Cookie: better-auth.session_token=YOUR_SESSION_TOKEN"
```

## 🔒 Middleware Usage

### Using Authentication Middleware

```typescript
import { requireAuth, authMiddleware } from '../middleware/auth';

// Require authentication
fastify.get('/api/protected', {
  preHandler: requireAuth
}, async (request, reply) => {
  // request.user and request.session are available
  return { user: request.user };
});

// Optional authentication
fastify.get('/api/optional', {
  preHandler: authMiddleware
}, async (request, reply) => {
  if (request.user) {
    return { message: 'Authenticated user', user: request.user };
  }
  return { message: 'Anonymous user' };
});
```

## 🗃️ Database Schema

Better-auth automatically creates these tables:
- `user` - User accounts
- `session` - User sessions
- `account` - OAuth accounts (for social providers)
- `verification` - Email verification tokens

## 🧪 Testing

Run the test suite:

```bash
pnpm test
```

## 🔧 Configuration

The auth configuration is in `src/auth.ts`:

```typescript
export const auth = betterAuth({
  database: {
    provider: "pg",
    url: "your-postgres-url",
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
    // Add more providers as needed
  },
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: ["http://localhost:3000", "http://localhost:3001"],
});
```

## 📁 File Structure

```
src/
├── auth.ts                 # Better-auth configuration
├── middleware/
│   └── auth.ts            # Authentication middleware
├── routes/
│   ├── auth.ts            # Authentication endpoints
│   ├── protected.ts       # Example protected routes
│   └── auth.test.ts       # Auth tests
└── migrate.ts             # Database migration script
```

## 🚀 Next Steps

1. **Email Verification**: Set `requireEmailVerification: true` and configure email provider
2. **Social Providers**: Add OAuth apps and configure client IDs/secrets
3. **Role-based Access**: Extend user model with roles and implement `requireAdmin` middleware
4. **Rate Limiting**: Add rate limiting to auth endpoints
5. **Email Templates**: Customize verification and password reset emails

## 🔍 Troubleshooting

### Common Issues

1. **Port in use**: Change `PORT` in `.env` file
2. **Database connection**: Verify your PostgreSQL connection string
3. **Session issues**: Check `BETTER_AUTH_SECRET` is set and consistent
4. **CORS issues**: Add your frontend URL to `trustedOrigins`

### Debug Mode

Enable debug logging:
```typescript
const server = Fastify({
  logger: {
    level: 'debug',
  },
});
```

## 📚 Resources

- [Better-auth Documentation](https://www.better-auth.com/docs)
- [Fastify Documentation](https://www.fastify.io/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)