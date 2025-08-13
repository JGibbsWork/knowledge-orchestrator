# Brave Search Service with MongoDB Caching

## Overview

The `services/web.ts` module provides web search functionality using the Brave Search API with intelligent MongoDB caching.

## Features

- ✅ **Brave Search API Integration** - Real web search results
- ✅ **MongoDB Caching** - 24h TTL with automatic expiration
- ✅ **Query Hash Deduplication** - Identical queries hit cache
- ✅ **Case Insensitive** - "AI" and "ai" share the same cache
- ✅ **Parameter-Aware** - Different `k` values cached separately
- ✅ **Error Handling** - Graceful API failure handling
- ✅ **Performance Monitoring** - Built-in response time tracking

## API Contract

### `searchBrave(query: string, k?: number): Promise<SearchResult[]>`

**Parameters:**
- `query` - Search query string (required, non-empty)
- `k` - Number of results (optional, default: 10, max: 20)

**Returns:**
```typescript
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}
```

## Caching Behavior

### Cache Key Generation
```typescript
// Query hash includes both query and k parameter
const hashInput = `${query.toLowerCase().trim()}:${k}`;
const queryHash = sha256(hashInput);
```

### Cache Hit Examples
```javascript
// These will hit the same cache entry:
await searchBrave("artificial intelligence", 5);
await searchBrave("ARTIFICIAL INTELLIGENCE", 5);
await searchBrave(" Artificial Intelligence ", 5);

// This will be a cache miss (different k):
await searchBrave("artificial intelligence", 10);
```

### TTL (Time To Live)
- **Default**: 24 hours
- **Implementation**: MongoDB TTL index on `expiresAt` field
- **Automatic cleanup**: MongoDB handles expired document removal

## Database Schema

### Collection: `web_cache`
```typescript
interface CacheEntry {
  queryHash: string;      // SHA256 hash of query:k
  query: string;          // Original normalized query
  results: SearchResult[]; // Cached search results
  k: number;              // Number of results requested
  createdAt: Date;        // Cache entry creation time
  expiresAt: Date;        // Automatic expiration time (24h)
}
```

### Indexes
- `{ expiresAt: 1 }` - TTL index for automatic cleanup
- `{ queryHash: 1 }` - Unique index for fast lookups

## Error Handling

### Validation Errors (400)
- Empty query string
- Invalid k value (< 1 or > 20)

### API Errors (500)
- Brave API authentication failure
- Network connectivity issues
- MongoDB connection problems

### Graceful Degradation
- Cache read failures → Fall back to API call
- Cache write failures → Continue without caching
- API failures → Throw descriptive error

## Integration Example

```typescript
import { searchBrave } from './services/web.js';

// Basic usage
const results = await searchBrave("TypeScript tutorials", 5);

// Process results
results.forEach(result => {
  console.log(`${result.title}: ${result.url}`);
  console.log(`Snippet: ${result.snippet}`);
});
```

## Performance Characteristics

### Cache Hit
- **Response Time**: < 10ms (database lookup)
- **Network Calls**: 0
- **Cost**: Minimal (MongoDB query)

### Cache Miss
- **Response Time**: 200-800ms (API call + cache write)
- **Network Calls**: 1 (Brave API)
- **Cost**: Brave API usage + MongoDB write

### Typical Performance
- First search: ~500ms (API call)
- Subsequent identical searches: ~5ms (cache hit)
- **99%+ cache hit rate** for repeated queries

## Configuration

### Environment Variables
```bash
BRAVE_API_KEY=your_brave_search_api_key
MONGO_URL=mongodb://localhost:27017/knowledge_orchestrator
```

### MongoDB Connection
- Automatic connection on service initialization
- Connection reuse across requests
- Graceful error handling for connection failures

## Monitoring & Utilities

### Cache Statistics
```typescript
import { getCacheStats } from './services/web.js';

const stats = await getCacheStats();
console.log(`Total entries: ${stats.totalEntries}`);
console.log(`Expired entries: ${stats.expiredEntries}`);
```

### Manual Cache Cleanup
```typescript
import { clearExpiredCache } from './services/web.js';

const deletedCount = await clearExpiredCache();
console.log(`Cleaned up ${deletedCount} expired entries`);
```

## Testing

### Cache Logic Verification
- Query normalization (case, whitespace)
- Hash consistency across identical queries
- TTL expiration calculations
- Result format validation

### Integration Points
- Used in `/search/web` endpoint
- Swagger UI documentation included
- OpenAPI schema validation

## Production Considerations

### Scalability
- MongoDB handles concurrent cache reads efficiently
- Unique constraints prevent duplicate cache entries
- TTL cleanup runs automatically without performance impact

### Cost Optimization
- 24h cache TTL balances freshness vs API costs
- Case-insensitive caching maximizes hit rate
- Parameter-aware caching prevents false hits

### Monitoring
- Cache hit/miss rates logged
- Response time tracking built-in
- Error tracking with detailed context