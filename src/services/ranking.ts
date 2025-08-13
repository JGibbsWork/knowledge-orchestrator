// Removed unused import

export interface RankedItem {
  id: string;
  title: string;
  snippet: string;
  url?: string;
  source: 'memory' | 'notion' | 'web';
  vectorScore?: number;
  textScore?: number;
  rrfScore?: number;
  simHash?: string;
}

export interface RankingList {
  name: string;
  items: RankedItem[];
}

export interface RRFOptions {
  k?: number;           // RRF parameter (default: 60)
  weights?: {           // Weights for different scoring methods
    vector?: number;    // Vector similarity weight (default: 1.0)
    text?: number;      // Text relevance weight (default: 1.0)
  };
}

export interface DiversityOptions {
  simHashThreshold?: number;  // SimHash similarity threshold (default: 0.85)
  maxResults?: number;        // Maximum results to return (default: 20)
}

export class RankingError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number
  ) {
    super(message);
    this.name = 'RankingError';
  }
}

class RankingService {
  // TF-IDF implementation removed - using BM25 instead

  /**
   * Calculate BM25 score for a document against a query
   */
  private calculateBm25(text: string, query: string, avgDocLength: number = 100): number {
    const k1 = 1.5;  // Term frequency saturation parameter
    const b = 0.75;  // Length normalization parameter
    
    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    const docTerms = text.toLowerCase().split(/\s+/);
    const docLength = docTerms.length;
    
    if (docLength === 0 || queryTerms.length === 0) {
      return 0;
    }

    // Calculate term frequencies in document
    const termFreqs: { [term: string]: number } = {};
    for (const term of docTerms) {
      termFreqs[term] = (termFreqs[term] || 0) + 1;
    }

    let score = 0;
    
    for (const queryTerm of queryTerms) {
      const tf = termFreqs[queryTerm] || 0;
      
      if (tf > 0) {
        // Simple IDF approximation
        const idf = Math.log(100 / 10); // Assume 10% of docs contain term
        
        // BM25 formula
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
        
        score += idf * (numerator / denominator);
      }
    }
    
    return score;
  }

  /**
   * Calculate text relevance score using BM25
   */
  calculateTextScore(item: RankedItem, query: string): number {
    const combinedText = `${item.title} ${item.snippet}`;
    return this.calculateBm25(combinedText, query);
  }

  /**
   * Generate SimHash for content similarity detection
   */
  generateSimHash(text: string): string {
    // Simplified SimHash implementation
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2);
    
    if (words.length === 0) {
      return '0'.repeat(32);
    }
    
    // Create frequency map
    const wordFreqs: { [word: string]: number } = {};
    for (const word of words) {
      wordFreqs[word] = (wordFreqs[word] || 0) + 1;
    }
    
    // Generate hash bits
    const bits = new Array(32).fill(0);
    
    for (const [word, freq] of Object.entries(wordFreqs)) {
      const hash = this.hashString(word);
      
      for (let i = 0; i < 32; i++) {
        const bit = (hash >> i) & 1;
        bits[i] += bit ? freq : -freq;
      }
    }
    
    // Convert to binary string
    return bits.map(bit => bit > 0 ? '1' : '0').join('');
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Calculate SimHash similarity (Hamming distance)
   */
  calculateSimHashSimilarity(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) {
      return 0;
    }
    
    let differences = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) {
        differences++;
      }
    }
    
    return 1 - (differences / hash1.length);
  }

  /**
   * Apply Reciprocal Rank Fusion to combine multiple ranking lists
   */
  applyRRF(
    vectorList: RankedItem[],
    textList: RankedItem[],
    query: string,
    options: RRFOptions = {}
  ): RankedItem[] {
    const k = options.k || 60;
    const vectorWeight = options.weights?.vector || 1.0;
    const textWeight = options.weights?.text || 1.0;
    
    // Create unified item map
    const itemMap = new Map<string, RankedItem>();
    
    // Process vector ranking list
    vectorList.forEach((item, index) => {
      const rrfScore = vectorWeight / (k + index + 1);
      const existing = itemMap.get(item.id);
      
      if (existing) {
        existing.rrfScore = (existing.rrfScore || 0) + rrfScore;
        if (item.vectorScore !== undefined) {
          existing.vectorScore = item.vectorScore;
        }
      } else {
        itemMap.set(item.id, {
          ...item,
          vectorScore: item.vectorScore,
          rrfScore: rrfScore
        });
      }
    });
    
    // Process text ranking list (calculate text scores if not provided)
    textList.forEach((item, index) => {
      const textScore = item.textScore || this.calculateTextScore(item, query);
      const rrfScore = textWeight / (k + index + 1);
      const existing = itemMap.get(item.id);
      
      if (existing) {
        existing.rrfScore = (existing.rrfScore || 0) + rrfScore;
        existing.textScore = textScore;
      } else {
        itemMap.set(item.id, {
          ...item,
          textScore: textScore,
          rrfScore: rrfScore
        });
      }
    });
    
    // Convert back to array and sort by RRF score
    const rankedItems = Array.from(itemMap.values())
      .sort((a, b) => (b.rrfScore || 0) - (a.rrfScore || 0));
    
    console.log(`RRF fusion completed: ${rankedItems.length} unique items from ${vectorList.length} vector + ${textList.length} text results`);
    
    return rankedItems;
  }

  /**
   * Apply diversity filter to remove near-duplicates
   */
  applyDiversityFilter(items: RankedItem[], options: DiversityOptions = {}): RankedItem[] {
    const threshold = options.simHashThreshold || 0.85;
    const maxResults = options.maxResults || 20;
    
    if (items.length === 0) {
      return items;
    }
    
    // Generate SimHashes for all items
    const itemsWithHashes = items.map(item => ({
      ...item,
      simHash: this.generateSimHash(`${item.title} ${item.snippet}`)
    }));
    
    const filteredItems: RankedItem[] = [];
    const seenHashes: string[] = [];
    
    for (const item of itemsWithHashes) {
      let isDuplicate = false;
      
      // Check similarity against all previously accepted items
      for (const seenHash of seenHashes) {
        const similarity = this.calculateSimHashSimilarity(item.simHash!, seenHash);
        
        if (similarity >= threshold) {
          isDuplicate = true;
          console.log(`Filtered duplicate: "${item.title.substring(0, 50)}..." (similarity: ${similarity.toFixed(3)})`);
          break;
        }
      }
      
      if (!isDuplicate) {
        filteredItems.push(item);
        seenHashes.push(item.simHash!);
        
        // Stop if we've reached the desired number of results
        if (filteredItems.length >= maxResults) {
          break;
        }
      }
    }
    
    console.log(`Diversity filter: ${items.length} → ${filteredItems.length} items (removed ${items.length - filteredItems.length} near-duplicates)`);
    
    return filteredItems;
  }

  /**
   * Complete ranking pipeline: RRF + diversity filtering
   */
  rankAndFilter(
    vectorResults: RankedItem[],
    textResults: RankedItem[],
    query: string,
    rrfOptions: RRFOptions = {},
    diversityOptions: DiversityOptions = {}
  ): RankedItem[] {
    console.log('Starting ranking pipeline...');
    
    // Step 1: Apply RRF fusion
    const fusedResults = this.applyRRF(vectorResults, textResults, query, rrfOptions);
    
    // Step 2: Apply diversity filter
    const finalResults = this.applyDiversityFilter(fusedResults, diversityOptions);
    
    console.log(`Ranking pipeline completed: ${finalResults.length} final results`);
    
    return finalResults;
  }

  /**
   * Create separate ranking lists for RRF (for testing)
   */
  createRankingLists(items: RankedItem[], query: string): {
    vectorList: RankedItem[];
    textList: RankedItem[];
  } {
    // Sort by vector score (if available)
    const vectorList = items
      .filter(item => item.vectorScore !== undefined)
      .sort((a, b) => (b.vectorScore || 0) - (a.vectorScore || 0));
    
    // Calculate text scores and sort by them
    const textList = items.map(item => ({
      ...item,
      textScore: this.calculateTextScore(item, query)
    })).sort((a, b) => (b.textScore || 0) - (a.textScore || 0));
    
    return { vectorList, textList };
  }
}

// Create and export singleton instance
const rankingService = new RankingService();

export const applyRRF = (
  vectorList: RankedItem[],
  textList: RankedItem[],
  query: string,
  options?: RRFOptions
): RankedItem[] => rankingService.applyRRF(vectorList, textList, query, options);

export const applyDiversityFilter = (
  items: RankedItem[],
  options?: DiversityOptions
): RankedItem[] => rankingService.applyDiversityFilter(items, options);

export const rankAndFilter = (
  vectorResults: RankedItem[],
  textResults: RankedItem[],
  query: string,
  rrfOptions?: RRFOptions,
  diversityOptions?: DiversityOptions
): RankedItem[] => rankingService.rankAndFilter(vectorResults, textResults, query, rrfOptions, diversityOptions);

export const generateSimHash = (text: string): string => 
  rankingService.generateSimHash(text);

export const calculateSimHashSimilarity = (hash1: string, hash2: string): number =>
  rankingService.calculateSimHashSimilarity(hash1, hash2);

export const calculateTextScore = (item: RankedItem, query: string): number =>
  rankingService.calculateTextScore(item, query);

export default rankingService;