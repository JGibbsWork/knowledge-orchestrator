# Pull Request Templates

## Memory Layer Repository PR

### Title
`feat: Add search endpoints for knowledge orchestrator integration`

### Description
```markdown
## Summary
Adds REST API endpoints for searching and fetching documents to support integration with the knowledge orchestrator service.

## Changes
- ✅ **POST /search** - Vector search endpoint with configurable result limit
- ✅ **GET /doc/:id** - Document retrieval by ID
- ✅ Request validation middleware
- ✅ Performance optimization for <300ms response times
- ✅ Comprehensive unit tests
- ✅ Error handling with proper HTTP status codes

## API Contract
- **POST /search**: `{query: string, k?: number}` → `{results: UpstreamHit[], total: number}`
- **GET /doc/:id**: Returns document with metadata and content
- **Performance**: <300ms for k≤10, <500ms for k≤50

## Testing
- [x] Unit tests for both endpoints
- [x] Request validation tests
- [x] Error handling tests
- [x] Performance benchmarks
- [x] Integration tests

## Breaking Changes
None - these are new endpoints only.

## Performance Impact
- Optimized search queries with result limits
- Added response time tracking
- Memory usage optimized for concurrent requests

## Dependencies
No new dependencies required.
```

### Files Changed
- `routes/search.js` (new)
- `tests/search.test.js` (new)
- `app.js` (route registration)
- `package.json` (test scripts if needed)

---

## Notion Service Repository PR

### Title
`feat: Add generic search endpoints for Notion pages`

### Description
```markdown
## Summary
Exposes generic search and document retrieval endpoints over Notion pages to support integration with external services. Keeps implementation generic and not finance-specific.

## Changes
- ✅ **POST /search** - Search across Notion pages with optional database filtering
- ✅ **GET /doc/:id** - Retrieve specific Notion page with full content
- ✅ Pagination support with cursor-based navigation
- ✅ Content extraction from multiple block types
- ✅ Entity extraction from page properties and content
- ✅ Comprehensive unit tests with mocked Notion API

## API Contract
- **POST /search**: Supports `query`, `k`, `database_id`, pagination parameters
- **GET /doc/:id**: Returns full page content with metadata
- **Performance**: <300ms response times for typical workloads
- **Pagination**: Cursor-based with `has_more`/`next_cursor` fields

## Features
- 🔍 **Smart Content Extraction**: Handles paragraphs, headings, lists, todos, code blocks
- 🏷️ **Entity Detection**: Extracts from page tags, properties, and content keywords  
- 📄 **Database Filtering**: Optional filtering by specific Notion databases
- 🚀 **Performance Optimized**: Concurrent block fetching with graceful fallbacks
- 📖 **Pagination Ready**: Full cursor-based pagination support

## Testing
- [x] Unit tests for search and fetch endpoints
- [x] Notion API mock tests
- [x] Error handling (unauthorized, not found, API errors)
- [x] Performance benchmarks
- [x] Content extraction tests for various block types
- [x] Pagination functionality tests

## Security
- Respects Notion workspace permissions
- Handles unauthorized access gracefully
- No sensitive data exposed in error messages

## Breaking Changes
None - these are new endpoints only.

## Performance Considerations
- Concurrent block content fetching
- Graceful degradation when block access fails
- Response time tracking and optimization
```

### Files Changed
- `routes/search.js` (new)
- `tests/search.test.js` (new)
- `app.js` (route registration)
- `package.json` (add @notionhq/client if not present)

---

## Shared Implementation Checklist

### For Both PRs

#### Code Quality
- [ ] TypeScript/JSDoc documentation
- [ ] ESLint/Prettier compliance
- [ ] Error handling with proper HTTP status codes
- [ ] Input validation and sanitization
- [ ] Response time tracking

#### Testing
- [ ] Unit tests with >90% coverage
- [ ] Integration tests
- [ ] Performance benchmarks
- [ ] Error scenario testing
- [ ] Concurrent request testing

#### Documentation
- [ ] API documentation/OpenAPI spec
- [ ] README updates if needed
- [ ] Inline code comments
- [ ] Example usage

#### Performance
- [ ] Response times <300ms for k≤10
- [ ] Memory usage optimization
- [ ] Proper error boundaries
- [ ] Graceful degradation

#### Security
- [ ] Input validation/sanitization
- [ ] Authentication handling
- [ ] No sensitive data in logs/errors
- [ ] Proper CORS configuration if needed

---

## Review Guidelines

### Memory Layer Review Focus
1. **Vector Search Integration**: Ensure proper use of existing search infrastructure
2. **Performance**: Verify indexing strategy supports sub-300ms response times
3. **Entity Extraction**: Review NLP pipeline integration or fallback implementation
4. **Caching Strategy**: Consider document caching for frequently accessed items

### Notion Service Review Focus
1. **Notion API Usage**: Verify efficient API call patterns and rate limiting
2. **Content Extraction**: Review robustness across different Notion block types
3. **Permission Handling**: Ensure proper workspace/database permission respect
4. **Pagination**: Verify cursor-based pagination correctness
5. **Error Handling**: Review Notion-specific error scenarios (unauthorized, not found, rate limits)

### Common Review Points
1. **API Contract Compliance**: Exact adherence to specified response shapes
2. **Error Response Consistency**: Standardized error format across both services
3. **Test Coverage**: Comprehensive testing of happy path and edge cases
4. **Performance Monitoring**: Response time tracking and optimization
5. **Documentation**: Clear API documentation and usage examples