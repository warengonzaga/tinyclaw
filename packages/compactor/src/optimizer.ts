/**
 * Tokenizer-Level Format Optimization
 *
 * Encoding-aware transformations that reduce token count while preserving
 * all semantic information. Each transformation targets specific tokenizer
 * inefficiencies in cl100k_base / o200k_base.
 *
 * Key insight: the same information can be encoded in fewer tokens
 * by choosing formats the tokenizer handles more efficiently.
 *
 * Ported from claw-compactor's tokenizer_optimizer.py. Savings: 1-3%.
 */

import { normalizeCjkPunctuation } from './rules.js';

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const BOLD_RE = /\*\*(.+?)\*\*/g;
const ITALIC_RE = /(?<!\*)\*([^*]+?)\*(?!\*)/g;
const TRIVIAL_CODE_RE = /`([a-zA-Z0-9_.-]+)`/g;
const TABLE_SEP_RE = /^[\s|:-]+$/;
const MULTI_SPACE_RE = / {2,}/g;
const _LEADING_SPACES_RE = /^( {4,})/gm;
const BULLET_RE = /^(\s*[-*+])\s+(.*)/;

// ---------------------------------------------------------------------------
// Individual optimizations
// ---------------------------------------------------------------------------

/**
 * Remove **bold** and *italic* markdown decorators.
 */
export function stripBoldItalic(text: string): string {
  if (!text) return '';
  let result = text.replace(BOLD_RE, '$1');
  result = result.replace(ITALIC_RE, '$1');
  return result;
}

/**
 * Remove backticks around simple words (not real code).
 * Keeps backticks when content contains spaces or special chars.
 */
export function stripTrivialBackticks(text: string): string {
  if (!text) return '';
  return text.replace(TRIVIAL_CODE_RE, '$1');
}

/**
 * Reduce multiple spaces and excessive indentation.
 * Preserves up to 4 leading spaces per line while collapsing inline runs.
 */
export function minimizeWhitespace(text: string): string {
  if (!text) return '';

  // Process line-by-line so leading indent and inline spaces are handled separately
  let result = text
    .split('\n')
    .map((line) => {
      // Separate leading whitespace from the rest
      const match = line.match(/^( *)(.*)/);
      if (!match) return line;
      const [, leadSpaces, rest] = match;
      // Cap leading indent at 4 spaces
      const indent = leadSpaces.length > 4 ? '    ' : leadSpaces;
      // Collapse inline multi-space runs
      const cleaned = rest.replace(MULTI_SPACE_RE, ' ');
      return indent + cleaned;
    })
    .join('\n');

  // Collapse 3+ consecutive newlines into 2
  result = result.replace(/\n{3,}/g, '\n\n');
  return result;
}

/**
 * Remove bullet prefixes from long consecutive bullet lists (3+).
 * Short lists (1-2 items) keep their original bullets.
 */
export function compactBullets(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const result: string[] = [];
  const bulletRun: Array<{ text: string; prefix: string; indent: string }> = [];

  function flush(): void {
    if (bulletRun.length >= 3) {
      // Strip bullet prefix for long runs
      for (const item of bulletRun) result.push(item.text);
    } else {
      // Keep original bullet character and indentation
      for (const item of bulletRun) result.push(item.indent + item.prefix + item.text);
    }
    bulletRun.length = 0;
  }

  for (const line of lines) {
    const m = BULLET_RE.exec(line);
    if (m) {
      // m[1] = full prefix incl. indent + bullet char, m[2] = content
      // Separate leading whitespace from the bullet character
      const fullPrefix = m[1];
      const indentMatch = fullPrefix.match(/^(\s*)(.+)/);
      const indent = indentMatch ? indentMatch[1] : '';
      const prefix = indentMatch ? `${indentMatch[2]} ` : '- ';
      bulletRun.push({ text: m[2], prefix, indent });
    } else {
      flush();
      result.push(line);
    }
  }
  flush();

  return result.join('\n');
}

/**
 * Convert markdown tables to compact key:value or compact format.
 */
export function compressTableToKv(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1].trim())) {
      const headers = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const cells = lines[i]
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
        rows.push(cells);
        i++;
      }

      const hasNonEmptyHeader = headers.some((h) => h.length > 0);

      if (headers.length === 2) {
        // 2-column: key:value format
        if (hasNonEmptyHeader) {
          result.push(`${headers[0] ?? ''}: ${headers[1] ?? ''}`);
        }
        for (const row of rows) {
          const k = row[0] ?? '';
          const v = row[1] ?? '';
          if (k || v) result.push(`${k}: ${v}`);
        }
      } else {
        // Multi-column: compact pipe-delimited
        if (hasNonEmptyHeader) {
          result.push(headers.join(' | '));
        }
        for (const row of rows) {
          result.push(row.join(' | '));
        }
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export interface OptimizerOptions {
  /** Apply aggressive transformations (strip bold/italic, compact bullets, strip backticks). */
  aggressive?: boolean;
}

/**
 * Apply all token-saving optimizations.
 *
 * Non-aggressive (default): CJK normalization, table compression, whitespace minimization.
 * Aggressive: additionally strips bold/italic, trivial backticks, compacts bullets.
 *
 * @returns The optimized text.
 */
export function optimizeTokens(text: string, options: OptimizerOptions = {}): string {
  if (!text) return '';
  const { aggressive = false } = options;

  let result = normalizeCjkPunctuation(text);
  result = compressTableToKv(result);
  result = minimizeWhitespace(result);

  if (aggressive) {
    result = stripBoldItalic(result);
    result = stripTrivialBackticks(result);
    result = compactBullets(result);
  }

  return result;
}
