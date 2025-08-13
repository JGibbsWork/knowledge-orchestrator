// Memory Layer - Unit tests for search endpoints
// File: tests/search.test.js (or similar)

const request = require('supertest');
const app = require('../app'); // Your Express app

describe('Search Endpoints', () => {
  // Mock data for testing
  const mockSearchResults = [
    {
      id: 'doc_1',
      content: 'This is a test document about artificial intelligence',
      updated_at: '2024-01-15T10:30:00Z',
      entities: ['artificial', 'intelligence', 'test'],
      source_url: 'https://example.com/doc1'
    },
    {
      id: 'doc_2', 
      content: 'Another document discussing machine learning concepts',
      updated_at: '2024-01-14T15:45:00Z',
      entities: ['machine', 'learning', 'concepts'],
      source_url: 'https://example.com/doc2'
    }
  ];

  const mockDocument = {
    id: 'doc_1',
    title: 'AI Document',
    content: 'This is a test document about artificial intelligence',
    updated_at: '2024-01-15T10:30:00Z',
    entities: ['artificial', 'intelligence', 'test'],
    source_url: 'https://example.com/doc1'
  };

  describe('POST /search', () => {
    beforeEach(() => {
      // Mock your search function
      jest.spyOn(require('../lib/search'), 'performVectorSearch')
        .mockResolvedValue(mockSearchResults);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return search results for valid query', async () => {
      const response = await request(app)
        .post('/search')
        .send({
          query: 'artificial intelligence',
          k: 5
        })
        .expect(200);

      expect(response.body).toHaveProperty('results');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('query', 'artificial intelligence');
      expect(response.body).toHaveProperty('response_time_ms');
      expect(Array.isArray(response.body.results)).toBe(true);
      expect(response.body.results.length).toBeLessThanOrEqual(5);
      
      // Check result structure
      const firstResult = response.body.results[0];
      expect(firstResult).toHaveProperty('id');
      expect(firstResult).toHaveProperty('text');
      expect(firstResult).toHaveProperty('updated_at');
      expect(firstResult).toHaveProperty('entities');
      expect(firstResult).toHaveProperty('url');
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

    it('should return 400 for missing query', async () => {
      const response = await request(app)
        .post('/search')
        .send({
          k: 5
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
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

    it('should return 400 for k > 100', async () => {
      const response = await request(app)
        .post('/search')
        .send({
          query: 'test',
          k: 101
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

    it('should handle search errors gracefully', async () => {
      jest.spyOn(require('../lib/search'), 'performVectorSearch')
        .mockRejectedValue(new Error('Search service unavailable'));

      const response = await request(app)
        .post('/search')
        .send({
          query: 'test query',
          k: 5
        })
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Internal search error');
    });
  });

  describe('GET /doc/:id', () => {
    beforeEach(() => {
      // Mock your document retrieval function
      jest.spyOn(require('../lib/documents'), 'getDocumentById')
        .mockImplementation((id) => {
          if (id === 'doc_1') return Promise.resolve(mockDocument);
          if (id === 'nonexistent') return Promise.resolve(null);
          return Promise.reject(new Error('Database error'));
        });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return document for valid ID', async () => {
      const response = await request(app)
        .get('/doc/doc_1')
        .expect(200);

      expect(response.body).toHaveProperty('document');
      expect(response.body).toHaveProperty('response_time_ms');
      
      const doc = response.body.document;
      expect(doc).toHaveProperty('id', 'doc_1');
      expect(doc).toHaveProperty('title');
      expect(doc).toHaveProperty('text');
      expect(doc).toHaveProperty('updated_at');
    });

    it('should return 404 for nonexistent document', async () => {
      const response = await request(app)
        .get('/doc/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Document not found');
      expect(response.body).toHaveProperty('id', 'nonexistent');
    });

    it('should return 400 for empty document ID', async () => {
      const response = await request(app)
        .get('/doc/')
        .expect(404); // Express returns 404 for missing route params
    });

    it('should complete fetch within 300ms', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/doc/doc_1')
        .expect(200);

      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      expect(responseTime).toBeLessThan(300);
      expect(response.body.response_time_ms).toBeLessThan(300);
    });

    it('should handle database errors gracefully', async () => {
      const response = await request(app)
        .get('/doc/error_case')
        .expect(500);

      expect(response.body).toHaveProperty('error', 'Internal fetch error');
    });
  });

  describe('Integration Tests', () => {
    it('should handle concurrent requests efficiently', async () => {
      const promises = Array.from({ length: 10 }, () =>
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

    it('should maintain consistent response format', async () => {
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
      
      expect(typeof docResponse.body.document.id).toBe('string');
      expect(typeof docResponse.body.document.text).toBe('string');
      expect(typeof docResponse.body.document.updated_at).toBe('string');
    });
  });
});