import { countTokens } from './embeddings.js';
import { type RankedItem } from './ranking.js';

export interface CitationSource {
  id: string;
  source: 'memory' | 'notion' | 'web';
  url?: string;
  source_id?: string;
  title: string;
}

export interface Citation {
  id: string;           // Unique citation ID (e.g., "[1]", "[2]")
  source: CitationSource;
  snippet: string;      // Original snippet from the source
  used_in_context: boolean; // Whether this citation appears in the context
}

export interface CompressionResult {
  context: string;      // Compressed summary with inline citations
  citations: Citation[]; // List of all citations
  debug: {
    timings: {
      extraction_ms: number;
      compression_ms: number;
      citation_ms: number;
      total_ms: number;
    };
    source_breakdown: {
      [source: string]: {
        count: number;
        tokens: number;
        citations: number;
      };
    };
    token_usage: {
      target: number;
      actual: number;
      efficiency: number; // actual/target ratio
    };
    compression_stats: {
      input_chunks: number;
      input_tokens: number;
      output_tokens: number;
      compression_ratio: number;
    };
  };
}

export interface CompressionOptions {
  targetTokens?: number;        // Target token count (default: 1500)
  maxCitations?: number;        // Maximum citations to include (default: 20)
  snippetLength?: number;       // Max length per snippet in chars (default: 200)
  prioritizeRecent?: boolean;   // Whether to prioritize recent content (default: false)
  includeUrls?: boolean;        // Whether to include URLs in citations (default: true)
}

export class CompressionError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number
  ) {
    super(message);
    this.name = 'CompressionError';
  }
}

class CompressionService {
  /**
   * Extract key information and create initial citations
   */
  private extractKeyInfo(rankedItems: RankedItem[]): {
    keyPoints: Array<{
      content: string;
      importance: number;
      citationId: string;
      source: CitationSource;
    }>;
    citations: Map<string, Citation>;
  } {
    const keyPoints: Array<{
      content: string;
      importance: number;
      citationId: string;
      source: CitationSource;
    }> = [];
    const citations = new Map<string, Citation>();

    rankedItems.forEach((item, index) => {
      const citationId = `[${index + 1}]`;
      
      // Create citation source
      const source: CitationSource = {
        id: item.id,
        source: item.source,
        url: item.url,
        source_id: item.id, // Use ID as source_id for now
        title: item.title
      };

      // Create citation
      const citation: Citation = {
        id: citationId,
        source,
        snippet: item.snippet,
        used_in_context: false
      };

      citations.set(citationId, citation);

      // Calculate importance based on ranking scores
      const vectorWeight = item.vectorScore ? item.vectorScore * 0.4 : 0;
      const textWeight = item.textScore ? Math.min(item.textScore / 10, 1) * 0.3 : 0;
      const rrfWeight = item.rrfScore ? item.rrfScore * 10 : 0; // Scale RRF score
      const rankWeight = Math.max(0, 1 - (index / rankedItems.length)) * 0.3;
      
      const importance = vectorWeight + textWeight + rrfWeight + rankWeight;

      // Extract meaningful sentences from snippet
      const sentences = this.extractSentences(item.snippet);
      sentences.forEach(sentence => {
        if (sentence.length > 20) { // Skip very short sentences
          keyPoints.push({
            content: sentence,
            importance: importance,
            citationId,
            source
          });
        }
      });
    });

    // Sort by importance
    keyPoints.sort((a, b) => b.importance - a.importance);

    return { keyPoints, citations };
  }

  /**
   * Extract sentences from text
   */
  private extractSentences(text: string): string[] {
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 10)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1)); // Capitalize first letter
  }

  /**
   * Compress content into bullet points with citations
   */
  private compressToSummary(
    keyPoints: Array<{
      content: string;
      importance: number;
      citationId: string;
      source: CitationSource;
    }>,
    targetTokens: number,
    citations: Map<string, Citation>
  ): string {
    const maxBullets = Math.min(15, keyPoints.length); // Limit bullet points
    const targetTokensPerBullet = Math.floor(targetTokens * 0.8 / maxBullets); // 80% for bullets, 20% for structure

    let summary = '';
    let currentTokens = 0;
    const usedCitations = new Set<string>();
    let bulletCount = 0;

    // Add header
    const header = '## Key Insights\n\n';
    summary += header;
    currentTokens += countTokens(header);

    // Group points by theme/source to avoid repetition
    const grouped = this.groupKeyPoints(keyPoints);

    for (const group of grouped) {
      if (bulletCount >= maxBullets) break;
      
      // Create bullet point
      const bulletContent = this.createBulletPoint(group, targetTokensPerBullet);
      const bulletTokens = countTokens(bulletContent);
      
      if (currentTokens + bulletTokens > targetTokens * 0.95) { // Leave 5% buffer
        break;
      }
      
      summary += bulletContent;
      currentTokens += bulletTokens;
      bulletCount++;

      // Mark citations as used
      group.forEach(point => {
        usedCitations.add(point.citationId);
        const citation = citations.get(point.citationId);
        if (citation) {
          citation.used_in_context = true;
        }
      });
    }

    return summary;
  }

  /**
   * Group key points by similarity to reduce redundancy
   */
  private groupKeyPoints(
    keyPoints: Array<{
      content: string;
      importance: number;
      citationId: string;
      source: CitationSource;
    }>
  ): Array<Array<{
    content: string;
    importance: number;
    citationId: string;
    source: CitationSource;
  }>> {
    const groups: Array<Array<typeof keyPoints[0]>> = [];
    const used = new Set<number>();

    for (let i = 0; i < keyPoints.length; i++) {
      if (used.has(i)) continue;

      const group = [keyPoints[i]];
      used.add(i);

      // Find similar points to group together
      for (let j = i + 1; j < keyPoints.length && group.length < 3; j++) {
        if (used.has(j)) continue;

        const similarity = this.calculateTextSimilarity(
          keyPoints[i].content,
          keyPoints[j].content
        );

        if (similarity > 0.3) { // Group similar content
          group.push(keyPoints[j]);
          used.add(j);
        }
      }

      groups.push(group);
      
      if (groups.length >= 12) break; // Limit number of groups
    }

    return groups;
  }

  /**
   * Calculate simple text similarity
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * Create a bullet point from grouped content
   */
  private createBulletPoint(
    group: Array<{
      content: string;
      importance: number;
      citationId: string;
      source: CitationSource;
    }>,
    targetTokens: number
  ): string {
    // Take the most important point as the main content
    const mainPoint = group[0];
    let content = mainPoint.content;

    // Add supporting information from other points in group
    if (group.length > 1) {
      const supportingInfo = group.slice(1)
        .map(p => p.content)
        .join(' ');
      
      // Merge content intelligently
      content = this.mergeContent(content, supportingInfo, targetTokens * 0.8);
    }

    // Add citations
    const citationIds = [...new Set(group.map(p => p.citationId))];
    const citationText = citationIds.join(' ');

    const bullet = `• ${content} ${citationText}\n\n`;
    
    return bullet;
  }

  /**
   * Merge content while respecting token limits
   */
  private mergeContent(main: string, supporting: string, maxTokens: number): string {
    const mainTokens = countTokens(main);
    const remainingTokens = maxTokens - mainTokens;
    
    if (remainingTokens <= 10) {
      return main;
    }

    // Truncate supporting content if needed
    const supportingWords = supporting.split(/\s+/);
    const maxSupportingWords = Math.floor(remainingTokens * 0.75); // Rough token estimation
    
    if (supportingWords.length > maxSupportingWords) {
      const truncated = supportingWords.slice(0, maxSupportingWords).join(' ');
      return `${main}. Additionally, ${truncated}...`;
    }
    
    return `${main}. ${supporting}`;
  }

  /**
   * Calculate source breakdown statistics
   */
  private calculateSourceBreakdown(
    citations: Map<string, Citation>
  ): { [source: string]: { count: number; tokens: number; citations: number } } {
    const breakdown: { [source: string]: { count: number; tokens: number; citations: number } } = {};

    for (const citation of citations.values()) {
      const sourceKey = citation.source.source;
      
      if (!breakdown[sourceKey]) {
        breakdown[sourceKey] = { count: 0, tokens: 0, citations: 0 };
      }

      breakdown[sourceKey].count += 1;
      breakdown[sourceKey].tokens += countTokens(citation.snippet);
      if (citation.used_in_context) {
        breakdown[sourceKey].citations += 1;
      }
    }

    return breakdown;
  }

  /**
   * Main compression function
   */
  async compress(
    rankedItems: RankedItem[],
    options: CompressionOptions = {}
  ): Promise<CompressionResult> {
    const startTime = Date.now();
    const targetTokens = options.targetTokens || 1500;
    const maxCitations = options.maxCitations || 20;

    if (rankedItems.length === 0) {
      throw new CompressionError('No items provided for compression', 'NO_INPUT', 400);
    }

    console.log(`Starting compression of ${rankedItems.length} items to ${targetTokens} tokens...`);

    // Step 1: Extract key information and create citations
    const extractionStart = Date.now();
    const { keyPoints, citations } = this.extractKeyInfo(rankedItems.slice(0, maxCitations));
    const extractionMs = Date.now() - extractionStart;

    // Step 2: Compress to summary with citations
    const compressionStart = Date.now();
    const context = this.compressToSummary(keyPoints, targetTokens, citations);
    const compressionMs = Date.now() - compressionStart;

    // Step 3: Finalize citations and create result
    const citationStart = Date.now();
    const finalCitations = Array.from(citations.values())
      .filter(c => c.used_in_context)
      .sort((a, b) => parseInt(a.id.replace(/[\[\]]/g, '')) - parseInt(b.id.replace(/[\[\]]/g, '')));
    const citationMs = Date.now() - citationStart;

    const totalMs = Date.now() - startTime;

    // Calculate statistics
    const actualTokens = countTokens(context);
    const inputTokens = rankedItems.reduce((sum, item) => sum + countTokens(item.snippet), 0);
    const sourceBreakdown = this.calculateSourceBreakdown(citations);

    console.log(`Compression completed: ${rankedItems.length} items → ${actualTokens} tokens (${finalCitations.length} citations)`);

    return {
      context,
      citations: finalCitations,
      debug: {
        timings: {
          extraction_ms: extractionMs,
          compression_ms: compressionMs,
          citation_ms: citationMs,
          total_ms: totalMs
        },
        source_breakdown: sourceBreakdown,
        token_usage: {
          target: targetTokens,
          actual: actualTokens,
          efficiency: actualTokens / targetTokens
        },
        compression_stats: {
          input_chunks: rankedItems.length,
          input_tokens: inputTokens,
          output_tokens: actualTokens,
          compression_ratio: inputTokens > 0 ? actualTokens / inputTokens : 0
        }
      }
    };
  }
}

// Create and export singleton instance
const compressionService = new CompressionService();

export const compress = (
  rankedItems: RankedItem[],
  options?: CompressionOptions
): Promise<CompressionResult> => compressionService.compress(rankedItems, options);

export default compressionService;