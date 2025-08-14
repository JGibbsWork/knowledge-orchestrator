import { generateQueryVariants } from './query-rewrite.js';
import { search as memorySearch } from '../adapters/memory.js';
import { search as notionSearch } from '../adapters/notion.js';
import { searchAndScrape } from './web.js';
import { ingestDocument } from './ingestion.js';
import { insertChunk } from './chunks.js';
import { chunkAndEmbed } from './embeddings.js';
import { rankAndFilter, type RankedItem } from './ranking.js';
import { compress, type CompressionResult, type Citation } from './compression.js';
import { loadEnv } from '../env.js';

export type ScopeType = 'personal' | 'domain' | 'web';

export interface PackRequest {
  agent_id: string;
  task: string;
  scope?: ScopeType[];
  k?: number;
  allow_web?: boolean;
  allow_private?: boolean;
  
  // F2: Request budgets for circuit breaker integration
  latency_ms_max?: number;
  token_budget_max?: number;
}

export interface Candidate {
  id: string;
  title: string;
  snippet: string;
  url?: string;
  score?: number;
  source: 'memory' | 'notion' | 'web';
  vectorScore?: number;
  textScore?: number;
  rrfScore?: number;
}

export interface PackResponse {
  agent_id: string;
  task: string;
  query_variants: string[];
  candidates: {
    personal?: Candidate[];
    domain?: Candidate[];
    web?: Candidate[];
  };
  context?: string;
  citations?: Citation[];
  debug: {
    query_generation_ms: number;
    personal_retrieval_ms?: number;
    domain_retrieval_ms?: number;
    web_retrieval_ms?: number;
    ranking_ms?: number;
    compression_ms?: number;
    total_ms: number;
    ingested_documents?: string[];
    compression_stats?: {
      input_chunks: number;
      input_tokens: number;
      output_tokens: number;
      compression_ratio: number;
      citations_used: number;
    };
  };
  total_candidates: number;
}

export class PackError extends Error {
  constructor(
    message: string,
    public scope?: string,
    public status?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'PackError';
  }
}

class PackService {
  private env = loadEnv();

  /**
   * Search personal/memory scope with auto-ingestion
   */
  private async searchPersonal(queries: string[], k: number, allowPrivate: boolean): Promise<{
    candidates: Candidate[];
    ingestedDocuments: string[];
    timingMs: number;
  }> {
    const startTime = Date.now();
    const candidates: Candidate[] = [];
    const ingestedDocuments: string[] = [];

    try {
      // Check privacy settings
      if (!allowPrivate && !this.env.ALLOW_PRIVATE_DEFAULT) {
        console.log('Personal scope access denied - private access not allowed');
        return { candidates: [], ingestedDocuments: [], timingMs: Date.now() - startTime };
      }

      // Search each query variant in memory
      for (const query of queries) {
        try {
          console.log(`Searching memory with query: "${query}"`);
          const memoryResults = await memorySearch(query, k);

          // Convert memory results to candidates
          for (const hit of memoryResults.slice(0, k)) {
            candidates.push({
              id: hit.id,
              title: `Memory Document ${hit.id}`,
              snippet: hit.text.substring(0, 200) + '...',
              url: hit.url,
              source: 'memory'
            });
          }

          // Auto-ingest documents that seem relevant but might be missing from chunks
          if (memoryResults.length > 0) {
            for (const hit of memoryResults.slice(0, 3)) { // Only ingest top 3
              try {
                console.log(`Auto-ingesting memory document: ${hit.id}`);
                const result = await ingestDocument({
                  source: 'memory',
                  id: hit.id,
                  scope: 'auto_ingest'
                });

                if (result.status === 'success' || result.status === 'no_change') {
                  ingestedDocuments.push(`memory:${hit.id}`);
                }
              } catch (ingestError) {
                console.error(`Failed to auto-ingest memory document ${hit.id}:`, ingestError);
                // Don't fail the entire search for ingestion errors
              }
            }
          }

        } catch (error) {
          console.error(`Memory search failed for query "${query}":`, error);
          // Continue with other queries
        }
      }

    } catch (error) {
      console.error('Personal scope search failed:', error);
      throw new PackError(
        `Personal scope search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'personal',
        500,
        'SEARCH_ERROR'
      );
    }

    return {
      candidates: candidates.slice(0, k), // Limit total results
      ingestedDocuments,
      timingMs: Date.now() - startTime
    };
  }

  /**
   * Search domain/notion scope with auto-ingestion
   */
  private async searchDomain(queries: string[], k: number): Promise<{
    candidates: Candidate[];
    ingestedDocuments: string[];
    timingMs: number;
  }> {
    const startTime = Date.now();
    const candidates: Candidate[] = [];
    const ingestedDocuments: string[] = [];

    try {
      // Search each query variant in notion
      for (const query of queries) {
        try {
          console.log(`Searching Notion with query: "${query}"`);
          const notionResults = await notionSearch(query, k);

          // Convert notion results to candidates
          for (const hit of notionResults.slice(0, k)) {
            candidates.push({
              id: hit.id,
              title: `Notion Page ${hit.id}`,
              snippet: hit.text.substring(0, 200) + '...',
              url: hit.url,
              source: 'notion'
            });
          }

          // Auto-ingest documents that seem relevant but might be missing from chunks
          if (notionResults.length > 0) {
            for (const hit of notionResults.slice(0, 3)) { // Only ingest top 3
              try {
                console.log(`Auto-ingesting Notion document: ${hit.id}`);
                const result = await ingestDocument({
                  source: 'notion',
                  id: hit.id,
                  scope: 'auto_ingest'
                });

                if (result.status === 'success' || result.status === 'no_change') {
                  ingestedDocuments.push(`notion:${hit.id}`);
                }
              } catch (ingestError) {
                console.error(`Failed to auto-ingest Notion document ${hit.id}:`, ingestError);
                // Don't fail the entire search for ingestion errors
              }
            }
          }

        } catch (error) {
          console.error(`Notion search failed for query "${query}":`, error);
          // Continue with other queries
        }
      }

    } catch (error) {
      console.error('Domain scope search failed:', error);
      throw new PackError(
        `Domain scope search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'domain',
        500,
        'SEARCH_ERROR'
      );
    }

    return {
      candidates: candidates.slice(0, k), // Limit total results
      ingestedDocuments,
      timingMs: Date.now() - startTime
    };
  }

  /**
   * Search web scope with scraping to ephemeral chunks
   */
  private async searchWeb(queries: string[], k: number, allowWeb: boolean): Promise<{
    candidates: Candidate[];
    timingMs: number;
  }> {
    const startTime = Date.now();
    const candidates: Candidate[] = [];

    try {
      if (!allowWeb) {
        console.log('Web scope access denied - web access not allowed');
        return { candidates: [], timingMs: Date.now() - startTime };
      }

      // Search each query variant on the web
      for (const query of queries) {
        try {
          console.log(`Searching web with query: "${query}"`);
          const webResults = await searchAndScrape(query, Math.min(k, 5)); // Limit web scraping

          // Convert web results to candidates and create ephemeral chunks
          for (const result of webResults.slice(0, k)) {
            candidates.push({
              id: result.url,
              title: result.title,
              snippet: result.snippet,
              url: result.url,
              source: 'web'
            });

            // Create ephemeral chunks from scraped content
            if (result.fullText) {
              try {
                console.log(`Creating ephemeral chunks for: ${result.url}`);
                const chunks = await chunkAndEmbed(result.fullText);
                
                for (const chunk of chunks.slice(0, 3)) { // Limit chunks per URL
                  // G1: Web content is generally public, but mark private if it contains sensitive info
                  const isPrivate = this.isWebContentPrivate(chunk.text, result.url);
                  
                  await insertChunk({
                    source: 'web',
                    url: result.url,
                    scope: 'web_search',
                    text: chunk.text,
                    tokens: chunk.tokens,
                    embedding: chunk.embedding,
                    ephemeral: true,
                    ttlHours: 2, // Short TTL for web content
                    private: isPrivate
                  });
                }
                
                console.log(`Created ${chunks.length} ephemeral chunks for ${result.url}`);
              } catch (chunkError) {
                console.error(`Failed to create ephemeral chunks for ${result.url}:`, chunkError);
                // Don't fail search for chunking errors
              }
            }
          }

        } catch (error) {
          console.error(`Web search failed for query "${query}":`, error);
          // Continue with other queries
        }
      }

    } catch (error) {
      console.error('Web scope search failed:', error);
      throw new PackError(
        `Web scope search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'web',
        500,
        'SEARCH_ERROR'
      );
    }

    return {
      candidates: candidates.slice(0, k), // Limit total results
      timingMs: Date.now() - startTime
    };
  }

  /**
   * Main pack function - orchestrates query rewrite and parallel retrieval
   */
  async pack(request: PackRequest): Promise<PackResponse> {
    const overallStartTime = Date.now();
    const {
      agent_id,
      task,
      scope = ['domain'],
      k = 10,
      allow_web = false,
      allow_private = this.env.ALLOW_PRIVATE_DEFAULT,
      // F2: Extract budget parameters
      latency_ms_max,
      token_budget_max
    } = request;

    console.log(`Starting pack operation for agent ${agent_id} with task: "${task}"`);
    console.log(`Scopes: [${scope.join(', ')}], k=${k}, allow_web=${allow_web}, allow_private=${allow_private}`);
    
    // F2: Log budget constraints
    if (latency_ms_max || token_budget_max) {
      console.log(`Budget constraints: latency_max=${latency_ms_max}ms, token_max=${token_budget_max}`);
    }

    const debug = {
      query_generation_ms: 0,
      personal_retrieval_ms: undefined as number | undefined,
      domain_retrieval_ms: undefined as number | undefined,
      web_retrieval_ms: undefined as number | undefined,
      ranking_ms: undefined as number | undefined,
      compression_ms: undefined as number | undefined,
      total_ms: 0,
      ingested_documents: [] as string[],
      compression_stats: undefined as {
        input_chunks: number;
        input_tokens: number;
        output_tokens: number;
        compression_ratio: number;
        citations_used: number;
      } | undefined
    };

    try {
      // F2: Helper function to check latency budget
      const checkLatencyBudget = (stepName: string) => {
        if (latency_ms_max) {
          const elapsed = Date.now() - overallStartTime;
          if (elapsed > latency_ms_max * 0.9) { // 90% of budget used
            console.warn(`⚠️  Approaching latency budget: ${elapsed}/${latency_ms_max}ms at ${stepName}`);
          }
          if (elapsed > latency_ms_max) {
            throw new PackError(
              `Latency budget exceeded: ${elapsed}ms > ${latency_ms_max}ms at ${stepName}`,
              undefined,
              408,
              'LATENCY_BUDGET_EXCEEDED'
            );
          }
        }
      };

      // Step 1: Generate query variants
      console.log('Step 1: Generating query variants...');
      const queryStartTime = Date.now();
      const queryVariants = await generateQueryVariants(task);
      debug.query_generation_ms = Date.now() - queryStartTime;
      
      checkLatencyBudget('query generation');
      
      const allQueries = [queryVariants.original, ...queryVariants.variants];
      console.log(`Generated ${queryVariants.variants.length} variants: [${queryVariants.variants.join(', ')}]`);

      // Step 2: Parallel retrieval based on requested scopes
      console.log('Step 2: Starting parallel retrieval...');
      const retrievalPromises: Array<Promise<any>> = [];
      
      // Personal scope
      if (scope.includes('personal')) {
        retrievalPromises.push(
          this.searchPersonal(allQueries, k, allow_private)
            .then(result => ({ type: 'personal', ...result }))
            .catch(error => ({ type: 'personal', error }))
        );
      }

      // Domain scope  
      if (scope.includes('domain')) {
        retrievalPromises.push(
          this.searchDomain(allQueries, k)
            .then(result => ({ type: 'domain', ...result }))
            .catch(error => ({ type: 'domain', error }))
        );
      }

      // Web scope
      if (scope.includes('web')) {
        retrievalPromises.push(
          this.searchWeb(allQueries, k, allow_web)
            .then(result => ({ type: 'web', ...result }))
            .catch(error => ({ type: 'web', error }))
        );
      }

      // Wait for all searches to complete
      const results = await Promise.all(retrievalPromises);
      
      checkLatencyBudget('parallel retrieval');
      
      // Step 3: Collect all candidates for ranking and filtering
      const allCandidates: RankedItem[] = [];
      const candidates: PackResponse['candidates'] = {};

      for (const result of results) {
        if (result.error) {
          console.error(`${result.type} scope failed:`, result.error);
          continue;
        }

        // Set timing debug info and collect candidates
        if (result.type === 'personal') {
          debug.personal_retrieval_ms = result.timingMs;
          if (result.ingestedDocuments) {
            debug.ingested_documents!.push(...result.ingestedDocuments);
          }
          // Add to unified list for ranking
          allCandidates.push(...(result.candidates || []));
        } else if (result.type === 'domain') {
          debug.domain_retrieval_ms = result.timingMs;
          if (result.ingestedDocuments) {
            debug.ingested_documents!.push(...result.ingestedDocuments);
          }
          // Add to unified list for ranking
          allCandidates.push(...(result.candidates || []));
        } else if (result.type === 'web') {
          debug.web_retrieval_ms = result.timingMs;
          // Add to unified list for ranking
          allCandidates.push(...(result.candidates || []));
        }
      }

      // Step 4: Apply RRF ranking and diversity filtering
      console.log('Step 4: Applying RRF ranking and diversity filtering...');
      const rankingStartTime = Date.now();
      
      let rankedCandidates: RankedItem[] = [];
      if (allCandidates.length > 0) {
        // Create separate lists for vector and text ranking
        const vectorList = allCandidates.filter(c => c.vectorScore !== undefined);
        const textList = allCandidates; // All candidates get text scores
        
        // Apply ranking and filtering
        rankedCandidates = rankAndFilter(
          vectorList,
          textList,
          task, // Use original task as query
          { k: 60, weights: { vector: 1.0, text: 0.8 } }, // Slight preference for vector scores
          { simHashThreshold: 0.85, maxResults: k } // Keep top k results
        );
      }
      
      const rankingMs = Date.now() - rankingStartTime;
      debug.ranking_ms = rankingMs;
      console.log(`Ranking and filtering completed in ${rankingMs}ms`);

      checkLatencyBudget('ranking and filtering');

      // Step 5: Compress to summary with citations
      console.log('Step 5: Compressing candidates to summary...');
      const compressionStartTime = Date.now();
      
      let compressionResult: CompressionResult | null = null;
      if (rankedCandidates.length > 0) {
        try {
          // F2: Apply token budget constraint to compression
          const targetTokens = token_budget_max || 1500;
          
          compressionResult = await compress(rankedCandidates, {
            targetTokens,
            maxCitations: Math.min(20, rankedCandidates.length),
            includeUrls: true
          });
          
          console.log(`Compression with budget ${targetTokens} tokens completed: ${compressionResult.debug.compression_stats.input_tokens} → ${compressionResult.debug.token_usage.actual} tokens (${compressionResult.citations.length} citations)`);
        } catch (compressionError) {
          console.error('Compression failed:', compressionError);
          // Continue without compression
        }
      }
      
      const compressionMs = Date.now() - compressionStartTime;
      debug.compression_ms = compressionMs;

      // Step 6: Organize final results by scope
      for (const candidate of rankedCandidates) {
        if (candidate.source === 'memory') {
          if (!candidates.personal) candidates.personal = [];
          candidates.personal.push(candidate as Candidate);
        } else if (candidate.source === 'notion') {
          if (!candidates.domain) candidates.domain = [];
          candidates.domain.push(candidate as Candidate);
        } else if (candidate.source === 'web') {
          if (!candidates.web) candidates.web = [];
          candidates.web.push(candidate as Candidate);
        }
      }

      const totalCandidates = rankedCandidates.length;

      debug.total_ms = Date.now() - overallStartTime;
      
      // Add compression statistics to debug
      if (compressionResult) {
        debug.compression_stats = {
          input_chunks: compressionResult.debug.compression_stats.input_chunks,
          input_tokens: compressionResult.debug.compression_stats.input_tokens,
          output_tokens: compressionResult.debug.compression_stats.output_tokens,
          compression_ratio: compressionResult.debug.compression_stats.compression_ratio,
          citations_used: compressionResult.citations.length
        };
      }
      
      console.log(`Pack operation completed in ${debug.total_ms}ms with ${totalCandidates} total candidates${compressionResult ? ` and ${compressionResult.citations.length} citations` : ''}`);

      return {
        agent_id,
        task,
        query_variants: queryVariants.variants,
        candidates,
        context: compressionResult?.context,
        citations: compressionResult?.citations,
        debug,
        total_candidates: totalCandidates
      };

    } catch (error) {
      debug.total_ms = Date.now() - overallStartTime;
      console.error('Pack operation failed:', error);
      
      throw new PackError(
        `Pack operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        500,
        'PACK_ERROR'
      );
    }
  }

  /**
   * G1: Simple privacy detection for web content
   */
  private isWebContentPrivate(text: string, url: string): boolean {
    // Check for sensitive patterns in web content
    const sensitivePatterns = [
      /\b(login|password|auth|credential|token)/i,
      /\b(private|confidential|restricted|internal)/i,
      /\b\w+@\w+\.\w+/,                    // Email addresses
      /\b\d{3}-\d{2}-\d{4}\b/,            // SSN pattern
      /\b(api key|secret|private key)/i
    ];

    const hasPrivateContent = sensitivePatterns.some(pattern => pattern.test(text));
    
    // Check URL patterns that might indicate private content
    const privateUrlPatterns = [
      /\/admin\//,
      /\/private\//,
      /\/internal\//,
      /\/dashboard\//,
      /\.local$/,
      /localhost/,
      /127\.0\.0\.1/,
      /192\.168\./,
      /10\.\d+\./
    ];
    
    const hasPrivateUrl = privateUrlPatterns.some(pattern => pattern.test(url));
    
    const isPrivate = hasPrivateContent || hasPrivateUrl;
    
    if (isPrivate) {
      console.log(`🔒 Web content marked as private: ${url}`);
    }
    
    return isPrivate;
  }
}

// Create and export singleton instance
const packService = new PackService();

export const pack = (request: PackRequest): Promise<PackResponse> =>
  packService.pack(request);

export default packService;