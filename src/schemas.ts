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
  source_url: z.string().url().openapi({
    description: 'URL of the upstream source to ingest',
    example: 'https://api.example.com/data'
  }),
  auth: z.object({
    type: z.enum(['none', 'bearer', 'basic', 'api_key']).openapi({
      description: 'Authentication type',
      example: 'bearer'
    }),
    token: z.string().optional().openapi({
      description: 'Authentication token (for bearer/api_key)',
      example: 'abc123def456'
    }),
    username: z.string().optional().openapi({
      description: 'Username (for basic auth)',
      example: 'user'
    }),
    password: z.string().optional().openapi({
      description: 'Password (for basic auth)',
      example: 'password'
    })
  }).optional().openapi({
    description: 'Authentication configuration'
  }),
  transform: z.object({
    format: z.enum(['json', 'xml', 'csv', 'text']).optional().openapi({
      description: 'Expected format of source data',
      example: 'json'
    }),
    mapping: z.record(z.string()).optional().openapi({
      description: 'Field mapping configuration',
      example: { 'source_field': 'target_field' }
    })
  }).optional().openapi({
    description: 'Data transformation configuration'
  })
}).openapi({
  description: 'Request schema for upstream ingestion'
});

export const IngestUpstreamResponseSchema = z.object({
  job_id: z.string().openapi({
    description: 'Unique identifier for the ingestion job',
    example: 'ingest_789123'
  }),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).openapi({
    description: 'Status of the ingestion job',
    example: 'in_progress'
  }),
  source_url: z.string().url().openapi({
    description: 'URL of the ingested source',
    example: 'https://api.example.com/data'
  }),
  records_processed: z.number().openapi({
    description: 'Number of records processed',
    example: 1250
  }),
  errors: z.array(z.string()).optional().openapi({
    description: 'Array of error messages if any',
    example: ['Failed to parse record 123', 'Authentication expired']
  }),
  created_at: z.string().openapi({
    description: 'Job creation timestamp',
    example: '2024-01-15T10:30:00Z'
  })
}).openapi({
  description: 'Response schema for upstream ingestion'
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