import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const PackRequestSchema = z.object({
  agent_id: z.string().min(1).openapi({
    description: 'Unique identifier for the agent making the request',
    example: 'agent_12345'
  }),
  task: z.string().min(1).openapi({
    description: 'Task description or query to process',
    example: 'Find information about TypeScript best practices'
  }),
  scope: z.array(z.enum(['personal', 'domain', 'web'])).optional().default(['domain']).openapi({
    description: 'Scopes to search in - personal (Memory), domain (Notion), web (Brave)',
    example: ['personal', 'domain']
  }),
  k: z.number().min(1).max(50).optional().default(10).openapi({
    description: 'Number of results to return per scope',
    example: 10
  }),
  allow_web: z.boolean().optional().default(false).openapi({
    description: 'Whether to allow web search (required for web scope)',
    example: true
  }),
  allow_private: z.boolean().optional().openapi({
    description: 'Whether to allow access to private/personal content',
    example: false
  })
}).openapi({
  description: 'Request schema for intelligent content packing with query rewrite'
});

export const PackResponseSchema = z.object({
  agent_id: z.string().openapi({
    description: 'Agent ID from the request',
    example: 'agent_12345'
  }),
  task: z.string().openapi({
    description: 'Original task from request',
    example: 'Find information about TypeScript best practices'
  }),
  query_variants: z.array(z.string()).openapi({
    description: 'Generated query variations for improved retrieval',
    example: ['TypeScript best practices', 'TypeScript coding standards', 'TypeScript development guidelines']
  }),
  candidates: z.object({
    personal: z.array(z.object({
      id: z.string(),
      title: z.string(),
      snippet: z.string(),
      score: z.number().optional(),
      source: z.literal('memory'),
      vectorScore: z.number().optional(),
      textScore: z.number().optional(),
      rrfScore: z.number().optional()
    })).optional().openapi({
      description: 'Results from personal/memory scope'
    }),
    domain: z.array(z.object({
      id: z.string(),
      title: z.string(),
      snippet: z.string(),
      score: z.number().optional(),
      source: z.literal('notion'),
      vectorScore: z.number().optional(),
      textScore: z.number().optional(),
      rrfScore: z.number().optional()
    })).optional().openapi({
      description: 'Results from domain/notion scope'
    }),
    web: z.array(z.object({
      id: z.string(),
      title: z.string(),
      snippet: z.string(),
      url: z.string(),
      score: z.number().optional(),
      source: z.literal('web'),
      vectorScore: z.number().optional(),
      textScore: z.number().optional(),
      rrfScore: z.number().optional()
    })).optional().openapi({
      description: 'Results from web scope'
    })
  }).openapi({
    description: 'Retrieved candidates organized by scope'
  }),
  context: z.string().optional().openapi({
    description: 'Compressed summary of all candidates with inline citations',
    example: '## Key Insights\n\n• TypeScript provides strong typing for JavaScript development [1] [2]\n• Best practices include strict configuration and consistent patterns [3]'
  }),
  citations: z.array(z.object({
    id: z.string(),
    source: z.object({
      id: z.string(),
      source: z.enum(['memory', 'notion', 'web']),
      url: z.string().optional(),
      source_id: z.string().optional(),
      title: z.string()
    }),
    snippet: z.string(),
    used_in_context: z.boolean()
  })).optional().openapi({
    description: 'Citations referenced in the context summary'
  }),
  debug: z.object({
    query_generation_ms: z.number(),
    personal_retrieval_ms: z.number().optional(),
    domain_retrieval_ms: z.number().optional(),
    web_retrieval_ms: z.number().optional(),
    ranking_ms: z.number().optional(),
    compression_ms: z.number().optional(),
    total_ms: z.number(),
    ingested_documents: z.array(z.string()).optional(),
    compression_stats: z.object({
      input_chunks: z.number(),
      input_tokens: z.number(),
      output_tokens: z.number(),
      compression_ratio: z.number(),
      citations_used: z.number()
    }).optional()
  }).openapi({
    description: 'Debug timing information and compression statistics'
  }),
  total_candidates: z.number().openapi({
    description: 'Total number of candidates returned across all scopes',
    example: 25
  })
}).openapi({
  description: 'Response schema for intelligent content packing with compression'
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