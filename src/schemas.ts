import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const PackRequestSchema = z.object({
  content: z.string().min(1).openapi({
    description: 'Content to be packed',
    example: 'This is the content to pack'
  }),
  format: z.enum(['json', 'xml', 'text']).optional().default('json').openapi({
    description: 'Output format for packed content',
    example: 'json'
  }),
  metadata: z.record(z.string()).optional().openapi({
    description: 'Additional metadata for the content',
    example: { source: 'user-input', priority: 'high' }
  })
}).openapi({
  description: 'Request schema for packing content'
});

export const PackResponseSchema = z.object({
  id: z.string().openapi({
    description: 'Unique identifier for the packed content',
    example: 'pack_12345'
  }),
  status: z.enum(['success', 'error']).openapi({
    description: 'Status of the pack operation',
    example: 'success'
  }),
  packed_content: z.string().openapi({
    description: 'The packed content',
    example: 'eyJjb250ZW50IjoiVGhpcyBpcyB0aGUgY29udGVudCB0byBwYWNrIn0='
  }),
  size: z.number().openapi({
    description: 'Size of the packed content in bytes',
    example: 1024
  })
}).openapi({
  description: 'Response schema for pack operation'
});

export const WebSearchRequestSchema = z.object({
  query: z.string().min(1).openapi({
    description: 'Search query string',
    example: 'artificial intelligence trends 2024'
  }),
  max_results: z.number().min(1).max(100).optional().default(10).openapi({
    description: 'Maximum number of search results to return',
    example: 10
  }),
  filters: z.object({
    date_range: z.enum(['day', 'week', 'month', 'year', 'all']).optional().openapi({
      description: 'Filter results by date range',
      example: 'month'
    }),
    language: z.string().length(2).optional().openapi({
      description: 'Language code for search results',
      example: 'en'
    }),
    domain: z.string().optional().openapi({
      description: 'Restrict search to specific domain',
      example: 'example.com'
    })
  }).optional().openapi({
    description: 'Search filters'
  })
}).openapi({
  description: 'Request schema for web search'
});

export const WebSearchResponseSchema = z.object({
  query: z.string().openapi({
    description: 'Original search query',
    example: 'artificial intelligence trends 2024'
  }),
  total_results: z.number().openapi({
    description: 'Total number of results found',
    example: 1500
  }),
  results: z.array(z.object({
    title: z.string().openapi({
      description: 'Title of the search result',
      example: 'AI Trends to Watch in 2024'
    }),
    url: z.string().url().openapi({
      description: 'URL of the search result',
      example: 'https://example.com/ai-trends-2024'
    }),
    snippet: z.string().openapi({
      description: 'Brief snippet of the content',
      example: 'Artificial intelligence continues to evolve rapidly...'
    }),
    domain: z.string().openapi({
      description: 'Domain of the result',
      example: 'example.com'
    }),
    published_date: z.string().optional().openapi({
      description: 'Publication date if available',
      example: '2024-01-15T10:30:00Z'
    })
  })).openapi({
    description: 'Array of search results'
  })
}).openapi({
  description: 'Response schema for web search'
});

export const IngestUpstreamRequestSchema = z.object({
  source: z.enum(['memory', 'notion']).openapi({
    description: 'Source system to ingest from',
    example: 'memory'
  }),
  id: z.string().min(1).openapi({
    description: 'Document ID in the source system',
    example: 'doc_123456'
  }),
  scope: z.string().optional().openapi({
    description: 'Optional scope for organizing chunks',
    example: 'project_alpha'
  })
}).openapi({
  description: 'Request schema for upstream document ingestion'
});

export const IngestUpstreamResponseSchema = z.object({
  source: z.enum(['memory', 'notion']).openapi({
    description: 'Source system that was ingested from',
    example: 'memory'
  }),
  id: z.string().openapi({
    description: 'Document ID that was ingested',
    example: 'doc_123456'
  }),
  status: z.enum(['success', 'no_change', 'error']).openapi({
    description: 'Status of the ingestion operation',
    example: 'success'
  }),
  chunks_created: z.number().openapi({
    description: 'Number of chunks created from the document',
    example: 15
  }),
  chunks_updated: z.number().openapi({
    description: 'Number of existing chunks that were updated',
    example: 3
  }),
  total_tokens: z.number().openapi({
    description: 'Total token count across all chunks',
    example: 12500
  }),
  updated_at: z.string().openapi({
    description: 'Last update timestamp from the source document',
    example: '2024-01-15T10:30:00Z'
  }),
  message: z.string().optional().openapi({
    description: 'Additional status message',
    example: 'Document successfully ingested and chunked'
  }),
  error: z.string().optional().openapi({
    description: 'Error message if status is error',
    example: 'Document not found in source system'
  })
}).openapi({
  description: 'Response schema for upstream document ingestion'
});

export const ErrorResponseSchema = z.object({
  error: z.string().openapi({
    description: 'Error message',
    example: 'Invalid request parameters'
  }),
  code: z.string().openapi({
    description: 'Error code',
    example: 'VALIDATION_ERROR'
  }),
  details: z.record(z.any()).optional().openapi({
    description: 'Additional error details',
    example: { field: 'content', message: 'Content cannot be empty' }
  })
}).openapi({
  description: 'Error response schema'
});

export type PackRequest = z.infer<typeof PackRequestSchema>;
export type PackResponse = z.infer<typeof PackResponseSchema>;
export type WebSearchRequest = z.infer<typeof WebSearchRequestSchema>;
export type WebSearchResponse = z.infer<typeof WebSearchResponseSchema>;
export type IngestUpstreamRequest = z.infer<typeof IngestUpstreamRequestSchema>;
export type IngestUpstreamResponse = z.infer<typeof IngestUpstreamResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;