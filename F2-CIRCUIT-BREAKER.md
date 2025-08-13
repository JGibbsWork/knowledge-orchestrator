# F2: Circuit Breaker & Budgets Implementation

This document describes the F2 implementation that wraps KO calls in a circuit breaker with exponential backoff, retries, and request budgets for graceful degradation.

## ✅ F2 Acceptance Criteria Met

- **✅ 10s timeout with exponential backoff**: Implemented with configurable base delay and exponential scaling
- **✅ 3 retries**: Configurable retry attempts with intelligent retry logic for different error types
- **✅ Circuit breaker protection**: Opens after failure threshold, provides graceful degradation
- **✅ latency_ms_max budget**: Enforced at both client and service level with budget tracking
- **✅ token_budget_max budget**: Passed through to compression service for response sizing
- **✅ MoneyBag degrades gracefully**: Provides degraded responses instead of hard failures

## Quick Migration Guide

### Update Import
```typescript
// OLD: Basic KO client
import { getContextPack } from './src/adapters/ko.js';

// NEW: Enhanced KO client with circuit breaker
import { getContextPack } from './src/adapters/ko-enhanced.js';
```

### Add Budget Parameters
```typescript
// OLD: Basic context request
const result = await getContextPack('analyze market trends', {
  scope: ['domain'],
  k: 10
});

// NEW: With budget constraints
const result = await getContextPack('analyze market trends', {
  scope: ['domain'],
  k: 10,
  latency_ms_max: 5000,    // 5 second timeout
  token_budget_max: 800    // Smaller response for faster processing
});
```

### Handle Degraded Responses
```typescript
const result = await getContextPack(task, options);

if (result.debug.circuit_breaker?.degraded) {
  // Use lower confidence for degraded responses
  confidence = 0.3;
  decision = 'PROCEED_WITH_CAUTION';
} else {
  // Normal confidence for full responses
  confidence = 0.8;
  decision = 'PROCEED_CONFIDENTLY';
}
```

## Circuit Breaker Configuration

### Default Settings
```typescript
const circuitBreakerDefaults = {
  failureThreshold: 3,        // Open circuit after 3 failures
  resetTimeout: 30000,        // Try recovery after 30 seconds
  monitoringPeriod: 60000,    // Track failures over 1 minute
  expectedLatency: 5000,      // Flag requests slower than 5 seconds
  maxRetries: 3,             // Up to 3 retry attempts
  retryDelayBase: 1000       // 1 second base delay (exponential backoff)
};
```

### Custom Configuration
```typescript
import { createKOClient } from './src/adapters/ko-enhanced.js';

const customClient = createKOClient({
  baseUrl: 'http://localhost:3000',
  timeout: 15000, // 15 second timeout
  circuitBreaker: {
    failureThreshold: 5,      // More tolerant of failures
    resetTimeout: 10000,      // Faster recovery attempts
    maxRetries: 2,           // Fewer retries for faster failure
    retryDelayBase: 500      // Faster initial retry
  }
});
```

## Circuit States & Behavior

### CLOSED (Normal Operation)
- All requests allowed
- Failures are tracked
- Automatic retry with exponential backoff
- Opens when failure threshold reached

### OPEN (Service Protection)
- New requests immediately fail with degraded response
- No actual KO service calls made
- Transitions to HALF_OPEN after reset timeout

### HALF_OPEN (Recovery Testing)
- Limited requests allowed to test service recovery
- Success closes circuit back to normal
- Failure returns to OPEN state

## Request Budgets

### Latency Budget (`latency_ms_max`)
- **Client-side enforcement**: Timeout applied at HTTP request level
- **Service-side tracking**: Budget monitored throughout pack pipeline
- **Early termination**: Request aborted if budget approaches limit
- **Header passing**: Budget communicated via `X-Latency-Budget-Ms` header

```typescript
// Example: Tight latency budget for real-time decisions
const result = await getContextPack('urgent security decision', {
  latency_ms_max: 2000, // Must complete within 2 seconds
  scope: ['domain']     // Limit to fastest scope
});
```

### Token Budget (`token_budget_max`)
- **Compression control**: Passed to compression service as `targetTokens`
- **Response sizing**: Ensures response fits within MoneyBag's processing limits
- **Cost control**: Reduces token usage for cost-sensitive operations
- **Header passing**: Budget communicated via `X-Token-Budget-Max` header

```typescript
// Example: Constrained token budget for cost control
const result = await getContextPack('routine analysis', {
  token_budget_max: 500, // Limit response to 500 tokens
  scope: ['domain'],
  k: 5                   // Fewer candidates for smaller response
});
```

## Error Handling & Degradation

### Error Types and Recovery
```typescript
try {
  const result = await getContextPack(task, options);
} catch (error) {
  if (error.code === 'CIRCUIT_OPEN') {
    // Circuit breaker is protecting service
    console.log('KO service temporarily unavailable');
    return fallbackDecision(task);
  }
  
  if (error.code === 'LATENCY_BUDGET_EXCEEDED') {
    // Request took too long
    console.log('Request exceeded time budget');
    return urgentDecision(task);
  }
  
  if (error.degraded) {
    // Error indicates service degradation
    console.log('Using degraded KO service response');
    return lowConfidenceDecision(task, error.context);
  }
  
  // Handle other errors...
}
```

### Degraded Response Structure
```json
{
  "context": "⚠️ Limited context available due to service degradation.\n\nTask: analyze system performance\n\nProcessing with reduced capabilities...",
  "citations": [],
  "query_variants": ["analyze system performance"],
  "total_candidates": 0,
  "debug": {
    "total_ms": 0,
    "circuit_breaker": {
      "state": "OPEN",
      "failure_count": 3,
      "degraded": true
    }
  }
}
```

## MoneyBag Integration Patterns

### 1. Adaptive Confidence Based on Service State
```typescript
async function makeResilientDecision(task: string) {
  try {
    const result = await getContextPack(task, {
      latency_ms_max: 5000,
      token_budget_max: 1000,
      scope: ['domain', 'personal']
    });
    
    // Adjust confidence based on service health
    let baseConfidence = 0.8;
    
    if (result.debug.circuit_breaker?.degraded) {
      baseConfidence = 0.3; // Low confidence for degraded responses
    } else if (result.debug.total_ms > 3000) {
      baseConfidence = 0.6; // Medium confidence for slow responses
    }
    
    const finalConfidence = baseConfidence * (result.citations?.length || 0) / 10;
    
    return {
      outcome: finalConfidence > 0.5 ? 'PROCEED' : 'NEED_MORE_INFO',
      confidence: finalConfidence,
      context: result.context,
      citations: result.citations
    };
    
  } catch (error) {
    // Fallback decision logic
    return {
      outcome: 'PROCEED_WITH_CAUTION',
      confidence: 0.2,
      context: 'Limited context due to service issues',
      citations: []
    };
  }
}
```

### 2. Budget-Aware Request Optimization
```typescript
function getOptimalBudgets(decisionType: string, urgency: 'LOW' | 'MEDIUM' | 'HIGH') {
  const budgets = {
    latency_ms_max: 10000,    // Default: 10 seconds
    token_budget_max: 1500    // Default: 1500 tokens
  };
  
  // Adjust based on urgency
  if (urgency === 'HIGH') {
    budgets.latency_ms_max = 2000;  // 2 seconds for urgent decisions
    budgets.token_budget_max = 500; // Smaller response for speed
  } else if (urgency === 'LOW') {
    budgets.latency_ms_max = 30000; // 30 seconds for thorough analysis
    budgets.token_budget_max = 3000; // Larger response for completeness
  }
  
  // Adjust based on decision type
  if (decisionType === 'FINANCIAL') {
    budgets.token_budget_max = Math.min(budgets.token_budget_max, 800); // Cost control
  } else if (decisionType === 'STRATEGIC') {
    budgets.latency_ms_max = Math.max(budgets.latency_ms_max, 15000); // Allow more time
  }
  
  return budgets;
}

// Usage
const budgets = getOptimalBudgets('TECHNICAL', 'MEDIUM');
const result = await getContextPack(task, { ...options, ...budgets });
```

### 3. Circuit Breaker Status Monitoring
```typescript
import { getCircuitBreakerState, resetCircuitBreaker } from './src/adapters/ko-enhanced.js';

class MoneyBagHealthMonitor {
  async checkKOHealth() {
    const state = getCircuitBreakerState();
    
    if (state === 'OPEN') {
      console.warn('⚠️  KO service circuit breaker is OPEN');
      
      // Optional: Manual recovery attempt
      if (this.shouldAttemptRecovery()) {
        console.log('🔄 Attempting manual circuit breaker recovery');
        resetCircuitBreaker();
      }
      
      return { healthy: false, reason: 'Circuit breaker open' };
    }
    
    return { healthy: true, circuitState: state };
  }
  
  private shouldAttemptRecovery(): boolean {
    // Custom logic for when to attempt manual recovery
    const lastRecoveryAttempt = this.getLastRecoveryTime();
    const timeSinceLastAttempt = Date.now() - lastRecoveryAttempt;
    
    return timeSinceLastAttempt > 300000; // 5 minutes
  }
}
```

## Performance Monitoring

### Circuit Breaker Metrics
```typescript
// Extract circuit breaker metrics from responses
function extractCircuitMetrics(result: ContextPackResult) {
  const cb = result.debug.circuit_breaker;
  
  return {
    state: cb?.state || 'UNKNOWN',
    failureCount: cb?.failure_count || 0,
    isDegraded: cb?.degraded || false,
    lastFailure: cb?.last_failure_time,
    retryAttempt: cb?.retry_attempt || 0
  };
}

// Track metrics over time
class CircuitBreakerMetrics {
  private metrics: Array<{ timestamp: number; state: string; failures: number }> = [];
  
  recordMetrics(result: ContextPackResult) {
    const cb = result.debug.circuit_breaker;
    
    this.metrics.push({
      timestamp: Date.now(),
      state: cb?.state || 'CLOSED',
      failures: cb?.failure_count || 0
    });
    
    // Keep only last 100 measurements
    if (this.metrics.length > 100) {
      this.metrics.shift();
    }
  }
  
  getHealthScore(): number {
    const recent = this.metrics.slice(-10); // Last 10 measurements
    const openCount = recent.filter(m => m.state === 'OPEN').length;
    
    return Math.max(0, 1 - (openCount / recent.length));
  }
}
```

## Testing & Validation

### Circuit Breaker Testing
```bash
# Run comprehensive circuit breaker tests
node test-circuit-breaker.js

# Expected output shows:
# ✅ Budget Constraints: PASS
# ✅ Circuit Breaker Failures: PASS  
# ✅ Circuit Recovery: PASS
# ✅ Graceful Degradation: PASS
```

### Load Testing
```typescript
// Stress test circuit breaker under load
async function stressTestCircuitBreaker() {
  const promises = [];
  
  for (let i = 0; i < 50; i++) {
    promises.push(
      getContextPack(`stress test ${i}`, {
        latency_ms_max: 1000, // Tight budget to trigger failures
        token_budget_max: 300
      }).catch(error => ({
        error: error.code,
        degraded: error.degraded
      }))
    );
  }
  
  const results = await Promise.allSettled(promises);
  
  const degradedCount = results.filter(r => 
    r.status === 'fulfilled' && r.value.error && r.value.degraded
  ).length;
  
  console.log(`Handled ${degradedCount} degraded responses gracefully`);
}
```

## Migration Checklist

### Phase 1: Replace Basic Client
- [ ] Update imports to use `ko-enhanced.js`
- [ ] Test existing functionality works unchanged
- [ ] Monitor circuit breaker state in logs

### Phase 2: Add Budget Constraints
- [ ] Identify critical vs. non-critical decision paths
- [ ] Set appropriate `latency_ms_max` for each path
- [ ] Configure `token_budget_max` based on processing needs
- [ ] Test with realistic budgets under load

### Phase 3: Implement Degraded Response Handling
- [ ] Update decision confidence calculation
- [ ] Add fallback logic for circuit breaker failures
- [ ] Implement monitoring and alerting for degraded states
- [ ] Test graceful degradation scenarios

### Phase 4: Production Optimization
- [ ] Tune circuit breaker thresholds based on real usage
- [ ] Implement automatic recovery monitoring
- [ ] Add business metrics for degraded decision quality
- [ ] Set up alerts for extended circuit breaker open states

## Environment Configuration

```env
# KO Service endpoint (same as before)
KO_BASE_URL=http://localhost:3000
KO_API_KEY=optional-api-key

# Circuit breaker tuning (optional - defaults provided)
KO_CIRCUIT_FAILURE_THRESHOLD=3
KO_CIRCUIT_RESET_TIMEOUT=30000
KO_CIRCUIT_MAX_RETRIES=3
KO_CIRCUIT_RETRY_DELAY_BASE=1000
```

## Summary

F2 implementation provides robust protection for MoneyBag against KO service failures through:

1. **Circuit Breaker Pattern**: Prevents cascading failures by cutting off unhealthy services
2. **Request Budgets**: Controls response time and size for predictable performance  
3. **Exponential Backoff**: Intelligent retry logic that doesn't overwhelm failing services
4. **Graceful Degradation**: Provides reduced-quality responses instead of hard failures
5. **Comprehensive Testing**: Full test suite validating all failure scenarios

This ensures MoneyBag remains operational and provides value even when the Knowledge Orchestrator is slow, overloaded, or temporarily unavailable.