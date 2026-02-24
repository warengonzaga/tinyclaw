/**
 * @tinyclaw/compactor — Enhanced Conversation Compaction
 *
 * Layered compression pipeline for AI agent conversation history:
 *
 *   Layer 1: Rule-based pre-compression (9 rules: dedup, emoji, whitespace,
 *            CJK normalization, empty sections, table compression,
 *            similar bullet merging, short bullet merging, decorative lines)
 *   Layer 2: Message deduplication (shingle hashing + Jaccard similarity)
 *   Layer 3: LLM summarization (single call for L2 summary)
 *   Layer 4: Tiered summaries (L0/L1/L2 derived from L2)
 *
 * Standalone utilities (not part of automatic pipeline):
 *   - Dictionary encoding: auto-learned codebook, $XX substitution (lossless)
 *   - Tokenizer optimizer: encoding-aware format fixes (1-3% savings)
 *   - Compressed Context Protocol (CCP): ultra/medium/light abbreviation (20-60%)
 *
 * Usage:
 *   import { createCompactor } from '@tinyclaw/compactor';
 *   const compactor = createCompactor(db, config);
 *   await compactor.compactIfNeeded(userId, provider);
 */

export type { CcpLevel, CcpResult, CcpResultWithStats } from './ccp.js';
// Compressed Context Protocol (standalone utility)
export { compressContext, compressContextWithStats } from './ccp.js';
// Core pipeline
export { createCompactor } from './compactor.js';
export { computeShingles, deduplicateMessages, jaccardSimilarity } from './dedup.js';
export type { BuildCodebookOptions, Codebook } from './dictionary.js';

// Dictionary encoding (standalone utility)
export {
  buildCodebook,
  compressionStats,
  compressText,
  decompressText,
} from './dictionary.js';
export type { OptimizerOptions } from './optimizer.js';

// Tokenizer optimizer (standalone utility)
export {
  compactBullets,
  compressTableToKv,
  minimizeWhitespace,
  optimizeTokens,
  stripBoldItalic,
  stripTrivialBackticks,
} from './optimizer.js';
export {
  collapseWhitespace,
  compressMarkdownTable,
  deduplicateLines,
  mergeShortBullets,
  mergeSimilarBullets,
  normalizeCjkPunctuation,
  preCompress,
  removeDecorativeLines,
  removeEmptySections,
  stripEmoji,
} from './rules.js';
export { generateTiers } from './tiers.js';
export { estimateTokens, truncateToTokenBudget } from './tokens.js';

// Types
export type {
  CompactionMetrics,
  CompactionResult,
  CompactorConfig,
  CompactorEngine,
  CompactorStore,
  TieredSummary,
} from './types.js';
export { DEFAULT_COMPACTOR_CONFIG } from './types.js';
