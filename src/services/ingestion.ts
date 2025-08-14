import { ObjectId } from 'mongodb';
import { fetchDocument as memoryFetchDocument } from '../adapters/memory.js';
import { fetchDocument as notionFetchDocument } from '../adapters/notion.js';
import { chunkAndEmbed } from './embeddings.js';
import { insertChunk, getChunksByScope, type ChunkSource } from './chunks.js';

export interface UpstreamDocument {
  id: string;
  title: string;
  content: string;
  updated_at: string;
  url?: string;
}

export interface IngestRequest {
  source: 'memory' | 'notion';
  id: string;
  scope?: string;
}

export interface IngestResult {
  source: ChunkSource;
  id: string;
  status: 'success' | 'no_change' | 'error';
  chunks_created: number;
  chunks_updated: number;
  total_tokens: number;
  updated_at: string;
  message?: string;
  error?: string;
}

export class IngestionError extends Error {
  constructor(
    message: string,
    public source?: string,
    public documentId?: string,
    public code?: string,
    public status?: number
  ) {
    super(message);
    this.name = 'IngestionError';
  }
}

class IngestionService {

  /**
   * Fetch document from memory adapter
   */
  private async fetchFromMemory(id: string): Promise<UpstreamDocument> {
    try {
      const document = await memoryFetchDocument(id);
      
      return {
        id: document.id,
        title: 'Untitled', // Memory adapter doesn't provide title
        content: document.text || '',
        updated_at: document.updated_at || new Date().toISOString(),
        url: document.url
      };
    } catch (error) {
      throw new IngestionError(
        `Failed to fetch document from memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'memory',
        id,
        'FETCH_ERROR',
        500
      );
    }
  }

  /**
   * Fetch document from notion adapter
   */
  private async fetchFromNotion(id: string): Promise<UpstreamDocument> {
    try {
      const document = await notionFetchDocument(id);
      
      return {
        id: document.id,
        title: 'Untitled', // Notion adapter doesn't provide title in UpstreamHit
        content: document.text || '',
        updated_at: document.updated_at || new Date().toISOString(),
        url: document.url
      };
    } catch (error) {
      throw new IngestionError(
        `Failed to fetch document from Notion: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'notion',
        id,
        'FETCH_ERROR',
        500
      );
    }
  }

  /**
   * Fetch document from specified source
   */
  private async fetchDocument(source: 'memory' | 'notion', id: string): Promise<UpstreamDocument> {
    switch (source) {
      case 'memory':
        return this.fetchFromMemory(id);
      case 'notion':
        return this.fetchFromNotion(id);
      default:
        throw new IngestionError(
          `Unsupported source: ${source}`,
          source,
          id,
          'INVALID_SOURCE',
          400
        );
    }
  }

  /**
   * Check if document has changed by comparing updated_at timestamps
   */
  private async checkIfDocumentChanged(
    source: ChunkSource,
    sourceId: string,
    scope: string,
    newUpdatedAt: string
  ): Promise<boolean> {
    try {
      // Get existing chunks for this document
      const existingChunks = await getChunksByScope(source, scope);
      
      // Find chunks with matching source_id
      const documentChunks = existingChunks.filter(chunk => chunk.source_id === sourceId);
      
      if (documentChunks.length === 0) {
        // No existing chunks, document is new
        console.log(`No existing chunks found for ${source}:${sourceId}, treating as new document`);
        return true;
      }

      // Check if any chunk has a different updated_at timestamp
      // All chunks for the same document should have the same updated_at
      const existingUpdatedAt = documentChunks[0].updated_at;
      const newTimestamp = new Date(newUpdatedAt);
      
      console.log(`Comparing timestamps - Existing: ${existingUpdatedAt.toISOString()}, New: ${newTimestamp.toISOString()}`);
      
      // If timestamps match, document hasn't changed
      const hasChanged = existingUpdatedAt.getTime() !== newTimestamp.getTime();
      console.log(`Document ${source}:${sourceId} has ${hasChanged ? 'changed' : 'not changed'}`);
      
      return hasChanged;
    } catch (error) {
      console.error('Error checking document change status:', error);
      // On error, assume document has changed to be safe
      return true;
    }
  }

  /**
   * Remove existing chunks for a document before inserting new ones
   */
  private async removeExistingChunks(
    source: ChunkSource,
    sourceId: string,
    scope: string
  ): Promise<number> {
    try {
      // Get existing chunks for this document
      const existingChunks = await getChunksByScope(source, scope);
      
      // Filter to chunks with matching source_id
      const documentChunks = existingChunks.filter(chunk => chunk.source_id === sourceId);
      
      if (documentChunks.length === 0) {
        return 0;
      }

      // For now, we'll track removal count but actual deletion would require
      // adding a delete method to the chunks service
      console.log(`Would remove ${documentChunks.length} existing chunks for ${source}:${sourceId}`);
      
      return documentChunks.length;
    } catch (error) {
      console.error('Error removing existing chunks:', error);
      return 0;
    }
  }

  /**
   * Ingest document from upstream source
   */
  async ingestDocument(request: IngestRequest): Promise<IngestResult> {
    const { source, id, scope = 'default' } = request;
    
    console.log(`Starting ingestion for ${source}:${id} in scope '${scope}'`);

    try {
      // 1. Fetch document from upstream source
      console.log(`Fetching document ${id} from ${source}...`);
      const document = await this.fetchDocument(source, id);
      
      if (!document.content || document.content.trim().length === 0) {
        return {
          source,
          id,
          status: 'error',
          chunks_created: 0,
          chunks_updated: 0,
          total_tokens: 0,
          updated_at: document.updated_at,
          error: 'Document content is empty'
        };
      }

      // 2. Check if document has changed since last ingestion
      console.log(`Checking if document has changed...`);
      const hasChanged = await this.checkIfDocumentChanged(
        source,
        id,
        scope,
        document.updated_at
      );

      if (!hasChanged) {
        console.log(`Document ${source}:${id} has not changed, skipping ingestion`);
        return {
          source,
          id,
          status: 'no_change',
          chunks_created: 0,
          chunks_updated: 0,
          total_tokens: 0,
          updated_at: document.updated_at,
          message: 'Document has not changed since last ingestion'
        };
      }

      // 3. Remove existing chunks for this document
      console.log(`Removing existing chunks...`);
      const removedChunks = await this.removeExistingChunks(source, id, scope);

      // 4. Chunk and embed the document content
      console.log(`Chunking and embedding document content...`);
      const chunks = await chunkAndEmbed(document.content);
      
      if (chunks.length === 0) {
        return {
          source,
          id,
          status: 'error',
          chunks_created: 0,
          chunks_updated: 0,
          total_tokens: 0,
          updated_at: document.updated_at,
          error: 'Failed to create chunks from document content'
        };
      }

      // 5. Insert chunks into database
      console.log(`Inserting ${chunks.length} chunks into database...`);
      let totalTokens = 0;
      const insertedChunkIds: ObjectId[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        totalTokens += chunk.tokens;

        try {
          // G1: Determine if chunk contains private content
          const isPrivate = this.isContentPrivate(chunk.text, source, scope);
          
          const chunkId = await insertChunk({
            source,
            source_id: id,
            url: document.url,
            scope,
            text: chunk.text,
            tokens: chunk.tokens,
            embedding: chunk.embedding,
            priority: 'norm',
            updated_at: new Date(document.updated_at),
            private: isPrivate
          });

          insertedChunkIds.push(chunkId);
          console.log(`Inserted chunk ${i + 1}/${chunks.length} with ID: ${chunkId}`);
        } catch (error) {
          console.error(`Failed to insert chunk ${i + 1}:`, error);
          throw new IngestionError(
            `Failed to insert chunk ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            source,
            id,
            'CHUNK_INSERT_ERROR',
            500
          );
        }
      }

      console.log(`Successfully ingested ${source}:${id} - created ${chunks.length} chunks with ${totalTokens} total tokens`);

      return {
        source,
        id,
        status: 'success',
        chunks_created: chunks.length,
        chunks_updated: removedChunks,
        total_tokens: totalTokens,
        updated_at: document.updated_at,
        message: `Successfully processed ${chunks.length} chunks from document`
      };

    } catch (error) {
      console.error(`Ingestion failed for ${source}:${id}:`, error);
      
      if (error instanceof IngestionError) {
        return {
          source,
          id,
          status: 'error',
          chunks_created: 0,
          chunks_updated: 0,
          total_tokens: 0,
          updated_at: new Date().toISOString(),
          error: error.message
        };
      }

      return {
        source,
        id,
        status: 'error',
        chunks_created: 0,
        chunks_updated: 0,
        total_tokens: 0,
        updated_at: new Date().toISOString(),
        error: `Ingestion failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Batch ingest multiple documents
   */
  async ingestDocuments(requests: IngestRequest[]): Promise<IngestResult[]> {
    const results: IngestResult[] = [];
    
    for (const request of requests) {
      try {
        const result = await this.ingestDocument(request);
        results.push(result);
        
        // Small delay between documents to be respectful to upstream APIs
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Failed to ingest ${request.source}:${request.id}:`, error);
        results.push({
          source: request.source,
          id: request.id,
          status: 'error',
          chunks_created: 0,
          chunks_updated: 0,
          total_tokens: 0,
          updated_at: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }

  /**
   * G1: Determine if content should be marked as private
   * This is a simple heuristic-based approach that can be enhanced
   */
  private isContentPrivate(text: string, source: ChunkSource, scope: string): boolean {
    // Basic privacy detection heuristics
    const privateIndicators = [
      // Personal identifiers
      /\b\d{3}-\d{2}-\d{4}\b/,           // SSN pattern
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email addresses
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card pattern
      /\bphone:\s*[\d\s\-\(\)]+/i,       // Phone numbers
      /\bmobile:\s*[\d\s\-\(\)]+/i,      // Mobile numbers
      
      // Financial information
      /\$[\d,]+\.\d{2}/,                 // Dollar amounts
      /\b(salary|wage|income|profit|revenue|budget):\s*\$?[\d,]+/i,
      /\b(account|routing)\s*number/i,
      
      // Sensitive business information
      /\b(confidential|proprietary|internal only|classified|restricted)/i,
      /\b(api key|secret|password|token|credentials)/i,
      /\b(customer data|user data|personal information)/i,
      /\bnda\b|\bnon.disclosure/i,       // Non-disclosure agreements
      
      // Private company information
      /\b(board meeting|executive|c-level|ceo|cto|cfo)/i,
      /\b(acquisition|merger|layoffs|reorganization)/i,
      /\b(performance review|hr matter|personnel)/i
    ];

    // Check if text contains any private indicators
    const hasPrivateContent = privateIndicators.some(pattern => pattern.test(text));
    
    // Scope-based privacy rules
    const privateScopePatterns = [
      /^private_/,                       // Scopes starting with 'private_'
      /^personal_/,                      // Scopes starting with 'personal_'  
      /^confidential_/,                  // Scopes starting with 'confidential_'
      /^internal_/,                      // Scopes starting with 'internal_'
      /hr|human.resources/i,             // HR-related scopes
      /finance|accounting|payroll/i,     // Financial scopes
      /executive|board|management/i      // Executive scopes
    ];
    
    const hasPrivateScope = privateScopePatterns.some(pattern => pattern.test(scope));
    
    // Source-specific rules
    let sourceBasedPrivacy = false;
    if (source === 'memory') {
      // Memory content is often personal/private by default
      sourceBasedPrivacy = true;
    }
    
    const isPrivate = hasPrivateContent || hasPrivateScope || sourceBasedPrivacy;
    
    if (isPrivate) {
      console.log(`🔒 Content marked as private (source: ${source}, scope: ${scope}, indicators: ${hasPrivateContent})`);
    }
    
    return isPrivate;
  }
}

// Create and export singleton instance
const ingestionService = new IngestionService();

export const ingestDocument = (request: IngestRequest): Promise<IngestResult> =>
  ingestionService.ingestDocument(request);

export const ingestDocuments = (requests: IngestRequest[]): Promise<IngestResult[]> =>
  ingestionService.ingestDocuments(requests);

export default ingestionService;