import { MongoClient, Db, Collection } from 'mongodb';
import { loadEnv } from '../env.js';
import { insertChunk, type Chunk, type ChunkSource } from './chunks.js';
import { chunkAndEmbed } from './embeddings.js';

export interface TTLJobOptions {
  dryRun?: boolean;              // If true, only log what would be done
  maxAgeHours?: number;          // Max age for chunks to be considered old (default: 168 = 7 days)
  minChunksPerDoc?: number;      // Minimum chunks per doc to trigger consolidation (default: 3)
  maxDigestTokens?: number;      // Maximum tokens for digest chunk (default: 2000)
  batchSize?: number;            // Number of documents to process per batch (default: 100)
}

export interface ConsolidationCandidate {
  source: ChunkSource;
  source_id: string;
  chunks: Chunk[];
  totalTokens: number;
  oldestChunk: Date;
  newestChunk: Date;
}

export interface ConsolidationResult {
  documentsProcessed: number;
  chunksConsolidated: number;
  digestsCreated: number;
  tokensReclaimed: number;
  errors: string[];
  dryRun: boolean;
  duration: number;
}

export class TTLError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number
  ) {
    super(message);
    this.name = 'TTLError';
  }
}

class TTLService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private chunksCollection: Collection<Chunk> | null = null;
  private env = loadEnv();

  /**
   * Initialize database connection
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.db) {
      this.client = new MongoClient(this.env.MONGO_URL);
      await this.client.connect();
      this.db = this.client.db('knowledge_orchestrator');
      this.chunksCollection = this.db.collection<Chunk>('chunks');
      
      console.log('TTL Service initialized with MongoDB');
    }
  }

  /**
   * Find chunks eligible for consolidation
   */
  private async findConsolidationCandidates(options: TTLJobOptions): Promise<ConsolidationCandidate[]> {
    await this.ensureInitialized();
    
    const maxAgeMs = (options.maxAgeHours || 168) * 60 * 60 * 1000; // Default 7 days
    const cutoffDate = new Date(Date.now() - maxAgeMs);
    const minChunksPerDoc = options.minChunksPerDoc || 3;
    
    if (!this.chunksCollection) {
      throw new TTLError('Chunks collection not initialized');
    }

    console.log(`🔍 Finding consolidation candidates (older than ${options.maxAgeHours || 168} hours, min ${minChunksPerDoc} chunks per doc)`);

    // Aggregation pipeline to find documents with multiple old, low-priority chunks
    const pipeline = [
      {
        $match: {
          updated_at: { $lt: cutoffDate },
          priority: { $in: ['low', 'norm'] },  // Only consolidate low/normal priority chunks
          source_id: { $ne: null },            // Must have a source document ID
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
          count: { $gte: minChunksPerDoc }  // Only documents with enough chunks
        }
      },
      {
        $sort: { oldestDate: 1 }  // Process oldest documents first
      },
      {
        $limit: options.batchSize || 100  // Limit batch size
      }
    ];

    const results = await this.chunksCollection.aggregate(pipeline).toArray();
    
    const candidates: ConsolidationCandidate[] = results.map(result => ({
      source: result._id.source,
      source_id: result._id.source_id,
      chunks: result.chunks,
      totalTokens: result.totalTokens,
      oldestChunk: result.oldestDate,
      newestChunk: result.newestDate
    }));

    console.log(`📊 Found ${candidates.length} consolidation candidates`);
    
    return candidates;
  }

  /**
   * Create a digest summary from multiple chunks
   */
  private async createDigestSummary(chunks: Chunk[], maxTokens: number): Promise<string> {
    // Sort chunks by updated_at to create coherent summary
    const sortedChunks = chunks.sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime());
    
    // Combine chunk texts with some structure
    const combinedText = sortedChunks
      .map((chunk, i) => `[Chunk ${i + 1}] ${chunk.text}`)
      .join('\n\n');

    // If combined text is already short enough, return as-is
    const estimatedTokens = Math.ceil(combinedText.length / 4); // Rough estimation
    if (estimatedTokens <= maxTokens) {
      return `DIGEST: This document contains ${chunks.length} consolidated chunks.\n\n${combinedText}`;
    }

    // Create a more concise summary
    const chunkSummaries = sortedChunks.map((chunk, i) => {
      const text = chunk.text.length > 200 ? chunk.text.substring(0, 200) + '...' : chunk.text;
      return `${i + 1}. ${text}`;
    });

    const digestHeader = `DIGEST: Consolidated ${chunks.length} chunks from this document (${chunks.reduce((sum, c) => sum + c.tokens, 0)} total tokens).`;
    const digestBody = chunkSummaries.join('\n\n');
    
    let digestText = `${digestHeader}\n\n${digestBody}`;
    
    // Trim if still too long
    const digestTokens = Math.ceil(digestText.length / 4);
    if (digestTokens > maxTokens) {
      const targetLength = maxTokens * 4 * 0.9; // 90% of target to be safe
      digestText = digestText.substring(0, targetLength) + '...\n\n[TRUNCATED]';
    }

    return digestText;
  }

  /**
   * Process a single consolidation candidate
   */
  private async processConsolidationCandidate(
    candidate: ConsolidationCandidate,
    options: TTLJobOptions
  ): Promise<{ success: boolean; tokensReclaimed: number; error?: string }> {
    const maxDigestTokens = options.maxDigestTokens || 2000;
    
    try {
      console.log(`📝 Processing ${candidate.source}:${candidate.source_id} (${candidate.chunks.length} chunks, ${candidate.totalTokens} tokens)`);
      
      if (options.dryRun) {
        console.log(`   🔍 DRY RUN: Would consolidate ${candidate.chunks.length} chunks:`);
        candidate.chunks.forEach((chunk, i) => {
          console.log(`      ${i + 1}. ${chunk.tokens} tokens, updated: ${chunk.updated_at.toISOString().split('T')[0]}`);
          console.log(`         Text: "${chunk.text.substring(0, 80)}..."`);
        });
        console.log(`   🔍 DRY RUN: Would create digest chunk with ~${Math.min(candidate.totalTokens, maxDigestTokens)} tokens`);
        console.log(`   🔍 DRY RUN: Would delete ${candidate.chunks.length} original chunks`);
        
        return { 
          success: true, 
          tokensReclaimed: Math.max(0, candidate.totalTokens - maxDigestTokens)
        };
      }

      // Create digest summary
      const digestText = await this.createDigestSummary(candidate.chunks, maxDigestTokens);
      
      // Generate embedding for digest
      const digestEmbeddings = await chunkAndEmbed(digestText);
      if (digestEmbeddings.length === 0) {
        throw new Error('Failed to generate embedding for digest');
      }
      
      const digestEmbedding = digestEmbeddings[0];
      
      // Get metadata from the most recent chunk
      const newestChunk = candidate.chunks.reduce((newest, chunk) => 
        chunk.updated_at > newest.updated_at ? chunk : newest
      );

      // Create digest chunk
      const digestChunkId = await insertChunk({
        source: candidate.source,
        source_id: candidate.source_id,
        url: newestChunk.url,
        scope: `${newestChunk.scope}_digest`,  // Mark as digest
        text: digestText,
        tokens: digestEmbedding.tokens,
        embedding: digestEmbedding.embedding,
        entities: this.extractUniqueEntities(candidate.chunks),
        priority: 'norm',  // Digest chunks get normal priority
        updated_at: candidate.newestChunk,  // Keep newest timestamp
        private: candidate.chunks.some(c => c.private)  // Private if any source chunk was private
      });

      console.log(`   ✅ Created digest chunk ${digestChunkId} (${digestEmbedding.tokens} tokens)`);

      // Delete original chunks
      if (!this.chunksCollection) {
        throw new Error('Chunks collection not available');
      }

      const chunkIds = candidate.chunks.map(c => c._id).filter(id => id !== undefined);
      const deleteResult = await this.chunksCollection.deleteMany({
        _id: { $in: chunkIds }
      });

      console.log(`   🗑️  Deleted ${deleteResult.deletedCount} original chunks`);

      const tokensReclaimed = candidate.totalTokens - digestEmbedding.tokens;
      console.log(`   💾 Reclaimed ${tokensReclaimed} tokens`);

      return { 
        success: true, 
        tokensReclaimed 
      };

    } catch (error) {
      const errorMessage = `Failed to process ${candidate.source}:${candidate.source_id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`   ❌ ${errorMessage}`);
      return { 
        success: false, 
        tokensReclaimed: 0, 
        error: errorMessage 
      };
    }
  }

  /**
   * Extract unique entities from multiple chunks
   */
  private extractUniqueEntities(chunks: Chunk[]): string[] {
    const allEntities = chunks.flatMap(chunk => chunk.entities || []);
    return [...new Set(allEntities)];
  }

  /**
   * Run TTL consolidation job
   */
  async runConsolidationJob(options: TTLJobOptions = {}): Promise<ConsolidationResult> {
    const startTime = Date.now();
    
    console.log(`🚀 Starting TTL consolidation job (${options.dryRun ? 'DRY RUN' : 'LIVE MODE'})`);
    console.log(`   Max age: ${options.maxAgeHours || 168} hours`);
    console.log(`   Min chunks per doc: ${options.minChunksPerDoc || 3}`);
    console.log(`   Max digest tokens: ${options.maxDigestTokens || 2000}`);
    console.log(`   Batch size: ${options.batchSize || 100}`);

    const result: ConsolidationResult = {
      documentsProcessed: 0,
      chunksConsolidated: 0,
      digestsCreated: 0,
      tokensReclaimed: 0,
      errors: [],
      dryRun: options.dryRun || false,
      duration: 0
    };

    try {
      // Find consolidation candidates
      const candidates = await this.findConsolidationCandidates(options);
      
      if (candidates.length === 0) {
        console.log('✨ No consolidation candidates found');
        result.duration = Date.now() - startTime;
        return result;
      }

      // Process each candidate
      for (const candidate of candidates) {
        const processResult = await this.processConsolidationCandidate(candidate, options);
        
        result.documentsProcessed++;
        
        if (processResult.success) {
          result.chunksConsolidated += candidate.chunks.length;
          result.digestsCreated++;
          result.tokensReclaimed += processResult.tokensReclaimed;
        } else if (processResult.error) {
          result.errors.push(processResult.error);
        }
      }

      result.duration = Date.now() - startTime;

      console.log(`\n📊 TTL Consolidation Summary:`);
      console.log(`   Documents processed: ${result.documentsProcessed}`);
      console.log(`   Chunks consolidated: ${result.chunksConsolidated}`);
      console.log(`   Digests created: ${result.digestsCreated}`);
      console.log(`   Tokens reclaimed: ${result.tokensReclaimed}`);
      console.log(`   Errors: ${result.errors.length}`);
      console.log(`   Duration: ${(result.duration / 1000).toFixed(1)}s`);
      console.log(`   Mode: ${result.dryRun ? 'DRY RUN' : 'LIVE'}`);

      if (result.errors.length > 0) {
        console.log(`\n❌ Errors encountered:`);
        result.errors.forEach((error, i) => {
          console.log(`   ${i + 1}. ${error}`);
        });
      }

      return result;

    } catch (error) {
      console.error('❌ TTL consolidation job failed:', error);
      throw new TTLError(
        `TTL consolidation job failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'JOB_ERROR',
        500
      );
    }
  }

  /**
   * Schedule nightly consolidation job
   */
  scheduleNightlyJob(options: TTLJobOptions = {}): NodeJS.Timeout {
    console.log('⏰ Scheduling nightly TTL consolidation job');
    
    // Calculate time until next 2 AM
    const now = new Date();
    const next2AM = new Date();
    next2AM.setHours(2, 0, 0, 0); // 2 AM
    
    if (next2AM <= now) {
      next2AM.setDate(next2AM.getDate() + 1); // Next day if 2 AM already passed
    }
    
    const msUntil2AM = next2AM.getTime() - now.getTime();
    
    console.log(`📅 Next TTL job scheduled for: ${next2AM.toISOString()}`);
    console.log(`⏱️  Time until next run: ${(msUntil2AM / (1000 * 60 * 60)).toFixed(1)} hours`);
    
    return setTimeout(() => {
      console.log('🌙 Running scheduled nightly TTL consolidation job');
      
      this.runConsolidationJob(options)
        .then(_result => {
          console.log('✅ Nightly TTL job completed successfully');
          
          // Schedule next job (24 hours later)
          this.scheduleNightlyJob(options);
        })
        .catch(error => {
          console.error('❌ Nightly TTL job failed:', error);
          
          // Still schedule next job despite failure
          this.scheduleNightlyJob(options);
        });
        
    }, msUntil2AM);
  }

  /**
   * Get TTL job statistics
   */
  async getConsolidationStats(): Promise<{
    candidateDocuments: number;
    candidateChunks: number;
    totalCandidateTokens: number;
    estimatedReclamation: number;
  }> {
    const candidates = await this.findConsolidationCandidates({ 
      dryRun: true,
      batchSize: 1000  // Get more for statistics
    });
    
    const stats = {
      candidateDocuments: candidates.length,
      candidateChunks: candidates.reduce((sum, c) => sum + c.chunks.length, 0),
      totalCandidateTokens: candidates.reduce((sum, c) => sum + c.totalTokens, 0),
      estimatedReclamation: 0
    };
    
    // Estimate token reclamation (assume digests use 50% of original tokens on average)
    stats.estimatedReclamation = Math.floor(stats.totalCandidateTokens * 0.5);
    
    return stats;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.chunksCollection = null;
    }
  }
}

// Create and export singleton instance
const ttlService = new TTLService();

export const runConsolidationJob = (options?: TTLJobOptions): Promise<ConsolidationResult> =>
  ttlService.runConsolidationJob(options);

export const scheduleNightlyJob = (options?: TTLJobOptions): NodeJS.Timeout =>
  ttlService.scheduleNightlyJob(options);

export const getConsolidationStats = (): Promise<{
  candidateDocuments: number;
  candidateChunks: number;
  totalCandidateTokens: number;
  estimatedReclamation: number;
}> => ttlService.getConsolidationStats();

export default ttlService;