import { createServer, Server } from 'http';
import { URL } from 'url';

/**
 * H2: Mock Notion API server for E2E testing
 * Simulates the Notion service API responses
 */

export interface NotionPage {
  id: string;
  title: string;
  content: string;
  url: string;
  updated_at: string;
  database_id?: string;
}

export class MockNotionServer {
  private server: Server | null = null;
  private port: number;
  private pages: NotionPage[] = [];

  constructor(port: number = 3002) {
    this.port = port;
    this.setupDefaultPages();
  }

  private setupDefaultPages() {
    this.pages = [
      {
        id: 'notion_001',
        title: 'JavaScript Frameworks Comparison',
        content: 'Modern JavaScript frameworks like React, Vue, and Angular each have unique strengths. React excels in component reusability and has a vast ecosystem. Vue offers gentle learning curve and excellent documentation. Angular provides a complete framework solution with TypeScript by default.',
        url: `http://localhost:${this.port}/pages/notion_001`,
        updated_at: '2024-01-15T12:00:00Z',
        database_id: 'db_001'
      },
      {
        id: 'notion_002',
        title: 'Database Design Principles',
        content: 'Effective database design follows normalization principles to reduce redundancy. Use appropriate data types, implement proper indexing strategies, and consider scalability from the start. NoSQL databases like MongoDB offer flexibility for evolving schemas.',
        url: `http://localhost:${this.port}/pages/notion_002`,
        updated_at: '2024-01-16T16:30:00Z',
        database_id: 'db_001'
      },
      {
        id: 'notion_003',
        title: 'Microservices Architecture',
        content: 'Microservices architecture breaks down applications into small, independent services. Each service should have a single responsibility and communicate via well-defined APIs. Benefits include scalability, technology diversity, and fault isolation.',
        url: `http://localhost:${this.port}/pages/notion_003`,
        updated_at: '2024-01-17T11:45:00Z',
        database_id: 'db_002'
      }
    ];
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.port, () => {
        console.log(`Mock Notion API server listening on port ${this.port}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Mock Notion API server stopped');
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Notion-Version');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url!, `http://localhost:${this.port}`);
    const path = url.pathname;
    const method = req.method;

    try {
      if (method === 'POST' && path === '/v1/search') {
        this.handleSearch(req, res);
      } else if (method === 'GET' && path.startsWith('/v1/pages/')) {
        this.handleGetPage(req, res, path);
      } else if (method === 'GET' && path === '/v1/pages') {
        this.handleListPages(req, res);
      } else if (method === 'POST' && path.startsWith('/v1/databases/') && path.endsWith('/query')) {
        this.handleDatabaseQuery(req, res, path);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      console.error('Mock Notion API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private handleSearch(req: any, res: any) {
    let body = '';
    req.on('data', (chunk: any) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const searchData = JSON.parse(body);
        const query = searchData.query || '';
        const pageSize = searchData.page_size || 10;

        // Simple search: match query against title and content
        const results = this.pages
          .filter(page => 
            page.title.toLowerCase().includes(query.toLowerCase()) ||
            page.content.toLowerCase().includes(query.toLowerCase())
          )
          .slice(0, pageSize)
          .map(page => ({
            object: 'page',
            id: page.id,
            created_time: '2024-01-01T00:00:00.000Z',
            last_edited_time: page.updated_at,
            url: page.url,
            properties: {
              title: {
                id: 'title',
                type: 'title',
                title: [
                  {
                    type: 'text',
                    text: {
                      content: page.title,
                      link: null
                    }
                  }
                ]
              }
            },
            content: page.content
          }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          object: 'list',
          results,
          next_cursor: null,
          has_more: false
        }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleGetPage(req: any, res: any, path: string) {
    const pageId = path.split('/').pop();
    const page = this.pages.find(p => p.id === pageId);

    if (!page) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Page not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'page',
      id: page.id,
      created_time: '2024-01-01T00:00:00.000Z',
      last_edited_time: page.updated_at,
      url: page.url,
      properties: {
        title: {
          id: 'title',
          type: 'title',
          title: [
            {
              type: 'text',
              text: {
                content: page.title,
                link: null
              }
            }
          ]
        }
      },
      content: page.content
    }));
  }

  private handleListPages(req: any, res: any) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      results: this.pages.map(page => ({
        object: 'page',
        id: page.id,
        url: page.url,
        last_edited_time: page.updated_at
      })),
      next_cursor: null,
      has_more: false
    }));
  }

  private handleDatabaseQuery(req: any, res: any, path: string) {
    const databaseId = path.split('/')[3]; // Extract database ID from path
    
    let body = '';
    req.on('data', (chunk: any) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const queryData = JSON.parse(body);
        const pageSize = queryData.page_size || 10;

        // Filter pages by database ID
        const results = this.pages
          .filter(page => page.database_id === databaseId)
          .slice(0, pageSize)
          .map(page => ({
            object: 'page',
            id: page.id,
            created_time: '2024-01-01T00:00:00.000Z',
            last_edited_time: page.updated_at,
            url: page.url,
            properties: {
              title: {
                id: 'title',
                type: 'title',
                title: [
                  {
                    type: 'text',
                    text: {
                      content: page.title,
                      link: null
                    }
                  }
                ]
              }
            }
          }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          object: 'list',
          results,
          next_cursor: null,
          has_more: false
        }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  addPage(page: NotionPage) {
    this.pages.push(page);
  }

  clearPages() {
    this.pages = [];
  }

  getPort() {
    return this.port;
  }
}