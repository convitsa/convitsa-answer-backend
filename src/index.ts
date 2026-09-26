import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './config/env';
import { connectMongoDB } from './db/mongodb';
import { connectRedis } from './db/redis';
import { api } from './api/routes';
import { securityHeaders, errorHandler, requestSizeLimit } from './api/middleware/security.middleware';
import { ApiKeyService } from './services/project.service';
import { StorageService } from './services/storage.service';
import { DocumentWorker } from './workers/document.worker';
import { ChatSession, Project, ChatMessage, Lead } from './db/schemas';
import { SubscriptionService } from './services/subscription.service';
import { LostLeadService } from './services/lost-lead.service';
import { RAGService } from './services/rag.service';
import type { IChatMessage } from './types';
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
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

    // Initialize local file storage
    try {
      await StorageService.initialize();
    } catch (error) {
      console.warn('⚠️ Local file storage not available - file uploads disabled');
    }

    // Start document processing worker in background
    DocumentWorker.start().catch((error) => {
      console.error('Document worker error:', error);
    });

    // Message queue for messages received before connection is ready
    const pendingMessages = new Map<string, string[]>();
    
    // Process a chat message (used both for direct messages and queued messages)
    async function processMessage(ws: any, messageStr: string) {
      try {
        const msgData = JSON.parse(messageStr);
        
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
          visitorId: ws.data.visitorId,
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
    }
    
    // Start Bun server with WebSocket support
    const server = Bun.serve<{ token: string; visitorId: string; [key: string]: any }>({
      port: env.PORT,
      
      fetch(req, server) {
        const url = new URL(req.url);
        
        // Handle WebSocket upgrade for /chat path
        if (url.pathname === '/chat') {
          const token = url.searchParams.get('token');
          const visitorId = url.searchParams.get('visitorId') || crypto.randomUUID();
          const pageUrl = url.searchParams.get('pageUrl') || '';
          const referrer = url.searchParams.get('referrer') || '';
          const userAgent = req.headers.get('user-agent') || '';
          
          if (!token) {
            return new Response('API key required', { status: 401 });
          }
          
          const upgraded = server.upgrade(req, {
            data: { token, visitorId, pageUrl, referrer, userAgent },
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
          const { token, visitorId, pageUrl, referrer, userAgent } = ws.data;
          
          // Generate unique connection ID for message queueing
          const connectionId = crypto.randomUUID();
          ws.data.connectionId = connectionId;
          ws.data.isReady = false;
          
          // Validate API key
          const keyResult = await ApiKeyService.validateApiKey(token);
          if (!keyResult.success) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid API key', code: 'INVALID_API_KEY' }));
            ws.close(4002, 'Invalid API key');
            pendingMessages.delete(connectionId);
            return;
          }
          
          const { apiKeyId, projectId, userId } = keyResult.data!;
          const apiKeyIdStr = apiKeyId.toString();
          
          // Get subscription - must exist (don't default to free!)
          let subscription;
          try {
            subscription = await SubscriptionService.getSubscription(userId.toString());
            if (!subscription) {
              console.log(`⚠️ No subscription found for user ${userId}`);
              ws.send(JSON.stringify({ type: 'error', message: 'No active subscription found', code: 'NO_SUBSCRIPTION' }));
              ws.close(4005, 'No subscription');
              pendingMessages.delete(connectionId);
              return;
            }
          } catch (error) {
            console.error(`❌ Subscription lookup failed for userId=${userId}:`, error);
            ws.send(JSON.stringify({ type: 'error', message: 'Subscription lookup failed', code: 'SUBSCRIPTION_ERROR' }));
            ws.close(4005, 'Subscription error');
            pendingMessages.delete(connectionId);
            return;
          }
          
          const tier: ChatTier = subscription.tier as ChatTier;
          console.log(`🎫 User ${userId} subscription: tier=${tier}, status=${subscription.status}, stripeSubId=${subscription.stripeSubscriptionId || 'none'}`);
          
          // Run parallel operations for better performance
          const [connectionCount, project] = await Promise.all([
            getConnectionCount(apiKeyIdStr),
            Project.findById(projectId).lean(),
          ]);
          
          // Check connection limit
          if (connectionCount >= env.MAX_WS_CONNECTIONS_PER_KEY) {
            ws.send(JSON.stringify({ type: 'error', message: 'Connection limit reached', code: 'CONNECTION_LIMIT' }));
            ws.close(4003, 'Connection limit reached');
            pendingMessages.delete(connectionId);
            return;
          }
          
          // Validate project exists
          if (!project) {
            ws.send(JSON.stringify({ type: 'error', message: 'Project not found', code: 'PROJECT_NOT_FOUND' }));
            ws.close(4004, 'Project not found');
            pendingMessages.delete(connectionId);
            return;
          }
          
          // Increment connection count and create session in parallel
          const [, session] = await Promise.all([
            incrementConnections(apiKeyIdStr),
            ChatSession.create({
              projectId,
              apiKeyId,
              tier,
              visitorId,
              startedAt: new Date(),
              totalTokens: 0,
              messageCount: 0,
              leadCaptured: false,
              metadata: {
                userAgent,
                referrer,
                pageUrl,
              },
            }),
          ]);
          
          // Store connection data
          ws.data.apiKeyId = apiKeyIdStr;
          ws.data.projectId = projectId.toString();
          ws.data.userId = userId.toString();
          ws.data.sessionId = session._id.toString();
          ws.data.websiteUrl = project.websiteUrl;
          ws.data.tier = tier;
          ws.data.isReady = true; // Mark connection as ready
          
          console.log(`🔗 WS connected: project=${projectId}, tier=${tier}, user=${userId}, visitor=${visitorId}`);
          
          // Send ready message to client
          ws.send(JSON.stringify({
            type: 'ready',
            sessionId: session._id.toString(),
            tier,
            visitorId,
          }));
          
          // Process any queued messages that arrived before connection was ready
          const queued = pendingMessages.get(connectionId);
          if (queued && queued.length > 0) {
            console.log(`📬 Processing ${queued.length} queued messages for connection ${connectionId}`);
            for (const queuedMsg of queued) {
              // Re-emit as if the message just arrived
              try {
                await processMessage(ws, queuedMsg);
              } catch (err) {
                console.error('Error processing queued message:', err);
              }
            }
            pendingMessages.delete(connectionId);
          }
        },
        
        async message(ws, message) {
          const messageStr = message.toString();
          
          // If connection is not ready, queue the message silently
          if (!ws.data.isReady) {
            const connectionId = ws.data.connectionId;
            if (connectionId) {
              const queue = pendingMessages.get(connectionId) || [];
              queue.push(messageStr);
              pendingMessages.set(connectionId, queue);
              console.log(`📥 Message queued for connection ${connectionId} (connection not ready)`);
            }
            return;
          }
          
          // Connection is ready, process the message
          await processMessage(ws, messageStr);
        },
        
        async close(ws) {
          const { apiKeyId, sessionId, tier, visitorId, connectionId } = ws.data;
          
          // Clean up any pending messages
          if (connectionId) {
            pendingMessages.delete(connectionId);
          }
          
          if (apiKeyId) {
            await decrementConnections(apiKeyId);
          }
          if (sessionId) {
            await ChatSession.updateOne(
              { _id: sessionId },
              { $set: { endedAt: new Date() } }
            );
          }
          console.log(`🔌 WS disconnected: session=${sessionId}`);
          
          // Process lost lead if no lead was captured (Pro/Business tiers only)
          console.log(`🔍 Lost lead check: tier=${tier}, visitorId=${visitorId ? 'yes' : 'no'}`);
          
          if (tier === 'free') {
            console.log(`⏭️ Skipping lost lead: Free tier (upgrade to Pro/Business)`);
            return;
          }
          
          if (!visitorId) {
            console.log(`⏭️ Skipping lost lead: No visitorId`);
            return;
          }
          
          if (!sessionId) {
            console.log(`⏭️ Skipping lost lead: No sessionId`);
            return;
          }
          
          try {
            // Check if a lead was captured for this session
            const leadExists = await Lead.findOne({ sessionId });
            
            if (leadExists) {
              // Mark session as having captured a lead
              await ChatSession.updateOne(
                { _id: sessionId },
                { $set: { leadCaptured: true } }
              );
              console.log(`✅ Lead captured for session=${sessionId}, skipping lost lead`);
              return;
            }
            
            // Get messages for intent scoring
            const messages = await ChatMessage.find({ sessionId })
              .sort({ createdAt: 1 })
              .lean() as IChatMessage[];
            
            // Only process if there were actual messages (at least 1 user + 1 assistant)
            if (messages.length < 2) {
              console.log(`⏭️ Skipping lost lead: Only ${messages.length} messages (need at least 2)`);
              return;
            }
            
            console.log(`🔍 Processing lost lead: visitor=${visitorId}, messages=${messages.length}`);
            
            // Score intent using AI
            const intentResult = await RAGService.scoreSessionIntent(messages);
            
            console.log(`📊 Intent score: ${intentResult.score} (${intentResult.signals.join(', ')})`);
            
            // Update lost lead record
            await LostLeadService.updateFromSession(sessionId, intentResult);
            
            console.log(`✅ Lost lead recorded for visitor=${visitorId}`);
          } catch (error) {
            console.error('❌ Lost lead processing error:', error);
          }
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
