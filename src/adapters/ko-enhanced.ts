import { loadEnv } from '../env.js';
import type { PackRequest, PackResponse, ErrorResponse } from '../schemas.js';

export interface KOClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
  circuitBreaker?: CircuitBreakerOptions;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;        // Number of failures before opening circuit (default: 3)
  resetTimeout?: number;           // Time to wait before trying again (default: 30000ms)
  monitoringPeriod?: number;       // Time window for failure tracking (default: 60000ms)
  expectedLatency?: number;        // Expected max latency before considering slow (default: 5000ms)
  maxRetries?: number;            // Max retry attempts (default: 3)
  retryDelayBase?: number;        // Base delay for exponential backoff (default: 1000ms)
}

export interface GetContextPackOptions {
  scope?: ('personal' | 'domain' | 'web')[];
  k?: number;
  allow_web?: boolean;
  allow_private?: boolean;
  agent_id?: string;
  
  // F2: Request budgets
  latency_ms_max?: number;        // Maximum allowed latency in milliseconds
  token_budget_max?: number;      // Maximum token budget for response
}

export interface ContextPackResult {
  context?: string;
  citations?: Array<{
    id: string;
    source: {
      id: string;
      source: 'memory' | 'notion' | 'web';
      url?: string;
      source_id?: string;
      title: string;
    };
    snippet: string;
    used_in_context: boolean;
  }>;
  query_variants: string[];
  total_candidates: number;
  debug: {
    query_generation_ms: number;
    personal_retrieval_ms?: number;
    domain_retrieval_ms?: number;
    web_retrieval_ms?: number;
    ranking_ms?: number;
    compression_ms?: number;
    total_ms: number;
    ingested_documents?: string[];
    compression_stats?: {
      input_chunks: number;
      input_tokens: number;
      output_tokens: number;
      compression_ratio: number;
      citations_used: number;
    };
    // F2: Circuit breaker debug info
    circuit_breaker?: {
      state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      failure_count: number;
      last_failure_time?: number;
      retry_attempt?: number;
      degraded: boolean;
    };
  };
}

export class KOClientError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public details?: any,
    public degraded?: boolean  // F2: Indicates if this is a degraded response
  ) {
    super(message);
    this.name = 'KOClientError';
  }
}

enum CircuitState {
  CLOSED = 'CLOSED',      // Normal operation
  OPEN = 'OPEN',          // Circuit breaker is open, rejecting calls
  HALF_OPEN = 'HALF_OPEN' // Testing if service has recovered
}

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime?: number;
  nextRetryTime?: number;
  consecutiveSuccesses?: number;
}

class KOClientEnhanced {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;
  private env = loadEnv();
  
  // F2: Circuit breaker state
  private circuitState: CircuitBreakerState = {
    state: CircuitState.CLOSED,
    failureCount: 0
  };
  
  private cbOptions: Required<CircuitBreakerOptions>;

  constructor(options: KOClientOptions = {}) {
    this.baseUrl = options.baseUrl || this.env.KO_BASE_URL || 'http://localhost:3000';
    this.apiKey = options.apiKey || this.env.KO_API_KEY;
    this.timeout = options.timeout || 30000;
    
    // F2: Initialize circuit breaker options
    this.cbOptions = {
      failureThreshold: 3,
      resetTimeout: 30000,        // 30 seconds
      monitoringPeriod: 60000,    // 1 minute
      expectedLatency: 5000,      // 5 seconds
      maxRetries: 3,
      retryDelayBase: 1000,       // 1 second base delay
      ...options.circuitBreaker
    };

    console.log(`KO Client initialized with circuit breaker: threshold=${this.cbOptions.failureThreshold}, resetTimeout=${this.cbOptions.resetTimeout}ms`);
  }

  /**
   * F2: Check if circuit breaker should allow the request
   */
  private canExecute(): boolean {
    const now = Date.now();
    
    switch (this.circuitState.state) {
      case CircuitState.CLOSED:
        return true;
        
      case CircuitState.OPEN:
        // Check if we should transition to HALF_OPEN
        if (this.circuitState.nextRetryTime && now >= this.circuitState.nextRetryTime) {
          console.log('Circuit breaker transitioning to HALF_OPEN state');
          this.circuitState.state = CircuitState.HALF_OPEN;
          this.circuitState.consecutiveSuccesses = 0;
          return true;
        }
        return false;
        
      case CircuitState.HALF_OPEN:
        return true;
        
      default:
        return false;
    }
  }

  /**
   * F2: Record successful execution
   */
  private recordSuccess(): void {
    if (this.circuitState.state === CircuitState.HALF_OPEN) {
      this.circuitState.consecutiveSuccesses = (this.circuitState.consecutiveSuccesses || 0) + 1;
      
      // Close circuit after successful calls
      if (this.circuitState.consecutiveSuccesses >= 2) {
        console.log('Circuit breaker closing after successful recovery');
        this.circuitState.state = CircuitState.CLOSED;
        this.circuitState.failureCount = 0;
        this.circuitState.consecutiveSuccesses = 0;
      }
    } else if (this.circuitState.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.circuitState.failureCount = 0;
    }
  }

  /**
   * F2: Record failed execution
   */
  private recordFailure(): void {
    const now = Date.now();
    this.circuitState.failureCount++;
    this.circuitState.lastFailureTime = now;

    if (this.circuitState.state === CircuitState.HALF_OPEN) {
      // Failed during recovery, go back to OPEN
      console.log('Circuit breaker failed during recovery, returning to OPEN state');
      this.circuitState.state = CircuitState.OPEN;
      this.circuitState.nextRetryTime = now + this.cbOptions.resetTimeout;
    } else if (this.circuitState.failureCount >= this.cbOptions.failureThreshold) {
      // Open the circuit
      console.log(`Circuit breaker OPENING after ${this.circuitState.failureCount} failures`);
      this.circuitState.state = CircuitState.OPEN;
      this.circuitState.nextRetryTime = now + this.cbOptions.resetTimeout;
    }
  }

  /**
   * F2: Calculate exponential backoff delay
   */
  private calculateBackoffDelay(retryAttempt: number): number {
    const delay = this.cbOptions.retryDelayBase * Math.pow(2, retryAttempt);
    const jitter = Math.random() * 0.1 * delay; // Add 10% jitter
    return Math.min(delay + jitter, 10000); // Cap at 10 seconds
  }

  /**
   * F2: Sleep utility for backoff
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Enhanced HTTP request with circuit breaker and retries
   */
  private async makeRequestWithCircuitBreaker<T>(
    endpoint: string,
    options: RequestInit = {},
    budgets: { latency_ms_max?: number; token_budget_max?: number } = {},
    retryAttempt: number = 0
  ): Promise<T> {
    // Check circuit breaker state
    if (!this.canExecute()) {
      throw new KOClientError(
        'Circuit breaker is OPEN - KO service is temporarily unavailable',
        503,
        'CIRCUIT_OPEN',
        {
          state: this.circuitState.state,
          failureCount: this.circuitState.failureCount,
          nextRetryTime: this.circuitState.nextRetryTime
        },
        true // degraded = true
      );
    }

    const url = `${this.baseUrl}${endpoint}`;
    const requestStart = Date.now();
    
    // Apply latency budget as timeout
    const effectiveTimeout = budgets.latency_ms_max 
      ? Math.min(budgets.latency_ms_max, this.timeout)
      : this.timeout;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'MoneyBag-KO-Client/2.0-CircuitBreaker',
      ...options.headers as Record<string, string>,
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // Add budget headers for KO service
    if (budgets.latency_ms_max) {
      headers['X-Latency-Budget-Ms'] = budgets.latency_ms_max.toString();
    }
    if (budgets.token_budget_max) {
      headers['X-Token-Budget-Max'] = budgets.token_budget_max.toString();
    }

    try {
      console.log(`KO request [attempt ${retryAttempt + 1}]: ${options.method || 'GET'} ${url} (timeout: ${effectiveTimeout}ms)`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const requestDuration = Date.now() - requestStart;

      // Check if request was slower than expected
      if (requestDuration > this.cbOptions.expectedLatency) {
        console.warn(`KO request slow: ${requestDuration}ms (expected: ${this.cbOptions.expectedLatency}ms)`);
      }

      if (!response.ok) {
        let errorMessage = `KO request failed: ${response.status} ${response.statusText}`;
        let errorCode = 'REQUEST_FAILED';
        let errorDetails: any;

        try {
          const errorData = await response.json() as ErrorResponse;
          errorMessage = errorData.error || errorMessage;
          errorCode = errorData.code || errorCode;
          errorDetails = errorData.details;
        } catch (parseError) {
          errorMessage = `${errorMessage} - ${await response.text()}`;
        }

        // Record failure for circuit breaker
        this.recordFailure();

        // Retry on server errors (5xx) but not client errors (4xx)
        if (response.status >= 500 && retryAttempt < this.cbOptions.maxRetries) {
          const delay = this.calculateBackoffDelay(retryAttempt);
          console.log(`Retrying KO request in ${delay}ms (attempt ${retryAttempt + 1}/${this.cbOptions.maxRetries})`);
          await this.sleep(delay);
          return this.makeRequestWithCircuitBreaker(endpoint, options, budgets, retryAttempt + 1);
        }

        throw new KOClientError(errorMessage, response.status, errorCode, errorDetails);
      }

      const result = await response.json() as T;
      
      // Record success
      this.recordSuccess();
      
      console.log(`KO request completed successfully in ${requestDuration}ms`);
      return result;

    } catch (error) {
      const requestDuration = Date.now() - requestStart;
      
      if (error instanceof KOClientError) {
        throw error;
      }

      // Record failure for circuit breaker
      this.recordFailure();

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          const timeoutError = new KOClientError(
            `KO request timeout after ${effectiveTimeout}ms`,
            408,
            'TIMEOUT',
            { duration: requestDuration },
            true // degraded = true
          );

          // Retry on timeout
          if (retryAttempt < this.cbOptions.maxRetries) {
            const delay = this.calculateBackoffDelay(retryAttempt);
            console.log(`Retrying KO request after timeout in ${delay}ms (attempt ${retryAttempt + 1}/${this.cbOptions.maxRetries})`);
            await this.sleep(delay);
            return this.makeRequestWithCircuitBreaker(endpoint, options, budgets, retryAttempt + 1);
          }

          throw timeoutError;
        }
        
        if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
          const connectionError = new KOClientError(
            `Cannot connect to KO service at ${this.baseUrl}: ${error.message}`,
            503,
            'CONNECTION_ERROR',
            { duration: requestDuration },
            true // degraded = true
          );

          // Retry connection errors
          if (retryAttempt < this.cbOptions.maxRetries) {
            const delay = this.calculateBackoffDelay(retryAttempt);
            console.log(`Retrying KO request after connection error in ${delay}ms (attempt ${retryAttempt + 1}/${this.cbOptions.maxRetries})`);
            await this.sleep(delay);
            return this.makeRequestWithCircuitBreaker(endpoint, options, budgets, retryAttempt + 1);
          }

          throw connectionError;
        }
      }

      throw new KOClientError(
        `Unexpected error in KO request: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'UNKNOWN_ERROR',
        { duration: requestDuration },
        true // degraded = true
      );
    }
  }

  /**
   * F2: Enhanced getContextPack with circuit breaker and budgets
   */
  async getContextPack(
    task: string,
    options: GetContextPackOptions = {}
  ): Promise<ContextPackResult> {
    if (!task || task.trim().length === 0) {
      throw new KOClientError('Task is required and cannot be empty', 400, 'VALIDATION_ERROR');
    }

    const {
      scope = ['domain'],
      k = 10,
      allow_web = false,
      allow_private = false,
      agent_id = 'moneybag-client',
      // F2: Budget parameters
      latency_ms_max,
      token_budget_max
    } = options;

    console.log(`Getting context pack for task: "${task}" with budgets: latency=${latency_ms_max}ms, tokens=${token_budget_max}`);

    // Prepare request with budget constraints
    const request: PackRequest & { 
      latency_ms_max?: number; 
      token_budget_max?: number; 
    } = {
      agent_id,
      task: task.trim(),
      scope,
      k,
      allow_web,
      allow_private
    };

    // Add budgets to request if specified
    if (latency_ms_max) request.latency_ms_max = latency_ms_max;
    if (token_budget_max) request.token_budget_max = token_budget_max;

    try {
      const response = await this.makeRequestWithCircuitBreaker<PackResponse>(
        '/pack',
        {
          method: 'POST',
          body: JSON.stringify(request),
        },
        { latency_ms_max, token_budget_max }
      );

      const result: ContextPackResult = {
        context: response.context,
        citations: response.citations,
        query_variants: response.query_variants,
        total_candidates: response.total_candidates,
        debug: {
          ...response.debug,
          // Add circuit breaker debug info
          circuit_breaker: {
            state: this.circuitState.state,
            failure_count: this.circuitState.failureCount,
            last_failure_time: this.circuitState.lastFailureTime,
            degraded: false
          }
        }
      };

      console.log(`Context pack retrieved: ${result.total_candidates} candidates, ${result.citations?.length || 0} citations`);
      
      return result;
    } catch (error) {
      console.error('Failed to get context pack:', error);
      
      // F2: For circuit breaker errors, provide degraded response
      if (error instanceof KOClientError && error.degraded) {
        return this.getDegradedResponse(task, options, error);
      }
      
      throw error;
    }
  }

  /**
   * F2: Provide degraded response when KO is unavailable
   */
  private getDegradedResponse(
    task: string,
    _options: GetContextPackOptions,
    _originalError: KOClientError
  ): ContextPackResult {
    console.log('🔄 Providing degraded response due to KO unavailability');
    
    return {
      context: `⚠️ Limited context available due to service degradation.\n\nTask: ${task}\n\nProcessing with reduced capabilities. Some insights may be missing.`,
      citations: [],
      query_variants: [task], // Just the original task
      total_candidates: 0,
      debug: {
        query_generation_ms: 0,
        total_ms: 0,
        circuit_breaker: {
          state: this.circuitState.state,
          failure_count: this.circuitState.failureCount,
          last_failure_time: this.circuitState.lastFailureTime,
          degraded: true
        }
      }
    };
  }

  /**
   * Test connection to KO service
   */
  async healthCheck(): Promise<{ status: string; version?: string; circuitState?: CircuitState }> {
    try {
      if (!this.canExecute()) {
        return {
          status: 'circuit_open',
          circuitState: this.circuitState.state
        };
      }

      const response = await this.makeRequestWithCircuitBreaker<any>('/openapi.json', {
        method: 'GET',
      });
      
      return {
        status: 'healthy',
        version: response.info?.version || 'unknown',
        circuitState: this.circuitState.state
      };
    } catch (error) {
      console.error('KO health check failed:', error);
      return {
        status: 'unhealthy',
        circuitState: this.circuitState.state
      };
    }
  }

  /**
   * Get configuration and circuit breaker state
   */
  getConfig(): {
    baseUrl: string;
    hasApiKey: boolean;
    timeout: number;
    circuitBreaker: CircuitBreakerState & { options: CircuitBreakerOptions };
  } {
    return {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey,
      timeout: this.timeout,
      circuitBreaker: {
        ...this.circuitState,
        options: this.cbOptions
      }
    };
  }

  /**
   * F2: Force circuit breaker state (for testing)
   */
  setCircuitState(state: CircuitState, failureCount: number = 0): void {
    console.log(`Manually setting circuit breaker state to ${state}`);
    this.circuitState.state = state;
    this.circuitState.failureCount = failureCount;
    
    if (state === CircuitState.OPEN) {
      this.circuitState.nextRetryTime = Date.now() + this.cbOptions.resetTimeout;
    }
  }

  /**
   * F2: Reset circuit breaker (for testing/manual recovery)
   */
  resetCircuitBreaker(): void {
    console.log('Manually resetting circuit breaker');
    this.circuitState = {
      state: CircuitState.CLOSED,
      failureCount: 0
    };
  }
}

// Create and export singleton instance
const koClientEnhanced = new KOClientEnhanced();

/**
 * F2: Enhanced function for moneyBag integration with circuit breaker and budgets
 */
export const getContextPack = (
  task: string,
  options?: GetContextPackOptions
): Promise<ContextPackResult> => koClientEnhanced.getContextPack(task, options);

/**
 * Test connection to Knowledge Orchestrator
 */
export const healthCheck = (): Promise<{ status: string; version?: string; circuitState?: CircuitState }> => 
  koClientEnhanced.healthCheck();

/**
 * Create a new KO client with custom configuration
 */
export const createKOClient = (options: KOClientOptions): KOClientEnhanced => 
  new KOClientEnhanced(options);

/**
 * Get current circuit breaker state
 */
export const getCircuitBreakerState = (): CircuitState => 
  koClientEnhanced.getConfig().circuitBreaker.state;

/**
 * Reset circuit breaker (for manual recovery)
 */
export const resetCircuitBreaker = (): void => 
  koClientEnhanced.resetCircuitBreaker();

export default koClientEnhanced;