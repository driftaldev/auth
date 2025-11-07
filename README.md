# ScoutCLI Backend

Complete backend service for ScoutCLI's cloud proxy authentication and LLM request routing. Handles OAuth authentication, token management, and proxies LLM requests to Anthropic/OpenAI.

## Features

- **OAuth 2.0 Authentication** - Secure authorization code flow for CLI authentication
- **Supabase Integration** - PostgreSQL database with built-in authentication
- **LLM Proxy** - Route requests to Anthropic or OpenAI based on user preferences
- **Rate Limiting** - Redis-based rate limiting with Upstash
- **JWT Verification** - Secure token-based authentication
- **Usage Tracking** - Track LLM API usage per user
- **Streaming Support** - Server-Sent Events (SSE) for streaming responses
- **Docker Ready** - Containerized for easy deployment

## Tech Stack

- **Framework**: Express.js with TypeScript
- **Database & Auth**: Supabase (PostgreSQL + Auth)
- **Cache**: Upstash Redis (serverless)
- **LLM Providers**: Anthropic, OpenAI
- **Deployment**: Railway/Render compatible

## Prerequisites

- Node.js 20+
- Supabase account ([supabase.com](https://supabase.com))
- Upstash Redis account ([console.upstash.com](https://console.upstash.com))
- Anthropic API key ([console.anthropic.com](https://console.anthropic.com))
- OpenAI API key ([platform.openai.com](https://platform.openai.com))

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Set Up Supabase

#### Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to be provisioned (~2 minutes)
3. Go to **Settings** → **API** and copy:
   - Project URL
   - `anon` public key
   - `service_role` secret key
4. Go to **Settings** → **API** → **JWT Settings** and copy:
   - JWT Secret

#### Run Database Migrations

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Run migrations
supabase db push --include-all
```

Or manually run the SQL files in the Supabase SQL Editor:
- `supabase/migrations/001_create_user_profiles.sql`
- `supabase/migrations/002_create_auth_codes.sql`
- `supabase/migrations/003_create_usage_logs.sql`

#### Configure Supabase Auth

1. Go to **Authentication** → **Providers**
2. Enable **Email** provider
3. (Optional) Enable **Google** or **GitHub** OAuth
4. Go to **Authentication** → **URL Configuration**
5. Add redirect URLs:
   - `http://localhost:3000/cli/auth`
   - `http://localhost:*/callback` (for CLI)
   - Your production domain

### 3. Set Up Upstash Redis

1. Go to [console.upstash.com](https://console.upstash.com)
2. Create a new Redis database
3. Select a region close to your deployment
4. Copy the **REST URL** (format: `redis://...`)

### 4. Get API Keys

#### Anthropic
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Copy the key (starts with `sk-ant-...`)

#### OpenAI
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a new secret key
3. Copy the key (starts with `sk-...`)

### 5. Configure Environment Variables

```bash
# Copy example env file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

Fill in all the required values:

```env
# Server
PORT=3000
NODE_ENV=development

# Supabase (from step 2)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret

# Redis (from step 3)
REDIS_URL=redis://default:password@endpoint.upstash.io:6379

# LLM Provider API Keys (from step 4)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=50

# CORS
ALLOWED_ORIGINS=http://localhost:8080,https://scoutcode.com,http://localhost:*

# Frontend URL
FRONTEND_URL=https://scoutcode.com

# Logging
LOG_LEVEL=info

# Authentication
AUTH_CODE_EXPIRY_MINUTES=10
JWT_EXPIRY_SECONDS=3600

# Security
FORCE_HTTPS=false
TRUST_PROXY=false
```

### 6. Update Auth Page

Edit `public/auth.html` and replace the Supabase credentials:

```javascript
const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE';
```

### 7. Start Development Server

```bash
npm run dev
```

The server will start on http://localhost:3000

### 8. Test the Setup

```bash
# Health check
curl http://localhost:3000/health

# Should return:
{
  "status": "ok",
  "supabase": "connected",
  "redis": "connected",
  "timestamp": "2025-01-04T12:00:00Z"
}
```

## API Endpoints

### Authentication

#### `POST /auth/token`
Exchange authorization code for access/refresh tokens.

**Request:**
```json
{
  "code": "auth_code_from_cli"
}
```

**Response:**
```json
{
  "access_token": "jwt_token",
  "refresh_token": "refresh_token",
  "expires_in": 3600,
  "user_email": "user@example.com"
}
```

#### `POST /auth/refresh`
Refresh an expired access token.

**Request:**
```json
{
  "refresh_token": "refresh_token"
}
```

**Response:**
```json
{
  "access_token": "new_jwt_token",
  "refresh_token": "new_refresh_token",
  "expires_in": 3600
}
```

#### `POST /auth/signup`
Register a new user.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "primary_model": "claude-3-5-sonnet-20241022",
  "fallback_model": "gpt-4"
}
```

#### `POST /auth/signin`
Sign in with email/password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### LLM Proxy

#### `POST /v1/chat/completions`
Proxy LLM requests (requires authentication).

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request:**
```json
{
  "messages": [
    {"role": "system", "content": "You are a code reviewer"},
    {"role": "user", "content": "Review this code..."}
  ],
  "model": "claude-3-5-sonnet-20241022",
  "temperature": 0.3,
  "max_tokens": 4096,
  "stream": false
}
```

**Response:**
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "The response text..."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150
  }
}
```

#### `GET /v1/usage`
Get usage statistics (requires authentication).

**Response:**
```json
{
  "total_requests": 150,
  "total_tokens": 50000,
  "models_used": ["claude-3-5-sonnet-20241022"]
}
```

#### `GET /v1/models`
List available models.

### Health

#### `GET /health`
Health check endpoint.

#### `GET /health/ready`
Readiness probe for Kubernetes.

#### `GET /health/live`
Liveness probe for Kubernetes.

### Web Authentication

#### `GET /cli/auth`
Web authentication page for CLI users.

Query parameters:
- `state` - CSRF protection token
- `primary_model` - Pre-selected primary model
- `fallback_model` - Pre-selected fallback model

## Development

### Project Structure

```
backend/
├── src/
│   ├── routes/          # API endpoints
│   │   ├── auth.ts      # Authentication routes
│   │   ├── proxy.ts     # LLM proxy routes
│   │   └── health.ts    # Health check
│   ├── middleware/      # Express middleware
│   │   ├── auth.ts      # JWT verification
│   │   ├── rate-limit.ts # Rate limiting
│   │   └── error.ts     # Error handling
│   ├── services/        # Business logic
│   │   ├── supabase.ts  # Supabase client
│   │   ├── auth.ts      # OAuth logic
│   │   ├── anthropic.ts # Anthropic API
│   │   ├── openai.ts    # OpenAI API
│   │   └── proxy.ts     # Request routing
│   ├── config/          # Configuration
│   │   ├── index.ts     # Config loader
│   │   └── logger.ts    # Winston logger
│   ├── types/           # TypeScript types
│   │   └── index.ts     # Type definitions
│   └── index.ts         # Entry point
├── public/              # Static files
│   └── auth.html        # Auth page
├── supabase/            # Database
│   └── migrations/      # SQL migrations
├── tests/               # Test files
├── package.json
├── tsconfig.json
├── Dockerfile
└── README.md
```

### Scripts

```bash
# Development
npm run dev          # Start with hot reload

# Production
npm run build        # Compile TypeScript
npm start            # Start production server

# Testing
npm test             # Run tests
npm run test:watch   # Watch mode

# Code Quality
npm run lint         # Run ESLint
npm run format       # Format with Prettier
npm run typecheck    # TypeScript type check
```

### Adding a New Route

1. Create route file in `src/routes/`
2. Import and use in `src/index.ts`
3. Add middleware as needed
4. Update this README

### Adding a New LLM Provider

1. Create provider service in `src/services/`
2. Add model mappings to `src/types/index.ts`
3. Update `src/services/proxy.ts` routing logic
4. Test with sample requests

## Deployment

### Railway (Recommended)

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login and initialize:
```bash
railway login
railway init
```

3. Add environment variables in Railway dashboard

4. Deploy:
```bash
railway up
```

### Render

1. Create new Web Service on [render.com](https://render.com)
2. Connect your GitHub repository
3. Configure:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node 20
4. Add environment variables
5. Deploy

### Docker

```bash
# Build image
docker build -t scoutcli-backend .

# Run container
docker run -p 3000:3000 --env-file .env scoutcli-backend

# Or use Docker Compose
docker-compose up
```

### Environment-Specific Settings

**Production:**
- Set `NODE_ENV=production`
- Set `FORCE_HTTPS=true`
- Set `TRUST_PROXY=true` (if behind proxy)
- Use strong passwords
- Enable Supabase RLS policies
- Set up monitoring

## Monitoring & Logging

### Logs

Logs are output to:
- Console (always)
- File (if `LOG_FILE` is set)

Log levels: `error`, `warn`, `info`, `debug`

### Health Checks

Monitor these endpoints:
- `/health` - Overall health
- `/health/ready` - Ready to serve traffic
- `/health/live` - Server is alive

### Metrics

Usage metrics are stored in `usage_logs` table:
- Request count
- Token usage
- Error rates
- Response times

## Security

- **JWT Verification**: All proxy requests require valid JWT
- **Rate Limiting**: Redis-based rate limiting per user/IP
- **CORS**: Configured allowed origins
- **Helmet**: Security headers enabled
- **Input Validation**: Zod schemas for all inputs
- **SQL Injection**: Supabase parameterized queries
- **Secrets**: Never commit `.env` file

## Troubleshooting

### Supabase Connection Fails

```bash
# Check credentials
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY

# Test connection
curl "$SUPABASE_URL/rest/v1/" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

### Redis Connection Fails

```bash
# Verify Redis URL format
# Should be: redis://default:password@endpoint.upstash.io:6379

# Test with Upstash REST API
curl https://YOUR-ENDPOINT.upstash.io/ping \
  -H "Authorization: Bearer YOUR-TOKEN"
```

### Authentication Errors

- Check JWT secret matches Supabase
- Verify token hasn't expired
- Check CORS settings for CLI callback URLs

### Rate Limiting Issues

- Check Redis connection
- Verify rate limit settings
- Clear rate limit: `redis-cli DEL ratelimit:userid`

## CLI Integration

The backend works with ScoutCLI's authentication flow:

1. User runs `scoutcli login`
2. CLI opens browser to `/cli/auth?state=xyz`
3. User authenticates and selects models
4. Page redirects to `http://localhost:PORT/callback?code=abc&state=xyz`
5. CLI exchanges code for tokens via `POST /auth/token`
6. CLI saves tokens and uses them for `/v1/chat/completions`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## Support

- **Documentation**: [docs.scoutcode.com](https://docs.scoutcode.com)
- **Issues**: [github.com/scoutcode/backend/issues](https://github.com/scoutcode/backend/issues)
- **Discord**: [discord.gg/scoutcode](https://discord.gg/scoutcode)

## License

MIT License - see [LICENSE](LICENSE) file

---

Built with ❤️ for ScoutCLI
