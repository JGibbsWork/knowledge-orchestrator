# MoneyBag + Knowledge Orchestrator Integration

This document describes how to integrate MoneyBag with the Knowledge Orchestrator (KO) service to replace internal context assembly with intelligent knowledge retrieval and citation tracking.

## Quick Start

1. **Import the KO Client**:
```typescript
import { getContextPack, type ContextPackResult } from './src/adapters/ko.js';
```

2. **Replace Internal Context Assembly**:
```typescript
// OLD: Internal context assembly
const context = await assembleContextInternally(task);

// NEW: KO-powered context
const koResult = await getContextPack(task, {
  scope: ['domain', 'personal'],
  k: 10,
  allow_web: false,
  allow_private: true,
  agent_id: 'moneybag'
});
const context = koResult.context || '';
```

3. **Store Citations in Decision Records**:
```typescript
const decision = {
  id: generateId(),
  task,
  context: koResult.context,
  citations: koResult.citations, // ← Store KO citations
  reasoning,
  outcome,
  timestamp: new Date(),
  debug: {
    query_variants: koResult.query_variants,
    total_candidates: koResult.total_candidates,
    processing_time_ms: koResult.debug.total_ms
  }
};
```

## KO Client API

### `getContextPack(task, options)`

**Parameters:**
- `task` (string): The task or question to get context for
- `options` (optional):
  - `scope`: Array of scopes to search (['personal', 'domain', 'web'])
  - `k`: Number of results to return per scope (default: 10)
  - `allow_web`: Whether to allow web search (default: false)
  - `allow_private`: Whether to allow private content (default: false)
  - `agent_id`: Identifier for the requesting agent (default: 'moneybag-client')

**Returns:** `ContextPackResult` with:
- `context`: Compressed summary with inline citations
- `citations`: Array of citation objects with source mapping
- `query_variants`: LLM-generated query variations used
- `total_candidates`: Number of candidates found across all scopes
- `debug`: Timing and processing information

### Citation Format

```typescript
interface Citation {
  id: string;                    // e.g., "[1]", "[2]"
  source: {
    id: string;                  // Source document ID
    source: 'memory' | 'notion' | 'web';
    url?: string;                // URL if available
    source_id?: string;          // Source system ID
    title: string;               // Document title
  };
  snippet: string;               // Original text snippet
  used_in_context: boolean;      // Whether cited in context
}
```

## Configuration

### Environment Variables

Add to your `.env` file:
```env
# KO Service endpoint
KO_BASE_URL=http://localhost:3000

# Optional API key for authentication
KO_API_KEY=your-api-key-here
```

### MoneyBag Configuration

```typescript
const moneyBagConfig = {
  // Enable KO integration
  useKnowledgeOrchestrator: true,
  
  // Default scopes for different decision types
  koScopes: ['domain', 'personal'], // domain=Notion, personal=Memory
  
  // Performance settings
  contextBudget: 1500,  // Token budget for context
  timeout: 30000,       // Request timeout in ms
  
  // Access permissions
  allowWeb: false,      // Usually false for sensitive decisions
  allowPrivate: true,   // Access to private knowledge bases
};
```

## Integration Patterns

### 1. Basic Decision Making

```typescript
async function makeDecision(task: string): Promise<Decision> {
  // Get contextualized information from KO
  const koResult = await getContextPack(task, {
    scope: ['domain', 'personal'],
    k: 10,
    agent_id: 'moneybag'
  });

  // Apply decision logic with rich context
  const reasoning = generateReasoning(task, koResult.context);
  const outcome = determineOutcome(task, koResult.context, reasoning);
  const confidence = calculateConfidence(koResult.context, koResult.citations?.length || 0);

  // Create decision record with citations
  return {
    id: generateId(),
    task,
    context: koResult.context,
    reasoning,
    outcome,
    confidence,
    citations: koResult.citations,
    timestamp: new Date(),
    debug: {
      query_variants: koResult.query_variants,
      total_candidates: koResult.total_candidates,
      processing_time_ms: koResult.debug.total_ms,
      sources_used: extractSources(koResult.debug)
    }
  };
}
```

### 2. Scope-Based Decision Types

```typescript
async function makeDecisionWithScoping(task: string, decisionType: string) {
  let scope: ('personal' | 'domain' | 'web')[];
  
  switch (decisionType) {
    case 'TECHNICAL':
      scope = ['domain']; // Use company/team knowledge
      break;
    case 'STRATEGIC':
      scope = ['domain', 'personal']; // Company + personal insights
      break;
    case 'RESEARCH':
      scope = ['domain', 'personal', 'web']; // All sources
      break;
    default:
      scope = ['domain'];
  }

  return await getContextPack(task, {
    scope,
    allow_web: decisionType === 'RESEARCH',
    allow_private: decisionType !== 'PUBLIC',
    agent_id: `moneybag-${decisionType.toLowerCase()}`
  });
}
```

### 3. Error Handling & Fallbacks

```typescript
async function robustContextRetrieval(task: string) {
  try {
    // Try KO first
    return await getContextPack(task, { scope: ['domain', 'personal'] });
  } catch (error) {
    console.error('KO failed, falling back to internal context:', error);
    
    // Fallback to internal context assembly
    return {
      context: await assembleContextInternally(task),
      citations: [],
      query_variants: [task],
      total_candidates: 0,
      debug: { total_ms: 0 }
    };
  }
}
```

### 4. Citation Tracking & Audit Trail

```typescript
class MoneyBagAuditTrail {
  logDecisionWithCitations(decision: Decision) {
    console.log(`Decision: ${decision.outcome}`);
    console.log(`Confidence: ${decision.confidence}`);
    
    if (decision.citations?.length) {
      console.log(`Sources used:`);
      decision.citations.forEach(citation => {
        console.log(`  • ${citation.source.title} (${citation.source.source})`);
        if (citation.source.url) {
          console.log(`    URL: ${citation.source.url}`);
        }
      });
    }
  }

  getSourceBreakdown(decisions: Decision[]) {
    const breakdown: { [source: string]: number } = {};
    
    decisions.forEach(decision => {
      decision.citations?.forEach(citation => {
        const source = citation.source.source;
        breakdown[source] = (breakdown[source] || 0) + 1;
      });
    });
    
    return breakdown;
  }
}
```

## Performance Considerations

### Caching
- KO implements internal caching for repeated queries
- Consider caching `getContextPack` results at MoneyBag level for identical tasks
- Cache TTL should align with knowledge freshness requirements

### Timeout Handling
```typescript
const koResult = await Promise.race([
  getContextPack(task, options),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('KO timeout')), 30000)
  )
]);
```

### Batch Processing
```typescript
async function batchDecisions(tasks: string[]) {
  // Process in parallel but limit concurrency
  const results = await Promise.allSettled(
    tasks.map(task => getContextPack(task))
  );
  
  return results.map((result, i) => ({
    task: tasks[i],
    success: result.status === 'fulfilled',
    data: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? result.reason : null
  }));
}
```

## Testing

### Unit Tests
```typescript
import { jest } from '@jest/globals';
import * as koClient from '../src/adapters/ko.js';

// Mock KO client for testing
jest.mock('../src/adapters/ko.js', () => ({
  getContextPack: jest.fn().mockResolvedValue({
    context: 'Test context',
    citations: [],
    query_variants: ['test'],
    total_candidates: 1,
    debug: { total_ms: 100 }
  })
}));
```

### Integration Tests
```bash
# Start KO service
npm run dev

# Run MoneyBag integration tests
npm run test:integration
```

## Migration Guide

### Step 1: Add KO Client Dependency
```bash
# If moneyBag is separate project, copy ko.ts or install as package
cp src/adapters/ko.ts ../moneybag/src/clients/
```

### Step 2: Update Decision Interface
```typescript
interface Decision {
  // ... existing fields
  citations?: Citation[];         // ← Add citations
  debug?: {                      // ← Add debug info
    query_variants: string[];
    total_candidates: number;
    processing_time_ms: number;
    sources_used: string[];
  };
}
```

### Step 3: Replace Context Assembly
```typescript
// Replace all occurrences of internal context assembly
- const context = await this.assembleContext(task);
+ const koResult = await getContextPack(task, this.koOptions);
+ const context = koResult.context || '';
```

### Step 4: Update Storage Layer
```sql
-- Add citations column to decisions table
ALTER TABLE decisions 
ADD COLUMN citations JSON,
ADD COLUMN debug_info JSON;
```

## Acceptance Criteria ✅

- ✅ **MoneyBag calls KO**: `getContextPack()` replaces internal context assembly
- ✅ **Decisions store citations**: Citations with source mapping stored in decision records  
- ✅ **koClient.ts created**: Full-featured client with error handling and configuration
- ✅ **Integration example**: Complete working example in `examples/moneyBag-integration.ts`
- ✅ **Documentation**: Comprehensive integration guide with patterns and examples

## Example Output

When integrated correctly, MoneyBag decision records will include:

```json
{
  "id": "decision_1703123456789_abc123",
  "task": "Should we migrate to microservices architecture?",
  "context": "## Key Insights\n\n• Microservices provide better scalability and team autonomy [1]\n• Consider operational complexity and monitoring overhead [2]...",
  "citations": [
    {
      "id": "[1]",
      "source": {
        "id": "arch-guide-001",
        "source": "notion",
        "title": "Microservices Architecture Guide",
        "url": "https://company-wiki.notion.so/Microservices-123"
      },
      "snippet": "Microservices architecture enables independent deployment and scaling...",
      "used_in_context": true
    }
  ],
  "outcome": "PROCEED_WITH_CAUTION",
  "confidence": 0.85,
  "timestamp": "2024-01-15T10:30:00Z",
  "debug": {
    "query_variants": ["microservices architecture", "service decomposition", "distributed systems migration"],
    "total_candidates": 8,
    "processing_time_ms": 1250,
    "sources_used": ["notion", "memory"]
  }
}
```