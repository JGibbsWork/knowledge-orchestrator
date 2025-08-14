import { createServer, Server } from 'http';
import { URL } from 'url';

/**
 * H2: Mock Memory API server for E2E testing
 * Simulates the Memory service API responses
 */

export interface MemoryDocument {
  id: string;
  title: string;
  content: string;
  updated_at: string;
  tags?: string[];
}

export class MockMemoryServer {
  private server: Server | null = null;
  private port: number;
  private documents: MemoryDocument[] = [];

  constructor(port: number = 3001) {
    this.port = port;
    this.setupDefaultDocuments();
  }

  private setupDefaultDocuments() {
    this.documents = [
      {
        id: 'mem_001',
        title: 'TypeScript Best Practices',
        content: 'TypeScript provides static typing for JavaScript. Key best practices include using strict mode, proper interface definitions, and leveraging union types for better type safety. Always use explicit return types for functions and prefer interfaces over type aliases for object shapes.',
        updated_at: '2024-01-15T10:30:00Z',
        tags: ['typescript', 'programming', 'best-practices']
      },
      {
        id: 'mem_002', 
        title: 'API Design Patterns',
        content: 'RESTful API design follows HTTP conventions and resource-based URLs. Use proper HTTP methods (GET, POST, PUT, DELETE) and status codes. Implement pagination for large datasets, version your APIs, and provide comprehensive error messages with structured responses.',
        updated_at: '2024-01-16T14:20:00Z',
        tags: ['api', 'rest', 'design-patterns']
      },
      {
        id: 'mem_003',
        title: 'Testing Strategies',
        content: 'Comprehensive testing includes unit tests, integration tests, and end-to-end tests. Use test-driven development (TDD) for critical functionality. Mock external dependencies and ensure high code coverage. Playwright is excellent for E2E API testing.',
        updated_at: '2024-01-17T09:15:00Z',
        tags: ['testing', 'tdd', 'playwright', 'e2e']
      }
    ];
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.port, () => {
        console.log(`Mock Memory API server listening on port ${this.port}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Mock Memory API server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: any, res: any) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url!, `http://localhost:${this.port}`);
    const path = url.pathname;
    const method = req.method;

    try {
      if (method === 'GET' && path === '/search') {
        this.handleSearch(req, res, url);
      } else if (method === 'GET' && path.startsWith('/documents/')) {
        this.handleGetDocument(req, res, path);
      } else if (method === 'GET' && path === '/documents') {
        this.handleListDocuments(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      console.error('Mock Memory API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private handleSearch(req: any, res: any, url: URL) {
    const query = url.searchParams.get('query') || '';
    const limit = parseInt(url.searchParams.get('limit') || '10');

    // Simple search: match query against title and content
    const results = this.documents
      .filter(doc => 
        doc.title.toLowerCase().includes(query.toLowerCase()) ||
        doc.content.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, limit)
      .map(doc => ({
        id: doc.id,
        title: doc.title,
        text: doc.content.substring(0, 300) + '...',
        url: `http://localhost:${this.port}/documents/${doc.id}`,
        score: 0.8 + Math.random() * 0.2, // Simulate relevance score
        updated_at: doc.updated_at
      }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      query,
      results,
      total: results.length
    }));
  }

  private handleGetDocument(req: any, res: any, path: string) {
    const documentId = path.split('/').pop();
    const document = this.documents.find(doc => doc.id === documentId);

    if (!document) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Document not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: document.id,
      title: document.title,
      content: document.content,
      updated_at: document.updated_at,
      tags: document.tags || []
    }));
  }

  private handleListDocuments(req: any, res: any) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      documents: this.documents.map(doc => ({
        id: doc.id,
        title: doc.title,
        updated_at: doc.updated_at
      })),
      total: this.documents.length
    }));
  }

  addDocument(document: MemoryDocument) {
    this.documents.push(document);
  }

  clearDocuments() {
    this.documents = [];
  }

  getPort() {
    return this.port;
  }
}