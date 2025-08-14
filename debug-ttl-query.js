// Debug TTL query to understand why consolidation candidates aren't found
import { MongoClient } from 'mongodb';
import { loadEnv } from './dist/env.js';
import { insertChunk } from './dist/services/chunks.js';

console.log('🔍 Debug TTL Query');

const env = loadEnv();

async function debugTTLQuery() {
  console.log('\n=== Creating Single Test Document ===');
  
  // Create old test chunks (8 days ago)
  const oldDate = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000)); // 8 days ago
  console.log(`Creating chunks with date: ${oldDate.toISOString()}`);
  
  // Create fake embedding (zeros for testing)
  const fakeEmbedding = new Array(1536).fill(0);
  
  const testChunks = [
    'First chunk about debugging TTL queries',
    'Second chunk about database aggregation',
    'Third chunk about MongoDB queries',
    'Fourth chunk about consolidation logic'
  ];
  
  const insertedIds = [];
  
  for (let i = 0; i < testChunks.length; i++) {
    const chunkId = await insertChunk({
      source: 'notion',
      source_id: 'debug_doc',
      scope: 'debug_scope',
      text: testChunks[i],
      tokens: 10,
      embedding: fakeEmbedding,
      priority: 'low',
      updated_at: oldDate,
      private: false
    });
    
    insertedIds.push(chunkId);
    console.log(`✅ Created chunk ${i + 1}: "${testChunks[i].substring(0, 30)}..."`);
  }
  
  console.log('\n=== Verifying Chunks in Database ===');
  
  const client = new MongoClient(env.MONGO_URL);
  await client.connect();
  const db = client.db('knowledge_orchestrator');
  const collection = db.collection('chunks');
  
  // Find the chunks we just created
  const chunks = await collection.find({
    source_id: 'debug_doc'
  }).toArray();
  
  console.log(`Found ${chunks.length} chunks in database:`);
  chunks.forEach((chunk, i) => {
    console.log(`   ${i + 1}. ID: ${chunk._id}`);
    console.log(`      Source: ${chunk.source}:${chunk.source_id}`);
    console.log(`      Priority: ${chunk.priority}`);
    console.log(`      Updated: ${chunk.updated_at.toISOString()}`);
    console.log(`      Age: ${((Date.now() - chunk.updated_at.getTime()) / (1000 * 60 * 60)).toFixed(1)} hours`);
  });
  
  console.log('\n=== Testing TTL Aggregation Pipeline ===');
  
  const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
  const cutoffDate = new Date(Date.now() - maxAgeMs);
  const minChunksPerDoc = 3;
  
  console.log(`Cutoff date: ${cutoffDate.toISOString()}`);
  console.log(`Looking for chunks older than: ${cutoffDate.toISOString()}`);
  console.log(`Minimum chunks per doc: ${minChunksPerDoc}`);
  
  // Run the exact same aggregation pipeline as TTL service
  const pipeline = [
    {
      $match: {
        updated_at: { $lt: cutoffDate },
        priority: { $in: ['low', 'norm'] },
        source_id: { $ne: null },
      }
    },
    {
      $group: {
        _id: { source: '$source', source_id: '$source_id' },
        chunks: { $push: '$$ROOT' },
        count: { $sum: 1 },
        totalTokens: { $sum: '$tokens' },
        oldestDate: { $min: '$updated_at' },
        newestDate: { $max: '$updated_at' }
      }
    },
    {
      $match: {
        count: { $gte: minChunksPerDoc }
      }
    },
    {
      $sort: { oldestDate: 1 }
    }
  ];
  
  console.log('\nRunning aggregation pipeline...');
  const results = await collection.aggregate(pipeline).toArray();
  
  console.log(`Pipeline returned ${results.length} results:`);
  results.forEach((result, i) => {
    console.log(`   ${i + 1}. Document: ${result._id.source}:${result._id.source_id}`);
    console.log(`      Chunks: ${result.count}`);
    console.log(`      Total tokens: ${result.totalTokens}`);
    console.log(`      Oldest: ${result.oldestDate.toISOString()}`);
    console.log(`      Newest: ${result.newestDate.toISOString()}`);
  });
  
  // Also test individual match criteria
  console.log('\n=== Testing Individual Match Criteria ===');
  
  const oldChunks = await collection.find({
    updated_at: { $lt: cutoffDate },
    source_id: 'debug_doc'
  }).toArray();
  console.log(`Chunks older than cutoff: ${oldChunks.length}`);
  
  const lowPriorityChunks = await collection.find({
    priority: { $in: ['low', 'norm'] },
    source_id: 'debug_doc'
  }).toArray();
  console.log(`Low/norm priority chunks: ${lowPriorityChunks.length}`);
  
  const hasSourceId = await collection.find({
    source_id: { $ne: null },
    source_id: 'debug_doc'
  }).toArray();
  console.log(`Chunks with source_id: ${hasSourceId.length}`);
  
  // Cleanup
  console.log('\n=== Cleanup ===');
  const deleteResult = await collection.deleteMany({
    source_id: 'debug_doc'
  });
  console.log(`Cleaned up ${deleteResult.deletedCount} chunks`);
  
  await client.close();
  
  return results.length > 0;
}

debugTTLQuery().catch(console.error);