import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './config/env';
import { connectMongoDB } from './db/mongodb';
import { connectRedis } from './db/redis';
import { api } from './api/routes';
import { securityHeaders, errorHandler, requestSizeLimit } from './api/middleware/security.middleware';
import { ApiKeyService } from './services/project.service';
import { BlobService } from './services/blob.service';
import { DocumentWorker } from './workers/document.worker';
import { ChatSession, Project } from './db/schemas';
import { checkRateLimit, incrementConnections, decrementConnections, getConnectionCount } from './db/redis';
import { getTierConfig } from './config/env';
import { handleChatMessage } from './ws/handlers/chat.handler';
import type { AuthenticatedWebSocket, ChatTier } from './types';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', securityHeaders);
app.use('*', errorHandler);
app.use('*', requestSizeLimit(1024 * 100)); // 100KB default, 55MB for document uploads

// CORS configuration
app.use(
  '*',
  cors({
    origin: env.NODE_ENV === 'production' 
      ? ['https://framer.com', 'https://*.framer.com']
      : '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
  })
);

// Mount API routes
app.route('/api/v1', api);

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'Convitsa Answer API',
    version: '1.0.0',
    documentation: '/api/v1/health',
  });
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: 'Not Found',
      code: 'NOT_FOUND',
      path: c.req.path,
    },
    404
  );
});

// Start server
async function startServer() {
  try {
    console.log('🚀 Starting Convitsa Answer Backend...');
    console.log(`📦 Environment: ${env.NODE_ENV}`);

    // Connect to databases
    await connectMongoDB();
    await connectRedis();

    // Initialize Azure Blob Storage
    try {
      await BlobService.initialize();
    } catch (error) {
      console.warn('⚠️ Azure Blob Storage not configured - file uploads disabled');
    }

    // Start document processing worker in background
    DocumentWorker.start().catch((error) => {
      console.error('Document worker error:', error);
    });

    // Start Bun server with WebSocket support
    const server = Bun.serve<{ token: string; tier: string; [key: string]: any }>({
      port: env.PORT,
      
      fetch(req, server) {
        const url = new URL(req.url);
        
        // Handle WebSocket upgrade for /chat path
        if (url.pathname === '/chat') {
          const token = url.searchParams.get('token');
          const tier = url.searchParams.get('tier') || 'free';
          
          if (!token) {
            return new Response('API key required', { status: 401 });
          }
          
          const upgraded = server.upgrade(req, {
            data: { token, tier },
          });
          
          if (upgraded) {
            return undefined;
          }
          return new Response('WebSocket upgrade failed', { status: 500 });
        }
        
        // Handle HTTP requests with Hono
        return app.fetch(req);
      },
      
      websocket: {
        async open(ws) {
          const { token, tier } = ws.data;
          
          // Validate API key
          const keyResult = await ApiKeyService.validateApiKey(token);
          if (!keyResult.success) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid API key', code: 'INVALID_API_KEY' }));
            ws.close(4002, 'Invalid API key');
            return;
          }
          
          const { apiKeyId, projectId, userId } = keyResult.data!;
          
          // Check connection limit
          const connectionCount = await getConnectionCount(apiKeyId.toString());
          if (connectionCount >= env.MAX_WS_CONNECTIONS_PER_KEY) {
            ws.send(JSON.stringify({ type: 'error', message: 'Connection limit reached', code: 'CONNECTION_LIMIT' }));
            ws.close(4003, 'Connection limit reached');
            return;
          }
          
          await incrementConnections(apiKeyId.toString());
          
          // Get project
          const project = await Project.findById(projectId).lean();
          if (!project) {
            ws.send(JSON.stringify({ type: 'error', message: 'Project not found', code: 'PROJECT_NOT_FOUND' }));
            ws.close(4004, 'Project not found');
            await decrementConnections(apiKeyId.toString());
            return;
          }
          
          // Create session
          const session = await ChatSession.create({
            projectId,
            apiKeyId,
            tier: tier as ChatTier,
            startedAt: new Date(),
            totalTokens: 0,
            messageCount: 0,
          });
          
          // Store connection data
          ws.data.apiKeyId = apiKeyId.toString();
          ws.data.projectId = projectId.toString();
          ws.data.userId = userId.toString();
          ws.data.sessionId = session._id.toString();
          ws.data.websiteUrl = project.websiteUrl;
          
          console.log(`🔗 WS connected: project=${projectId}, tier=${tier}`);
        },
        
        async message(ws, message) {
          try {
            // Validate connection is properly initialized
            if (!ws.data.sessionId || !ws.data.projectId || !ws.data.apiKeyId) {
              console.error('WS message received before connection fully initialized');
              ws.send(JSON.stringify({ 
                type: 'error', 
                message: 'Connection not ready. Please wait and try again.', 
                code: 'CONNECTION_NOT_READY' 
              }));
              return;
            }
            
            const msgData = JSON.parse(message.toString());
            
            if (msgData.type !== 'message' || typeof msgData.content !== 'string') {
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format', code: 'INVALID_FORMAT' }));
              return;
            }
            
            if (msgData.content.length > 4096) {
              ws.send(JSON.stringify({ type: 'error', message: 'Message too long', code: 'MESSAGE_TOO_LONG' }));
              return;
            }
            
            const tier = (ws.data.tier || 'free') as ChatTier;
            const config = getTierConfig(tier);
            
            // Check rate limit
            const rateLimitResult = await checkRateLimit(
              `chat:${ws.data.apiKeyId}`,
              config.messagesPerMin,
              60
            );
            
            if (!rateLimitResult.allowed) {
              ws.send(JSON.stringify({
                type: 'error',
                message: tier === 'free' 
                  ? 'Free tier rate limit reached. Please wait.'
                  : 'Rate limit reached. Please slow down.',
                code: 'RATE_LIMIT'
              }));
              return;
            }
            
            // Create a wrapper that matches AuthenticatedWebSocket interface
            const authWs = {
              send: (msg: string) => ws.send(msg),
              readyState: 1,
              apiKeyId: ws.data.apiKeyId,
              projectId: ws.data.projectId,
              tier: ws.data.tier,
              sessionId: ws.data.sessionId,
              isAlive: true,
            } as unknown as AuthenticatedWebSocket;
            
            await handleChatMessage(
              authWs,
              msgData.content,
              ws.data.websiteUrl || '',
              ws.data.userId || ''
            );
          } catch (error) {
            console.error('WS message error:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Internal error', code: 'INTERNAL_ERROR' }));
          }
        },
        
        async close(ws) {
          if (ws.data.apiKeyId) {
            await decrementConnections(ws.data.apiKeyId);
          }
          if (ws.data.sessionId) {
            await ChatSession.updateOne(
              { _id: ws.data.sessionId },
              { $set: { endedAt: new Date() } }
            );
          }
          console.log(`🔌 WS disconnected: session=${ws.data.sessionId}`);
        },
      },
    });

    console.log(`✅ Server running on http://localhost:${env.PORT}`);
    console.log(`📡 WebSocket available at ws://localhost:${env.PORT}/chat`);
    console.log(`🌐 REST API available at http://localhost:${env.PORT}/api/v1`);

    // Graceful shutdown
    const shutdown = () => {
      console.log('\n🛑 Shutting down gracefully...');
      DocumentWorker.stop();
      server.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Note: Don't export default app - it causes Bun to auto-serve and conflict with Bun.serve()
