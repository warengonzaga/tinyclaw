/**
 * Rule-Based Pre-Compression
 *
 * Deterministic text transformations applied before LLM summarization.
 * Learned from claw-compactor's Layer 1: reduces token input to the
 * summarization call without requiring an LLM.
 *
 * 9 rules applied in sequence:
 *   1. CJK punctuation normalization
 *   2. Collapse whitespace / strip trailing spaces
 *   3. Deduplicate lines
 *   4. Remove empty sections
 *   5. Compress markdown tables to key:value
 *   6. Strip emoji
 *   7. Merge similar bullets (SequenceMatcher-style)
 *   8. Merge short consecutive bullets
 *   9. Remove decorative lines
 */

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

// Matches most emoji: emoticons, dingbats, symbols, skin tones, ZWJ sequences
const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

// Markdown header
const HEADER_RE = /^(#{1,6})\s+(.*)/;

// Table separator line
const TABLE_SEP_RE = /^[\s|:\-]+$/;

// Bullet line
const BULLET_RE = /^(\s*[-*+]\s+)(.*)/;

// Chinese fullwidth punctuation -> ASCII equivalents (each saves ~1 token)
const ZH_PUNCT_MAP: Record<string, string> = {
  '\uFF0C': ',', '\u3002': '.', '\uFF1B': ';', '\uFF1A': ':', '\uFF01': '!', '\uFF1F': '?',
  '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'",
  '\uFF08': '(', '\uFF09': ')', '\u3010': '[', '\u3011': ']',
  '\u3001': ',', '\u2026': '...', '\uFF5E': '~',
};
const ZH_PUNCT_RE = new RegExp(
  Object.keys(ZH_PUNCT_MAP).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
);

// ---------------------------------------------------------------------------
// Core rules
// ---------------------------------------------------------------------------

/**
 * Normalize Chinese fullwidth punctuation to ASCII equivalents.
 * Each replacement typically saves ~1 token.
 */
export function normalizeCjkPunctuation(text: string): string {
  if (!text) return '';
  let result = text.replace('\u2014\u2014', '--'); // em-dash pair
  result = result.replace(ZH_PUNCT_RE, (m) => ZH_PUNCT_MAP[m] ?? m);
  return result;
}

/**
 * Remove emoji characters from text.
 */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI_REGEX, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Remove exact duplicate lines while preserving order.
 * Keeps the first occurrence of each line.
 */
export function deduplicateLines(text: string): string {
  const lines = text.split('\n');
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Keep empty lines for structure, deduplicate non-empty ones
    if (trimmed === '' || !seen.has(trimmed)) {
      result.push(line);
      if (trimmed !== '') seen.add(trimmed);
    }
  }

  return result.join('\n');
}

/**
 * Collapse runs of 3+ blank lines into a single blank line.
 * Also trims trailing whitespace from each line.
 */
export function collapseWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Remove lines that are entirely empty content markers like "---", "***", "===".
 */
export function removeDecorativeLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^[\s]*[-*=]{3,}[\s]*$/.test(line))
    .join('\n');
}

/**
 * Remove markdown sections that have no meaningful body content.
 * A section with only whitespace and no child sections is removed.
 */
export function removeEmptySections(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');

  interface Section {
    header: string;
    level: number;
    bodyLines: string[];
  }

  const sections: Section[] = [];
  let current: Section = { header: '', level: 0, bodyLines: [] };

  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      sections.push(current);
      current = { header: m[2].trim(), level: m[1].length, bodyLines: [] };
    } else {
      current.bodyLines.push(line);
    }
  }
  sections.push(current);

  // Determine which sections have children (a deeper section follows)
  const hasChild = new Array(sections.length).fill(false);
  for (let i = 1; i < sections.length; i++) {
    if (sections[i].level > 0) {
      for (let p = i - 1; p >= 0; p--) {
        if (sections[p].level > 0 && sections[p].level < sections[i].level) {
          hasChild[p] = true;
          break;
        }
      }
    }
  }

  const result: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const body = sec.bodyLines.join('\n').trim();
    if (!sec.header && !body) continue;
    if (sec.header && !body && !hasChild[i]) continue; // empty section, no children
    if (sec.header) result.push('#'.repeat(sec.level) + ' ' + sec.header);
    if (body) result.push(body);
    result.push(''); // blank line between sections
  }

  return result.join('\n').trim();
}

/**
 * Convert markdown tables to compact key:value notation.
 * 2-column tables become "- Key: Value" lines.
 * Multi-column tables become compact "Col1, Header2=Val2" lines.
 * Wide tables (5+ columns) are preserved as pipe-delimited rows without header/separator.
 */
export function compressMarkdownTable(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      TABLE_SEP_RE.test(lines[i + 1].trim())
    ) {
      const headers = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        rows.push(cells);
        i++;
      }

      if (headers.length >= 5) {
        // Wide tables: preserve rows without header/separator
        for (const row of rows) {
          result.push('| ' + row.join(' | ') + ' |');
        }
      } else if (headers.length === 2) {
        // 2-column: key: value format
        for (const row of rows) {
          const k = row[0] ?? '';
          const v = row[1] ?? '';
          if (k || v) result.push(`- ${k}: ${v}`);
        }
      } else {
        // Multi-column: compact format using headers as labels
        for (const row of rows) {
          const parts: string[] = [];
          for (let ci = 0; ci < row.length; ci++) {
            if (ci === 0) {
              parts.push(row[ci]);
            } else if (ci < headers.length) {
              parts.push(`${headers[ci]}=${row[ci]}`);
            } else {
              parts.push(row[ci]);
            }
          }
          result.push(parts.join(', '));
        }
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Compute similarity ratio between two strings (0.0–1.0).
 * Simplified SequenceMatcher-style comparison using bigram overlap.
 */
function similarityRatio(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) ?? 0) + 1);
  }

  const bigramsB = new Map<string, number>();
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    bigramsB.set(bg, (bigramsB.get(bg) ?? 0) + 1);
  }

  let intersection = 0;
  for (const [bg, countA] of bigramsA) {
    intersection += Math.min(countA, bigramsB.get(bg) ?? 0);
  }

  const total = (a.length - 1) + (b.length - 1);
  return total === 0 ? 0 : (2 * intersection) / total;
}

/**
 * Merge bullet lines with high similarity (>= threshold).
 * When two bullets are near-identical, keep the longer one.
 */
export function mergeSimilarBullets(text: string, threshold: number = 0.8): string {
  if (!text) return '';

  const lines = text.split('\n');
  const result: string[] = [];
  const bullets: Array<{ prefix: string; content: string; line: string }> = [];

  function flushBullets(): void {
    if (!bullets.length) return;

    const mergedOut = new Array(bullets.length).fill(false);
    for (let i = 0; i < bullets.length; i++) {
      if (mergedOut[i]) continue;
      for (let j = i + 1; j < bullets.length; j++) {
        if (mergedOut[j]) continue;
        const ratio = similarityRatio(bullets[i].content, bullets[j].content);
        if (ratio >= threshold) {
          // Keep the longer one
          if (bullets[j].content.length > bullets[i].content.length) {
            mergedOut[i] = true;
            break;
          } else {
            mergedOut[j] = true;
          }
        }
      }
    }

    for (let i = 0; i < bullets.length; i++) {
      if (!mergedOut[i]) result.push(bullets[i].line);
    }
    bullets.length = 0;
  }

  for (const line of lines) {
    const m = BULLET_RE.exec(line);
    if (m) {
      bullets.push({ prefix: m[1], content: m[2], line });
    } else {
      flushBullets();
      result.push(line);
    }
  }
  flushBullets();

  return result.join('\n');
}

/**
 * Combine consecutive short bullet points into comma-separated form.
 * Bullets with <= maxWords words are candidates. Up to maxMerge
 * consecutive short bullets are joined into one line.
 */
export function mergeShortBullets(
  text: string,
  maxWords: number = 3,
  maxMerge: number = 10,
): string {
  if (!text) return '';

  const lines = text.split('\n');
  const result: string[] = [];
  const shortBullets: string[] = [];
  let bulletPrefix = '- ';

  function flushShort(): void {
    if (!shortBullets.length) return;
    if (shortBullets.length <= 2) {
      for (const sb of shortBullets) result.push(bulletPrefix + sb);
    } else {
      result.push(bulletPrefix + shortBullets.join(', '));
    }
    shortBullets.length = 0;
  }

  for (const line of lines) {
    const m = BULLET_RE.exec(line);
    if (m) {
      const content = m[2].trim();
      bulletPrefix = m[1];
      if (content.split(/\s+/).length <= maxWords) {
        shortBullets.push(content);
        if (shortBullets.length >= maxMerge) flushShort();
      } else {
        flushShort();
        result.push(line);
      }
    } else {
      flushShort();
      result.push(line);
    }
  }
  flushShort();

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Apply all pre-compression rules to a message's content.
 *
 * The full 9-rule pipeline runs in this order:
 *   1. CJK punctuation normalization
 *   2. Collapse whitespace
 *   3. Deduplicate lines
 *   4. Remove empty sections
 *   5. Compress markdown tables
 *   6. Strip emoji (if enabled)
 *   7. Merge similar bullets
 *   8. Merge short bullets
 *   9. Remove decorative lines + final cleanup
 */
export function preCompress(
  text: string,
  options: { stripEmoji: boolean; removeDuplicateLines: boolean },
): string {
  let result = text;

  // 1. CJK punctuation normalization
  result = normalizeCjkPunctuation(result);

  // 2. Collapse whitespace
  result = collapseWhitespace(result);

  // 3. Deduplicate lines
  if (options.removeDuplicateLines) {
    result = deduplicateLines(result);
  }

  // 4. Remove empty sections
  result = removeEmptySections(result);

  // 5. Compress markdown tables
  result = compressMarkdownTable(result);

  // 6. Strip emoji
  if (options.stripEmoji) {
    result = stripEmoji(result);
  }

  // 7. Merge similar bullets
  result = mergeSimilarBullets(result);

  // 8. Merge short bullets
  result = mergeShortBullets(result);

  // 9. Final cleanup
  result = collapseWhitespace(result);
  result = removeDecorativeLines(result);

  return result;
}
