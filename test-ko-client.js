// Test script for KO client integration
import { getContextPack, healthCheck, createKOClient } from './dist/adapters/ko.js';

console.log('Testing KO Client integration...');

async function testKOClient() {
  try {
    console.log('\n=== KO Client Health Check ===');
    
    // Test health check first
    const health = await healthCheck();
    console.log('Health status:', health.status);
    if (health.version) {
      console.log('Service version:', health.version);
    }

    if (health.status === 'unhealthy') {
      console.log('⚠️  KO service appears to be down, skipping integration tests');
      return;
    }

    console.log('\n=== Testing Context Pack Retrieval ===');

    // Test basic context pack retrieval
    const result = await getContextPack('What are TypeScript best practices?', {
      scope: ['domain'],
      k: 5,
      allow_web: false,
      allow_private: false,
      agent_id: 'test-client'
    });

    console.log('✅ Context Pack Result:');
    console.log(`   Query variants: [${result.query_variants.join(', ')}]`);
    console.log(`   Total candidates: ${result.total_candidates}`);
    console.log(`   Context length: ${result.context?.length || 0} characters`);
    console.log(`   Citations: ${result.citations?.length || 0}`);
    console.log(`   Processing time: ${result.debug.total_ms}ms`);

    if (result.context) {
      console.log(`\n📄 Generated Context:`);
      console.log(result.context.substring(0, 300) + '...');
    }

    if (result.citations && result.citations.length > 0) {
      console.log(`\n📚 Citations:`);
      result.citations.slice(0, 3).forEach(citation => {
        console.log(`   ${citation.id} ${citation.source.title} (${citation.source.source})`);
        if (citation.source.url) {
          console.log(`      URL: ${citation.source.url}`);
        }
      });
    }

    console.log('\n=== Testing Different Scopes ===');
    
    // Test with multiple scopes
    const multiScopeResult = await getContextPack('How to implement caching strategies?', {
      scope: ['domain', 'personal'],
      k: 8,
      allow_web: false,
      allow_private: true,
      agent_id: 'multi-scope-test'
    });

    console.log('✅ Multi-scope Result:');
    console.log(`   Total candidates: ${multiScopeResult.total_candidates}`);
    console.log(`   Citations: ${multiScopeResult.citations?.length || 0}`);
    
    const timings = multiScopeResult.debug;
    if (timings.personal_retrieval_ms) console.log(`   Personal retrieval: ${timings.personal_retrieval_ms}ms`);
    if (timings.domain_retrieval_ms) console.log(`   Domain retrieval: ${timings.domain_retrieval_ms}ms`);
    if (timings.ranking_ms) console.log(`   Ranking: ${timings.ranking_ms}ms`);
    if (timings.compression_ms) console.log(`   Compression: ${timings.compression_ms}ms`);

    console.log('\n=== Testing Custom Client Configuration ===');
    
    // Test custom client
    const customClient = createKOClient({
      baseUrl: process.env.KO_BASE_URL || 'http://localhost:3000',
      timeout: 10000
    });

    console.log('✅ Custom client created with config:');
    console.log('   Base URL:', customClient.getConfig().baseUrl);
    console.log('   Timeout:', customClient.getConfig().timeout);
    console.log('   Has API key:', customClient.getConfig().hasApiKey);

    console.log('\n=== MoneyBag Integration Demo ===');

    // Demonstrate how moneyBag would use this
    const moneyBagTask = 'Should we migrate our authentication system to OAuth 2.0?';
    console.log(`MoneyBag task: "${moneyBagTask}"`);
    
    const moneyBagResult = await getContextPack(moneyBagTask, {
      scope: ['domain', 'personal'], // MoneyBag typically wants domain knowledge + personal insights
      k: 10,
      allow_web: false, // MoneyBag usually doesn't want web results for sensitive decisions
      allow_private: true, // But may want access to private knowledge
      agent_id: 'moneybag-v1'
    });

    // This is what moneyBag would store in its decision record
    const decisionRecord = {
      task: moneyBagTask,
      context: moneyBagResult.context,
      citations: moneyBagResult.citations,
      queryVariants: moneyBagResult.query_variants,
      processingTime: moneyBagResult.debug.total_ms,
      sourcesUsed: [
        moneyBagResult.debug.personal_retrieval_ms ? 'memory' : null,
        moneyBagResult.debug.domain_retrieval_ms ? 'notion' : null,
        moneyBagResult.debug.web_retrieval_ms ? 'web' : null
      ].filter(Boolean),
      timestamp: new Date().toISOString()
    };

    console.log('✅ MoneyBag Decision Record Created:');
    console.log(`   Context: ${decisionRecord.context?.length || 0} chars`);
    console.log(`   Citations: ${decisionRecord.citations?.length || 0}`);
    console.log(`   Sources used: [${decisionRecord.sourcesUsed.join(', ')}]`);
    console.log(`   Processing time: ${decisionRecord.processingTime}ms`);

    console.log('\n🎉 All KO Client tests completed successfully!');
    console.log('\nKey Integration Points for MoneyBag:');
    console.log('✅ Replace internal context assembly with getContextPack() calls');
    console.log('✅ Store citations in decision records for traceability');
    console.log('✅ Use debug info for performance monitoring');
    console.log('✅ Configure scopes based on decision type (domain/personal/web)');
    console.log('✅ Handle errors gracefully with fallback mechanisms');

  } catch (error) {
    console.error('❌ KO Client test failed:', error);
    
    if (error.code === 'CONNECTION_ERROR') {
      console.log('\n💡 To run full tests:');
      console.log('   1. Start the KO service: npm run dev');
      console.log('   2. Set environment variables if needed');
      console.log('   3. Run this test again');
    }
    
    process.exit(1);
  }
}

testKOClient();