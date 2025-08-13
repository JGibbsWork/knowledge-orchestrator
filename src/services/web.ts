import fetch from 'node-fetch';
import { MongoClient, Db, Collection } from 'mongodb';
import { createHash } from 'crypto';
import { chromium, Browser } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { loadEnv } from '../env.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  fullText?: string; // Added for scraped content
}

export interface CacheEntry {
  queryHash: string;
  query: string;
  results: SearchResult[];
  k: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface ScrapedContent {
  urlHash: string;
  url: string;
  title: string;
  rawHtml: string;
  extractedText: string;
  createdAt: Date;
  expiresAt: Date;
  wordCount: number;
  success: boolean;
  errorMessage?: string;
}

export interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title: string;
      url: string;
      description: string;
    }>;
  };
}

export class WebSearchError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'WebSearchError';
  }
}

class WebSearchService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private cacheCollection: Collection<CacheEntry> | null = null;
  private scrapeCacheCollection: Collection<ScrapedContent> | null = null;
  private browser: Browser | null = null;
  private env = loadEnv();
  private readonly CACHE_TTL_HOURS = 24;

  constructor() {
    this.initializeDatabase();
  }

  private async initializeDatabase(): Promise<void> {
    try {
      this.client = new MongoClient(this.env.MONGO_URL);
      await this.client.connect();
      this.db = this.client.db();
      this.cacheCollection = this.db.collection<CacheEntry>('web_cache');
      this.scrapeCacheCollection = this.db.collection<ScrapedContent>('scraped_content');

      // Create TTL index on expiresAt field for both collections
      await this.cacheCollection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
      );
      
      await this.scrapeCacheCollection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
      );

      // Create index on queryHash for fast lookups
      await this.cacheCollection.createIndex({ queryHash: 1 }, { unique: true });
      
      // Create index on urlHash for scraped content
      await this.scrapeCacheCollection.createIndex({ urlHash: 1 }, { unique: true });

      console.log('Web search service initialized with MongoDB cache and scraping');
    } catch (error) {
      console.error('Failed to initialize MongoDB connection:', error);
      throw new WebSearchError(
        'Database initialization failed',
        500,
        'DB_INIT_ERROR'
      );
    }
  }

  private hashQuery(query: string, k: number): string {
    // Create consistent hash for query + k combination
    const normalizedQuery = query.toLowerCase().trim();
    const hashInput = `${normalizedQuery}:${k}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  private hashUrl(url: string): string {
    // Create consistent hash for URL
    const normalizedUrl = url.trim().toLowerCase();
    return createHash('sha256').update(normalizedUrl).digest('hex');
  }

  private async getFromCache(queryHash: string): Promise<SearchResult[] | null> {
    if (!this.cacheCollection) {
      console.warn('Cache collection not available');
      return null;
    }

    try {
      const cacheEntry = await this.cacheCollection.findOne({ queryHash });
      
      if (!cacheEntry) {
        return null;
      }

      // Double-check expiration (MongoDB TTL might have slight delay)
      if (cacheEntry.expiresAt <= new Date()) {
        await this.cacheCollection.deleteOne({ queryHash });
        return null;
      }

      console.log(`Cache hit for query hash: ${queryHash}`);
      return cacheEntry.results;
    } catch (error) {
      console.error('Cache read error:', error);
      return null; // Graceful fallback to API call
    }
  }

  private async saveToCache(
    queryHash: string,
    query: string,
    results: SearchResult[],
    k: number
  ): Promise<void> {
    if (!this.cacheCollection) {
      console.warn('Cache collection not available, skipping cache save');
      return;
    }

    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.CACHE_TTL_HOURS * 60 * 60 * 1000);

      const cacheEntry: CacheEntry = {
        queryHash,
        query,
        results,
        k,
        createdAt: now,
        expiresAt
      };

      await this.cacheCollection.replaceOne(
        { queryHash },
        cacheEntry,
        { upsert: true }
      );

      console.log(`Cached search results for query hash: ${queryHash}`);
    } catch (error) {
      console.error('Cache write error:', error);
      // Don't throw - caching failure shouldn't break search functionality
    }
  }

  private async callBraveAPI(query: string, k: number): Promise<SearchResult[]> {
    const baseUrl = 'https://api.search.brave.com/res/v1/web/search';
    const params = new URLSearchParams({
      q: query,
      count: Math.min(k, 20).toString()
    });
    
    const url = `${baseUrl}?${params.toString()}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.env.BRAVE_API_KEY,
        },
        method: 'GET',
      });

      if (!response.ok) {
        let errorMessage = `Brave API error: ${response.status} ${response.statusText}`;
        
        try {
          const errorBody = await response.json() as any;
          if (errorBody?.message) {
            errorMessage = errorBody.message;
          }
        } catch {
          // Use default error message if response parsing fails
        }

        throw new WebSearchError(
          errorMessage,
          response.status,
          'BRAVE_API_ERROR'
        );
      }

      const data = await response.json() as BraveSearchResponse;
      
      if (!data.web?.results) {
        return [];
      }

      // Transform Brave results to our format
      return data.web.results.slice(0, k).map(result => ({
        title: result.title || 'No title',
        url: result.url,
        snippet: result.description || 'No description available'
      }));

    } catch (error) {
      if (error instanceof WebSearchError) {
        throw error;
      }

      throw new WebSearchError(
        `Search API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'API_CALL_ERROR'
      );
    }
  }

  private async initializeBrowser(): Promise<void> {
    if (!this.browser) {
      try {
        this.browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        console.log('Playwright browser initialized');
      } catch (error) {
        console.error('Failed to initialize browser:', error);
        throw new WebSearchError(
          'Browser initialization failed',
          500,
          'BROWSER_INIT_ERROR'
        );
      }
    }
  }

  private async getScrapedFromCache(urlHash: string): Promise<ScrapedContent | null> {
    if (!this.scrapeCacheCollection) {
      console.warn('Scrape cache collection not available');
      return null;
    }

    try {
      const cacheEntry = await this.scrapeCacheCollection.findOne({ urlHash });
      
      if (!cacheEntry) {
        return null;
      }

      // Double-check expiration
      if (cacheEntry.expiresAt <= new Date()) {
        await this.scrapeCacheCollection.deleteOne({ urlHash });
        return null;
      }

      console.log(`Scrape cache hit for URL hash: ${urlHash}`);
      return cacheEntry;
    } catch (error) {
      console.error('Scrape cache read error:', error);
      return null;
    }
  }

  private async saveScrapedToCache(scrapedContent: ScrapedContent): Promise<void> {
    if (!this.scrapeCacheCollection) {
      console.warn('Scrape cache collection not available, skipping cache save');
      return;
    }

    try {
      await this.scrapeCacheCollection.replaceOne(
        { urlHash: scrapedContent.urlHash },
        scrapedContent,
        { upsert: true }
      );

      console.log(`Cached scraped content for URL hash: ${scrapedContent.urlHash}`);
    } catch (error) {
      console.error('Scrape cache write error:', error);
    }
  }

  private async scrapePage(url: string): Promise<ScrapedContent> {
    const urlHash = this.hashUrl(url);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.CACHE_TTL_HOURS * 60 * 60 * 1000);

    try {
      await this.initializeBrowser();
      
      if (!this.browser) {
        throw new Error('Browser not available');
      }

      const page = await this.browser.newPage();
      
      // Set a reasonable user agent
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      });
      
      // Navigate to the page with timeout
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      // Wait a bit for dynamic content to load
      await page.waitForTimeout(2000);

      // Get the HTML content
      const rawHtml = await page.content();
      const title = await page.title();

      // Close the page
      await page.close();

      // Extract readable content using Readability
      const dom = new JSDOM(rawHtml, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      const extractedText = article?.textContent || '';
      const wordCount = extractedText.split(/\s+/).filter(word => word.length > 0).length;

      const scrapedContent: ScrapedContent = {
        urlHash,
        url,
        title: article?.title || title || 'No title',
        rawHtml,
        extractedText,
        createdAt: now,
        expiresAt,
        wordCount,
        success: true
      };

      return scrapedContent;

    } catch (error) {
      console.error(`Failed to scrape ${url}:`, error);
      
      // Return failed scrape result
      const failedContent: ScrapedContent = {
        urlHash,
        url,
        title: 'Scraping failed',
        rawHtml: '',
        extractedText: '',
        createdAt: now,
        expiresAt,
        wordCount: 0,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      };

      return failedContent;
    }
  }

  async scrapeUrls(urls: string[]): Promise<ScrapedContent[]> {
    const results: ScrapedContent[] = [];

    for (const url of urls) {
      try {
        const urlHash = this.hashUrl(url);
        
        // Check cache first
        const cached = await this.getScrapedFromCache(urlHash);
        if (cached) {
          results.push(cached);
          continue;
        }

        // Cache miss - scrape the page
        console.log(`Scraping: ${url}`);
        const scrapedContent = await this.scrapePage(url);
        
        // Save to cache
        await this.saveScrapedToCache(scrapedContent);
        
        results.push(scrapedContent);

        // Small delay between requests to be respectful
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Error processing URL ${url}:`, error);
        
        // Add failed result
        results.push({
          urlHash: this.hashUrl(url),
          url,
          title: 'Error',
          rawHtml: '',
          extractedText: '',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + this.CACHE_TTL_HOURS * 60 * 60 * 1000),
          wordCount: 0,
          success: false,
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }

  /**
   * Search the web using Brave Search API with MongoDB caching
   * @param query - Search query string
   * @param k - Number of results to return (default: 10, max: 20)
   * @returns Promise<SearchResult[]> - Array of search results
   */
  async searchBrave(query: string, k: number = 10): Promise<SearchResult[]> {
    if (!query || typeof query !== 'string' || query.trim() === '') {
      throw new WebSearchError('Search query cannot be empty', 400, 'INVALID_QUERY');
    }

    if (typeof k !== 'number' || k < 1 || k > 20) {
      throw new WebSearchError('k must be a number between 1 and 20', 400, 'INVALID_K');
    }

    const normalizedQuery = query.trim();
    const queryHash = this.hashQuery(normalizedQuery, k);

    try {
      // Try cache first
      const cachedResults = await this.getFromCache(queryHash);
      if (cachedResults) {
        return cachedResults;
      }

      // Cache miss - call Brave API
      console.log(`Cache miss for query: "${normalizedQuery}" (k=${k})`);
      const results = await this.callBraveAPI(normalizedQuery, k);

      // Save to cache for next time
      await this.saveToCache(queryHash, normalizedQuery, results, k);

      return results;

    } catch (error) {
      if (error instanceof WebSearchError) {
        throw error;
      }

      throw new WebSearchError(
        `Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'SEARCH_ERROR'
      );
    }
  }

  /**
   * Search and scrape top N results with full text extraction
   * @param query - Search query string
   * @param k - Number of results to return and scrape (default: 5, max: 10)
   * @returns Promise<SearchResult[]> - Array of search results with fullText
   */
  async searchAndScrape(query: string, k: number = 5): Promise<SearchResult[]> {
    // Limit scraping to reasonable number to avoid overwhelming sites
    const maxScrapeResults = Math.min(k, 10);
    
    // First get search results
    const searchResults = await this.searchBrave(query, maxScrapeResults);
    
    if (searchResults.length === 0) {
      return searchResults;
    }

    // Extract URLs from top N results
    const urls = searchResults.slice(0, maxScrapeResults).map(result => result.url);
    
    // Scrape the pages
    console.log(`Scraping ${urls.length} URLs for query: "${query}"`);
    const scrapedContents = await this.scrapeUrls(urls);
    
    // Combine search results with scraped content
    const enhancedResults: SearchResult[] = searchResults.map((result, index) => {
      const scrapedContent = scrapedContents[index];
      
      if (scrapedContent && scrapedContent.success) {
        return {
          ...result,
          fullText: scrapedContent.extractedText,
          title: scrapedContent.title || result.title // Use scraped title if available
        };
      }
      
      // If scraping failed, return original result
      return result;
    });

    return enhancedResults;
  }

  /**
   * Clear expired cache entries manually
   */
  async clearExpiredCache(): Promise<number> {
    if (!this.cacheCollection) {
      return 0;
    }

    try {
      const result = await this.cacheCollection.deleteMany({
        expiresAt: { $lte: new Date() }
      });

      console.log(`Cleared ${result.deletedCount} expired cache entries`);
      return result.deletedCount;
    } catch (error) {
      console.error('Error clearing expired cache:', error);
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalEntries: number;
    expiredEntries: number;
    oldestEntry?: Date;
    newestEntry?: Date;
  }> {
    if (!this.cacheCollection) {
      return { totalEntries: 0, expiredEntries: 0 };
    }

    try {
      const now = new Date();
      const [totalEntries, expiredEntries] = await Promise.all([
        this.cacheCollection.countDocuments(),
        this.cacheCollection.countDocuments({ expiresAt: { $lte: now } })
      ]);

      const oldestEntry = await this.cacheCollection.findOne(
        {},
        { sort: { createdAt: 1 } }
      );

      const newestEntry = await this.cacheCollection.findOne(
        {},
        { sort: { createdAt: -1 } }
      );

      return {
        totalEntries,
        expiredEntries,
        oldestEntry: oldestEntry?.createdAt,
        newestEntry: newestEntry?.createdAt
      };
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return { totalEntries: 0, expiredEntries: 0 };
    }
  }

  /**
   * Close database connection and browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.cacheCollection = null;
      this.scrapeCacheCollection = null;
    }
  }
}

// Create and export singleton instance
const webSearchService = new WebSearchService();

export const searchBrave = (query: string, k?: number): Promise<SearchResult[]> => 
  webSearchService.searchBrave(query, k);

export const searchAndScrape = (query: string, k?: number): Promise<SearchResult[]> => 
  webSearchService.searchAndScrape(query, k);

export const scrapeUrls = (urls: string[]): Promise<ScrapedContent[]> => 
  webSearchService.scrapeUrls(urls);

export const clearExpiredCache = (): Promise<number> => 
  webSearchService.clearExpiredCache();

export const getCacheStats = () => 
  webSearchService.getCacheStats();

export default webSearchService;