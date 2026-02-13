import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { Pattern, LearnedContext, Message, Signal } from '@tinyclaw/types';
import { detectSignals } from './detector.js';

export interface LearningEngineConfig {
  storagePath: string;
  minConfidence?: number;
}

export function createLearningEngine(config: LearningEngineConfig) {
  const minConfidence = config.minConfidence || 0.7;
  const patternsPath = join(config.storagePath, 'patterns.json');

  // Ensure directory exists
  try {
    mkdirSync(dirname(patternsPath), { recursive: true });
  } catch {}

  // Load patterns
  let patterns: Pattern[] = [];
  try {
    const data = readFileSync(patternsPath, 'utf-8');
    patterns = JSON.parse(data);
  } catch {
    // File doesn't exist yet, start with empty patterns
  }

  function savePatterns(): void {
    try {
      writeFileSync(patternsPath, JSON.stringify(patterns, null, 2));
    } catch (err) {
      // Silent fail - could be logged if logger is available
    }
  }

  function storeSignal(signal: Signal): void {
    if (signal.confidence < minConfidence) return;

    const category = `${signal.type}_general`;
    const existing = patterns.find(p => p.category === category);

    if (existing) {
      // Update confidence (weighted average)
      existing.confidence = (existing.confidence * 0.7) + (signal.confidence * 0.3);
      existing.examples.push(signal.context);
      existing.lastUpdated = Date.now();

      // Keep only last 10 examples
      if (existing.examples.length > 10) {
        existing.examples = existing.examples.slice(-10);
      }
    } else {
      // New pattern
      patterns.push({
        category,
        preference: signal.learned || signal.context,
        confidence: signal.confidence,
        examples: [signal.context],
        lastUpdated: Date.now(),
      });
    }

    savePatterns();
  }

  return {
    analyze(userMessage: string, assistantMessage: string, history: Message[]): void {
      const signals = detectSignals(userMessage, assistantMessage);
      for (const signal of signals) {
        storeSignal(signal);
      }
    },

    getContext(): LearnedContext {
      const highConfidence = patterns.filter(p => p.confidence >= minConfidence);

      const preferences = highConfidence
        .filter(p => p.category.includes('preference') || p.category.includes('correction'))
        .map(p => `- ${p.preference}`)
        .join('\n');

      const patternsText = highConfidence
        .filter(p => p.category.includes('positive'))
        .map(p => `- Works well: ${p.preference}`)
        .join('\n');

      const recentCorrections = patterns
        .filter(p => p.category.includes('correction'))
        .slice(-5)
        .map(p => `- ${p.preference}`)
        .join('\n');

      return { preferences, patterns: patternsText, recentCorrections };
    },

    injectIntoPrompt(basePrompt: string, context: LearnedContext): string {
      if (!context.preferences && !context.patterns && !context.recentCorrections) {
        return basePrompt;
      }

      let additions = '\n\n## Learned About This User\n';

      if (context.preferences) {
        additions += `\n### Preferences\n${context.preferences}\n`;
      }

      if (context.patterns) {
        additions += `\n### What Works\n${context.patterns}\n`;
      }

      if (context.recentCorrections) {
        additions += `\n### Recent Corrections\n${context.recentCorrections}\n`;
      }

      return basePrompt + additions;
    },

    getStats() {
      return {
        totalPatterns: patterns.length,
        highConfidencePatterns: patterns.filter(p => p.confidence >= minConfidence).length,
      };
    }
  };
}

export type { LearningEngineConfig as LearningConfig };
