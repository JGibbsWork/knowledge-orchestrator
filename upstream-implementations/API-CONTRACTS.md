# API Contracts for Upstream Services

This document defines the API contracts that need to be implemented in both the Memory Layer and Notion Service repositories.

## Common Requirements

- **Performance**: Both endpoints must respond within **300ms** for small k values (k ≤ 10)
- **Error Handling**: Consistent error response format with proper HTTP status codes
- **Authentication**: Bearer token authentication using service-specific tokens
- **Content-Type**: All requests/responses use `application/json`

## Memory Layer Service

### POST /search

**Request:**
```json
{
  "query": "string (required, non-empty)",
  "k": "number (optional, default: 10, range: 1-100)"
}
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "string (unique document identifier)",
      "text": "string (document content)",
      "updated_at": "string (ISO 8601 timestamp)",
      "entities": ["string"] | undefined,
      "url": "string (source URL)" | undefined
    }
  ],
  "total": "number (total matching results)",
  "query": "string (original query)",
  "response_time_ms": "number (processing time)"
}
```

### GET /doc/:id

**Response (200 OK):**
```json
{
  "document": {
    "id": "string",
    "title": "string" | undefined,
    "text": "string",
    "updated_at": "string (ISO 8601 timestamp)",
    "entities": ["string"] | undefined,
    "url": "string" | undefined
  },
  "response_time_ms": "number"
}
```

**Error Responses:**
- `400`: Invalid request parameters
- `404`: Document not found
- `500`: Internal server error

---

## Notion Service

### POST /search

**Request:**
```json
{
  "query": "string (required, non-empty)",
  "k": "number (optional, default: 10, range: 1-100)",
  "database_id": "string (optional, filter by specific database)",
  "page_size": "number (optional, pagination size, default: k, max: 100)",
  "start_cursor": "string (optional, pagination cursor)"
}
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "string (Notion page ID)",
      "text": "string (extracted page content)",
      "updated_at": "string (ISO 8601 timestamp)",
      "entities": ["string"] | undefined,
      "url": "string (Notion page URL)"
    }
  ],
  "total": "number (results in current page)",
  "query": "string (original query)",
  "has_more": "boolean (pagination indicator)",
  "next_cursor": "string | null (next page cursor)",
  "response_time_ms": "number"
}
```

### GET /doc/:id

**Response (200 OK):**
```json
{
  "document": {
    "id": "string",
    "title": "string (page title)",
    "text": "string (full page content)",
    "updated_at": "string (ISO 8601 timestamp)",
    "entities": ["string"] | undefined,
    "url": "string (Notion page URL)",
    "database_id": "string (parent database)" | undefined,
    "created_time": "string (ISO 8601 timestamp)"
  },
  "response_time_ms": "number"
}
```

**Error Responses:**
- `400`: Invalid request parameters
- `403`: Access denied (insufficient Notion permissions)
- `404`: Page not found
- `500`: Internal server error

---

## Implementation Notes

### Memory Layer
- Use existing vector search/similarity search functionality
- Extract entities using your current NLP pipeline or simple keyword extraction
- Implement proper indexing for sub-300ms response times
- Cache frequently accessed documents

### Notion Service
- Use `@notionhq/client` SDK for Notion API integration
- Handle Notion API rate limits appropriately
- Extract text from various block types (paragraphs, headings, lists, etc.)
- Extract entities from page properties (tags, select fields) and content
- Implement pagination using Notion's cursor-based pagination
- Handle workspace permissions gracefully

### Shared Patterns
- Use middleware for request validation
- Implement response time tracking
- Log errors with sufficient detail for debugging
- Return consistent error response format:
  ```json
  {
    "error": "string (human-readable message)",
    "message": "string (detailed error info)",
    "code": "string (error code)" | undefined
  }
  ```

---

## Testing Requirements

### Unit Tests
- Request validation (required fields, data types, ranges)
- Response format validation
- Error handling scenarios
- Performance benchmarks (< 300ms for k ≤ 10)
- Pagination functionality (Notion only)
- Database filtering (Notion only)

### Integration Tests
- End-to-end search and fetch workflows
- Concurrent request handling
- Large result set handling
- Authentication/authorization flows

---

## Performance Benchmarks

Both services should meet these performance criteria:

| Operation | k value | Target Response Time |
|-----------|---------|---------------------|
| Search    | 1-10    | < 300ms            |
| Search    | 11-50   | < 500ms            |
| Search    | 51-100  | < 1000ms           |
| Fetch     | Any     | < 300ms            |

Response times are measured from request receipt to response completion, excluding network latency.