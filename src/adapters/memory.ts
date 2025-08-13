import fetch, { RequestInit, Response } from 'node-fetch';
import { loadEnv } from '../env.js';

export interface UpstreamHit {
  id: string;
  text: string;
  updated_at: string;
  entities?: string[];
  url?: string;
}

export interface SearchRequest {
  query: string;
  k: number;
}

export interface SearchResponse {
  results: UpstreamHit[];
  total: number;
  query: string;
}

export interface DocumentResponse {
  document: UpstreamHit;
}

export class MemoryLayerError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'MemoryLayerError';
  }
}

class MemoryAdapter {
  private baseUrl: string;
  private token: string;

  constructor() {
    const env = loadEnv();
    this.baseUrl = env.MEMORY_BASE_URL.replace(/\/$/, ''); // Remove trailing slash
    this.token = env.MEMORY_TOKEN;
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const response: Response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      let errorMessage = `Memory layer request failed: ${response.status} ${response.statusText}`;
      let errorCode = `HTTP_${response.status}`;
      
      try {
        const errorBody = await response.json() as any;
        if (errorBody?.message) {
          errorMessage = errorBody.message;
        }
        if (errorBody?.code) {
          errorCode = errorBody.code;
        }
      } catch {
        // If we can't parse error response, use default message
      }
      
      throw new MemoryLayerError(errorMessage, response.status, errorCode);
    }

    try {
      return await response.json() as T;
    } catch (error) {
      throw new MemoryLayerError(
        'Failed to parse response from memory layer',
        500,
        'PARSE_ERROR'
      );
    }
  }

  /**
   * Search for documents in the memory layer
   * @param q - Search query string
   * @param k - Number of results to return
   * @returns Promise<UpstreamHit[]> - Array of search results
   */
  async search(q: string, k: number): Promise<UpstreamHit[]> {
    if (!q.trim()) {
      throw new Error('Search query cannot be empty');
    }
    
    if (k < 1 || k > 100) {
      throw new Error('k must be between 1 and 100');
    }

    const searchRequest: SearchRequest = {
      query: q,
      k
    };

    try {
      const response = await this.makeRequest<SearchResponse>('/search', {
        method: 'POST',
        body: JSON.stringify(searchRequest),
      });

      return response.results;
    } catch (error) {
      if (error instanceof MemoryLayerError) {
        throw error;
      }
      
      throw new MemoryLayerError(
        `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'SEARCH_ERROR'
      );
    }
  }

  /**
   * Fetch a specific document by ID from the memory layer
   * @param id - Document ID
   * @returns Promise<UpstreamHit> - The requested document
   */
  async fetch(id: string): Promise<UpstreamHit> {
    if (!id.trim()) {
      throw new Error('Document ID cannot be empty');
    }

    try {
      const response = await this.makeRequest<DocumentResponse>(`/doc/${encodeURIComponent(id)}`);
      return response.document;
    } catch (error) {
      if (error instanceof MemoryLayerError) {
        throw error;
      }
      
      throw new MemoryLayerError(
        `Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'FETCH_ERROR'
      );
    }
  }

  /**
   * Health check for the memory layer service
   * @returns Promise<boolean> - true if service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }
}

// Create and export a singleton instance
const memoryAdapter = new MemoryAdapter();

export const search = (q: string, k: number): Promise<UpstreamHit[]> => memoryAdapter.search(q, k);
export const fetchDocument = (id: string): Promise<UpstreamHit> => memoryAdapter.fetch(id);
export const healthCheck = (): Promise<boolean> => memoryAdapter.healthCheck();

export default memoryAdapter;