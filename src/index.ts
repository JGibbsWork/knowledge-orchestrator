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
import { runConsolidationJob, getConsolidationStats } from './services/ttl.js';
import { 
  createMetricsLogger, 
  createHttpMetricsMiddleware,
  createHttpMetricsCompleteHook,
  prometheusRegistry,
  metrics
} from './services/metrics.js';

const env = loadEnv();
const logger = createLogger(env);
const metricsLogger = createMetricsLogger(logger);

const fastify = Fastify({ 
  logger: logger as any,
});

// Register HTTP metrics hooks
fastify.addHook('onRequest', createHttpMetricsMiddleware());
fastify.addHook('onSend', createHttpMetricsCompleteHook());

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

// H1: Prometheus metrics endpoint
fastify.get('/metrics', async (_request, reply) => {
  try {
    const metrics = await prometheusRegistry.metrics();
    reply.type('text/plain');
    return metrics;
  } catch (error) {
    reply.code(500);
    return { error: 'Failed to generate metrics' };
  }
});

fastify.post<{ Body: PackRequest }>('/pack', async (request, reply) => {
  const requestStart = Date.now();
  const { agent_id, task, scope, k, allow_web, allow_private } = request.body;
  
  // Create scoped logger for this request
  const requestLogger = metricsLogger.child({
    agent_id,
    task: task.substring(0, 50),
    scope,
    request_id: `pack_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  });

  requestLogger.info('Pack request started', {
    k,
    allow_web,
    allow_private
  });

  // Start metrics timer
  const packTimer = metricsLogger.startTimer(metrics.packRequestDuration, {
    agent_id,
    scope: scope?.join(',') || 'unknown'
  });

  try {
    // Validate web scope requirements
    if (scope?.includes('web') && !allow_web) {
      requestLogger.warn('Pack request rejected - web scope requires allow_web=true');
      metricsLogger.recordOutcome('validation_error', scope?.join(',') || 'unknown', agent_id);
      
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
    
    requestLogger.info('Executing pack operation');
    
    // Execute pack operation
    const result = await pack({
      agent_id,
      task,
      scope,
      k,
      allow_web,
      allow_private
    });
    
    // Record successful completion
    const totalDuration = Date.now() - requestStart;
    packTimer.end({ outcome: 'success' });
    metricsLogger.recordOutcome('success', scope?.join(',') || 'unknown', agent_id);
    
    requestLogger.info('Pack request completed successfully', {
      total_candidates: result.total_candidates,
      total_duration_ms: totalDuration,
      query_variants_count: result.query_variants?.length || 0,
      context_length: result.context?.length || 0,
      citations_count: result.citations?.length || 0
    });
    
    return result;
  } catch (error) {
    const totalDuration = Date.now() - requestStart;
    packTimer.end({ outcome: 'error' });
    metricsLogger.recordOutcome('error', scope?.join(',') || 'unknown', agent_id);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    requestLogger.error('Pack request failed', {
      error: errorMessage,
      total_duration_ms: totalDuration
    });
    
    reply.code(500);
    return {
      agent_id: request.body.agent_id || 'unknown',
      task: request.body.task || '',
      query_variants: [],
      candidates: {},
      debug: {
        query_generation_ms: 0,
        total_ms: totalDuration
      },
      total_candidates: 0,
      error: `Pack operation failed: ${errorMessage}`
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

// G2: TTL consolidation endpoints
fastify.post('/ttl/consolidate', async (request, reply) => {
  try {
    const body = request.body as any;
    const options = {
      dryRun: body?.dryRun || false,
      maxAgeHours: body?.maxAgeHours || 168,  // 7 days default
      minChunksPerDoc: body?.minChunksPerDoc || 3,
      maxDigestTokens: body?.maxDigestTokens || 2000,
      batchSize: body?.batchSize || 100
    };

    const result = await runConsolidationJob(options);
    
    return {
      success: true,
      result,
      message: result.dryRun 
        ? 'Dry run completed - no changes made'
        : 'Consolidation job completed successfully'
    };
  } catch (error) {
    reply.code(500);
    return {
      success: false,
      error: 'TTL consolidation failed',
      code: 'TTL_ERROR',
      details: { message: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
});

fastify.get('/ttl/stats', async (_request, reply) => {
  try {
    const stats = await getConsolidationStats();
    
    return {
      success: true,
      stats,
      message: 'TTL consolidation statistics retrieved successfully'
    };
  } catch (error) {
    reply.code(500);
    return {
      success: false,
      error: 'Failed to get TTL stats',
      code: 'STATS_ERROR',
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