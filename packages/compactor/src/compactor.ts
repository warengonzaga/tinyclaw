/**
 * Compactor Engine
 *
 * Enhanced compaction pipeline extracted from core/loop.ts.
 * Applies layered compression before LLM summarization:
 *
 *   1. Pre-compress messages (rule-based: dedup lines, strip emoji, collapse whitespace)
 *   2. Deduplicate near-identical messages (shingle hashing + Jaccard similarity)
 *   3. Estimate tokens and send to LLM for summarization
 *   4. Generate tiered summaries (L0/L1/L2) from the LLM output
 *   5. Save compaction record and delete old messages
 */

import { logger } from '@tinyclaw/logger';
import type { Provider } from '@tinyclaw/types';
import type {
  CompactorStore,
  CompactorConfig,
  CompactorEngine,
  CompactionResult,
} from './types.js';
import { DEFAULT_COMPACTOR_CONFIG } from './types.js';
import { estimateTokens } from './tokens.js';
import { preCompress } from './rules.js';
import { deduplicateMessages } from './dedup.js';
import { generateTiers } from './tiers.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a compactor engine.
 *
 * @param db - Narrow database interface (core's Database satisfies this)
 * @param config - Optional configuration overrides
 */
export function createCompactor(
  db: CompactorStore,
  config?: Partial<CompactorConfig>,
): CompactorEngine {
  const cfg: CompactorConfig = {
    ...DEFAULT_COMPACTOR_CONFIG,
    ...config,
    tierBudgets: {
      ...DEFAULT_COMPACTOR_CONFIG.tierBudgets,
      ...config?.tierBudgets,
    },
    dedup: {
      ...DEFAULT_COMPACTOR_CONFIG.dedup,
      ...config?.dedup,
    },
    preCompression: {
      ...DEFAULT_COMPACTOR_CONFIG.preCompression,
      ...config?.preCompression,
    },
  };

  return {
    async compactIfNeeded(
      userId: string,
      provider: Provider,
    ): Promise<CompactionResult | null> {
      const count = db.getMessageCount(userId);
      if (count < cfg.threshold) return null;

      const startTime = Date.now();
      logger.info('Compacting conversation history', { userId, messageCount: count });

      // 1. Fetch all messages, split into old and recent
      const allMessages = db.getHistory(userId, count);
      const splitAt = allMessages.length - cfg.keepRecent;
      if (splitAt <= 0) return null;

      let oldMessages = allMessages.slice(0, splitAt);
      const messagesBefore = allMessages.length;

      // 2. Pre-compress each message
      oldMessages = oldMessages.map((m) => ({
        ...m,
        content: preCompress(m.content ?? '', cfg.preCompression),
      }));

      // 3. Deduplicate near-identical messages
      let dedupGroupsRemoved = 0;
      if (cfg.dedup.enabled) {
        const dedupResult = deduplicateMessages(
          oldMessages,
          cfg.dedup.similarityThreshold,
        );
        oldMessages = dedupResult.messages;
        dedupGroupsRemoved = dedupResult.groupsRemoved;
      }

      // 4. Estimate tokens of cleaned content
      const summaryContent = oldMessages
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');
      const tokensBefore = estimateTokens(summaryContent);

      // 5. Send to LLM for summarization
      try {
        const response = await provider.chat([
          {
            role: 'system',
            content:
              'You are a summarizer. Produce a concise summary of the following conversation. ' +
              'Structure your summary with clear sections. ' +
              'Preserve: key facts about the user (name, preferences, location), ' +
              'important decisions made, corrections or clarifications, ' +
              'and any open tasks or TODOs. ' +
              `Keep your summary under ${cfg.tierBudgets.l2} tokens.`,
          },
          { role: 'user', content: summaryContent },
        ]);

        const rawSummary = response.content ?? '';
        if (!rawSummary) return null;

        // 6. Generate tiered summaries
        const summary = generateTiers(rawSummary, cfg.tierBudgets);
        const tokensAfter = estimateTokens(summary.l2);

        // 7. Save compaction and delete old messages
        const cutoffTimestamp = Date.now();
        db.saveCompaction(userId, summary.l2, cutoffTimestamp);

        const totalNow = db.getMessageCount(userId);
        const toDelete = totalNow - cfg.keepRecent;
        if (toDelete > 0) {
          db.deleteMessagesBefore(userId, cutoffTimestamp);
        }

        const durationMs = Date.now() - startTime;

        const metrics = {
          messagesBefore,
          messagesSummarized: splitAt,
          messagesKept: cfg.keepRecent,
          tokensBefore,
          tokensAfter,
          compressionRatio: tokensBefore > 0 ? tokensAfter / tokensBefore : 0,
          dedupGroupsRemoved,
          durationMs,
        };

        logger.info('Compaction complete', {
          userId,
          summarized: splitAt,
          kept: cfg.keepRecent,
          tokensBefore,
          tokensAfter,
          compressionRatio: metrics.compressionRatio.toFixed(2),
          dedupGroupsRemoved,
          durationMs,
        });

        return { summary, metrics };
      } catch (err) {
        logger.error('Compaction failed, skipping', err);
        return null;
      }
    },

    getLatestSummary(userId: string): string | null {
      const compaction = db.getLatestCompaction(userId);
      return compaction?.summary ?? null;
    },

    estimateTokens,
  };
}
