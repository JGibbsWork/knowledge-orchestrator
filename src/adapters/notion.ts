import fetch, { RequestInit, Response } from 'node-fetch';
import { loadEnv } from '../env.js';

// Re-use the same interface as memory adapter for consistency
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

export class NotionError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'NotionError';
  }
}

// Deterministic mock data for testing
const MOCK_DOCUMENTS: UpstreamHit[] = [
  {
    id: 'notion_page_001',
    text: 'This is a mock Notion page about project planning. It contains information about sprint planning, backlog management, and team coordination.',
    updated_at: '2024-01-15T10:30:00Z',
    entities: ['project', 'planning', 'sprint', 'backlog'],
    url: 'https://www.notion.so/page001'
  },
  {
    id: 'notion_page_002', 
    text: 'Documentation page covering API design patterns and best practices. Includes examples of REST API design, error handling, and authentication strategies.',
    updated_at: '2024-01-14T15:45:00Z',
    entities: ['api', 'documentation', 'rest', 'authentication'],
    url: 'https://www.notion.so/page002'
  },
  {
    id: 'notion_page_003',
    text: 'Meeting notes from quarterly review discussing team performance, project milestones, and upcoming initiatives for the next quarter.',
    updated_at: '2024-01-13T09:15:00Z',
    entities: ['meeting', 'quarterly', 'review', 'milestones'],
    url: 'https://www.notion.so/page003'
  },
  {
    id: 'notion_page_004',
    text: 'Technical specification for the new microservice architecture. Covers service boundaries, communication patterns, and deployment strategies.',
    updated_at: '2024-01-12T14:20:00Z',
    entities: ['technical', 'microservice', 'architecture', 'deployment'],
    url: 'https://www.notion.so/page004'
  },
  {
    id: 'notion_page_005',
    text: 'User research findings and insights from customer interviews. Includes pain points, feature requests, and usability feedback.',
    updated_at: '2024-01-11T11:00:00Z',
    entities: ['user', 'research', 'customer', 'feedback'],
    url: 'https://www.notion.so/page005'
  }
];

class NotionAdapter {
  private baseUrl: string;
  private token: string;
  private mockMode: boolean;

  constructor() {
    const env = loadEnv();
    this.baseUrl = env.NOTION_BASE_URL.replace(/\/$/, ''); // Remove trailing slash
    this.token = env.NOTION_TOKEN;
    this.mockMode = env.MOCK_NOTION;
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
        'Notion-Version': '2022-06-28', // Latest Notion API version
        ...options.headers,
      },
    });

    if (!response.ok) {
      let errorMessage = `Notion request failed: ${response.status} ${response.statusText}`;
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
      
      throw new NotionError(errorMessage, response.status, errorCode);
    }

    try {
      return await response.json() as T;
    } catch (error) {
      throw new NotionError(
        'Failed to parse response from Notion',
        500,
        'PARSE_ERROR'
      );
    }
  }

  private mockSearch(query: string, k: number): UpstreamHit[] {
    // Simple mock search: filter documents that contain query terms (case insensitive)
    const queryLower = query.toLowerCase();
    const matchingDocs = MOCK_DOCUMENTS.filter(doc => 
      doc.text.toLowerCase().includes(queryLower) ||
      doc.entities?.some(entity => entity.toLowerCase().includes(queryLower))
    );
    
    // Return up to k results, sorted by updated_at (newest first)
    return matchingDocs
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, k);
  }

  private mockFetch(id: string): UpstreamHit | null {
    return MOCK_DOCUMENTS.find(doc => doc.id === id) || null;
  }

  /**
   * Search for documents in Notion
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

    // Return mock data if in mock mode
    if (this.mockMode) {
      return this.mockSearch(q, k);
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
      if (error instanceof NotionError) {
        throw error;
      }
      
      throw new NotionError(
        `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'SEARCH_ERROR'
      );
    }
  }

  /**
   * Fetch a specific document by ID from Notion
   * @param id - Document ID
   * @returns Promise<UpstreamHit> - The requested document
   */
  async fetch(id: string): Promise<UpstreamHit> {
    if (!id.trim()) {
      throw new Error('Document ID cannot be empty');
    }

    // Return mock data if in mock mode
    if (this.mockMode) {
      const mockDoc = this.mockFetch(id);
      if (!mockDoc) {
        throw new NotionError('Document not found', 404, 'NOT_FOUND');
      }
      return mockDoc;
    }

    try {
      const response = await this.makeRequest<DocumentResponse>(`/doc/${encodeURIComponent(id)}`);
      return response.document;
    } catch (error) {
      if (error instanceof NotionError) {
        throw error;
      }
      
      throw new NotionError(
        `Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'FETCH_ERROR'
      );
    }
  }

  /**
   * Health check for the Notion service
   * @returns Promise<boolean> - true if service is healthy
   */
  async healthCheck(): Promise<boolean> {
    // In mock mode, always return healthy
    if (this.mockMode) {
      return true;
    }

    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current mode (mock or real)
   * @returns boolean - true if in mock mode
   */
  isMockMode(): boolean {
    return this.mockMode;
  }

  /**
   * Get all mock documents (useful for testing)
   * @returns UpstreamHit[] - Array of all mock documents
   */
  getMockDocuments(): UpstreamHit[] {
    return [...MOCK_DOCUMENTS]; // Return a copy to prevent mutation
  }
}

// Create and export a singleton instance
const notionAdapter = new NotionAdapter();

export const search = (q: string, k: number): Promise<UpstreamHit[]> => notionAdapter.search(q, k);
export const fetchDocument = (id: string): Promise<UpstreamHit> => notionAdapter.fetch(id);
export const healthCheck = (): Promise<boolean> => notionAdapter.healthCheck();
export const isMockMode = (): boolean => notionAdapter.isMockMode();
export const getMockDocuments = (): UpstreamHit[] => notionAdapter.getMockDocuments();

export default notionAdapter;