import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import {
  PackRequestSchema,
  PackResponseSchema,
  WebSearchRequestSchema,
  WebSearchResponseSchema,
  IngestUpstreamRequestSchema,
  IngestUpstreamResponseSchema,
  ErrorResponseSchema
} from './schemas.js';

const registry = new OpenAPIRegistry();

registry.registerPath({
  method: 'post',
  path: '/pack',
  description: 'Pack content into a compressed format',
  summary: 'Pack content',
  tags: ['Content'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: PackRequestSchema
        }
      },
      required: true
    }
  },
  responses: {
    200: {
      description: 'Content packed successfully',
      content: {
        'application/json': {
          schema: PackResponseSchema
        }
      }
    },
    400: {
      description: 'Bad request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/search/web',
  description: 'Search the web for content based on query',
  summary: 'Web search',
  tags: ['Search'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: WebSearchRequestSchema
        }
      },
      required: true
    }
  },
  responses: {
    200: {
      description: 'Search completed successfully',
      content: {
        'application/json': {
          schema: WebSearchResponseSchema
        }
      }
    },
    400: {
      description: 'Bad request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

registry.registerPath({
  method: 'post',
  path: '/ingest/upstream',
  description: 'Ingest data from an upstream source',
  summary: 'Ingest upstream data',
  tags: ['Ingestion'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: IngestUpstreamRequestSchema
        }
      },
      required: true
    }
  },
  responses: {
    200: {
      description: 'Ingestion started successfully',
      content: {
        'application/json': {
          schema: IngestUpstreamResponseSchema
        }
      }
    },
    400: {
      description: 'Bad request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiDocument: any = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Knowledge Orchestrator API',
    description: 'API for content packing, web search, and upstream data ingestion',
    contact: {
      name: 'API Support',
      url: 'https://example.com/support',
      email: 'support@example.com'
    }
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development server'
    }
  ],
  tags: [
    { name: 'Content', description: 'Content processing operations' },
    { name: 'Search', description: 'Search operations' },
    { name: 'Ingestion', description: 'Data ingestion operations' }
  ]
});