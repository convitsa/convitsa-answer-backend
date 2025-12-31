# Convitsa Answer Backend

Production-ready backend for **Convitsa Answer** - a no-code AI chat platform for websites.

## Overview

Convitsa Answer enables website owners to add AI-powered chat to their sites. The AI answers visitor questions based on the website's content using RAG (Retrieval-Augmented Generation).

### How It Works

1. Website owner signs up and verifies email
2. Owner creates a project for their website
3. Owner triggers a crawl to index the website content
4. Owner generates an API key
5. Owner adds the Framer chat component to their site
6. Visitors chat with AI that answers using the indexed content

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| REST API | Hono |
| WebSocket | ws |
| Database | MongoDB Atlas + Vector Search |
| Cache/Rate Limit | Redis |
| LLM | Azure OpenAI (GPT-4o, text-embedding-3-large) |
| Crawling | Firecrawl |
| Email | Resend |
| Auth | JWT + bcrypt |
| Validation | Zod |

## Project Structure

```
backend/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config/
│   │   └── env.ts               # Environment configuration
│   ├── db/
│   │   ├── mongodb.ts           # MongoDB connection
│   │   ├── redis.ts             # Redis connection
│   │   └── schemas/             # Mongoose schemas
│   ├── api/
│   │   ├── routes/              # REST API routes
│   │   ├── middleware/          # Auth, rate limiting, security
│   │   └── validators/          # Request validation (Zod)
│   ├── ws/
│   │   ├── server.ts            # WebSocket server
│   │   └── handlers/            # Chat message handler
│   ├── services/                # Business logic
│   ├── utils/                   # Helper functions
│   └── types/                   # TypeScript types
├── package.json
├── tsconfig.json
└── README.md
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- MongoDB Atlas account (with Vector Search enabled)
- Redis server
- Azure OpenAI account
- Firecrawl API key
- Resend API key

### Installation

1. Clone the repository and install dependencies:

```bash
cd backend
bun install
```

2. Create a `.env` file based on the example:

```bash
cp env.example .env
```

3. Configure your environment variables (see Configuration section)

4. Start the development server:

```bash
bun run dev
```

### Running in Production

```bash
bun run start
```

## Configuration

Create a `.env` file with the following variables:

```env
# Server
PORT=3000
NODE_ENV=production

# MongoDB Atlas
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/convitsa?retryWrites=true&w=majority

# Redis
REDIS_URL=redis://localhost:6379

# Azure OpenAI (REQUIRED)
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_API_VERSION=2024-02-15-preview
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4o
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-large

# Firecrawl
FIRECRAWL_API_KEY=your-firecrawl-api-key

# Resend
RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@convitsa.com

# JWT (generate with: openssl rand -base64 64)
JWT_SECRET=your-jwt-secret-at-least-32-characters
JWT_REFRESH_SECRET=your-refresh-secret-at-least-32-characters
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Rate Limiting
RATE_LIMIT_FREE_MESSAGES_PER_MIN=5
RATE_LIMIT_PRO_MESSAGES_PER_MIN=30
MAX_WS_CONNECTIONS_PER_KEY=100

# Tier Configuration
FREE_CONTEXT_CHUNKS=3
PRO_CONTEXT_CHUNKS=10
FREE_MAX_TOKENS=500
PRO_MAX_TOKENS=2000
```

### MongoDB Atlas Vector Search Index

Create a vector search index in MongoDB Atlas with this configuration:

```json
{
  "name": "vector_index",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "embedding",
        "numDimensions": 3072,
        "similarity": "cosine"
      },
      {
        "type": "filter",
        "path": "projectId"
      }
    ]
  }
}
```

## API Reference

### Authentication

All dashboard routes require a Bearer token:

```
Authorization: Bearer <jwt_token>
```

### Endpoints

#### Auth Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/signup` | Register new user |
| POST | `/api/v1/auth/verify` | Verify email with 6-digit code |
| POST | `/api/v1/auth/resend-code` | Resend verification code |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/forgot-password` | Request password reset |
| POST | `/api/v1/auth/reset-password` | Reset password |

#### User Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/users/me` | Get current user profile |
| GET | `/api/v1/users/me/credits` | Get credit balance |
| GET | `/api/v1/users/me/credits/history` | Get credit history |

#### Project Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/projects` | List user projects |
| POST | `/api/v1/projects` | Create project |
| GET | `/api/v1/projects/:id` | Get project details |
| PUT | `/api/v1/projects/:id` | Update project |
| DELETE | `/api/v1/projects/:id` | Delete project |
| POST | `/api/v1/projects/:id/crawl` | Trigger website crawl |
| GET | `/api/v1/projects/:id/crawl-status` | Get crawl status |
| GET | `/api/v1/projects/:id/pages` | List indexed pages |

#### API Key Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/projects/:id/api-keys` | List API keys |
| POST | `/api/v1/projects/:id/api-keys` | Create API key |
| DELETE | `/api/v1/api-keys/:id` | Revoke API key |

#### Analytics Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/projects/:id/analytics` | Get project analytics |
| GET | `/api/v1/projects/:id/sessions` | List chat sessions |
| GET | `/api/v1/projects/:id/sessions/:sessionId/messages` | Get session messages |

## WebSocket Protocol

### Connection

```
ws://host/chat?token=API_KEY&tier=free|pro
```

- `token`: API key (required)
- `tier`: `free` or `pro` (defaults to `free`)

### Client → Server

```json
{
  "type": "message",
  "content": "How does your pricing work?"
}
```

### Server → Client

**Streaming chunks:**
```json
{
  "type": "chunk",
  "content": "Our pricing is based on..."
}
```

**Completion:**
```json
{
  "type": "done",
  "tokensUsed": 932
}
```

**Error:**
```json
{
  "type": "error",
  "message": "Free tier limit reached",
  "code": "RATE_LIMIT"
}
```

## Free vs Pro Tier

| Feature | Free | Pro |
|---------|------|-----|
| Context chunks | 3 | 10 |
| Max tokens/response | 500 | 2000 |
| Messages/minute | 5 | 30 |
| Credit deduction | No | Yes |

## Security

- **Rate Limiting**: Redis-based sliding window per API key
- **Connection Limits**: Max 100 concurrent WebSocket connections per API key
- **Message Size**: 4KB max message size
- **API Key Hashing**: SHA-256, never stored in plain text
- **Password Hashing**: bcrypt with cost factor 12
- **JWT**: 1-hour expiry with refresh tokens
- **Input Validation**: Zod schemas for all inputs
- **Kill Switch**: Instant API key deactivation

## Deployment

### Docker

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --production

COPY . .

EXPOSE 3000

CMD ["bun", "run", "start"]
```

### Environment Variables

Ensure all required environment variables are set in your production environment.

### Health Check

```
GET /api/v1/health
```

Returns:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0"
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Clients                                  │
├─────────────────────────────────────────────────────────────────┤
│     Dashboard (JWT Auth)        │    Framer Widget (API Key)    │
└───────────────┬─────────────────┴───────────────┬───────────────┘
                │                                 │
                ▼                                 ▼
┌───────────────────────────────┐ ┌───────────────────────────────┐
│       REST API (Hono)         │ │   WebSocket Server (ws)       │
│  - Auth routes                │ │  - API key validation         │
│  - Project CRUD               │ │  - Tier-based rate limiting   │
│  - API key management         │ │  - Streaming responses        │
│  - Analytics                  │ │                               │
└───────────────┬───────────────┘ └───────────────┬───────────────┘
                │                                 │
                ▼                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Services Layer                            │
├────────────┬────────────┬────────────┬────────────┬─────────────┤
│   Auth     │  Project   │   Crawl    │    RAG     │   Credit    │
│  Service   │  Service   │  Service   │  Service   │  Service    │
└────────────┴────────────┴────────────┴────────────┴─────────────┘
                │                 │           │
                ▼                 ▼           ▼
┌───────────────────┐ ┌─────────────┐ ┌───────────────────────────┐
│   MongoDB Atlas   │ │  Firecrawl  │ │     Azure OpenAI          │
│  + Vector Search  │ │    API      │ │  - GPT-4o (chat)          │
└───────────────────┘ └─────────────┘ │  - text-embedding-3-large │
                                      └───────────────────────────┘
```

## License

Proprietary - Convitsa

