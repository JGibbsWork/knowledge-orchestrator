import Fastify from 'fastify';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { openApiDocument } from './openapi.js';
import {
  type PackRequest,
  type WebSearchRequest,
  type IngestUpstreamRequest
} from './schemas.js';
import { searchBrave } from './services/web.js';

const env = loadEnv();
const logger = createLogger(env);

const fastify = Fastify({ 
  logger: logger as any,
});

fastify.register(import('@fastify/swagger'), {
  openapi: openApiDocument as any,
});

fastify.register(import('@fastify/swagger-ui'), {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'full',
    deepLinking: false
  },
  uiHooks: {
    onRequest: function (_request, _reply, next) { next() },
    preHandler: function (_request, _reply, next) { next() }
  },
  staticCSP: true,
  transformStaticCSP: (header) => header,
  transformSpecification: (swaggerObject, _request, _reply) => { return swaggerObject },
  transformSpecificationClone: true
});

fastify.get('/health', async () => {
  return { status: 'ok' };
});

fastify.post<{ Body: PackRequest }>('/pack', async (request, reply) => {
  try {
    const { content, metadata } = request.body;
    
    const packedContent = Buffer.from(JSON.stringify({ content, metadata })).toString('base64');
    
    return {
      id: `pack_${Date.now()}`,
      status: 'success' as const,
      packed_content: packedContent,
      size: packedContent.length
    };
  } catch (error) {
    reply.code(500);
    return {
      error: 'Failed to pack content',
      code: 'PACK_ERROR',
      details: { message: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
});

fastify.post<{ Body: WebSearchRequest }>('/search/web', async (request, reply) => {
  try {
    const { query, max_results = 10 } = request.body;
    
    // Use Brave search with caching
    const braveResults = await searchBrave(query, max_results);
    
    return {
      query,
      total_results: braveResults.length,
      results: braveResults.map(result => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        domain: new URL(result.url).hostname,
        published_date: new Date().toISOString() // Brave doesn't provide publish date
      }))
    };
  } catch (error) {
    reply.code(500);
    return {
      error: 'Failed to perform web search',
      code: 'SEARCH_ERROR',
      details: { message: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
});

fastify.post<{ Body: IngestUpstreamRequest }>('/ingest/upstream', async (request, reply) => {
  try {
    const { source_url } = request.body;
    
    return {
      job_id: `ingest_${Date.now()}`,
      status: 'in_progress' as const,
      source_url,
      records_processed: 0,
      created_at: new Date().toISOString()
    };
  } catch (error) {
    reply.code(500);
    return {
      error: 'Failed to start ingestion',
      code: 'INGEST_ERROR',
      details: { message: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
});

const start = async () => {
  try {
    await fastify.listen({ 
      port: env.PORT, 
      host: env.HOST 
    });
    logger.info(`Server listening on ${env.HOST}:${env.PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  await fastify.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  await fastify.close();
  process.exit(0);
});

start();