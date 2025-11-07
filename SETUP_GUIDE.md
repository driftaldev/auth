# ScoutCLI Backend Setup Guide

Step-by-step guide to get your ScoutCLI backend up and running.

## 📋 Prerequisites Checklist

Before you begin, make sure you have:

- [ ] Node.js 20+ installed
- [ ] npm or yarn package manager
- [ ] A code editor (VS Code recommended)
- [ ] Terminal access
- [ ] 30-45 minutes of time

## 🚀 Step 1: Create Accounts

### 1.1 Supabase Account

1. Go to [https://supabase.com](https://supabase.com)
2. Click "Start your project"
3. Sign up with GitHub or email
4. Verify your email

### 1.2 Upstash Account

1. Go to [https://console.upstash.com](https://console.upstash.com)
2. Sign up with GitHub or email
3. No email verification needed

### 1.3 Anthropic API Key

1. Go to [https://console.anthropic.com](https://console.anthropic.com)
2. Sign up and verify your email
3. Add payment method (required)
4. Go to "API Keys" section

### 1.4 OpenAI API Key

1. Go to [https://platform.openai.com](https://platform.openai.com)
2. Sign up and verify your email
3. Add payment method (required)
4. Go to "API Keys" section

## 🗄️ Step 2: Set Up Supabase Project

### 2.1 Create Project

1. In Supabase dashboard, click "New Project"
2. Fill in:
   - **Name**: `scoutcli-backend`
   - **Database Password**: Generate strong password (save it!)
   - **Region**: Choose closest to your users
3. Click "Create new project"
4. Wait 2-3 minutes for provisioning

### 2.2 Get Credentials

1. Go to **Settings** → **API**
2. Copy these values (you'll need them later):

```
Project URL: https://xxxxxxxxxxxxx.supabase.co
anon public key: eyJhbGci...
service_role key: eyJhbGci...
```

3. Go to **Settings** → **API** → **JWT Settings**
4. Copy: **JWT Secret**

### 2.3 Run Database Migrations

**Option A: Using Supabase CLI (Recommended)**

```bash
# Install Supabase CLI globally
npm install -g supabase

# Login
supabase login

# Link to your project
# Get project ref from URL: https://supabase.com/dashboard/project/[PROJECT_REF]
supabase link --project-ref YOUR_PROJECT_REF

# Navigate to backend directory
cd backend

# Run all migrations
supabase db push --include-all
```

**Option B: Manual SQL Execution**

1. In Supabase dashboard, go to **SQL Editor**
2. Create a new query
3. Copy and paste content from `supabase/migrations/001_create_user_profiles.sql`
4. Click "Run"
5. Repeat for `002_create_auth_codes.sql` and `003_create_usage_logs.sql`

### 2.4 Verify Tables Created

1. Go to **Table Editor** in Supabase dashboard
2. You should see these tables:
   - `user_profiles`
   - `auth_codes`
   - `usage_logs`

### 2.5 Configure Authentication

1. Go to **Authentication** → **Providers**
2. Enable **Email** provider
3. Set **Confirm email** to OFF (for development)
4. Click Save

## 🔴 Step 3: Set Up Upstash Redis

### 3.1 Create Redis Database

1. In Upstash console, click "Create Database"
2. Fill in:
   - **Name**: `scoutcli-ratelimit`
   - **Type**: Regional (cheaper) or Global
   - **Region**: Same as Supabase or closest
3. Click "Create"

### 3.2 Get Connection URL

1. Click on your database
2. Scroll to "REST API" section
3. Copy the **UPSTASH_REDIS_REST_URL**
4. It should look like:
```
https://xxxxx.upstash.io
```

But we need Redis URL format:
1. Go to "Details" tab
2. Copy the connection string that starts with `redis://`

Example:
```
redis://default:AbCd1234...@xxxxx.upstash.io:6379
```

## 🔑 Step 4: Get API Keys

### 4.1 Anthropic API Key

1. Go to [https://console.anthropic.com](https://console.anthropic.com)
2. Click "API Keys" in sidebar
3. Click "Create Key"
4. Give it a name: `scoutcli-backend`
5. Copy the key (starts with `sk-ant-`)
6. **Save it immediately** - you won't see it again!

### 4.2 OpenAI API Key

1. Go to [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Click "Create new secret key"
3. Give it a name: `scoutcli-backend`
4. Copy the key (starts with `sk-`)
5. **Save it immediately** - you won't see it again!

## ⚙️ Step 5: Configure Backend

### 5.1 Clone/Download Backend Code

```bash
# If in the ScoutLab directory
cd backend

# Install dependencies
npm install
```

### 5.2 Create .env File

```bash
# Copy example
cp .env.example .env

# Open in your editor
nano .env  # or use VS Code, vim, etc.
```

### 5.3 Fill in Environment Variables

Replace these values in `.env`:

```env
# Server
PORT=3000
NODE_ENV=development

# Supabase (from Step 2.2)
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
SUPABASE_JWT_SECRET=your-jwt-secret

# Redis (from Step 3.2)
REDIS_URL=redis://default:AbCd1234...@xxxxx.upstash.io:6379

# LLM Provider API Keys (from Step 4)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Rate Limiting (defaults are fine for development)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=50

# CORS (allow CLI callback)
ALLOWED_ORIGINS=http://localhost:8080,https://scoutcode.com,http://localhost:*

# Frontend URL
FRONTEND_URL=http://localhost:3000

# Logging
LOG_LEVEL=info

# Authentication
AUTH_CODE_EXPIRY_MINUTES=10
JWT_EXPIRY_SECONDS=3600

# Security
FORCE_HTTPS=false
TRUST_PROXY=false
```

### 5.4 Update Auth Page

Edit `public/auth.html` and replace the Supabase credentials:

```javascript
// Find these lines (around line 198-201)
const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE';

// Replace with your values
const SUPABASE_URL = 'https://xxxxxxxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci...';
```

## ✅ Step 6: Test the Backend

### 6.1 Start Development Server

```bash
npm run dev
```

You should see:
```
✅ Configuration loaded successfully
   Environment: development
   Port: 3000
✓ Supabase client initialized
✓ Server running on port 3000
✓ Environment: development
✓ Health check: http://localhost:3000/health
✓ Web auth page: http://localhost:3000/cli/auth
🚀 ScoutCLI Backend is ready!
```

### 6.2 Test Health Endpoint

Open a new terminal:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "supabase": "connected",
  "redis": "connected",
  "timestamp": "2025-01-04T12:00:00.000Z"
}
```

### 6.3 Test Authentication Page

Open your browser and go to:
```
http://localhost:3000/cli/auth?state=test123
```

You should see the ScoutCLI authentication page.

### 6.4 Create Test User

1. On the auth page, click "Sign Up"
2. Enter:
   - Email: `test@example.com`
   - Password: `password123`
3. Click "Sign Up"
4. You should see "Account created!"
5. Select models and click "Authorize ScoutCLI"

### 6.5 Verify in Supabase

1. Go to Supabase dashboard
2. Go to **Table Editor** → **user_profiles**
3. You should see your test user

## 🐛 Troubleshooting

### "Configuration validation failed"

- Check that all required variables are in `.env`
- Make sure there are no extra spaces or quotes
- Verify URLs are in correct format

### "Supabase connection failed"

- Check `SUPABASE_URL` is correct
- Verify `SUPABASE_SERVICE_ROLE_KEY` (not anon key)
- Test the URL in browser - should show Supabase API page

### "Redis connection failed"

- Check Redis URL format: `redis://default:password@host:6379`
- Verify the password is included
- Test in Upstash console

### "Anthropic/OpenAI API error"

- Verify API key is correct
- Check you have credits/billing enabled
- Test key with curl:

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-3-5-haiku-20241022",
    "max_tokens": 1,
    "messages": [{"role": "user", "content": "Hi"}]
  }'
```

### Port 3000 already in use

```bash
# Find process using port 3000
lsof -i :3000

# Kill it
kill -9 <PID>

# Or use different port
PORT=3001 npm run dev
```

## 🎉 Success!

If all tests pass, your backend is ready! You can now:

1. Connect the ScoutCLI to your backend
2. Deploy to Railway or Render
3. Start using ScoutCLI with cloud authentication

## 📚 Next Steps

- Read the full [README.md](README.md) for API documentation
- Set up production deployment on Railway
- Configure monitoring and alerts
- Set up automated backups

## 💬 Getting Help

If you're stuck:

1. Check the [README.md](README.md) Troubleshooting section
2. Check Supabase logs in dashboard
3. Check backend logs in terminal
4. Open an issue on GitHub

---

**Estimated Setup Time**: 30-45 minutes

**Difficulty**: Intermediate

**Cost**: Free tier available for all services (with limitations)
