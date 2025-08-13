import OpenAI from 'openai';
import fetch from 'node-fetch';
import { loadEnv } from '../env.js';

export interface QueryVariants {
  original: string;
  variants: string[];
}

export class QueryRewriteError extends Error {
  constructor(
    message: string,
    public provider?: string,
    public status?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'QueryRewriteError';
  }
}

class QueryRewriteService {
  private env = loadEnv();
  private openaiClient: OpenAI | null = null;

  constructor() {
    if (this.env.EMBEDDINGS_PROVIDER === 'openai') {
      this.openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || 'dummy-key'
      });
    }
  }

  /**
   * Generate query variants using local Ollama LLM
   */
  private async generateVariantsOllama(task: string): Promise<string[]> {
    try {
      const systemPrompt = `You are a query expansion expert. Given a user task or question, generate 2-3 alternative search queries that would help find relevant information. Each query should approach the topic from a slightly different angle or use different terminology.

Rules:
- Generate exactly 2-3 variations
- Keep queries concise (5-15 words each)
- Use different keywords and synonyms
- Don't repeat the exact same query
- Focus on search-friendly terms
- Return only the queries, one per line, no numbering or formatting

Example:
Input: "Find TypeScript best practices"
Output:
TypeScript coding standards and conventions
Best practices for TypeScript development
TypeScript style guide and recommendations`;

      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          prompt: `${systemPrompt}\n\nInput: "${task}"\nOutput:`,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 200
          }
        })
      });

      if (!response.ok) {
        throw new QueryRewriteError(
          `Ollama API error: ${response.status} ${response.statusText}`,
          'ollama',
          response.status
        );
      }

      const data = await response.json() as { response: string };
      
      if (!data.response) {
        throw new QueryRewriteError(
          'No response from Ollama',
          'ollama',
          500,
          'EMPTY_RESPONSE'
        );
      }

      // Parse the response to extract query variants
      const variants = data.response
        .trim()
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.match(/^[\d\-\*\.)]/)) // Remove numbering/bullets
        .slice(0, 3); // Take first 3 variants max

      return variants.length > 0 ? variants : [task]; // Fallback to original if parsing fails

    } catch (error) {
      if (error instanceof QueryRewriteError) {
        throw error;
      }
      
      console.error('Ollama query generation failed:', error);
      throw new QueryRewriteError(
        `Ollama query generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'ollama',
        500,
        'API_ERROR'
      );
    }
  }

  /**
   * Generate query variants using OpenAI
   */
  private async generateVariantsOpenAI(task: string): Promise<string[]> {
    if (!this.openaiClient) {
      throw new QueryRewriteError(
        'OpenAI client not initialized',
        'openai',
        500,
        'CLIENT_ERROR'
      );
    }

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a query expansion expert. Given a user task or question, generate 2-3 alternative search queries that would help find relevant information. Each query should approach the topic from a slightly different angle or use different terminology.

Rules:
- Generate exactly 2-3 variations
- Keep queries concise (5-15 words each)
- Use different keywords and synonyms
- Don't repeat the exact same query
- Focus on search-friendly terms
- Return only the queries, one per line, no numbering or formatting`
          },
          {
            role: 'user',
            content: `Task: "${task}"\n\nGenerate query variants:`
          }
        ],
        temperature: 0.7,
        max_tokens: 200
      });

      const content = response.choices[0]?.message?.content;
      
      if (!content) {
        throw new QueryRewriteError(
          'No content in OpenAI response',
          'openai',
          500,
          'EMPTY_RESPONSE'
        );
      }

      // Parse the response to extract query variants
      const variants = content
        .trim()
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.match(/^[\d\-\*\.)]/)) // Remove numbering/bullets
        .slice(0, 3); // Take first 3 variants max

      return variants.length > 0 ? variants : [task]; // Fallback to original if parsing fails

    } catch (error) {
      console.error('OpenAI query generation failed:', error);
      throw new QueryRewriteError(
        `OpenAI query generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'openai',
        500,
        'API_ERROR'
      );
    }
  }

  /**
   * Generate simple rule-based variants as fallback
   */
  private generateVariantsRuleBased(task: string): string[] {
    const variants: string[] = [];
    
    // Variant 1: Add "how to" or "guide" if not present
    if (!task.toLowerCase().includes('how to') && !task.toLowerCase().includes('guide')) {
      variants.push(`how to ${task}`);
    }
    
    // Variant 2: Add "best practices" if not present
    if (!task.toLowerCase().includes('best practices') && !task.toLowerCase().includes('practices')) {
      variants.push(`${task} best practices`);
    }
    
    // Variant 3: Add "tutorial" or "examples" 
    if (!task.toLowerCase().includes('tutorial') && !task.toLowerCase().includes('example')) {
      variants.push(`${task} tutorial examples`);
    }
    
    // If we have fewer than 2 variants, add some generic ones
    if (variants.length < 2) {
      variants.push(`${task} documentation`);
      variants.push(`${task} reference guide`);
    }
    
    return variants.slice(0, 3); // Return max 3 variants
  }

  /**
   * Generate query variants using the best available method
   */
  async generateQueryVariants(task: string): Promise<QueryVariants> {
    const startTime = Date.now();
    
    try {
      let variants: string[];
      
      // Try Ollama first (local LLM)
      try {
        console.log('Attempting query generation with Ollama...');
        variants = await this.generateVariantsOllama(task);
        console.log(`Generated ${variants.length} variants via Ollama in ${Date.now() - startTime}ms`);
      } catch (ollamaError) {
        console.log('Ollama failed, trying OpenAI...');
        
        // Fallback to OpenAI if available
        if (this.env.EMBEDDINGS_PROVIDER === 'openai') {
          try {
            variants = await this.generateVariantsOpenAI(task);
            console.log(`Generated ${variants.length} variants via OpenAI in ${Date.now() - startTime}ms`);
          } catch (openaiError) {
            console.log('OpenAI failed, using rule-based generation...');
            variants = this.generateVariantsRuleBased(task);
            console.log(`Generated ${variants.length} variants via rule-based method in ${Date.now() - startTime}ms`);
          }
        } else {
          console.log('Using rule-based generation...');
          variants = this.generateVariantsRuleBased(task);
          console.log(`Generated ${variants.length} variants via rule-based method in ${Date.now() - startTime}ms`);
        }
      }
      
      // Ensure we have at least the original task if all else fails
      if (variants.length === 0) {
        variants = [task];
      }
      
      return {
        original: task,
        variants: variants.filter(v => v.trim() !== task.trim()) // Remove duplicates of original
      };
      
    } catch (error) {
      console.error('All query generation methods failed:', error);
      
      // Ultimate fallback - return original task with rule-based variants
      return {
        original: task,
        variants: this.generateVariantsRuleBased(task)
      };
    }
  }

  /**
   * Get all queries (original + variants) for search
   */
  async getAllQueries(task: string): Promise<string[]> {
    const queryVariants = await this.generateQueryVariants(task);
    return [queryVariants.original, ...queryVariants.variants];
  }
}

// Create and export singleton instance
const queryRewriteService = new QueryRewriteService();

export const generateQueryVariants = (task: string): Promise<QueryVariants> =>
  queryRewriteService.generateQueryVariants(task);

export const getAllQueries = (task: string): Promise<string[]> =>
  queryRewriteService.getAllQueries(task);

export default queryRewriteService;