import { loadEnv } from '../env.js';
import type { PackRequest, PackResponse, ErrorResponse } from '../schemas.js';

export interface KOClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
}

export interface GetContextPackOptions {
  scope?: ('personal' | 'domain' | 'web')[];
  k?: number;
  allow_web?: boolean;
  allow_private?: boolean;
  agent_id?: string;
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
  };
}

export class KOClientError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'KOClientError';
  }
}

class KOClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;
  private env = loadEnv();

  constructor(options: KOClientOptions = {}) {
    this.baseUrl = options.baseUrl || this.env.KO_BASE_URL || 'http://localhost:3000';
    this.apiKey = options.apiKey || this.env.KO_API_KEY;
    this.timeout = options.timeout || 30000; // 30 seconds default
  }

  /**
   * Make HTTP request to KO service
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'MoneyBag-KO-Client/1.0',
      ...options.headers as Record<string, string>,
    };

    // Add API key if configured
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      console.log(`Making KO request: ${options.method || 'GET'} ${url}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

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
          // Fallback if error response is not JSON
          errorMessage = `${errorMessage} - ${await response.text()}`;
        }

        throw new KOClientError(errorMessage, response.status, errorCode, errorDetails);
      }

      const result = await response.json() as T;
      console.log(`KO request completed successfully in ${response.headers.get('x-response-time') || 'unknown'}ms`);
      
      return result;
    } catch (error) {
      if (error instanceof KOClientError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new KOClientError(`KO request timeout after ${this.timeout}ms`, 408, 'TIMEOUT');
        }
        
        if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
          throw new KOClientError(
            `Cannot connect to KO service at ${this.baseUrl}: ${error.message}`, 
            503, 
            'CONNECTION_ERROR'
          );
        }
      }

      throw new KOClientError(
        `Unexpected error in KO request: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'UNKNOWN_ERROR'
      );
    }
  }

  /**
   * Get context pack from Knowledge Orchestrator
   * This is the main method that moneyBag will use to get contextualized information
   */
  async getContextPack(
    task: string,
    options: GetContextPackOptions = {}
  ): Promise<ContextPackResult> {
    if (!task || task.trim().length === 0) {
      throw new KOClientError('Task is required and cannot be empty', 400, 'VALIDATION_ERROR');
    }

    const {
      scope = ['domain'], // Default to domain (Notion) scope
      k = 10,
      allow_web = false,
      allow_private = false,
      agent_id = 'moneybag-client'
    } = options;

    console.log(`Getting context pack for task: "${task}" with scope: [${scope.join(', ')}]`);

    const request: PackRequest = {
      agent_id,
      task: task.trim(),
      scope,
      k,
      allow_web,
      allow_private
    };

    try {
      const response = await this.makeRequest<PackResponse>('/pack', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      const result: ContextPackResult = {
        context: response.context,
        citations: response.citations,
        query_variants: response.query_variants,
        total_candidates: response.total_candidates,
        debug: response.debug
      };

      console.log(`Context pack retrieved: ${result.total_candidates} candidates, ${result.citations?.length || 0} citations`);
      
      return result;
    } catch (error) {
      console.error('Failed to get context pack:', error);
      throw error;
    }
  }

  /**
   * Test connection to KO service
   */
  async healthCheck(): Promise<{ status: string; version?: string }> {
    try {
      // Try to get OpenAPI spec as a health check
      const response = await this.makeRequest<any>('/openapi.json', {
        method: 'GET',
      });
      
      return {
        status: 'healthy',
        version: response.info?.version || 'unknown'
      };
    } catch (error) {
      console.error('KO health check failed:', error);
      return {
        status: 'unhealthy'
      };
    }
  }

  /**
   * Get configuration info
   */
  getConfig(): {
    baseUrl: string;
    hasApiKey: boolean;
    timeout: number;
  } {
    return {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey,
      timeout: this.timeout
    };
  }
}

// Create and export singleton instance
const koClient = new KOClient();

/**
 * Main function for moneyBag integration
 * Get contextualized information for a given task
 */
export const getContextPack = (
  task: string,
  options?: GetContextPackOptions
): Promise<ContextPackResult> => koClient.getContextPack(task, options);

/**
 * Test connection to Knowledge Orchestrator
 */
export const healthCheck = (): Promise<{ status: string; version?: string }> => 
  koClient.healthCheck();

/**
 * Create a new KO client with custom configuration
 */
export const createKOClient = (options: KOClientOptions): KOClient => 
  new KOClient(options);

export default koClient;