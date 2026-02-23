/**
 * Dictionary-Based Compression
 *
 * Auto-learns high-frequency n-grams from text, builds a codebook
 * mapping long phrases to short `$XX` codes, and applies/reverses
 * substitutions for lossless compression.
 *
 * Ported from claw-compactor's dictionary.py. Savings: 4-5%.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Minimum occurrences for a phrase to be codebook-worthy. */
const DEFAULT_MIN_FREQ = 3;

/** Minimum raw length for a phrase to be worth replacing. */
const MIN_PHRASE_LEN = 6;

/** Maximum codebook entries. */
const DEFAULT_MAX_ENTRIES = 200;

/** Sentinel for escaping pre-existing '$' characters in source text. */
const DOLLAR_ESCAPE = '\x00DLR\x00';

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/**
 * Generate `n` unique short codes: $AA..$ZZ (676), then $AAA.. if needed.
 */
function generateCodes(n: number): string[] {
  const codes: string[] = [];
  const A = 65; // 'A' char code

  // 2-letter codes: $AA .. $ZZ (676)
  for (let i = 0; i < 26 && codes.length < n; i++) {
    for (let j = 0; j < 26 && codes.length < n; j++) {
      codes.push('$' + String.fromCharCode(A + i) + String.fromCharCode(A + j));
    }
  }

  // 3-letter codes if needed
  for (let i = 0; i < 26 && codes.length < n; i++) {
    for (let j = 0; j < 26 && codes.length < n; j++) {
      for (let k = 0; k < 26 && codes.length < n; k++) {
        codes.push(
          '$' +
            String.fromCharCode(A + i) +
            String.fromCharCode(A + j) +
            String.fromCharCode(A + k),
        );
      }
    }
  }

  return codes;
}

// ---------------------------------------------------------------------------
// N-gram extraction
// ---------------------------------------------------------------------------

/**
 * Extract word n-grams from text, filtering by minimum phrase length.
 */
function tokenizeNgrams(text: string, minN: number = 2, maxN: number = 5): Map<string, number> {
  const counter = new Map<string, number>();
  if (!text) return counter;

  const words = text.split(/\s+/);
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const gram = words.slice(i, i + n).join(' ');
      if (gram.length >= MIN_PHRASE_LEN) {
        counter.set(gram, (counter.get(gram) ?? 0) + 1);
      }
    }
  }

  return counter;
}

// ---------------------------------------------------------------------------
// Codebook
// ---------------------------------------------------------------------------

/** A codebook maps short codes ($XX) to the phrases they replace. */
export type Codebook = Record<string, string>;

export interface BuildCodebookOptions {
  /** Minimum frequency for a phrase to be included. Default: 3 */
  minFreq?: number;
  /** Maximum number of codebook entries. Default: 200 */
  maxEntries?: number;
}

/**
 * Build a codebook from a list of text documents.
 *
 * Scans for high-frequency n-grams and returns a mapping of short codes
 * to the phrases they replace, sorted by savings potential.
 */
export function buildCodebook(texts: string[], options: BuildCodebookOptions = {}): Codebook {
  const { minFreq = DEFAULT_MIN_FREQ, maxEntries = DEFAULT_MAX_ENTRIES } = options;
  if (!texts.length) return {};

  // Gather candidates from all texts
  const combined = new Map<string, number>();
  for (const text of texts) {
    const ngrams = tokenizeNgrams(text);
    for (const [gram, count] of ngrams) {
      combined.set(gram, (combined.get(gram) ?? 0) + count);
    }
  }

  // Filter by min frequency and sort by savings potential (freq * len)
  const candidates = [...combined.entries()]
    .filter(([phrase, count]) => count >= minFreq && phrase.length >= MIN_PHRASE_LEN)
    .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length);

  // Take top entries, avoiding overlapping phrases
  const codes = generateCodes(Math.min(candidates.length, maxEntries));
  const codebook: Codebook = {};
  const usedPhrases = new Set<string>();

  let ci = 0;
  for (const [phrase] of candidates) {
    if (ci >= codes.length) break;

    // Skip if this phrase is a substring of (or contains) an already-selected phrase
    let skip = false;
    for (const existing of usedPhrases) {
      if (phrase.includes(existing) || existing.includes(phrase)) {
        skip = true;
        break;
      }
    }
    if (skip) continue;

    codebook[codes[ci]] = phrase;
    usedPhrases.add(phrase);
    ci++;
  }

  return codebook;
}

/** Regex matching the code pattern produced by buildCodebook: $AA..$ZZ or $AAA..$ZZZ */
const CODE_PATTERN_RE = /^\$[A-Z]{2,3}$/;

/**
 * Normalize a codebook to {code: phrase} format.
 * Accepts either {code: phrase} or {phrase: code}.
 *
 * Detection: if ALL keys match the $XX / $XXX code pattern, treat input
 * as {code: phrase} and return as-is. Otherwise assume {phrase: code}
 * and reverse entries. This avoids misclassifying phrase keys that
 * happen to start with '$'.
 */
function normalizeCodebook(codebook: Codebook): Codebook {
  const keys = Object.keys(codebook);
  if (!keys.length) return {};

  // Check if every key matches the code pattern
  const allKeysAreCodes = keys.every((k) => CODE_PATTERN_RE.test(k));
  if (allKeysAreCodes) return codebook;

  // Reverse: {phrase: code} -> {code: phrase}
  const reversed: Codebook = {};
  for (const [phrase, code] of Object.entries(codebook)) {
    reversed[code] = phrase;
  }
  return reversed;
}

/**
 * Apply codebook substitutions to text. Lossless.
 *
 * Pre-existing '$' characters are escaped so they survive roundtrip.
 */
export function compressText(text: string, codebook: Codebook): string {
  if (!text || !Object.keys(codebook).length) return text;

  const normalized = normalizeCodebook(codebook);

  // Escape pre-existing '$' to avoid collisions with codes
  let result = text.replaceAll('$', DOLLAR_ESCAPE);

  // Sort by phrase length descending to avoid partial matches
  const sorted = Object.entries(normalized).sort((a, b) => b[1].length - a[1].length);

  for (const [code, phrase] of sorted) {
    const escapedPhrase = phrase.replaceAll('$', DOLLAR_ESCAPE);
    result = result.replaceAll(escapedPhrase, code);
  }

  return result;
}

/**
 * Reverse codebook substitutions. Lossless.
 */
export function decompressText(text: string, codebook: Codebook): string {
  if (!text || !Object.keys(codebook).length) return text;

  const normalized = normalizeCodebook(codebook);
  let result = text;

  // Sort by code length descending to handle $AAA before $AA
  const sorted = Object.entries(normalized).sort((a, b) => b[0].length - a[0].length);

  for (const [code, phrase] of sorted) {
    result = result.replaceAll(code, phrase);
  }

  // Unescape literal '$' characters
  result = result.replaceAll(DOLLAR_ESCAPE, '$');
  return result;
}

/**
 * Calculate compression statistics.
 */
export function compressionStats(
  original: string,
  codebook: Codebook,
): {
  originalChars: number;
  compressedChars: number;
  grossReductionPct: number;
  netReductionPct: number;
  codebookEntries: number;
  codesUsed: number;
} {
  const compressed = compressText(original, codebook);
  const normalized = normalizeCodebook(codebook);

  const origLen = original.length;
  const compLen = compressed.length;
  const grossReduction = origLen > 0 ? ((origLen - compLen) / origLen) * 100 : 0;

  // Count how many codes are actually used
  const codesUsed = Object.keys(normalized).filter((code) => compressed.includes(code)).length;

  // Net reduction accounts for codebook overhead
  const codebookOverhead = Object.entries(normalized).reduce(
    (acc, [k, v]) => acc + k.length + v.length + 2,
    0,
  );
  const netSaved = origLen - compLen - codebookOverhead;
  const netReduction = origLen > 0 ? (netSaved / origLen) * 100 : 0;

  return {
    originalChars: origLen,
    compressedChars: compLen,
    grossReductionPct: Math.round(grossReduction * 100) / 100,
    netReductionPct: Math.round(netReduction * 100) / 100,
    codebookEntries: Object.keys(normalized).length,
    codesUsed,
  };
}
