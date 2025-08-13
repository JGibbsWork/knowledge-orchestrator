// Memory Layer - Add these routes to your existing server
// File: routes/search.js (or similar)

const express = require('express');
const router = express.Router();

// Validation middleware
const validateSearchRequest = (req, res, next) => {
  const { query, k } = req.body;
  
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({
      error: 'query is required and must be a non-empty string'
    });
  }
  
  const limit = k || 10;
  if (typeof limit !== 'number' || limit < 1 || limit > 100) {
    return res.status(400).json({
      error: 'k must be a number between 1 and 100'
    });
  }
  
  req.searchParams = { query: query.trim(), k: limit };
  next();
};

// POST /search endpoint
router.post('/search', validateSearchRequest, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { query, k } = req.searchParams;
    
    // Your existing search logic here - this is pseudocode
    // Replace with your actual vector search/similarity search implementation
    const searchResults = await performVectorSearch(query, {
      limit: k,
      includeMetadata: true,
      threshold: 0.7 // similarity threshold
    });
    
    // Transform results to match contract
    const hits = searchResults.map(result => ({
      id: result.id,
      text: result.content || result.text,
      updated_at: result.updated_at || result.timestamp || new Date().toISOString(),
      entities: result.entities || extractEntities(result.content),
      url: result.source_url || result.url
    }));
    
    const responseTime = Date.now() - startTime;
    
    res.json({
      results: hits,
      total: searchResults.totalCount || hits.length,
      query,
      response_time_ms: responseTime
    });
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: 'Internal search error',
      message: error.message
    });
  }
});

// GET /doc/:id endpoint
router.get('/doc/:id', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    
    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        error: 'Document ID is required'
      });
    }
    
    // Your existing document retrieval logic
    // Replace with your actual document lookup implementation
    const document = await getDocumentById(id);
    
    if (!document) {
      return res.status(404).json({
        error: 'Document not found',
        id
      });
    }
    
    const responseTime = Date.now() - startTime;
    
    res.json({
      document: {
        id: document.id,
        title: document.title,
        text: document.content || document.text,
        updated_at: document.updated_at || document.timestamp || new Date().toISOString(),
        entities: document.entities || extractEntities(document.content),
        url: document.source_url || document.url
      },
      response_time_ms: responseTime
    });
    
  } catch (error) {
    console.error('Document fetch error:', error);
    res.status(500).json({
      error: 'Internal fetch error',
      message: error.message
    });
  }
});

// Helper functions (implement based on your existing codebase)
async function performVectorSearch(query, options = {}) {
  // TODO: Replace with your vector search implementation
  // This should use your existing embedding/similarity search logic
  // Example:
  // const embedding = await generateEmbedding(query);
  // const results = await vectorStore.search(embedding, options);
  // return results;
  throw new Error('performVectorSearch not implemented - replace with your search logic');
}

async function getDocumentById(id) {
  // TODO: Replace with your document storage lookup
  // This should use your existing document storage (database, vector store, etc.)
  // Example:
  // const doc = await documentStore.findById(id);
  // return doc;
  throw new Error('getDocumentById not implemented - replace with your storage logic');
}

function extractEntities(text) {
  // TODO: Replace with your entity extraction logic if available
  // This is optional - can return undefined if you don't have entity extraction
  // Example using simple keyword extraction:
  if (!text) return undefined;
  
  const commonEntities = text.toLowerCase()
    .split(/\W+/)
    .filter(word => word.length > 3)
    .slice(0, 10);
    
  return commonEntities.length > 0 ? commonEntities : undefined;
}

module.exports = router;