// Simple database debug - check what's happening with chunk insertion
import { MongoClient } from 'mongodb';
import { loadEnv } from './dist/env.js';

console.log('🔍 Simple Database Debug');

const env = loadEnv();

async function debugDatabase() {
  console.log(`\nConnecting to: ${env.MONGO_URL}`);
  
  const client = new MongoClient(env.MONGO_URL);
  await client.connect();
  
  console.log('✅ Connected to MongoDB');
  
  // List all databases
  const adminDb = client.db().admin();
  const dbs = await adminDb.listDatabases();
  console.log('\n📋 Available databases:');
  dbs.databases.forEach(db => {
    console.log(`   • ${db.name} (${(db.sizeOnDisk / 1024 / 1024).toFixed(1)} MB)`);
  });
  
  // Check the knowledge_orchestrator database
  const db = client.db('knowledge_orchestrator');
  const collections = await db.listCollections().toArray();
  
  console.log('\n📋 Collections in knowledge_orchestrator database:');
  collections.forEach(col => {
    console.log(`   • ${col.name} (type: ${col.type})`);
  });
  
  // Check chunks collection
  const chunksCollection = db.collection('chunks');
  const chunkCount = await chunksCollection.countDocuments();
  console.log(`\n📊 Chunks collection has ${chunkCount} documents`);
  
  if (chunkCount > 0) {
    console.log('\n📄 Sample chunks:');
    const sampleChunks = await chunksCollection.find().limit(3).toArray();
    sampleChunks.forEach((chunk, i) => {
      console.log(`   ${i + 1}. ID: ${chunk._id}`);
      console.log(`      Source: ${chunk.source}:${chunk.source_id}`);
      console.log(`      Text: "${chunk.text.substring(0, 40)}..."`);
      console.log(`      Updated: ${chunk.updated_at}`);
      console.log(`      Priority: ${chunk.priority}`);
    });
  }
  
  // Test simple insertion
  console.log('\n=== Testing Simple Insertion ===');
  
  const testDoc = {
    source: 'test',
    source_id: 'simple_test',
    scope: 'debug',
    text: 'Simple test chunk',
    tokens: 3,
    embedding: new Array(1536).fill(0),
    updated_at: new Date(Date.now() - (10 * 24 * 60 * 60 * 1000)), // 10 days ago
    priority: 'low',
    private: false
  };
  
  const insertResult = await chunksCollection.insertOne(testDoc);
  console.log(`✅ Inserted test chunk with ID: ${insertResult.insertedId}`);
  
  // Try to find it immediately
  const foundChunk = await chunksCollection.findOne({ _id: insertResult.insertedId });
  
  if (foundChunk) {
    console.log(`✅ Found inserted chunk:`);
    console.log(`   Text: "${foundChunk.text}"`);
    console.log(`   Updated: ${foundChunk.updated_at}`);
    console.log(`   Age: ${((Date.now() - foundChunk.updated_at.getTime()) / (1000 * 60 * 60)).toFixed(1)} hours`);
    
    // Test TTL query on this chunk
    const cutoffDate = new Date(Date.now() - (24 * 60 * 60 * 1000)); // 24 hours
    console.log(`\n=== Testing TTL Query on Test Chunk ===`);
    console.log(`Cutoff date: ${cutoffDate.toISOString()}`);
    console.log(`Chunk date: ${foundChunk.updated_at.toISOString()}`);
    console.log(`Is chunk older than cutoff? ${foundChunk.updated_at < cutoffDate}`);
    
    const ttlMatches = await chunksCollection.find({
      updated_at: { $lt: cutoffDate },
      priority: { $in: ['low', 'norm'] },
      source_id: { $ne: null },
      source_id: 'simple_test'
    }).toArray();
    
    console.log(`TTL query matches: ${ttlMatches.length}`);
  } else {
    console.log('❌ Could not find inserted chunk');
  }
  
  // Cleanup
  await chunksCollection.deleteOne({ _id: insertResult.insertedId });
  console.log('🧹 Cleaned up test chunk');
  
  await client.close();
}

debugDatabase().catch(console.error);