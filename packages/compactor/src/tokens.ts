/**
 * Token Estimation
 *
 * Heuristic-based token counting without external dependencies.
 * Inspired by claw-compactor's approach: ~4 chars/token for English,
 * ~1.5 chars/token for CJK characters.
 */

const CJK_RANGE =
  /[\u2E80-\u9FFF\uA000-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\u{20000}-\u{2FA1F}]/u;

/**
 * Estimate token count for a given text.
 *
 * Uses a character-based heuristic calibrated against common tokenizers:
 * - English text: ~4 characters per token
 * - CJK text: ~1.5 characters per token
 * - Mixed: weighted average
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let cjkChars = 0;
  for (const char of text) {
    if (CJK_RANGE.test(char)) cjkChars++;
  }

  const totalChars = text.length;
  const asciiChars = totalChars - cjkChars;

  // ASCII at ~4 chars/token, CJK at ~1.5 chars/token
  const asciiTokens = asciiChars / 4;
  const cjkTokens = cjkChars / 1.5;

  return Math.ceil(asciiTokens + cjkTokens);
}

/**
 * Truncate text to fit within a token budget.
 * Cuts at word boundaries when possible.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;

  // Approximate character limit from token budget
  const charLimit = maxTokens * 4;
  let truncated = text.slice(0, charLimit);

  // Cut at last newline or space for clean boundary
  const lastNewline = truncated.lastIndexOf('\n');
  const lastSpace = truncated.lastIndexOf(' ');
  const cutPoint = Math.max(lastNewline, lastSpace);

  if (cutPoint > charLimit * 0.5) {
    truncated = truncated.slice(0, cutPoint);
  }

  return truncated;
}
