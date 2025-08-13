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
import { ingestDocument } from './services/ingestion.js';
import { pack } from './services/pack.js';

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
    const { agent_id, task, scope, k, allow_web, allow_private } = request.body;
    
    // Validate web scope requirements
    if (scope?.includes('web') && !allow_web) {
      reply.code(400);
      return {
        agent_id,
        task,
        query_variants: [],
        candidates: {},
        debug: {
          query_generation_ms: 0,
          total_ms: 0
        },
        total_candidates: 0,
        error: 'Web scope requires allow_web=true'
      };
    }
    
    // Execute pack operation
    const result = await pack({
      agent_id,
      task,
      scope,
      k,
      allow_web,
      allow_private
    });
    
    return result;
  } catch (error) {
    reply.code(500);
    return {
      agent_id: request.body.agent_id || 'unknown',
      task: request.body.task || '',
      query_variants: [],
      candidates: {},
      debug: {
        query_generation_ms: 0,
        total_ms: 0
      },
      total_candidates: 0,
      error: `Pack operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
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
    const { source, id, scope } = request.body;
    
    // Ingest document from upstream source
    const result = await ingestDocument({ source, id, scope });
    
    // Set appropriate status code based on result
    if (result.status === 'error') {
      reply.code(500);
    } else if (result.status === 'no_change') {
      reply.code(200); // Not an error, but no work done
    } else {
      reply.code(200); // Success
    }
    
    return result;
  } catch (error) {
    reply.code(500);
    return {
      source: request.body.source,
      id: request.body.id,
      status: 'error' as const,
      chunks_created: 0,
      chunks_updated: 0,
      total_tokens: 0,
      updated_at: new Date().toISOString(),
      error: `Ingestion failed: ${error instanceof Error ? error.message : 'Unknown error'}`
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