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

// Core pipeline
export { createCompactor } from './compactor.js';
export { estimateTokens, truncateToTokenBudget } from './tokens.js';
export {
  preCompress,
  stripEmoji,
  deduplicateLines,
  collapseWhitespace,
  removeDecorativeLines,
  normalizeCjkPunctuation,
  removeEmptySections,
  compressMarkdownTable,
  mergeSimilarBullets,
  mergeShortBullets,
} from './rules.js';
export { deduplicateMessages, computeShingles, jaccardSimilarity } from './dedup.js';
export { generateTiers } from './tiers.js';

// Dictionary encoding (standalone utility)
export {
  buildCodebook,
  compressText,
  decompressText,
  compressionStats,
} from './dictionary.js';
export type { Codebook, BuildCodebookOptions } from './dictionary.js';

// Tokenizer optimizer (standalone utility)
export {
  optimizeTokens,
  stripBoldItalic,
  stripTrivialBackticks,
  minimizeWhitespace,
  compactBullets,
  compressTableToKv,
} from './optimizer.js';
export type { OptimizerOptions } from './optimizer.js';

// Compressed Context Protocol (standalone utility)
export { compressContext, compressContextWithStats } from './ccp.js';
export type { CcpLevel, CcpResult, CcpResultWithStats } from './ccp.js';

// Types
export type {
  CompactorStore,
  CompactorConfig,
  CompactorEngine,
  CompactionResult,
  CompactionMetrics,
  TieredSummary,
} from './types.js';
export { DEFAULT_COMPACTOR_CONFIG } from './types.js';
