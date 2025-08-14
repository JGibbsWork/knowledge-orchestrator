import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { loadEnv } from '../env.js';

export type ChunkSource = 'memory' | 'notion' | 'web';
export type ChunkPriority = 'low' | 'norm' | 'high';

export interface BaseChunk {
  _id?: ObjectId;
  source: ChunkSource;
  source_id?: string;      // ID from source system (memory doc ID, Notion page ID, etc.)
  url?: string;            // URL for web sources or source document URL
  scope: string;           // Logical grouping/namespace for chunks
  text: string;            // The actual text content
  tokens: number;          // Token count for the text
  embedding: number[];     // Vector embedding (typically 1536 dimensions for OpenAI)
  entities?: string[];     // Named entities extracted from text
  updated_at: Date;        // Last update timestamp
  priority?: ChunkPriority; // Processing/retrieval priority
  
  // G1: Privacy tags
  private?: boolean;       // Whether this chunk contains private/sensitive content
}

export interface Chunk extends BaseChunk {
  // No additional fields - permanent chunks
}

export interface EphemeralChunk extends BaseChunk {
  expires_at: Date;        // TTL expiration for ephemeral chunks
}

export interface ChunkInsertRequest {
  source: ChunkSource;
  source_id?: string;
  url?: string;
  scope: string;
  text: string;
  tokens: number;
  embedding: number[];
  entities?: string[];
  priority?: ChunkPriority;
  ephemeral?: boolean;     // Whether to insert into ephemeral collection
  ttlHours?: number;       // TTL in hours for ephemeral chunks (default: 48)
  updated_at?: Date;       // Custom updated_at timestamp (defaults to now)
  
  // G1: Privacy tags
  private?: boolean;       // Whether this chunk contains private/sensitive content
}

export interface VectorSearchOptions {
  limit?: number;          // Number of results to return (default: 10)
  minScore?: number;       // Minimum similarity score (0-1)
  filter?: {               // Optional filters
    source?: ChunkSource;
    scope?: string;
    priority?: ChunkPriority;
    // G1: Privacy filtering
    includePrivate?: boolean; // Whether to include private chunks (default: false)
  };
}

export interface VectorSearchResult {
  chunk: Chunk | EphemeralChunk;
  score: number;           // Similarity score (0-1)
}

export class ChunkServiceError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ChunkServiceError';
  }
}

class ChunkService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private chunksCollection: Collection<Chunk> | null = null;
  private ephemeralChunksCollection: Collection<EphemeralChunk> | null = null;
  private env = loadEnv();
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.initializeDatabase();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  private async initializeDatabase(): Promise<void> {
    try {
      this.client = new MongoClient(this.env.MONGO_URL);
      await this.client.connect();
      this.db = this.client.db('knowledge_orchestrator');
      
      this.chunksCollection = this.db.collection<Chunk>('chunks');
      this.ephemeralChunksCollection = this.db.collection<EphemeralChunk>('ephemeral_chunks');

      await this.createIndexes();
      
      console.log('Chunk service initialized with MongoDB');
    } catch (error) {
      console.error('Failed to initialize chunk service:', error);
      throw new ChunkServiceError(
        'Database initialization failed',
        'DB_INIT_ERROR',
        500
      );
    }
  }

  private async createIndexes(): Promise<void> {
    if (!this.chunksCollection || !this.ephemeralChunksCollection) {
      throw new ChunkServiceError('Collections not initialized', 'COLLECTION_ERROR');
    }

    try {
      // Create indexes for chunks collection
      await Promise.all([
        // Compound index for efficient filtering
        this.chunksCollection.createIndex({ 
          source: 1, 
          scope: 1, 
          updated_at: -1 
        }),
        
        // Index for source_id lookups
        this.chunksCollection.createIndex({ 
          source_id: 1 
        }, { 
          sparse: true 
        }),
        
        // Index for URL lookups
        this.chunksCollection.createIndex({ 
          url: 1 
        }, { 
          sparse: true 
        }),
        
        // Index for scope-based queries
        this.chunksCollection.createIndex({ 
          scope: 1, 
          priority: 1 
        }),
        
        // Text index for basic text search
        this.chunksCollection.createIndex({ 
          text: 'text',
          entities: 'text'
        })
      ]);

      // Create indexes for ephemeral_chunks collection
      await Promise.all([
        // TTL index for automatic expiration
        this.ephemeralChunksCollection.createIndex(
          { expires_at: 1 },
          { expireAfterSeconds: 0 }
        ),
        
        // Same indexes as chunks collection
        this.ephemeralChunksCollection.createIndex({ 
          source: 1, 
          scope: 1, 
          updated_at: -1 
        }),
        
        this.ephemeralChunksCollection.createIndex({ 
          source_id: 1 
        }, { 
          sparse: true 
        }),
        
        this.ephemeralChunksCollection.createIndex({ 
          url: 1 
        }, { 
          sparse: true 
        }),
        
        this.ephemeralChunksCollection.createIndex({ 
          scope: 1, 
          priority: 1 
        })
      ]);

      console.log('Database indexes created successfully');
      await this.setupVectorSearchIndexes();
      
    } catch (error) {
      console.error('Failed to create indexes:', error);
      throw new ChunkServiceError(
        'Index creation failed',
        'INDEX_ERROR',
        500
      );
    }
  }

  private async setupVectorSearchIndexes(): Promise<void> {
    try {
      // Note: Atlas Vector Search indexes must be created through Atlas UI or mongosh
      // This method provides the index specifications for manual creation
      
      const vectorIndexDefinition = {
        name: "vector_index",
        type: "vectorSearch",
        definition: {
          fields: [
            {
              type: "vector",
              path: "embedding",
              numDimensions: 1536, // OpenAI ada-002 embedding size
              similarity: "cosine"
            },
            {
              type: "filter",
              path: "source"
            },
            {
              type: "filter", 
              path: "scope"
            },
            {
              type: "filter",
              path: "priority"
            }
          ]
        }
      };

      const ephemeralVectorIndexDefinition = {
        name: "ephemeral_vector_index",
        type: "vectorSearch", 
        definition: {
          fields: [
            {
              type: "vector",
              path: "embedding",
              numDimensions: 1536,
              similarity: "cosine"
            },
            {
              type: "filter",
              path: "source"
            },
            {
              type: "filter",
              path: "scope"  
            },
            {
              type: "filter",
              path: "priority"
            }
          ]
        }
      };

      console.log('Vector Search Index Specifications:');
      console.log('For chunks collection:', JSON.stringify(vectorIndexDefinition, null, 2));
      console.log('For ephemeral_chunks collection:', JSON.stringify(ephemeralVectorIndexDefinition, null, 2));
      
      // Log instructions for manual creation
      console.log(`
📋 ATLAS VECTOR SEARCH INDEX SETUP INSTRUCTIONS:

1. Go to MongoDB Atlas → Database → Search → Create Search Index
2. Choose "Atlas Vector Search" and select JSON Editor
3. For 'chunks' collection, use this definition:
${JSON.stringify(vectorIndexDefinition, null, 2)}

4. For 'ephemeral_chunks' collection, use this definition:
${JSON.stringify(ephemeralVectorIndexDefinition, null, 2)}

5. Alternatively, use mongosh:
db.chunks.createSearchIndex(${JSON.stringify(vectorIndexDefinition, null, 2)})
db.ephemeral_chunks.createSearchIndex(${JSON.stringify(ephemeralVectorIndexDefinition, null, 2)})
      `);

    } catch (error) {
      console.error('Vector index setup instructions failed:', error);
    }
  }

  /**
   * Insert a chunk into the appropriate collection
   */
  async insertChunk(request: ChunkInsertRequest): Promise<ObjectId> {
    await this.ensureInitialized();
    const now = request.updated_at || new Date();
    
    const baseChunk = {
      source: request.source,
      source_id: request.source_id,
      url: request.url,
      scope: request.scope,
      text: request.text,
      tokens: request.tokens,
      embedding: request.embedding,
      entities: request.entities,
      updated_at: now,
      priority: request.priority || 'norm',
      // G1: Include private flag
      private: request.private || false
    };

    try {
      if (request.ephemeral) {
        // Insert into ephemeral collection with TTL
        const ttlHours = request.ttlHours || 48;
        const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
        
        const ephemeralChunk: EphemeralChunk = {
          ...baseChunk,
          expires_at: expiresAt
        };

        if (!this.ephemeralChunksCollection) {
          throw new ChunkServiceError('Ephemeral chunks collection not available');
        }

        const result = await this.ephemeralChunksCollection.insertOne(ephemeralChunk);
        console.log(`Inserted ephemeral chunk with ID: ${result.insertedId}`);
        return result.insertedId;
        
      } else {
        // Insert into permanent collection
        if (!this.chunksCollection) {
          throw new ChunkServiceError('Chunks collection not available');
        }

        const result = await this.chunksCollection.insertOne(baseChunk as Chunk);
        console.log(`Inserted chunk with ID: ${result.insertedId}`);
        return result.insertedId;
      }
      
    } catch (error) {
      console.error('Failed to insert chunk:', error);
      throw new ChunkServiceError(
        `Chunk insertion failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'INSERT_ERROR',
        500
      );
    }
  }

  /**
   * Perform vector similarity search
   * Note: Requires Atlas Vector Search indexes to be created manually
   */
  async vectorSearch(
    queryEmbedding: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    await this.ensureInitialized();
    const limit = options.limit || 10;
    const minScore = options.minScore || 0.0;
    
    try {
      // Search in both collections and combine results
      const [chunkResults, ephemeralResults] = await Promise.all([
        this.searchInCollection('chunks', queryEmbedding, options),
        this.searchInCollection('ephemeral_chunks', queryEmbedding, options)
      ]);

      // Combine and sort by score
      const allResults = [...chunkResults, ...ephemeralResults]
        .filter(result => result.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return allResults;
      
    } catch (error) {
      console.error('Vector search failed:', error);
      throw new ChunkServiceError(
        `Vector search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SEARCH_ERROR',
        500
      );
    }
  }

  private async searchInCollection(
    collectionName: 'chunks' | 'ephemeral_chunks',
    queryEmbedding: number[],
    options: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    const collection = collectionName === 'chunks' 
      ? this.chunksCollection 
      : this.ephemeralChunksCollection;
    
    if (!collection) {
      return [];
    }

    const indexName = collectionName === 'chunks' 
      ? 'vector_index' 
      : 'ephemeral_vector_index';

    // Build the aggregation pipeline for vector search
    const pipeline: any[] = [
      {
        $vectorSearch: {
          index: indexName,
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: (options.limit || 10) * 10, // Search more candidates for better results
          limit: options.limit || 10
        }
      }
    ];

    // Add filters if specified
    if (options.filter) {
      const matchStage: any = {};
      
      if (options.filter.source) {
        matchStage.source = options.filter.source;
      }
      
      if (options.filter.scope) {
        matchStage.scope = options.filter.scope;
      }
      
      if (options.filter.priority) {
        matchStage.priority = options.filter.priority;
      }

      // G1: Privacy filtering - exclude private chunks unless explicitly allowed
      if (!options.filter.includePrivate) {
        matchStage.private = { $ne: true }; // Exclude private chunks by default
      }

      if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
      }
    } else {
      // G1: Even without other filters, exclude private chunks by default
      pipeline.push({ 
        $match: { 
          private: { $ne: true } 
        } 
      });
    }

    // Add score projection
    pipeline.push({
      $addFields: {
        score: { $meta: "vectorSearchScore" }
      }
    });

    try {
      const results = await collection.aggregate(pipeline).toArray();
      
      return results.map(doc => ({
        chunk: doc as Chunk | EphemeralChunk,
        score: doc.score || 0
      }));
      
    } catch (error) {
      console.error(`Search in ${collectionName} failed:`, error);
      // Don't throw - return empty results to allow other collection to succeed
      return [];
    }
  }

  /**
   * Get chunks by source and scope
   */
  async getChunksByScope(
    source: ChunkSource,
    scope: string,
    limit: number = 100
  ): Promise<(Chunk | EphemeralChunk)[]> {
    await this.ensureInitialized();
    try {
      const [chunks, ephemeralChunks] = await Promise.all([
        this.chunksCollection?.find({ source, scope })
          .sort({ updated_at: -1 })
          .limit(limit)
          .toArray() || [],
        
        this.ephemeralChunksCollection?.find({ source, scope })
          .sort({ updated_at: -1 })
          .limit(limit)
          .toArray() || []
      ]);

      return [...chunks, ...ephemeralChunks]
        .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
        .slice(0, limit);
        
    } catch (error) {
      console.error('Failed to get chunks by scope:', error);
      throw new ChunkServiceError(
        `Failed to retrieve chunks: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'RETRIEVAL_ERROR',
        500
      );
    }
  }

  /**
   * Get collection statistics
   */
  async getStats(): Promise<{
    chunks: number;
    ephemeralChunks: number;
    totalTokens: number;
    sourceBreakdown: Record<ChunkSource, number>;
  }> {
    await this.ensureInitialized();
    try {
      const [chunkCount, ephemeralCount] = await Promise.all([
        this.chunksCollection?.countDocuments() || 0,
        this.ephemeralChunksCollection?.countDocuments() || 0
      ]);

      // Get total tokens and source breakdown
      const tokenStats = await this.chunksCollection?.aggregate([
        {
          $group: {
            _id: "$source",
            count: { $sum: 1 },
            totalTokens: { $sum: "$tokens" }
          }
        }
      ]).toArray() || [];

      const ephemeralTokenStats = await this.ephemeralChunksCollection?.aggregate([
        {
          $group: {
            _id: "$source", 
            count: { $sum: 1 },
            totalTokens: { $sum: "$tokens" }
          }
        }
      ]).toArray() || [];

      const sourceBreakdown: Record<ChunkSource, number> = {
        memory: 0,
        notion: 0,
        web: 0
      };

      let totalTokens = 0;

      [...tokenStats, ...ephemeralTokenStats].forEach(stat => {
        if (stat._id in sourceBreakdown) {
          sourceBreakdown[stat._id as ChunkSource] += stat.count;
          totalTokens += stat.totalTokens;
        }
      });

      return {
        chunks: chunkCount,
        ephemeralChunks: ephemeralCount,
        totalTokens,
        sourceBreakdown
      };
      
    } catch (error) {
      console.error('Failed to get chunk stats:', error);
      return {
        chunks: 0,
        ephemeralChunks: 0, 
        totalTokens: 0,
        sourceBreakdown: { memory: 0, notion: 0, web: 0 }
      };
    }
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
      this.ephemeralChunksCollection = null;
    }
  }
}

// Create and export singleton instance
const chunkService = new ChunkService();

export const insertChunk = (request: ChunkInsertRequest): Promise<ObjectId> =>
  chunkService.insertChunk(request);

export const vectorSearch = (
  queryEmbedding: number[],
  options?: VectorSearchOptions
): Promise<VectorSearchResult[]> =>
  chunkService.vectorSearch(queryEmbedding, options);

export const getChunksByScope = (
  source: ChunkSource,
  scope: string,
  limit?: number
): Promise<(Chunk | EphemeralChunk)[]> =>
  chunkService.getChunksByScope(source, scope, limit);

export const getChunkStats = () =>
  chunkService.getStats();

export default chunkService;