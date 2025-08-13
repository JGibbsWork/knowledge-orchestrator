import { encoding_for_model } from 'tiktoken';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import { loadEnv } from '../env.js';

export interface ChunkWithEmbedding {
  text: string;
  tokens: number;
  embedding: number[];
  startIndex: number;
  endIndex: number;
}

export interface ChunkAndEmbedOptions {
  chunkSize?: number;        // Target tokens per chunk (default: 900)
  overlapSize?: number;      // Overlap tokens (default: 200)
  model?: string;            // Embedding model override
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public provider?: string,
    public status?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

class EmbeddingService {
  private env = loadEnv();
  private tokenizer = encoding_for_model('gpt-4'); // Using GPT-4 tokenizer for consistency
  private openaiClient: OpenAI | null = null;

  constructor() {
    if (this.env.EMBEDDINGS_PROVIDER === 'openai') {
      this.openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || 'dummy-key'
      });
    }
  }

  /**
   * Count tokens in text using tiktoken
   */
  countTokens(text: string): number {
    try {
      const tokens = this.tokenizer.encode(text);
      return tokens.length;
    } catch (error) {
      console.error('Token counting failed:', error);
      // Fallback to rough estimation: ~4 chars per token
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Split text into chunks with specified overlap
   */
  createChunks(text: string, chunkSize: number = 900, overlapSize: number = 200): Array<{
    text: string;
    tokens: number;
    startIndex: number;
    endIndex: number;
  }> {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Handle text shorter than chunk size
    const totalTokens = this.countTokens(text);
    if (totalTokens <= chunkSize) {
      return [{
        text: text.trim(),
        tokens: totalTokens,
        startIndex: 0,
        endIndex: text.length
      }];
    }

    const chunks: Array<{
      text: string;
      tokens: number;
      startIndex: number;
      endIndex: number;
    }> = [];

    // Split text into sentences for better chunk boundaries
    const sentences = this.splitIntoSentences(text);
    let currentChunk = '';
    let currentTokens = 0;
    let chunkStartIndex = 0;
    let sentenceStartIndex = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceTokens = this.countTokens(sentence);

      // If adding this sentence would exceed chunk size, finish current chunk
      if (currentTokens + sentenceTokens > chunkSize && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          text: currentChunk.trim(),
          tokens: currentTokens,
          startIndex: chunkStartIndex,
          endIndex: chunkStartIndex + currentChunk.length
        });

        // Start new chunk with overlap
        const overlapText = this.createOverlapText(currentChunk, overlapSize);
        currentChunk = overlapText + sentence;
        currentTokens = this.countTokens(currentChunk);
        chunkStartIndex = sentenceStartIndex - overlapText.length + sentence.length;
      } else {
        // Add sentence to current chunk
        if (currentChunk.length === 0) {
          currentChunk = sentence;
          chunkStartIndex = sentenceStartIndex;
        } else {
          currentChunk += sentence;
        }
        currentTokens = this.countTokens(currentChunk);
      }

      sentenceStartIndex += sentence.length;
    }

    // Add final chunk if it has content
    if (currentChunk.trim().length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        tokens: currentTokens,
        startIndex: chunkStartIndex,
        endIndex: chunkStartIndex + currentChunk.length
      });
    }

    return chunks;
  }

  /**
   * Split text into sentences using basic punctuation rules
   */
  private splitIntoSentences(text: string): string[] {
    // Split on sentence-ending punctuation followed by whitespace or end of string
    const sentenceRegex = /([.!?]+)(\s+|$)/g;
    const sentences: string[] = [];
    let lastIndex = 0;
    let match;

    while ((match = sentenceRegex.exec(text)) !== null) {
      const sentence = text.slice(lastIndex, match.index + match[1].length);
      if (sentence.trim().length > 0) {
        sentences.push(sentence + (match[2] || ''));
      }
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text as final sentence
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex);
      if (remaining.trim().length > 0) {
        sentences.push(remaining);
      }
    }

    return sentences.filter(s => s.trim().length > 0);
  }

  /**
   * Create overlap text from the end of previous chunk
   */
  private createOverlapText(text: string, overlapTokens: number): string {
    if (overlapTokens === 0 || !text) {
      return '';
    }

    // Split into words and work backwards to build overlap
    const words = text.trim().split(/\s+/);
    let overlap = '';

    for (let i = words.length - 1; i >= 0; i--) {
      const wordWithSpace = (i === words.length - 1 ? '' : ' ') + words[i];
      const newTokens = this.countTokens(overlap + wordWithSpace);
      
      if (newTokens > overlapTokens) {
        break;
      }
      
      overlap = wordWithSpace + overlap;
    }

    return overlap.length > 0 ? overlap + ' ' : '';
  }

  /**
   * Get embeddings from Ollama (nomic-embed-text)
   */
  private async getOllamaEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'nomic-embed-text',
          prompt: text
        })
      });

      if (!response.ok) {
        throw new EmbeddingError(
          `Ollama API error: ${response.status} ${response.statusText}`,
          'ollama',
          response.status
        );
      }

      const data = await response.json() as { embedding: number[] };
      
      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new EmbeddingError(
          'Invalid embedding response from Ollama',
          'ollama',
          500,
          'INVALID_RESPONSE'
        );
      }

      return data.embedding;
    } catch (error) {
      if (error instanceof EmbeddingError) {
        throw error;
      }
      
      throw new EmbeddingError(
        `Ollama embedding failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'ollama',
        500,
        'API_ERROR'
      );
    }
  }

  /**
   * Get embeddings from OpenAI (text-embedding-3-large)
   */
  private async getOpenAIEmbedding(text: string): Promise<number[]> {
    if (!this.openaiClient) {
      throw new EmbeddingError(
        'OpenAI client not initialized',
        'openai',
        500,
        'CLIENT_ERROR'
      );
    }

    try {
      const response = await this.openaiClient.embeddings.create({
        model: 'text-embedding-3-large',
        input: text,
        encoding_format: 'float'
      });

      if (!response.data || response.data.length === 0) {
        throw new EmbeddingError(
          'No embedding data in OpenAI response',
          'openai',
          500,
          'INVALID_RESPONSE'
        );
      }

      return response.data[0].embedding;
    } catch (error) {
      if (error instanceof EmbeddingError) {
        throw error;
      }

      throw new EmbeddingError(
        `OpenAI embedding failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'openai',
        500,
        'API_ERROR'
      );
    }
  }

  /**
   * Get embedding based on configured provider
   */
  async getEmbedding(text: string): Promise<number[]> {
    const provider = this.env.EMBEDDINGS_PROVIDER;
    
    switch (provider) {
      case 'openai':
        return this.getOpenAIEmbedding(text);
      
      case 'ollama':
      default:
        return this.getOllamaEmbedding(text);
    }
  }

  /**
   * Main function: chunk text and generate embeddings
   */
  async chunkAndEmbed(text: string, options: ChunkAndEmbedOptions = {}): Promise<ChunkWithEmbedding[]> {
    const chunkSize = options.chunkSize || 900;
    const overlapSize = options.overlapSize || 200;

    if (!text || text.trim().length === 0) {
      return [];
    }

    console.log(`Chunking text (${this.countTokens(text)} tokens) with ${chunkSize} token chunks and ${overlapSize} token overlap`);

    // Create text chunks
    const chunks = this.createChunks(text, chunkSize, overlapSize);
    console.log(`Created ${chunks.length} chunks`);

    // Generate embeddings for each chunk
    const chunksWithEmbeddings: ChunkWithEmbedding[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      try {
        console.log(`Generating embedding for chunk ${i + 1}/${chunks.length} (${chunk.tokens} tokens)`);
        const embedding = await this.getEmbedding(chunk.text);
        
        chunksWithEmbeddings.push({
          text: chunk.text,
          tokens: chunk.tokens,
          embedding,
          startIndex: chunk.startIndex,
          endIndex: chunk.endIndex
        });

        // Small delay between requests to be respectful to APIs
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`Failed to generate embedding for chunk ${i + 1}:`, error);
        throw new EmbeddingError(
          `Embedding generation failed for chunk ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          this.env.EMBEDDINGS_PROVIDER,
          500,
          'CHUNK_EMBEDDING_ERROR'
        );
      }
    }

    console.log(`Successfully generated embeddings for ${chunksWithEmbeddings.length} chunks`);
    return chunksWithEmbeddings;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.tokenizer) {
      this.tokenizer.free();
    }
  }
}

// Create and export singleton instance
const embeddingService = new EmbeddingService();

// Export main function
export const chunkAndEmbed = (
  text: string, 
  options?: ChunkAndEmbedOptions
): Promise<ChunkWithEmbedding[]> => embeddingService.chunkAndEmbed(text, options);

// Export utility functions
export const countTokens = (text: string): number => embeddingService.countTokens(text);

export const getEmbedding = (text: string): Promise<number[]> => embeddingService.getEmbedding(text);

export default embeddingService;