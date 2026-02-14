/**
 * Compactor Types
 *
 * Narrow interfaces for the compaction subsystem.
 * Core's Database satisfies CompactorStore without changes.
 */

import type { Message, CompactionRecord, Provider } from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// CompactorStore — subset of Database used by compaction
// ---------------------------------------------------------------------------

export interface CompactorStore {
  getMessageCount(userId: string): number;
  getHistory(userId: string, limit?: number): Message[];
  /** Return message timestamps ordered ascending (oldest first). */
  getMessageTimestamps(userId: string): number[];
  saveCompaction(userId: string, summary: string, replacedBefore: number): void;
  getLatestCompaction(userId: string): CompactionRecord | null;
  deleteMessagesBefore(userId: string, beforeTimestamp: number): void;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CompactorConfig {
  /** Message count threshold to trigger compaction. Default: 60 */
  threshold: number;
  /** Number of recent messages to keep after compaction. Default: 20 */
  keepRecent: number;
  /** Token budgets per tier. */
  tierBudgets: {
    l0: number;
    l1: number;
    l2: number;
  };
  /** Deduplication settings. */
  dedup: {
    enabled: boolean;
    similarityThreshold: number;
  };
  /** Pre-compression settings. */
  preCompression: {
    stripEmoji: boolean;
    removeDuplicateLines: boolean;
  };
}

export const DEFAULT_COMPACTOR_CONFIG: CompactorConfig = {
  threshold: 60,
  keepRecent: 20,
  tierBudgets: {
    l0: 200,
    l1: 1000,
    l2: 3000,
  },
  dedup: {
    enabled: true,
    similarityThreshold: 0.6,
  },
  preCompression: {
    stripEmoji: true,
    removeDuplicateLines: true,
  },
};

// ---------------------------------------------------------------------------
// Compaction Result & Tiered Summary
// ---------------------------------------------------------------------------

export interface CompactionMetrics {
  /** Total messages before compaction. */
  messagesBefore: number;
  /** Messages summarized (removed). */
  messagesSummarized: number;
  /** Messages kept. */
  messagesKept: number;
  /** Estimated token count of original messages. */
  tokensBefore: number;
  /** Estimated token count of L2 summary. */
  tokensAfter: number;
  /** Compression ratio (tokensAfter / tokensBefore). Lower = better. */
  compressionRatio: number;
  /** Number of near-duplicate message groups removed by dedup. */
  dedupGroupsRemoved: number;
  /** Duration of compaction in ms. */
  durationMs: number;
}

export interface TieredSummary {
  /** Ultra-compact (200 tokens): identity, active decisions, critical corrections. */
  l0: string;
  /** Working memory (1000 tokens): decisions, actions, preferences, topics. */
  l1: string;
  /** Full context (3000 tokens): complete summary. */
  l2: string;
}

export interface CompactionResult {
  summary: TieredSummary;
  metrics: CompactionMetrics;
}

// ---------------------------------------------------------------------------
// Compactor Engine
// ---------------------------------------------------------------------------

export interface CompactorEngine {
  /** Run compaction if message count exceeds threshold. */
  compactIfNeeded(userId: string, provider: Provider): Promise<CompactionResult | null>;
  /** Get the latest compaction summary for a user. */
  getLatestSummary(userId: string): string | null;
  /** Estimate token count for a string. */
  estimateTokens(text: string): number;
}
