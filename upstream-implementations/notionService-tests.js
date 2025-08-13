// Notion Financial Service - Unit tests for search endpoints
// File: tests/search.test.js (or similar)

const request = require('supertest');
const app = require('../app'); // Your Express app
const { Client } = require('@notionhq/client');

// Mock Notion client
jest.mock('@notionhq/client');

describe('Notion Search Endpoints', () => {
  let mockNotion;

  beforeEach(() => {
    mockNotion = {
      search: jest.fn(),
      pages: {
        retrieve: jest.fn()
      },
      blocks: {
        children: {
          list: jest.fn()
        }
      }
    };
    
    Client.mockImplementation(() => mockNotion);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Mock data
  const mockSearchResults = {
    results: [
      {
        id: 'page-1',
        url: 'https://notion.so/page-1',
        last_edited_time: '2024-01-15T10:30:00Z',
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'Financial Report Q1' }]
          },
          Tags: {
            type: 'multi_select',
            multi_select: [
              { name: 'finance' },
              { name: 'quarterly' }
            ]
          }
        }
      },
      {
        id: 'page-2',
        url: 'https://notion.so/page-2',
        last_edited_time: '2024-01-14T15:45:00Z',
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'Budget Analysis' }]
          }
        }
      }
    ],
    has_more: false,
    next_cursor: null
  };

  const mockPageBlocks = {
    results: [
      {
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { plain_text: 'This is the main content of the financial report.' }
          ]
        }
      },
      {
        type: 'heading_1',
        heading_1: {
          rich_text: [
            { plain_text: 'Revenue Analysis' }
          ]
        }
      },
      {
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [
            { plain_text: 'Q1 revenue increased by 15%' }
          ]
        }
      }
    ]
  };

  const mockPage = {
    id: 'page-1',
    url: 'https://notion.so/page-1',
    last_edited_time: '2024-01-15T10:30:00Z',
    created_time: '2024-01-01T09:00:00Z',
    parent: {
      database_id: 'db-123'
    },
    properties: {
      Name: {
        type: 'title',
        title: [{ plain_text: 'Financial Report Q1' }]
      },
      Tags: {
        type: 'multi_select',
        multi_select: [
          { name: 'finance' },
          { name: 'quarterly' }
        ]
      }
    }
  };

  describe('POST /search', () => {
    beforeEach(() => {
      mockNotion.search.mockResolvedValue(mockSearchResults);
      mockNotion.blocks.children.list.mockResolvedValue(mockPageBlocks);
    });

    it('should return search results for valid query', async () => {
      const response = await request(app)
        .post('/search')
        .send({
          query: 'financial report',
          k: 5
        })
        .expect(200);

      expect(response.body).toHaveProperty('results');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('query', 'financial report');
      expect(response.body).toHaveProperty('has_more');
      expect(response.body).toHaveProperty('response_time_ms');
      expect(Array.isArray(response.body.results)).toBe(true);
      
      // Check result structure matches contract
      const firstResult = response.body.results[0];
      expect(firstResult).toHaveProperty('id');
      expect(firstResult).toHaveProperty('text');
      expect(firstResult).toHaveProperty('updated_at');
      expect(firstResult).toHaveProperty('url');
      expect(firstResult.entities).toBeDefined();
    });

    it('should support database filtering', async () => {
      const response = await request(app)
        .post('/search')
        .send({
          query: 'budget',
          k: 10,
          database_id: 'db-123'
        })
        .expect(200);

      expect(mockNotion.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'budget',
          filter: expect.objectContaining({
            and: expect.any(Array)
          })
        })
      );

      expect(response.body.results).toBeDefined();
    });

    it('should support pagination parameters', async () => {
      const response = await request(app)
        .post('/search')
        .send({
          query: 'finance',
          k: 20,
          page_size: 10,
          start_cursor: 'cursor-123'
        })
        .expect(200);

      expect(mockNotion.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'finance',
          page_size: 10,
          start_cursor: 'cursor-123'
        })
      );

      expect(response.body).toHaveProperty('has_more');
      expect(response.body).toHaveProperty('next_cursor');
    });

    it('should use default k=10 when k not provided', async () => {
      const response = await request(app)
        .post('/search')
        .send({
          query: 'test query'
        })
        .expect(200);

      expect(response.body.results).toBeDefined();
    });

    it('should return 400 for empty query', async () => {
      const response = await request(app)
        .post('/search')
        .send({
          query: '',
          k: 5
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('query is required');
    });

    it('should return 400 for invalid k value', async () => {
      const response = await request(app)
        .post('/search')
        .send({
          query: 'test',
          k: 0
        })
        .expect(400);

      expect(response.body.error).toContain('k must be a number between 1 and 100');
    });

    it('should complete search within 300ms for small k', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/search')
        .send({
          query: 'performance test',
          k: 5
        })
        .expect(200);

      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      expect(responseTime).toBeLessThan(300);
      expect(response.body.response_time_ms).toBeLessThan(300);
    });

    it('should handle Notion API errors gracefully', async () => {
      mockNotion.search.mockRejectedValue({
        code: 'unauthorized',
        message: 'Notion API key is invalid'
      });

      const response = await request(app)
        .post('/search')
        .send({
          query: 'test query',
          k: 5
        })
        .expect(500);

      expect(response.body).toHaveProperty('error', 'Internal search error');
      expect(response.body).toHaveProperty('code', 'unauthorized');
    });

    it('should handle block content fetch errors gracefully', async () => {
      mockNotion.blocks.children.list.mockRejectedValue(new Error('Block access denied'));

      const response = await request(app)
        .post('/search')
        .send({
          query: 'test query',
          k: 5
        })
        .expect(200);

      // Should still return results with title as fallback text
      expect(response.body.results).toBeDefined();
      expect(response.body.results[0].text).toContain('Financial Report Q1');
    });
  });

  describe('GET /doc/:id', () => {
    beforeEach(() => {
      mockNotion.pages.retrieve.mockResolvedValue(mockPage);
      mockNotion.blocks.children.list.mockResolvedValue(mockPageBlocks);
    });

    it('should return document for valid ID', async () => {
      const response = await request(app)
        .get('/doc/page-1')
        .expect(200);

      expect(response.body).toHaveProperty('document');
      expect(response.body).toHaveProperty('response_time_ms');
      
      const doc = response.body.document;
      expect(doc).toHaveProperty('id', 'page-1');
      expect(doc).toHaveProperty('title', 'Financial Report Q1');
      expect(doc).toHaveProperty('text');
      expect(doc).toHaveProperty('updated_at');
      expect(doc).toHaveProperty('url');
      expect(doc).toHaveProperty('database_id', 'db-123');
      expect(doc).toHaveProperty('created_time');
    });

    it('should return 404 for nonexistent document', async () => {
      mockNotion.pages.retrieve.mockRejectedValue({
        code: 'object_not_found',
        message: 'Page not found'
      });

      const response = await request(app)
        .get('/doc/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Document not found');
      expect(response.body).toHaveProperty('id', 'nonexistent');
    });

    it('should return 403 for unauthorized access', async () => {
      mockNotion.pages.retrieve.mockRejectedValue({
        code: 'unauthorized',
        message: 'Insufficient permissions'
      });

      const response = await request(app)
        .get('/doc/unauthorized-page')
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Access denied to document');
    });

    it('should complete fetch within 300ms', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/doc/page-1')
        .expect(200);

      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      expect(responseTime).toBeLessThan(300);
      expect(response.body.response_time_ms).toBeLessThan(300);
    });

    it('should extract text from various block types', async () => {
      const complexBlocks = {
        results: [
          {
            type: 'heading_1',
            heading_1: { rich_text: [{ plain_text: 'Main Heading' }] }
          },
          {
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Paragraph content' }] }
          },
          {
            type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: [{ plain_text: 'List item' }] }
          },
          {
            type: 'to_do',
            to_do: { 
              checked: true,
              rich_text: [{ plain_text: 'Completed task' }]
            }
          }
        ]
      };

      mockNotion.blocks.children.list.mockResolvedValue(complexBlocks);

      const response = await request(app)
        .get('/doc/page-1')
        .expect(200);

      const text = response.body.document.text;
      expect(text).toContain('Main Heading');
      expect(text).toContain('Paragraph content');
      expect(text).toContain('• List item');
      expect(text).toContain('[x] Completed task');
    });
  });

  describe('Integration Tests', () => {
    beforeEach(() => {
      mockNotion.search.mockResolvedValue(mockSearchResults);
      mockNotion.pages.retrieve.mockResolvedValue(mockPage);
      mockNotion.blocks.children.list.mockResolvedValue(mockPageBlocks);
    });

    it('should handle concurrent requests efficiently', async () => {
      const promises = Array.from({ length: 5 }, () =>
        request(app)
          .post('/search')
          .send({
            query: 'concurrent test',
            k: 3
          })
      );

      const responses = await Promise.all(promises);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.response_time_ms).toBeLessThan(300);
      });
    });

    it('should maintain consistent response format between search and fetch', async () => {
      const searchResponse = await request(app)
        .post('/search')
        .send({ query: 'format test', k: 1 })
        .expect(200);

      const firstResult = searchResponse.body.results[0];
      
      const docResponse = await request(app)
        .get(`/doc/${firstResult.id}`)
        .expect(200);

      // Both should have consistent field names and types
      expect(typeof firstResult.id).toBe('string');
      expect(typeof firstResult.text).toBe('string');
      expect(typeof firstResult.updated_at).toBe('string');
      expect(typeof firstResult.url).toBe('string');
      
      expect(typeof docResponse.body.document.id).toBe('string');
      expect(typeof docResponse.body.document.text).toBe('string');
      expect(typeof docResponse.body.document.updated_at).toBe('string');
      expect(typeof docResponse.body.document.url).toBe('string');
    });

    it('should properly extract entities from various sources', async () => {
      const response = await request(app)
        .get('/doc/page-1')
        .expect(200);

      const entities = response.body.document.entities;
      expect(entities).toContain('finance');
      expect(entities).toContain('quarterly');
      expect(Array.isArray(entities)).toBe(true);
    });
  });
});