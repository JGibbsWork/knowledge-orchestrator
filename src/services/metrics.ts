import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import pino from 'pino';

// Enable default Node.js metrics collection
collectDefaultMetrics({ register });

// Custom Prometheus metrics for KO service
export const metrics = {
  // Request metrics
  httpRequestDuration: new Histogram({
    name: 'ko_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10]
  }),

  httpRequestsTotal: new Counter({
    name: 'ko_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code']
  }),

  // Pack endpoint specific metrics
  packRequestDuration: new Histogram({
    name: 'ko_pack_request_duration_seconds',
    help: 'Duration of pack requests in seconds',
    labelNames: ['agent_id', 'scope', 'outcome'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
  }),

  packStageTimings: new Histogram({
    name: 'ko_pack_stage_duration_seconds',
    help: 'Duration of individual pack stages in seconds',
    labelNames: ['stage', 'scope'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
  }),

  packOutcomes: new Counter({
    name: 'ko_pack_outcomes_total',
    help: 'Total pack request outcomes',
    labelNames: ['outcome', 'scope', 'agent_id']
  }),

  // Cache metrics
  cacheHits: new Counter({
    name: 'ko_cache_hits_total',
    help: 'Total cache hits',
    labelNames: ['cache_type', 'scope']
  }),

  cacheMisses: new Counter({
    name: 'ko_cache_misses_total',
    help: 'Total cache misses',
    labelNames: ['cache_type', 'scope']
  }),

  cacheHitRatio: new Gauge({
    name: 'ko_cache_hit_ratio',
    help: 'Cache hit ratio (hits / total)',
    labelNames: ['cache_type', 'scope']
  }),

  // Embedding metrics
  embeddingCalls: new Counter({
    name: 'ko_embedding_calls_total',
    help: 'Total embedding API calls',
    labelNames: ['provider', 'model', 'outcome']
  }),

  embeddingTokens: new Counter({
    name: 'ko_embedding_tokens_total',
    help: 'Total tokens processed for embeddings',
    labelNames: ['provider', 'model']
  }),

  embeddingDuration: new Histogram({
    name: 'ko_embedding_duration_seconds',
    help: 'Duration of embedding generation in seconds',
    labelNames: ['provider', 'model'],
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10]
  }),

  // Vector search metrics
  vectorSearchDuration: new Histogram({
    name: 'ko_vector_search_duration_seconds',
    help: 'Duration of vector search operations in seconds',
    labelNames: ['source', 'scope'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2]
  }),

  vectorSearchResults: new Histogram({
    name: 'ko_vector_search_results_count',
    help: 'Number of results returned by vector search',
    labelNames: ['source', 'scope'],
    buckets: [1, 5, 10, 20, 50, 100]
  }),

  // TTL consolidation metrics
  ttlConsolidationDuration: new Histogram({
    name: 'ko_ttl_consolidation_duration_seconds',
    help: 'Duration of TTL consolidation jobs in seconds',
    labelNames: ['dry_run'],
    buckets: [1, 5, 10, 30, 60, 300, 600]
  }),

  ttlChunksConsolidated: new Counter({
    name: 'ko_ttl_chunks_consolidated_total',
    help: 'Total chunks consolidated by TTL jobs',
    labelNames: ['dry_run']
  }),

  ttlTokensReclaimed: new Counter({
    name: 'ko_ttl_tokens_reclaimed_total',
    help: 'Total tokens reclaimed by TTL consolidation',
    labelNames: ['dry_run']
  }),

  // Database metrics
  dbOperationDuration: new Histogram({
    name: 'ko_db_operation_duration_seconds',
    help: 'Duration of database operations in seconds',
    labelNames: ['operation', 'collection'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
  }),

  dbOperationsTotal: new Counter({
    name: 'ko_db_operations_total',
    help: 'Total database operations',
    labelNames: ['operation', 'collection', 'outcome']
  }),

  // Active connections
  activeConnections: new Gauge({
    name: 'ko_active_connections',
    help: 'Number of active connections',
    labelNames: ['type']
  })
};

// Metrics registry for Prometheus
export const prometheusRegistry = register;

// Performance tracking utilities
export interface StageTimer {
  end: (labels?: Record<string, string>) => number;
}

export interface MetricsLogger {
  info: (msg: string, data?: any) => void;
  warn: (msg: string, data?: any) => void;
  error: (msg: string, data?: any) => void;
  debug: (msg: string, data?: any) => void;
  child: (bindings: Record<string, any>) => MetricsLogger;
  startTimer: (metric: Histogram<string>, labels?: Record<string, string>) => StageTimer;
  recordStage: (stage: string, scope: string, durationMs: number) => void;
  recordOutcome: (outcome: string, scope: string, agentId?: string) => void;
  recordCacheHit: (cacheType: string, scope: string) => void;
  recordCacheMiss: (cacheType: string, scope: string) => void;
  recordEmbeddingCall: (provider: string, model: string, outcome: string, tokens?: number, durationMs?: number) => void;
  recordVectorSearch: (source: string, scope: string, durationMs: number, resultCount: number) => void;
  recordDbOperation: (operation: string, collection: string, outcome: string, durationMs: number) => void;
}

class MetricsLoggerImpl implements MetricsLogger {
  constructor(private logger: pino.Logger) {}

  info(msg: string, data?: any) {
    this.logger.info(data, msg);
  }

  warn(msg: string, data?: any) {
    this.logger.warn(data, msg);
  }

  error(msg: string, data?: any) {
    this.logger.error(data, msg);
  }

  debug(msg: string, data?: any) {
    this.logger.debug(data, msg);
  }

  child(bindings: Record<string, any>): MetricsLogger {
    return new MetricsLoggerImpl(this.logger.child(bindings));
  }

  startTimer(metric: Histogram<string>, labels?: Record<string, string>): StageTimer {
    const end = metric.startTimer(labels || {});
    return {
      end: (additionalLabels?: Record<string, string>) => {
        const duration = end(additionalLabels || {});
        return duration;
      }
    };
  }

  recordStage(stage: string, scope: string, durationMs: number) {
    const durationSeconds = durationMs / 1000;
    metrics.packStageTimings.observe({ stage, scope }, durationSeconds);
    this.debug('Stage completed', {
      stage,
      scope,
      durationMs,
      durationSeconds
    });
  }

  recordOutcome(outcome: string, scope: string, agentId?: string) {
    metrics.packOutcomes.inc({ outcome, scope, agent_id: agentId || 'unknown' });
    this.info('Pack outcome recorded', {
      outcome,
      scope,
      agentId
    });
  }

  recordCacheHit(cacheType: string, scope: string) {
    metrics.cacheHits.inc({ cache_type: cacheType, scope });
    this.updateCacheHitRatio(cacheType, scope);
    this.debug('Cache hit recorded', { cacheType, scope });
  }

  recordCacheMiss(cacheType: string, scope: string) {
    metrics.cacheMisses.inc({ cache_type: cacheType, scope });
    this.updateCacheHitRatio(cacheType, scope);
    this.debug('Cache miss recorded', { cacheType, scope });
  }

  private async updateCacheHitRatio(cacheType: string, scope: string) {
    try {
      const labels = { cache_type: cacheType, scope };
      const hitsMetric = await metrics.cacheHits.get();
      const missesMetric = await metrics.cacheMisses.get();
      
      const hits = hitsMetric.values?.find((v: any) => 
        v.labels.cache_type === cacheType && v.labels.scope === scope
      )?.value || 0;
      const misses = missesMetric.values?.find((v: any) => 
        v.labels.cache_type === cacheType && v.labels.scope === scope
      )?.value || 0;
      const total = hits + misses;
      const ratio = total > 0 ? hits / total : 0;
      metrics.cacheHitRatio.set(labels, ratio);
    } catch (error) {
      this.debug('Failed to update cache hit ratio', { error: error instanceof Error ? error.message : 'unknown' });
    }
  }

  recordEmbeddingCall(provider: string, model: string, outcome: string, tokens?: number, durationMs?: number) {
    metrics.embeddingCalls.inc({ provider, model, outcome });
    
    if (tokens) {
      metrics.embeddingTokens.inc({ provider, model }, tokens);
    }
    
    if (durationMs) {
      metrics.embeddingDuration.observe({ provider, model }, durationMs / 1000);
    }

    this.info('Embedding call recorded', {
      provider,
      model,
      outcome,
      tokens,
      durationMs
    });
  }

  recordVectorSearch(source: string, scope: string, durationMs: number, resultCount: number) {
    metrics.vectorSearchDuration.observe({ source, scope }, durationMs / 1000);
    metrics.vectorSearchResults.observe({ source, scope }, resultCount);
    
    this.debug('Vector search recorded', {
      source,
      scope,
      durationMs,
      resultCount
    });
  }

  recordDbOperation(operation: string, collection: string, outcome: string, durationMs: number) {
    metrics.dbOperationDuration.observe({ operation, collection }, durationMs / 1000);
    metrics.dbOperationsTotal.inc({ operation, collection, outcome });
    
    this.debug('Database operation recorded', {
      operation,
      collection,
      outcome,
      durationMs
    });
  }
}

// Factory function to create enhanced logger with metrics
export function createMetricsLogger(logger: pino.Logger): MetricsLogger {
  return new MetricsLoggerImpl(logger);
}

// Middleware for tracking HTTP requests
export function createHttpMetricsMiddleware() {
  return async function(request: any, _reply: any) {
    const timer = metrics.httpRequestDuration.startTimer({
      method: request.method,
      route: request.routeOptions?.url || request.url
    });

    // Store timer on request to access it later
    request.metricsTimer = timer;
    request.metricsStartTime = Date.now();
  };
}

// Hook for completing HTTP metrics
export function createHttpMetricsCompleteHook() {
  return async function(request: any, reply: any) {
    if (request.metricsTimer) {
      request.metricsTimer();
      
      const labels = {
        method: request.method,
        route: request.routeOptions?.url || request.url,
        status_code: reply.statusCode.toString()
      };

      metrics.httpRequestsTotal.inc(labels);
      
      // Update active connections (approximate)
      metrics.activeConnections.set({ type: 'http' }, 1);
    }
  };
}

// Utility to get metrics summary for logging
export async function getMetricsSummary() {
  const summary: any = {};
  
  try {
    const metricsData = await prometheusRegistry.metrics();
    const lines = metricsData.split('\n').filter((line: string) => 
      line.startsWith('ko_') && !line.startsWith('#')
    );
    
    summary.totalMetrics = lines.length;
    summary.timestamp = new Date().toISOString();
    
    return summary;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString()
    };
  }
}