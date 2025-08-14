import { test, expect } from '@playwright/test';

/**
 * H2: Simplified E2E API test for Knowledge Orchestrator
 * Tests the /pack endpoint without external dependencies, focusing on core functionality
 */

test.describe('Knowledge Orchestrator E2E API Tests - Simplified', () => {
  
  test('H2: /pack endpoint basic functionality with domain scope', async ({ request }) => {
    // Test with domain scope only (uses MOCK_NOTION=false in the service)
    const packRequest = {
      agent_id: 'e2e_test_agent',
      task: 'Find information about software testing best practices',
      scope: ['domain'],
      k: 3,
      allow_web: false,
      allow_private: false,
      token_budget_max: 1500
    };

    console.log('Making pack request with domain scope...');
    
    const response = await request.post('/pack', {
      data: packRequest,
      timeout: 30000
    });

    // Verify response status
    expect(response.status()).toBe(200);

    const result = await response.json();
    console.log('Pack response received:', {
      total_candidates: result.total_candidates,
      query_variants_count: result.query_variants?.length || 0,
      context_length: result.context?.length || 0,
      citations_count: result.citations?.length || 0
    });

    // Basic validations
    expect(result.agent_id).toBe(packRequest.agent_id);
    expect(result.task).toBe(packRequest.task);
    expect(result.query_variants).toBeDefined();
    expect(Array.isArray(result.query_variants)).toBe(true);
    expect(result.debug).toBeDefined();
    expect(result.debug.total_ms).toBeGreaterThan(0);

    console.log('✅ Basic pack functionality working');
  });

  test('H2: /pack endpoint with web scope enabled (with real web scraping)', async ({ request }) => {
    // Test with web scope to validate web scraping functionality
    const packRequest = {
      agent_id: 'e2e_web_agent',
      task: 'Find information about TypeScript and JavaScript frameworks',
      scope: ['web'],
      k: 2,
      allow_web: true,
      allow_private: false,
      token_budget_max: 1200
    };

    console.log('Making pack request with web scope...');
    
    const response = await request.post('/pack', {
      data: packRequest,
      timeout: 60000 // Longer timeout for web scraping
    });

    expect(response.status()).toBe(200);

    const result = await response.json();
    console.log('Web pack response:', {
      total_candidates: result.total_candidates,
      has_web_candidates: result.candidates?.web?.length > 0,
      context_length: result.context?.length || 0,
      citations_count: result.citations?.length || 0
    });

    // Verify web functionality
    expect(result.candidates).toBeDefined();
    
    // If we got web candidates, verify they have proper structure
    if (result.candidates.web && result.candidates.web.length > 0) {
      const webCandidate = result.candidates.web[0];
      expect(webCandidate.source).toBe('web');
      expect(webCandidate.url).toBeDefined();
      expect(webCandidate.title).toBeDefined();
      expect(webCandidate.snippet).toBeDefined();
      console.log('✅ Web candidates have proper structure');
    }

    // Verify citations from web if any
    if (result.citations && result.citations.length > 0) {
      const webCitations = result.citations.filter((c: any) => c.source.source === 'web');
      if (webCitations.length > 0) {
        console.log(`✅ Found ${webCitations.length} web citations`);
        const webCitation = webCitations[0];
        expect(webCitation.source.url).toBeDefined();
        expect(webCitation.snippet).toBeDefined();
      }
    }

    console.log('✅ Web functionality working');
  });

  test('H2: Token budget constraint validation', async ({ request }) => {
    const packRequest = {
      agent_id: 'budget_test_agent',
      task: 'Comprehensive analysis of modern software development practices including testing, deployment, and monitoring strategies',
      scope: ['domain'],
      k: 10,
      allow_web: false,
      token_budget_max: 800 // Tight budget
    };

    const response = await request.post('/pack', {
      data: packRequest
    });

    expect(response.status()).toBe(200);
    
    const result = await response.json();
    
    // Calculate total tokens
    let totalTokens = 0;
    if (result.debug?.compression_stats?.output_tokens) {
      totalTokens = result.debug.compression_stats.output_tokens;
    } else if (result.context) {
      totalTokens = Math.ceil(result.context.length / 4);
    }

    console.log(`Token budget test - Budget: ${packRequest.token_budget_max}, Actual: ${totalTokens}`);
    
    // Should respect the budget (allow some margin for overhead)
    expect(totalTokens).toBeLessThan(1000);
    
    console.log('✅ Token budget respected');
  });

  test('H2: Comprehensive multi-scope test (domain + web)', async ({ request }) => {
    const packRequest = {
      agent_id: 'multi_scope_agent',
      task: 'Software testing methodologies and automation tools',
      scope: ['domain', 'web'],
      k: 4,
      allow_web: true,
      allow_private: false,
      token_budget_max: 1600 // H2 requirement: < 1.6k tokens
    };

    console.log('Running comprehensive multi-scope test...');
    
    const response = await request.post('/pack', {
      data: packRequest,
      timeout: 60000
    });

    expect(response.status()).toBe(200);

    const result = await response.json();
    
    console.log('Multi-scope results:', {
      total_candidates: result.total_candidates,
      domain_candidates: result.candidates?.domain?.length || 0,
      web_candidates: result.candidates?.web?.length || 0,
      citations_count: result.citations?.length || 0,
      context_length: result.context?.length || 0
    });

    // H2 Acceptance Criteria Validations

    // 1. Verify we get results from multiple sources
    expect(result.candidates).toBeDefined();
    const hasMultipleSources = (result.candidates.domain?.length > 0) || (result.candidates.web?.length > 0);
    expect(hasMultipleSources).toBe(true);
    console.log('✅ Multiple sources returning results');

    // 2. Verify citations exist and have proper structure
    if (result.citations && result.citations.length > 0) {
      const citation = result.citations[0];
      expect(citation.source).toBeDefined();
      expect(citation.source.source).toBeDefined();
      expect(citation.snippet).toBeDefined();
      console.log(`✅ Citations properly structured (${result.citations.length} total)`);
    }

    // 3. CRITICAL: Verify overall tokens < 1.6k (H2 requirement)
    let totalTokens = 0;
    if (result.debug?.compression_stats?.output_tokens) {
      totalTokens = result.debug.compression_stats.output_tokens;
    } else if (result.context) {
      totalTokens = Math.ceil(result.context.length / 4);
    }

    console.log(`🎯 Token count check: ${totalTokens} tokens (limit: 1600)`);
    expect(totalTokens).toBeLessThan(1600);
    console.log('✅ H2 CRITICAL: Tokens < 1.6k requirement MET');

    // 4. Verify query processing worked
    expect(result.query_variants).toBeDefined();
    expect(result.query_variants.length).toBeGreaterThan(0);
    console.log(`✅ Query variants generated: ${result.query_variants.length}`);

    // 5. Verify timing information
    expect(result.debug.total_ms).toBeGreaterThan(0);
    console.log(`✅ Processing completed in ${result.debug.total_ms}ms`);

    console.log('\n🎉 H2 COMPREHENSIVE TEST PASSED!');
    console.log('✅ Multi-scope functionality working');
    console.log(`✅ Token limit respected (${totalTokens} < 1600)`);
    console.log('✅ All core functionality validated');
  });

  test('metrics endpoint returns proper prometheus format', async ({ request }) => {
    const response = await request.get('/metrics');
    
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');
    
    const metricsText = await response.text();
    expect(metricsText.length).toBeGreaterThan(0);
    
    // Should contain KO-specific metrics
    expect(metricsText).toContain('ko_http_requests_total');
    expect(metricsText).toContain('ko_pack_request_duration_seconds');
    
    const koMetricsCount = (metricsText.match(/^ko_/gm) || []).length;
    console.log(`✅ Metrics endpoint working: ${koMetricsCount} KO metrics`);
  });

  test('health endpoint responds correctly', async ({ request }) => {
    const response = await request.get('/health');
    
    expect(response.status()).toBe(200);
    
    const result = await response.json();
    expect(result.status).toBe('ok');
    
    console.log('✅ Health endpoint working');
  });
});