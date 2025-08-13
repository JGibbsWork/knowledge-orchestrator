// Notion Financial Service - Add these routes to your existing server
// File: routes/search.js (or similar)

const express = require('express');
const { Client } = require('@notionhq/client');
const router = express.Router();

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// Validation middleware
const validateSearchRequest = (req, res, next) => {
  const { query, k, database_id, page_size, start_cursor } = req.body;
  
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

  const pageSize = page_size || Math.min(limit, 100);
  if (typeof pageSize !== 'number' || pageSize < 1 || pageSize > 100) {
    return res.status(400).json({
      error: 'page_size must be a number between 1 and 100'
    });
  }
  
  req.searchParams = { 
    query: query.trim(), 
    k: limit,
    database_id,
    page_size: pageSize,
    start_cursor
  };
  next();
};

// POST /search endpoint
router.post('/search', validateSearchRequest, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { query, k, database_id, page_size, start_cursor } = req.searchParams;
    
    // Search across pages using Notion API
    const searchParams = {
      query,
      page_size,
      start_cursor,
      filter: {
        property: 'object',
        value: 'page'
      }
    };

    // Add database filter if specified
    if (database_id) {
      searchParams.filter = {
        and: [
          searchParams.filter,
          {
            property: 'parent',
            database: {
              equals: database_id
            }
          }
        ]
      };
    }

    const searchResponse = await notion.search(searchParams);
    
    // Get page content for matching pages
    const hits = await Promise.all(
      searchResponse.results.slice(0, k).map(async (page) => {
        try {
          // Get page content
          const blocks = await notion.blocks.children.list({
            block_id: page.id,
            page_size: 50
          });
          
          // Extract text content from blocks
          const textContent = extractTextFromBlocks(blocks.results);
          
          // Extract title from page properties
          const title = extractPageTitle(page);
          
          return {
            id: page.id,
            text: textContent || title || 'No content available',
            updated_at: page.last_edited_time,
            entities: extractEntitiesFromPage(page, textContent),
            url: page.url
          };
        } catch (error) {
          console.error(`Error fetching content for page ${page.id}:`, error);
          return {
            id: page.id,
            text: extractPageTitle(page) || 'Content unavailable',
            updated_at: page.last_edited_time,
            url: page.url
          };
        }
      })
    );

    const responseTime = Date.now() - startTime;
    
    res.json({
      results: hits,
      total: searchResponse.results.length,
      query,
      has_more: searchResponse.has_more,
      next_cursor: searchResponse.next_cursor,
      response_time_ms: responseTime
    });
    
  } catch (error) {
    console.error('Notion search error:', error);
    res.status(500).json({
      error: 'Internal search error',
      message: error.message,
      code: error.code || 'NOTION_ERROR'
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

    // Get page metadata
    const page = await notion.pages.retrieve({ page_id: id });
    
    // Get page content
    const blocks = await notion.blocks.children.list({
      block_id: id,
      page_size: 100 // Get more content for individual page fetch
    });
    
    const textContent = extractTextFromBlocks(blocks.results);
    const title = extractPageTitle(page);
    
    const responseTime = Date.now() - startTime;
    
    res.json({
      document: {
        id: page.id,
        title: title,
        text: textContent || title || 'No content available',
        updated_at: page.last_edited_time,
        entities: extractEntitiesFromPage(page, textContent),
        url: page.url,
        database_id: page.parent?.database_id,
        created_time: page.created_time
      },
      response_time_ms: responseTime
    });
    
  } catch (error) {
    console.error('Notion document fetch error:', error);
    
    if (error.code === 'object_not_found') {
      return res.status(404).json({
        error: 'Document not found',
        id: req.params.id
      });
    }
    
    if (error.code === 'unauthorized') {
      return res.status(403).json({
        error: 'Access denied to document',
        id: req.params.id
      });
    }
    
    res.status(500).json({
      error: 'Internal fetch error',
      message: error.message,
      code: error.code || 'NOTION_ERROR'
    });
  }
});

// Helper functions
function extractTextFromBlocks(blocks) {
  let text = '';
  
  for (const block of blocks) {
    const blockText = extractTextFromBlock(block);
    if (blockText) {
      text += blockText + '\n';
    }
  }
  
  return text.trim();
}

function extractTextFromBlock(block) {
  switch (block.type) {
    case 'paragraph':
      return extractRichText(block.paragraph?.rich_text);
    case 'heading_1':
      return extractRichText(block.heading_1?.rich_text);
    case 'heading_2':
      return extractRichText(block.heading_2?.rich_text);
    case 'heading_3':
      return extractRichText(block.heading_3?.rich_text);
    case 'bulleted_list_item':
      return '• ' + extractRichText(block.bulleted_list_item?.rich_text);
    case 'numbered_list_item':
      return '• ' + extractRichText(block.numbered_list_item?.rich_text);
    case 'to_do':
      const checked = block.to_do?.checked ? '[x]' : '[ ]';
      return `${checked} ${extractRichText(block.to_do?.rich_text)}`;
    case 'quote':
      return '> ' + extractRichText(block.quote?.rich_text);
    case 'callout':
      return extractRichText(block.callout?.rich_text);
    case 'code':
      return '```\n' + extractRichText(block.code?.rich_text) + '\n```';
    default:
      return '';
  }
}

function extractRichText(richTextArray) {
  if (!richTextArray || !Array.isArray(richTextArray)) {
    return '';
  }
  
  return richTextArray
    .map(text => text.plain_text || '')
    .join('')
    .trim();
}

function extractPageTitle(page) {
  if (!page.properties) return '';
  
  // Find title property (can have different names)
  const titleProperty = Object.values(page.properties).find(
    prop => prop.type === 'title'
  );
  
  if (titleProperty?.title) {
    return extractRichText(titleProperty.title);
  }
  
  return '';
}

function extractEntitiesFromPage(page, textContent) {
  const entities = [];
  
  // Extract from page properties (tags, select, etc.)
  if (page.properties) {
    Object.values(page.properties).forEach(prop => {
      if (prop.type === 'multi_select' && prop.multi_select) {
        entities.push(...prop.multi_select.map(tag => tag.name));
      } else if (prop.type === 'select' && prop.select) {
        entities.push(prop.select.name);
      }
    });
  }
  
  // Simple keyword extraction from text
  if (textContent) {
    const keywords = textContent
      .toLowerCase()
      .split(/\W+/)
      .filter(word => word.length > 3)
      .slice(0, 10);
    entities.push(...keywords);
  }
  
  return entities.length > 0 ? [...new Set(entities)] : undefined;
}

module.exports = router;