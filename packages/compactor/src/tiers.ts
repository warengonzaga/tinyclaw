/**
 * Tiered Summary Generation
 *
 * Derives L1 and L0 summaries from the full L2 summary using
 * deterministic section prioritization and token budget trimming.
 *
 * Inspired by claw-compactor's progressive context loading:
 *   L2 (3000 tokens) — Full LLM summary
 *   L1 (1000 tokens) — Working memory: prioritized sections
 *   L0 (200 tokens)  — Ultra-compact: identity + critical decisions
 *
 * Only one LLM call is needed (for L2). L1 and L0 are derived.
 */

import { estimateTokens, truncateToTokenBudget } from './tokens.js';
import type { TieredSummary } from './types.js';

// ---------------------------------------------------------------------------
// Section Priorities
// ---------------------------------------------------------------------------

/** Priority weights for different content categories. Higher = kept first. */
const SECTION_PRIORITIES: Record<string, number> = {
  // Identity / user facts
  name: 10,
  identity: 10,
  user: 9,
  // Decisions
  decision: 9,
  correction: 9,
  // Active tasks
  task: 8,
  todo: 8,
  action: 8,
  // Preferences
  preference: 7,
  like: 6,
  dislike: 6,
  // Context
  topic: 5,
  conversation: 4,
  summary: 4,
  note: 3,
};

/**
 * Score a line or section based on keyword matches.
 */
function scoreLine(line: string): number {
  const lower = line.toLowerCase();
  let maxScore = 1; // Default priority for unmatched lines

  for (const [keyword, priority] of Object.entries(SECTION_PRIORITIES)) {
    if (lower.includes(keyword)) {
      maxScore = Math.max(maxScore, priority);
    }
  }

  return maxScore;
}

// ---------------------------------------------------------------------------
// Tier Generation
// ---------------------------------------------------------------------------

/**
 * Generate tiered summaries from a full L2 summary.
 *
 * @param l2Summary - The full LLM-generated summary
 * @param budgets - Token budgets for each tier
 */
export function generateTiers(
  l2Summary: string,
  budgets: { l0: number; l1: number; l2: number },
): TieredSummary {
  // L2 is the full summary, just ensure it fits the budget
  const l2 = truncateToTokenBudget(l2Summary, budgets.l2);

  // L1: Keep highest-priority lines within budget
  const l1 = buildTierFromPriority(l2, budgets.l1);

  // L0: Keep only the most critical facts
  const l0 = buildTierFromPriority(l1, budgets.l0);

  return { l0, l1, l2 };
}

/**
 * Build a tier by selecting highest-priority lines that fit the budget.
 */
function buildTierFromPriority(text: string, tokenBudget: number): string {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);

  // Score and sort by priority (descending)
  const scored = lines.map((line) => ({
    line,
    score: scoreLine(line),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Greedily fill until budget is reached
  const selected: Array<{ line: string; originalIndex: number }> = [];
  let currentTokens = 0;

  for (const { line, score } of scored) {
    const lineTokens = estimateTokens(line);
    if (currentTokens + lineTokens > tokenBudget) continue;

    selected.push({ line, originalIndex: lines.indexOf(line) });
    currentTokens += lineTokens;
  }

  // Re-sort by original order to maintain coherent reading
  selected.sort((a, b) => a.originalIndex - b.originalIndex);

  return selected.map((s) => s.line).join('\n');
}
