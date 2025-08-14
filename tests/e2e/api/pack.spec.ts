import { test, expect } from '@playwright/test';
import { MockMemoryServer } from '../../mocks/memory-server.js';
import { MockNotionServer } from '../../mocks/notion-server.js';

/**
 * H2: End-to-End API tests for Knowledge Orchestrator
 * Tests the /pack endpoint with mocked Memory/Notion services and real web scraping
 */

test.describe('Knowledge Orchestrator E2E API Tests', () => {
  let memoryServer: MockMemoryServer;
  let notionServer: MockNotionServer;

  test.beforeAll(async () => {
    // Start mock servers before tests
    memoryServer = new MockMemoryServer(3001);
    notionServer = new MockNotionServer(3002);
    
    await memoryServer.start();
    await notionServer.start();
    
    console.log('Mock servers started for E2E tests');
  });

  test.afterAll(async () => {
    // Stop mock servers after tests
    await memoryServer.stop();
    await notionServer.stop();
    
    console.log('Mock servers stopped');
  });

  test('H2: /pack endpoint with web allowed returns citations from all three sources and tokens < 1.6k', async ({ request }) => {
    // Add additional test data to mock servers
    memoryServer.addDocument({
      id: 'mem_e2e_001',
      title: 'Advanced Testing Patterns',
      content: 'End-to-end testing with Playwright provides comprehensive coverage of user workflows. It validates the entire application stack from frontend to backend, ensuring all components work together correctly. Key benefits include catching integration issues and validating real user scenarios.',
      updated_at: '2024-01-18T10:00:00Z',
      tags: ['testing', 'e2e', 'playwright']
    });

    notionServer.addPage({
      id: 'notion_e2e_001',
      title: 'Web API Testing Best Practices',
      content: 'API testing focuses on data exchange between different software systems. Test both positive and negative scenarios, validate response schemas, check error handling, and ensure proper authentication. Use tools like Playwright for robust API testing automation.',
      url: `http://localhost:3002/pages/notion_e2e_001`,
      updated_at: '2024-01-18T11:00:00Z',
      database_id: 'db_e2e'
    });

    // Wait a moment for servers to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Make pack request with all three scopes including web
    const packRequest = {
      agent_id: 'e2e_test_agent',
      task: 'Find comprehensive information about testing strategies and best practices for web applications',
      scope: ['personal', 'domain', 'web'],
      k: 5,
      allow_web: true,
      allow_private: false,
      token_budget_max: 1500 // Set budget to ensure we stay under 1.6k
    };

    console.log('Making pack request with all three scopes...');
    
    const response = await request.post('/pack', {
      data: packRequest,
      timeout: 60000 // 60 second timeout for web scraping
    });

    // Verify response status
    expect(response.status()).toBe(200);

    const result = await response.json();
    console.log('Pack response received:', {
      total_candidates: result.total_candidates,
      query_variants_count: result.query_variants?.length || 0,
      context_length: result.context?.length || 0,
      citations_count: result.citations?.length || 0,
      debug: result.debug
    });

    // H2 Acceptance Criteria Validations

    // 1. Verify we get citations from all three sources
    expect(result.citations).toBeDefined();
    expect(Array.isArray(result.citations)).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);

    // Check that we have citations from memory (personal), notion (domain), and web
    const sources = result.citations.map((citation: any) => citation.source.source);
    const uniqueSources = [...new Set(sources)];
    
    console.log('Citation sources found:', uniqueSources);
    console.log('Citations breakdown:');
    result.citations.forEach((citation: any, index: number) => {
      console.log(`  ${index + 1}. Source: ${citation.source.source}, ID: ${citation.source.id}`);
    });

    // Verify we have citations from memory/personal scope
    const hasMemoryCitations = sources.includes('memory');
    expect(hasMemoryCitations).toBe(true);
    console.log('✅ Memory citations found');

    // Verify we have citations from notion/domain scope
    const hasNotionCitations = sources.includes('notion');
    expect(hasNotionCitations).toBe(true);
    console.log('✅ Notion citations found');

    // Verify we have citations from web scope
    const hasWebCitations = sources.includes('web');
    expect(hasWebCitations).toBe(true);
    console.log('✅ Web citations found');

    // 2. Verify overall tokens < 1.6k (1600 tokens)
    expect(result.context).toBeDefined();
    
    // Calculate total tokens from compression stats or estimate from context length
    let totalTokens = 0;
    if (result.debug?.compression_stats?.output_tokens) {
      totalTokens = result.debug.compression_stats.output_tokens;
    } else if (result.context) {
      // Rough estimation: 1 token ≈ 4 characters
      totalTokens = Math.ceil(result.context.length / 4);
    }

    console.log(`Total tokens: ${totalTokens}`);
    expect(totalTokens).toBeLessThan(1600);
    console.log('✅ Token count under 1.6k limit');

    // 3. Additional validations for robust testing

    // Verify we have candidates from all requested scopes
    expect(result.candidates).toBeDefined();
    
    if (result.candidates.personal) {
      expect(result.candidates.personal.length).toBeGreaterThan(0);
      console.log(`✅ Personal candidates: ${result.candidates.personal.length}`);
    }
    
    if (result.candidates.domain) {
      expect(result.candidates.domain.length).toBeGreaterThan(0);
      console.log(`✅ Domain candidates: ${result.candidates.domain.length}`);
    }
    
    if (result.candidates.web) {
      expect(result.candidates.web.length).toBeGreaterThan(0);
      console.log(`✅ Web candidates: ${result.candidates.web.length}`);
    }

    // Verify query variants were generated
    expect(result.query_variants).toBeDefined();
    expect(Array.isArray(result.query_variants)).toBe(true);
    expect(result.query_variants.length).toBeGreaterThan(0);
    console.log(`✅ Query variants generated: ${result.query_variants.length}`);

    // Verify debug timing information
    expect(result.debug).toBeDefined();
    expect(result.debug.total_ms).toBeGreaterThan(0);
    expect(result.debug.query_generation_ms).toBeGreaterThan(0);
    console.log(`✅ Timing info - Total: ${result.debug.total_ms}ms, Query gen: ${result.debug.query_generation_ms}ms`);

    // Verify agent_id and task are preserved
    expect(result.agent_id).toBe(packRequest.agent_id);
    expect(result.task).toBe(packRequest.task);

    // Verify context contains meaningful content
    expect(result.context.length).toBeGreaterThan(100); // Should have substantial content
    
    console.log('\n🎉 H2 E2E Test PASSED!');
    console.log('✅ Citations from all three sources (memory, notion, web)');
    console.log(`✅ Token count (${totalTokens}) under 1.6k limit`);
    console.log('✅ All acceptance criteria met');
  });

  test('pack endpoint handles errors gracefully', async ({ request }) => {
    // Test with invalid request to ensure error handling
    const invalidRequest = {
      agent_id: '',
      task: '',
      scope: ['invalid_scope'],
      k: 0
    };

    const response = await request.post('/pack', {
      data: invalidRequest
    });

    // Should handle gracefully, potentially with validation errors or empty results
    expect([200, 400, 422]).toContain(response.status());
    
    const result = await response.json();
    expect(result).toBeDefined();
    expect(result.agent_id).toBeDefined();
    expect(result.task).toBeDefined();
  });

  test('pack endpoint respects token budget constraints', async ({ request }) => {
    const budgetRequest = {
      agent_id: 'budget_test_agent',
      task: 'Find information about software development practices',
      scope: ['domain'],
      k: 10,
      allow_web: false,
      token_budget_max: 500 // Very low budget
    };

    const response = await request.post('/pack', {
      data: budgetRequest
    });

    expect(response.status()).toBe(200);
    
    const result = await response.json();
    
    // If compression was performed, verify it stayed within budget
    if (result.debug?.compression_stats?.output_tokens) {
      expect(result.debug.compression_stats.output_tokens).toBeLessThanOrEqual(500);
    }
    
    // Context should exist but be limited by budget
    if (result.context) {
      const estimatedTokens = Math.ceil(result.context.length / 4);
      expect(estimatedTokens).toBeLessThanOrEqual(600); // Allow some margin
    }
  });

  test('metrics endpoint returns prometheus format', async ({ request }) => {
    // Verify the metrics endpoint works as part of E2E testing
    const response = await request.get('/metrics');
    
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');
    
    const metricsText = await response.text();
    expect(metricsText).toBeDefined();
    expect(metricsText.length).toBeGreaterThan(0);
    
    // Should contain KO-specific metrics
    expect(metricsText).toContain('ko_http_requests_total');
    expect(metricsText).toContain('ko_pack_request_duration_seconds');
    
    console.log('✅ Metrics endpoint working correctly');
  });
});