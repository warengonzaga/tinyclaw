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
 *
 * Counts Unicode code points (not UTF-16 code units) so supplementary
 * characters are measured consistently.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let cjkChars = 0;
  let totalChars = 0;
  for (const char of text) {
    totalChars++;
    if (CJK_RANGE.test(char)) cjkChars++;
  }

  const asciiChars = totalChars - cjkChars;

  // ASCII at ~4 chars/token, CJK at ~1.5 chars/token
  const asciiTokens = asciiChars / 4;
  const cjkTokens = cjkChars / 1.5;

  return Math.ceil(asciiTokens + cjkTokens);
}

/**
 * Truncate text to fit within a token budget.
 * Uses an adaptive chars-per-token ratio based on content composition
 * and slices by Unicode code points to avoid splitting surrogate pairs.
 * Iteratively trims until the token count is within budget.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;

  // Detect CJK density to choose an adaptive chars-per-token ratio
  const codePoints = Array.from(text);
  let cjkCount = 0;
  for (const cp of codePoints) {
    if (CJK_RANGE.test(cp)) cjkCount++;
  }
  const cjkRatio = codePoints.length > 0 ? cjkCount / codePoints.length : 0;
  // Blend between ~1.5 (pure CJK) and ~4 (pure ASCII)
  const charsPerToken = cjkRatio > 0.3 ? 1.5 + (1 - cjkRatio) * 2.5 : 4;

  // Initial estimate: slice by code points
  let charLimit = Math.floor(maxTokens * charsPerToken);
  let truncated = codePoints.slice(0, charLimit).join('');

  // Cut at last newline or space for clean boundary
  const lastNewline = truncated.lastIndexOf('\n');
  const lastSpace = truncated.lastIndexOf(' ');
  const cutPoint = Math.max(lastNewline, lastSpace);

  if (cutPoint > truncated.length * 0.5) {
    truncated = truncated.slice(0, cutPoint);
  }

  // Iteratively trim if still over budget
  while (estimateTokens(truncated) > maxTokens && truncated.length > 0) {
    const overBy = estimateTokens(truncated) - maxTokens;
    // Remove roughly overBy * charsPerToken code points
    const trimBy = Math.max(1, Math.floor(overBy * charsPerToken));
    const trimmedCps = Array.from(truncated);
    trimmedCps.length = Math.max(0, trimmedCps.length - trimBy);
    truncated = trimmedCps.join('');

    // Re-cut at word boundary
    const ls = truncated.lastIndexOf(' ');
    const ln = truncated.lastIndexOf('\n');
    const cp2 = Math.max(ls, ln);
    if (cp2 > truncated.length * 0.5) {
      truncated = truncated.slice(0, cp2);
    }
  }

  return truncated;
}
