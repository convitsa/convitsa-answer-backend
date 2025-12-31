# Convitsa Answer API Documentation

**Base URL:** `http://localhost:3000/api/v1`  
**WebSocket URL:** `ws://localhost:3000/chat`

---

## Table of Contents

1. [Authentication](#authentication)
2. [Auth Endpoints](#auth-endpoints)
3. [User Endpoints](#user-endpoints)
4. [Project Endpoints](#project-endpoints)
5. [API Key Endpoints](#api-key-endpoints)
6. [Analytics Endpoints](#analytics-endpoints)
7. [WebSocket Chat Protocol](#websocket-chat-protocol)
8. [Error Responses](#error-responses)
9. [TypeScript Types](#typescript-types)

---

## Authentication

### Dashboard Authentication (JWT)

All dashboard endpoints require a Bearer token in the Authorization header:

```
Authorization: Bearer <access_token>
```

### Chat Authentication (API Key)

Website chat uses API keys passed via WebSocket query parameter:

```
ws://localhost:3000/chat?token=ca_live_xxxx&tier=free
```

---

## Auth Endpoints

### POST `/auth/signup`

Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

**Validation Rules:**
- `email`: Valid email format
- `password`: Min 8 chars, must contain uppercase, lowercase, and number

**Success Response (201):**
```json
{
  "message": "Account created. Please check your email for verification code.",
  "userId": "507f1f77bcf86cd799439011",
  "email": "user@example.com"
}
```

**Error Responses:**
- `400` - Validation error
- `409` - Email already registered

---

### POST `/auth/verify`

Verify email with 6-digit code.

**Request Body:**
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Success Response (200):**
```json
{
  "message": "Email verified successfully",
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com"
  }
}
```

**Error Responses:**
- `400` - Invalid or expired code
- `404` - User not found

---

### POST `/auth/resend-code`

Resend verification code (60 second cooldown).

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Success Response (200):**
```json
{
  "message": "If the email exists, a verification code has been sent."
}
```

**Error Responses:**
- `400` - Already verified
- `429` - Cooldown active (wait before resending)

---

### POST `/auth/login`

Login with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

**Success Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com"
  }
}
```

**Error Responses:**
- `401` - Invalid credentials
- `403` - Email not verified

---

### POST `/auth/refresh`

Refresh access token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Success Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Error Responses:**
- `401` - Invalid refresh token

---

### POST `/auth/forgot-password`

Request password reset code.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Success Response (200):**
```json
{
  "message": "If the email exists, a reset code has been sent."
}
```

---

### POST `/auth/reset-password`

Reset password with code.

**Request Body:**
```json
{
  "email": "user@example.com",
  "code": "123456",
  "newPassword": "NewSecurePass123"
}
```

**Success Response (200):**
```json
{
  "message": "Password reset successful"
}
```

**Error Responses:**
- `400` - Invalid code or password requirements not met

---

## User Endpoints

> All user endpoints require JWT authentication.

### GET `/users/me`

Get current user profile.

**Success Response (200):**
```json
{
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "emailVerified": true,
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

### GET `/users/me/credits`

Get credit balance and recent transactions.

**Success Response (200):**
```json
{
  "balance": 1500,
  "recentTransactions": [
    {
      "amount": 5,
      "type": "debit",
      "reason": "Chat usage (1500 tokens, 1.5 base + 0.38 commission)",
      "createdAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "amount": 100,
      "type": "credit",
      "reason": "Purchase",
      "createdAt": "2024-01-14T08:00:00.000Z"
    }
  ]
}
```

---

### GET `/users/me/credits/history`

Get full credit transaction history with pagination.

**Query Parameters:**
- `page` (optional): Page number, default 1
- `limit` (optional): Items per page, default 20, max 100

**Success Response (200):**
```json
{
  "transactions": [
    {
      "amount": 5,
      "type": "debit",
      "reason": "Chat usage (1500 tokens)",
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "total": 45,
  "page": 1,
  "limit": 20,
  "totalPages": 3
}
```

---

## Project Endpoints

> All project endpoints require JWT authentication.

### GET `/projects`

List all projects for the authenticated user.

**Success Response (200):**
```json
{
  "projects": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "userId": "507f1f77bcf86cd799439012",
      "name": "My Website",
      "websiteUrl": "https://example.com",
      "crawlStatus": "completed",
      "crawlError": null,
      "lastCrawledAt": "2024-01-15T10:30:00.000Z",
      "createdAt": "2024-01-10T08:00:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z",
      "pagesCount": 25,
      "apiKeysCount": 2,
      "sessionsCount": 150
    }
  ]
}
```

---

### POST `/projects`

Create a new project.

**Request Body:**
```json
{
  "name": "My Website",
  "websiteUrl": "https://example.com"
}
```

**Validation Rules:**
- `name`: 1-100 characters
- `websiteUrl`: Valid URL starting with http:// or https://

**Success Response (201):**
```json
{
  "project": {
    "_id": "507f1f77bcf86cd799439011",
    "userId": "507f1f77bcf86cd799439012",
    "name": "My Website",
    "websiteUrl": "https://example.com",
    "crawlStatus": "idle",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

### GET `/projects/:id`

Get a single project by ID.

**URL Parameters:**
- `id`: Project ID (MongoDB ObjectId)

**Success Response (200):**
```json
{
  "project": {
    "_id": "507f1f77bcf86cd799439011",
    "userId": "507f1f77bcf86cd799439012",
    "name": "My Website",
    "websiteUrl": "https://example.com",
    "crawlStatus": "completed",
    "crawlError": null,
    "lastCrawledAt": "2024-01-15T10:30:00.000Z",
    "createdAt": "2024-01-10T08:00:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "pagesCount": 25,
    "apiKeysCount": 2,
    "sessionsCount": 150
  }
}
```

**Error Responses:**
- `404` - Project not found

---

### PUT `/projects/:id`

Update a project.

**URL Parameters:**
- `id`: Project ID

**Request Body:**
```json
{
  "name": "Updated Website Name",
  "websiteUrl": "https://new-example.com"
}
```

Both fields are optional.

**Success Response (200):**
```json
{
  "project": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Updated Website Name",
    "websiteUrl": "https://new-example.com",
    ...
  }
}
```

---

### DELETE `/projects/:id`

Delete a project and all associated data (pages, API keys, sessions).

**URL Parameters:**
- `id`: Project ID

**Success Response (200):**
```json
{
  "message": "Project deleted successfully"
}
```

---

### POST `/projects/:id/crawl`

Trigger website crawling to index content.

**URL Parameters:**
- `id`: Project ID

**Success Response (202):**
```json
{
  "message": "Crawl started",
  "status": "pending"
}
```

**Error Responses:**
- `409` - Crawl already in progress

---

### GET `/projects/:id/crawl-status`

Get current crawl status.

**URL Parameters:**
- `id`: Project ID

**Success Response (200):**
```json
{
  "status": "completed",
  "lastCrawledAt": "2024-01-15T10:30:00.000Z",
  "crawlError": null,
  "pagesCount": 25
}
```

**Possible status values:**
- `idle` - Never crawled
- `pending` - Crawl queued
- `crawling` - Currently crawling
- `completed` - Crawl finished successfully
- `failed` - Crawl failed (check crawlError)

---

### GET `/projects/:id/pages`

List indexed pages for a project.

**URL Parameters:**
- `id`: Project ID

**Query Parameters:**
- `page` (optional): Page number, default 1
- `limit` (optional): Items per page, default 20, max 100

**Success Response (200):**
```json
{
  "pages": [
    {
      "url": "https://example.com/about",
      "title": "About Us",
      "crawledAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "url": "https://example.com/pricing",
      "title": "Pricing",
      "crawledAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "total": 25,
  "page": 1,
  "limit": 20
}
```

---

## API Key Endpoints

> All API key endpoints require JWT authentication.

### GET `/projects/:id/api-keys`

List all API keys for a project.

**URL Parameters:**
- `id`: Project ID

**Success Response (200):**
```json
{
  "apiKeys": [
    {
      "id": "507f1f77bcf86cd799439011",
      "keyPrefix": "ca_live_xxxx",
      "name": "Production Key",
      "active": true,
      "createdAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": "507f1f77bcf86cd799439012",
      "keyPrefix": "ca_live_yyyy",
      "name": "Development Key",
      "active": false,
      "createdAt": "2024-01-10T08:00:00.000Z"
    }
  ]
}
```

---

### POST `/projects/:id/api-keys`

Create a new API key for a project.

**URL Parameters:**
- `id`: Project ID

**Request Body:**
```json
{
  "name": "Production Key"
}
```

`name` is optional, defaults to "Default Key"

**Success Response (201):**
```json
{
  "message": "API key created. Store it securely - it will not be shown again.",
  "apiKey": "ca_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "keyPrefix": "ca_live_a1b2",
  "id": "507f1f77bcf86cd799439011"
}
```

> ⚠️ **Important:** The full `apiKey` is only returned once. Store it securely!

---

### DELETE `/api-keys/:id`

Revoke (deactivate) an API key.

**URL Parameters:**
- `id`: API Key ID

**Success Response (200):**
```json
{
  "message": "API key revoked successfully"
}
```

---

## Analytics Endpoints

> All analytics endpoints require JWT authentication.

### GET `/projects/:id/analytics`

Get analytics overview for a project.

**URL Parameters:**
- `id`: Project ID

**Success Response (200):**
```json
{
  "overview": {
    "totalSessions": 1500,
    "totalMessages": 8500,
    "totalTokens": 2500000,
    "sessionsLast7Days": 250,
    "sessionsLast30Days": 800,
    "pagesIndexed": 25,
    "activeApiKeys": 2
  },
  "tierBreakdown": {
    "free": 1200,
    "pro": 300
  },
  "dailyStats": [
    {
      "date": "2024-01-15",
      "sessions": 45,
      "messages": 280,
      "tokens": 85000
    },
    {
      "date": "2024-01-14",
      "sessions": 38,
      "messages": 210,
      "tokens": 72000
    }
  ],
  "crawlStatus": "completed",
  "lastCrawledAt": "2024-01-15T10:30:00.000Z"
}
```

---

### GET `/projects/:id/sessions`

List chat sessions for a project.

**URL Parameters:**
- `id`: Project ID

**Query Parameters:**
- `page` (optional): Page number, default 1
- `limit` (optional): Items per page, default 20, max 100

**Success Response (200):**
```json
{
  "sessions": [
    {
      "id": "507f1f77bcf86cd799439011",
      "tier": "free",
      "startedAt": "2024-01-15T10:30:00.000Z",
      "endedAt": "2024-01-15T10:45:00.000Z",
      "messageCount": 8,
      "totalTokens": 2500
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20,
  "totalPages": 8
}
```

---

### GET `/projects/:id/sessions/:sessionId/messages`

Get messages for a specific chat session.

**URL Parameters:**
- `id`: Project ID
- `sessionId`: Session ID

**Success Response (200):**
```json
{
  "session": {
    "id": "507f1f77bcf86cd799439011",
    "tier": "free",
    "startedAt": "2024-01-15T10:30:00.000Z",
    "endedAt": "2024-01-15T10:45:00.000Z",
    "totalTokens": 2500
  },
  "messages": [
    {
      "id": "507f1f77bcf86cd799439021",
      "role": "user",
      "content": "What is your pricing?",
      "tokenCount": 8,
      "createdAt": "2024-01-15T10:30:05.000Z"
    },
    {
      "id": "507f1f77bcf86cd799439022",
      "role": "assistant",
      "content": "Our pricing starts at $29/month for the basic plan...",
      "tokenCount": 150,
      "createdAt": "2024-01-15T10:30:08.000Z"
    }
  ]
}
```

---

## WebSocket Chat Protocol

### Connection

```
ws://localhost:3000/chat?token=API_KEY&tier=free|pro
```

**Query Parameters:**
- `token` (required): API key
- `tier` (optional): `free` or `pro`, defaults to `free`

### Client → Server Messages

**Send a message:**
```json
{
  "type": "message",
  "content": "How does your pricing work?"
}
```

**Validation:**
- `content` max length: 4096 characters

### Server → Client Messages

**Streaming chunk:**
```json
{
  "type": "chunk",
  "content": "Our pricing "
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
  "message": "Rate limit reached",
  "code": "RATE_LIMIT"
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `INVALID_API_KEY` | API key is invalid or inactive |
| `CONNECTION_LIMIT` | Max connections per API key reached |
| `PROJECT_NOT_FOUND` | Project associated with API key not found |
| `INVALID_FORMAT` | Message format is invalid |
| `MESSAGE_TOO_LONG` | Message exceeds 4096 characters |
| `RATE_LIMIT` | Rate limit exceeded |
| `NO_CREDITS` | Pro tier user has no credits |
| `INTERNAL_ERROR` | Server error |

### Tier Limits

| Feature | Free | Pro |
|---------|------|-----|
| Context chunks | 3 | 10 |
| Max tokens/response | 500 | 2000 |
| Messages/minute | 5 | 30 |

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "Human readable error message",
  "code": "ERROR_CODE",
  "details": [
    {
      "field": "email",
      "message": "Invalid email address"
    }
  ]
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing authorization header |
| `INVALID_TOKEN` | 401 | JWT token is invalid or expired |
| `INVALID_AUTH_FORMAT` | 401 | Authorization header format is wrong |
| `VALIDATION_ERROR` | 400 | Request body validation failed |
| `INVALID_JSON` | 400 | Request body is not valid JSON |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## TypeScript Types

### User Types

```typescript
interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string; // ISO date
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
  };
}
```

### Project Types

```typescript
type CrawlStatus = 'idle' | 'pending' | 'crawling' | 'completed' | 'failed';

interface Project {
  _id: string;
  userId: string;
  name: string;
  websiteUrl: string;
  crawlStatus: CrawlStatus;
  crawlError?: string;
  lastCrawledAt?: string; // ISO date
  createdAt: string;
  updatedAt: string;
  pagesCount: number;
  apiKeysCount: number;
  sessionsCount: number;
}

interface Page {
  url: string;
  title: string;
  crawledAt: string;
}
```

### API Key Types

```typescript
interface ApiKey {
  id: string;
  keyPrefix: string;
  name: string;
  active: boolean;
  createdAt: string;
}

interface CreateApiKeyResponse {
  message: string;
  apiKey: string; // Full key, only shown once!
  keyPrefix: string;
  id: string;
}
```

### Credit Types

```typescript
interface CreditBalance {
  balance: number;
  recentTransactions: CreditTransaction[];
}

interface CreditTransaction {
  amount: number;
  type: 'credit' | 'debit';
  reason: string;
  createdAt: string;
}
```

### Chat Types

```typescript
type ChatTier = 'free' | 'pro';
type MessageRole = 'user' | 'assistant' | 'system';

interface ChatSession {
  id: string;
  tier: ChatTier;
  startedAt: string;
  endedAt?: string;
  messageCount: number;
  totalTokens: number;
}

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  tokenCount: number;
  createdAt: string;
}

// WebSocket Messages
interface WSClientMessage {
  type: 'message';
  content: string;
}

interface WSChunkResponse {
  type: 'chunk';
  content: string;
}

interface WSDoneResponse {
  type: 'done';
  tokensUsed: number;
}

interface WSErrorResponse {
  type: 'error';
  message: string;
  code: string;
}
```

### Analytics Types

```typescript
interface ProjectAnalytics {
  overview: {
    totalSessions: number;
    totalMessages: number;
    totalTokens: number;
    sessionsLast7Days: number;
    sessionsLast30Days: number;
    pagesIndexed: number;
    activeApiKeys: number;
  };
  tierBreakdown: {
    free: number;
    pro: number;
  };
  dailyStats: Array<{
    date: string;
    sessions: number;
    messages: number;
    tokens: number;
  }>;
  crawlStatus: CrawlStatus;
  lastCrawledAt?: string;
}
```

---

## Rate Limits

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Auth endpoints | 10 requests | 1 minute |
| Signup | 5 requests | 1 hour |
| General API | 100 requests | 1 minute |
| Crawl trigger | 5 requests | 1 hour |
| WebSocket (Free) | 5 messages | 1 minute |
| WebSocket (Pro) | 30 messages | 1 minute |

Rate limit headers are included in responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Unix timestamp when limit resets

---

## Example: Complete Frontend Flow

### 1. User Registration

```typescript
// Sign up
const signup = await fetch('/api/v1/auth/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'SecurePass123'
  })
});

// Verify email
const verify = await fetch('/api/v1/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    code: '123456'
  })
});

const { accessToken, refreshToken } = await verify.json();
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken);
```

### 2. Create Project & Get API Key

```typescript
const token = localStorage.getItem('accessToken');

// Create project
const project = await fetch('/api/v1/projects', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    name: 'My Website',
    websiteUrl: 'https://example.com'
  })
}).then(r => r.json());

// Trigger crawl
await fetch(`/api/v1/projects/${project.project._id}/crawl`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});

// Create API key
const apiKeyResponse = await fetch(`/api/v1/projects/${project.project._id}/api-keys`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ name: 'Production Key' })
}).then(r => r.json());

console.log('Save this API key:', apiKeyResponse.apiKey);
```

### 3. WebSocket Chat (for Framer component)

```typescript
const API_KEY = 'ca_live_xxxx';
const TIER = 'free';

const ws = new WebSocket(`ws://localhost:3000/chat?token=${API_KEY}&tier=${TIER}`);

ws.onopen = () => {
  console.log('Connected to chat');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'chunk':
      // Append to current response
      appendToResponse(data.content);
      break;
    case 'done':
      // Response complete
      console.log('Tokens used:', data.tokensUsed);
      break;
    case 'error':
      // Handle error
      console.error(data.message);
      break;
  }
};

// Send message
function sendMessage(content: string) {
  ws.send(JSON.stringify({
    type: 'message',
    content
  }));
}
```

---

## Health Check

### GET `/api/v1/health`

**Success Response (200):**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0"
}
```


