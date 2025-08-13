/**
 * Example MoneyBag system integration with Knowledge Orchestrator
 * 
 * This demonstrates how moneyBag would use the KO client to:
 * 1. Replace internal context assembly with KO calls
 * 2. Store citations in decision records
 */

import { getContextPack, type ContextPackResult } from '../src/adapters/ko.js';

// Example interfaces for moneyBag system
interface Decision {
  id: string;
  task: string;
  context: string;
  reasoning: string;
  outcome: string;
  confidence: number;
  timestamp: Date;
  citations?: Citation[];
  debug?: {
    query_variants: string[];
    total_candidates: number;
    processing_time_ms: number;
    sources_used: string[];
  };
}

interface Citation {
  id: string;
  source: 'memory' | 'notion' | 'web';
  title: string;
  snippet: string;
  url?: string;
  source_id?: string;
  used_in_context: boolean;
}

interface MoneyBagOptions {
  useKnowledgeOrchestrator: boolean;
  koScopes?: ('personal' | 'domain' | 'web')[];
  contextBudget?: number;
  allowWeb?: boolean;
  allowPrivate?: boolean;
}

class MoneyBagError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'MoneyBagError';
  }
}

/**
 * Example MoneyBag system that integrates with Knowledge Orchestrator
 */
class MoneyBag {
  private decisions: Decision[] = [];
  private options: MoneyBagOptions;

  constructor(options: MoneyBagOptions = { useKnowledgeOrchestrator: true }) {
    this.options = {
      useKnowledgeOrchestrator: true,
      koScopes: ['domain', 'personal'], // Default to domain and personal knowledge
      contextBudget: 1500, // Token budget for context
      allowWeb: false,
      allowPrivate: false,
      ...options
    };
  }

  /**
   * Main decision-making method that now uses KO for context
   */
  async makeDecision(task: string, agentId: string = 'moneybag'): Promise<Decision> {
    const startTime = Date.now();
    
    console.log(`📊 MoneyBag making decision for task: "${task}"`);
    
    try {
      // Step 1: Get contextualized information from Knowledge Orchestrator
      let context = '';
      let citations: Citation[] = [];
      let debug: Decision['debug'];

      if (this.options.useKnowledgeOrchestrator) {
        console.log('🔍 Fetching context from Knowledge Orchestrator...');
        
        const koResult = await this.getContextFromKO(task, agentId);
        context = koResult.context || '';
        citations = this.convertCitations(koResult.citations || []);
        
        debug = {
          query_variants: koResult.query_variants,
          total_candidates: koResult.total_candidates,
          processing_time_ms: koResult.debug.total_ms,
          sources_used: this.extractSourcesUsed(koResult)
        };

        console.log(`✅ Retrieved context: ${context.length} chars, ${citations.length} citations`);
      } else {
        // Fallback to internal context assembly (legacy mode)
        context = await this.assembleContextInternally(task);
        console.log('⚠️  Using internal context assembly (legacy mode)');
      }

      // Step 2: Apply decision logic with contextualized information
      const reasoning = this.generateReasoning(task, context);
      const outcome = this.determineOutcome(task, context, reasoning);
      const confidence = this.calculateConfidence(context, citations.length);

      // Step 3: Create decision record with citations
      const decision: Decision = {
        id: this.generateDecisionId(),
        task,
        context,
        reasoning,
        outcome,
        confidence,
        timestamp: new Date(),
        citations, // Store KO citations in decision record
        debug
      };

      // Step 4: Store decision
      this.decisions.push(decision);
      
      const totalTime = Date.now() - startTime;
      console.log(`🎯 Decision made in ${totalTime}ms: "${outcome}" (confidence: ${confidence.toFixed(2)})`);
      
      if (citations.length > 0) {
        console.log(`📚 Decision supported by ${citations.length} citations from ${debug?.sources_used.join(', ')}`);
      }

      return decision;

    } catch (error) {
      console.error('❌ Failed to make decision:', error);
      throw new MoneyBagError(
        `Decision-making failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DECISION_ERROR'
      );
    }
  }

  /**
   * Get context from Knowledge Orchestrator (replaces internal context assembly)
   */
  private async getContextFromKO(task: string, agentId: string): Promise<ContextPackResult> {
    try {
      return await getContextPack(task, {
        agent_id: agentId,
        scope: this.options.koScopes,
        k: 15, // Get more candidates for better context
        allow_web: this.options.allowWeb,
        allow_private: this.options.allowPrivate
      });
    } catch (error) {
      console.error('Failed to get context from KO:', error);
      throw new MoneyBagError(
        `Knowledge Orchestrator integration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'KO_ERROR'
      );
    }
  }

  /**
   * Convert KO citations to MoneyBag citation format
   */
  private convertCitations(koCitations: ContextPackResult['citations'] = []): Citation[] {
    return koCitations.map(citation => ({
      id: citation.id,
      source: citation.source.source,
      title: citation.source.title,
      snippet: citation.snippet,
      url: citation.source.url,
      source_id: citation.source.source_id,
      used_in_context: citation.used_in_context
    }));
  }

  /**
   * Extract sources used from KO debug info
   */
  private extractSourcesUsed(koResult: ContextPackResult): string[] {
    const sources: string[] = [];
    
    if (koResult.debug.personal_retrieval_ms) sources.push('memory');
    if (koResult.debug.domain_retrieval_ms) sources.push('notion');
    if (koResult.debug.web_retrieval_ms) sources.push('web');
    
    return sources;
  }

  /**
   * Legacy internal context assembly (replaced by KO)
   */
  private async assembleContextInternally(task: string): Promise<string> {
    // This is the old way - now replaced by Knowledge Orchestrator
    return `[Internal context for: ${task}]`;
  }

  /**
   * Generate reasoning based on context
   */
  private generateReasoning(task: string, context: string): string {
    if (context && context.length > 100) {
      return `Based on the available knowledge context, analyzing ${task}. The context provides relevant insights that inform the decision-making process.`;
    } else {
      return `Limited context available for ${task}. Proceeding with available information.`;
    }
  }

  /**
   * Determine outcome based on task and context
   */
  private determineOutcome(task: string, context: string, reasoning: string): string {
    // Simple example logic - in reality this would be more sophisticated
    const hasRichContext = context.length > 500;
    const taskComplexity = task.split(' ').length;
    
    if (hasRichContext && taskComplexity > 5) {
      return 'PROCEED_WITH_CAUTION';
    } else if (hasRichContext) {
      return 'PROCEED_CONFIDENTLY';
    } else if (taskComplexity > 8) {
      return 'NEED_MORE_INFO';
    } else {
      return 'PROCEED_WITH_STANDARD_APPROACH';
    }
  }

  /**
   * Calculate confidence based on available information
   */
  private calculateConfidence(context: string, citationCount: number): number {
    let confidence = 0.5; // Base confidence
    
    // Increase confidence based on context richness
    if (context.length > 1000) confidence += 0.3;
    else if (context.length > 500) confidence += 0.2;
    else if (context.length > 200) confidence += 0.1;
    
    // Increase confidence based on citations
    if (citationCount >= 5) confidence += 0.2;
    else if (citationCount >= 3) confidence += 0.1;
    else if (citationCount >= 1) confidence += 0.05;
    
    return Math.min(0.95, confidence); // Cap at 95%
  }

  /**
   * Generate unique decision ID
   */
  private generateDecisionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `decision_${timestamp}_${random}`;
  }

  /**
   * Get decision by ID
   */
  getDecision(id: string): Decision | undefined {
    return this.decisions.find(d => d.id === id);
  }

  /**
   * Get all decisions
   */
  getAllDecisions(): Decision[] {
    return [...this.decisions];
  }

  /**
   * Get decisions with citations
   */
  getDecisionsWithCitations(): Decision[] {
    return this.decisions.filter(d => d.citations && d.citations.length > 0);
  }

  /**
   * Search decisions by task or content
   */
  searchDecisions(query: string): Decision[] {
    const lowerQuery = query.toLowerCase();
    return this.decisions.filter(d => 
      d.task.toLowerCase().includes(lowerQuery) ||
      d.context.toLowerCase().includes(lowerQuery) ||
      d.reasoning.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get decision statistics
   */
  getStats(): {
    totalDecisions: number;
    decisionsWithCitations: number;
    averageConfidence: number;
    sourceBreakdown: { [source: string]: number };
  } {
    const decisionsWithCitations = this.getDecisionsWithCitations();
    
    const sourceBreakdown: { [source: string]: number } = {};
    decisionsWithCitations.forEach(decision => {
      decision.citations?.forEach(citation => {
        sourceBreakdown[citation.source] = (sourceBreakdown[citation.source] || 0) + 1;
      });
    });

    const avgConfidence = this.decisions.length > 0 
      ? this.decisions.reduce((sum, d) => sum + d.confidence, 0) / this.decisions.length
      : 0;

    return {
      totalDecisions: this.decisions.length,
      decisionsWithCitations: decisionsWithCitations.length,
      averageConfidence: avgConfidence,
      sourceBreakdown
    };
  }
}

// Example usage demonstration
async function demonstrateMoneyBagIntegration() {
  console.log('🚀 MoneyBag + Knowledge Orchestrator Integration Demo\n');
  
  const moneyBag = new MoneyBag({
    useKnowledgeOrchestrator: true,
    koScopes: ['domain', 'personal'],
    allowWeb: false,
    allowPrivate: true
  });

  try {
    // Example decision-making scenarios
    const scenarios = [
      'Should we invest in TypeScript migration for our legacy codebase?',
      'What are the best practices for implementing microservices architecture?',
      'How should we approach technical debt in our current sprint?'
    ];

    console.log('Making decisions with KO integration...\n');

    for (const scenario of scenarios) {
      const decision = await moneyBag.makeDecision(scenario, 'demo-agent');
      
      console.log(`📋 Decision: ${decision.outcome}`);
      console.log(`🎯 Confidence: ${(decision.confidence * 100).toFixed(1)}%`);
      console.log(`📚 Citations: ${decision.citations?.length || 0}`);
      
      if (decision.citations && decision.citations.length > 0) {
        console.log('   Sources:');
        decision.citations.slice(0, 3).forEach(citation => {
          console.log(`   • ${citation.title} (${citation.source})`);
        });
      }
      
      console.log(''); // Empty line for readability
    }

    // Display statistics
    const stats = moneyBag.getStats();
    console.log('📊 Final Statistics:');
    console.log(`   Total Decisions: ${stats.totalDecisions}`);
    console.log(`   With Citations: ${stats.decisionsWithCitations}`);
    console.log(`   Average Confidence: ${(stats.averageConfidence * 100).toFixed(1)}%`);
    console.log(`   Source Usage:`, stats.sourceBreakdown);

  } catch (error) {
    console.error('❌ Demo failed:', error);
  }
}

export { MoneyBag, type Decision, type Citation };

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateMoneyBagIntegration();
}