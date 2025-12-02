> Authentication and AI gateway service for the Driftal CLI

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## Overview

**Auth** is a backend service that provides authentication and AI gateway functionality for the [Driftal CLI](https://github.com/scout-team/cli). It handles user authentication via OAuth and passwordless login, manages JWT tokens, proxies LLM requests to multiple providers (OpenAI, Anthropic, Gemini), and tracks code review usage statistics.

## Features

- **Authentication**

  - Google OAuth integration
  - Passwordless authentication via OTP
  - JWT token management with refresh tokens
  - Authorization code flow for CLI authentication

- **AI Gateway**

  - Unified API for multiple LLM providers (OpenAI, Anthropic, Gemini)
  - Streaming and non-streaming chat completions
  - Model routing via OpenRouter
  - Support for reasoning models (O3, GPT-5 Codex)

- **Code Review Logging**

  - Track review sessions with metadata
  - Log issues with severity levels
  - Usage statistics and analytics
  - Repository-level tracking

- **Security & Performance**

  - Rate limiting with Redis
  - CORS protection
  - Helmet security headers
  - Request validation with Zod

- **Integrations**
  - Moss (Semantic Code Search) credentials management
  - Morph (Fast Apply) API key distribution

### Key Components

- **Authentication Service** (`src/services/auth.ts`) - Handles OAuth flows, token exchange, and user management
- **LLM Service** (`src/services/llm.ts`) - Routes requests to appropriate LLM providers
- **Proxy Service** (`src/services/proxy.ts`) - Manages request routing and response transformation
- **Middleware** - Authentication, rate limiting, error handling, and request logging
- **Database** - Prisma ORM with Supabase PostgreSQL for user profiles and review logs

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Language**: TypeScript 5.3
- **Database**: PostgreSQL (via Supabase) with Prisma ORM
- **Authentication**: Supabase Auth
- **Caching/Rate Limiting**: Upstash Redis
- **LLM Providers**: OpenAI SDK, OpenRouter API
- **Logging**: Winston
- **Validation**: Zod
- **Security**: Helmet, CORS
- **Deployment**: Docker

## Prerequisites

Before setting up the service, ensure you have:

- **Node.js** 20.0.0 or higher
- **npm** or **yarn** package manager
- **Supabase** account and project
- **Upstash Redis** account (or compatible Redis instance)
- **API Keys** for:
  - OpenAI
  - Anthropic
  - Google Gemini
  - OpenRouter
- **Moss** project credentials (for semantic code search)
- **Morph** API key (optional, for fast apply feature)

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/scout-team/auth.git
cd auth
```

### 2. Install Dependencies

```bash
npm install
```

This will automatically run `prisma generate` via the postinstall script.

### 3. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

### 4. Set Up Database

The service uses Supabase PostgreSQL. Apply the database schema:

1. Open your Supabase project dashboard
2. Navigate to the SQL Editor
3. Run the SQL migrations from `supabase/migrations/` (if any)
4. Or use Prisma to push the schema:

```bash
npm run prisma:push
```

### 5. Start the Development Server

```bash
npm run dev
```

The server will start on `http://localhost:3000` (or the port specified in your `.env` file).
|

### Example `.env` File

```env
# Server
PORT=3000
NODE_ENV=development

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret

# Redis
REDIS_URL=https://your-redis.upstash.io
REDIS_TOKEN=your-redis-token

# LLM Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=sk-or-...

# Moss
MOSS_PROJECT_ID=your-project-id
MOSS_PROJECT_KEY=your-project-key

# Optional
MORPH_API_KEY=your-morph-key

# URLs
BASE_URL=http://localhost:3000
FRONTEND_URL=http://localhost:8080
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
