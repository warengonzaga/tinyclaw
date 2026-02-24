/**
 * Hybrid Semantic Matcher
 *
 * Three-dimensional text matching that handles synonyms, typos, and
 * partial matches — all without external embedding APIs.
 *
 * Dimensions:
 *   1. Keyword overlap (TF-IDF-like weighting, stop-word filtering)
 *   2. Fuzzy matching (Levenshtein distance for typo tolerance)
 *   3. Synonym expansion (built-in + user-extensible synonym groups)
 *
 * Designed as a drop-in replacement for the simple Jaccard keyword overlap
 * used in delegation lifecycle.findReusable() and templates.findBestMatch().
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MatchResult {
  /** Combined weighted score 0.0–1.0. */
  score: number;
  /** Keyword overlap sub-score. */
  keywordScore: number;
  /** Fuzzy / Levenshtein sub-score. */
  fuzzyScore: number;
  /** Synonym expansion sub-score. */
  synonymScore: number;
}

export interface HybridMatcher {
  /** Score how well two text strings match semantically. */
  score(query: string, target: string): MatchResult;
  /** Find best match from a list of candidates. Returns null if no candidate exceeds minScore. */
  findBest(
    query: string,
    candidates: { id: string; text: string }[],
  ): { id: string; result: MatchResult } | null;
  /** Register a custom synonym group (all words in the group are considered equivalent). */
  addSynonyms(group: string[]): void;
}

export interface HybridMatcherConfig {
  /** Minimum combined score to consider a match (default 0.3). */
  minScore?: number;
  /** Weights for each scoring dimension. Must sum to 1.0. */
  weights?: { keyword: number; fuzzy: number; synonym: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIN_SCORE = 0.3;
const DEFAULT_WEIGHTS = { keyword: 0.5, fuzzy: 0.2, synonym: 0.3 };

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'about',
  'like',
  'through',
  'after',
  'over',
  'between',
  'out',
  'up',
  'that',
  'this',
  'it',
  'and',
  'or',
  'but',
  'not',
  'no',
  'so',
  'if',
  'then',
  'than',
  'too',
  'very',
  'just',
  'also',
  'more',
  'some',
  'any',
  'each',
  'all',
]);

/**
 * Built-in synonym groups covering common agent task vocabulary.
 * Each array is a group of semantically equivalent words.
 */
const BUILT_IN_SYNONYMS: string[][] = [
  ['developer', 'engineer', 'coder', 'programmer'],
  ['research', 'analyze', 'investigate', 'study', 'examine'],
  ['write', 'compose', 'draft', 'author', 'create'],
  ['design', 'architect', 'blueprint', 'plan', 'layout'],
  ['test', 'verify', 'validate', 'check', 'assess'],
  ['fix', 'repair', 'patch', 'resolve', 'debug'],
  ['review', 'evaluate', 'critique', 'audit', 'inspect'],
  ['document', 'describe', 'explain', 'annotate', 'record'],
  ['optimize', 'improve', 'enhance', 'refine', 'tune'],
  ['deploy', 'release', 'ship', 'publish', 'launch'],
  ['database', 'datastore', 'storage', 'repository'],
  ['frontend', 'client', 'interface', 'presentation'],
  ['backend', 'server', 'service', 'api'],
  ['security', 'authentication', 'authorization', 'encryption'],
  ['performance', 'speed', 'latency', 'throughput'],
  ['monitor', 'observe', 'track', 'watch', 'log'],
  ['configure', 'setup', 'initialize', 'provision'],
  ['migrate', 'convert', 'transform', 'translate'],
  ['summarize', 'condense', 'digest', 'brief', 'overview'],
  ['compare', 'contrast', 'benchmark', 'differentiate'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tokenize text into lowercase words, filtering stop words and short tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/** Compute Levenshtein distance between two strings. */
function levenshteinDistance(s1: string, s2: string): number {
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  const m = s1.length;
  const n = s2.length;

  // Use single-row optimization for memory efficiency
  let prev = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    prev = curr;
  }

  return prev[n];
}

/**
 * Normalized fuzzy similarity between two tokens.
 * Returns 1.0 for exact match, approaches 0.0 for very different strings.
 */
function tokenFuzzySimilarity(a: string, b: string): number {
  if (a === b) return 1.0;

  // Substring match bonus
  if (a.length >= 4 && b.length >= 4) {
    if (a.includes(b) || b.includes(a)) return 0.8;
  }

  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1.0 : 1 - distance / maxLen;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHybridMatcher(config?: HybridMatcherConfig): HybridMatcher {
  const minScore = config?.minScore ?? DEFAULT_MIN_SCORE;
  const weights = config?.weights ?? DEFAULT_WEIGHTS;

  // Synonym index: word → group index, for fast lookup
  const synonymGroups: string[][] = [...BUILT_IN_SYNONYMS];
  const wordToGroup = new Map<string, number>();

  // Build initial synonym index
  function rebuildSynonymIndex(): void {
    wordToGroup.clear();
    for (let i = 0; i < synonymGroups.length; i++) {
      for (const word of synonymGroups[i]) {
        wordToGroup.set(word.toLowerCase(), i);
      }
    }
  }

  rebuildSynonymIndex();

  // --- Scoring functions ---

  /** Dimension 1: Keyword overlap with basic TF weighting. */
  function computeKeywordScore(queryTokens: string[], targetTokens: string[]): number {
    if (queryTokens.length === 0 || targetTokens.length === 0) return 0;

    const targetSet = new Set(targetTokens);
    let matches = 0;

    for (const token of queryTokens) {
      if (targetSet.has(token)) {
        matches++;
      }
    }

    // Normalized by the smaller set (same as existing Jaccard-like approach)
    return matches / Math.min(queryTokens.length, targetTokens.length);
  }

  /** Dimension 2: Best fuzzy match for each query token against target tokens. */
  function computeFuzzyScore(queryTokens: string[], targetTokens: string[]): number {
    if (queryTokens.length === 0 || targetTokens.length === 0) return 0;

    let totalSim = 0;

    for (const qToken of queryTokens) {
      let bestSim = 0;
      for (const tToken of targetTokens) {
        const sim = tokenFuzzySimilarity(qToken, tToken);
        if (sim > bestSim) bestSim = sim;
      }
      // Only count if similarity is meaningful (> 0.5 to avoid noise)
      if (bestSim > 0.5) {
        totalSim += bestSim;
      }
    }

    return totalSim / queryTokens.length;
  }

  /** Dimension 3: Synonym expansion — check if query tokens have synonyms in target. */
  function computeSynonymScore(queryTokens: string[], targetTokens: string[]): number {
    if (queryTokens.length === 0 || targetTokens.length === 0) return 0;

    const targetSet = new Set(targetTokens);
    let synonymMatches = 0;

    for (const qToken of queryTokens) {
      // Skip if already an exact match (handled by keyword score)
      if (targetSet.has(qToken)) continue;

      const groupIdx = wordToGroup.get(qToken);
      if (groupIdx === undefined) continue;

      // Check if any synonym from the same group exists in target
      const group = synonymGroups[groupIdx];
      for (const synonym of group) {
        if (synonym !== qToken && targetSet.has(synonym)) {
          synonymMatches++;
          break; // One synonym match per query token
        }
      }
    }

    return synonymMatches / queryTokens.length;
  }

  return {
    score(query: string, target: string): MatchResult {
      const queryTokens = tokenize(query);
      const targetTokens = tokenize(target);

      if (queryTokens.length === 0 || targetTokens.length === 0) {
        return { score: 0, keywordScore: 0, fuzzyScore: 0, synonymScore: 0 };
      }

      const keywordScore = computeKeywordScore(queryTokens, targetTokens);
      const fuzzyScore = computeFuzzyScore(queryTokens, targetTokens);
      const synonymScore = computeSynonymScore(queryTokens, targetTokens);

      const combined =
        keywordScore * weights.keyword +
        fuzzyScore * weights.fuzzy +
        synonymScore * weights.synonym;

      // Clamp to [0, 1]
      const score = Math.min(1, Math.max(0, combined));

      return { score, keywordScore, fuzzyScore, synonymScore };
    },

    findBest(
      query: string,
      candidates: { id: string; text: string }[],
    ): { id: string; result: MatchResult } | null {
      if (candidates.length === 0) return null;

      let bestId: string | null = null;
      let bestResult: MatchResult | null = null;
      let bestScore = 0;

      for (const candidate of candidates) {
        const result = this.score(query, candidate.text);
        if (result.score > bestScore && result.score >= minScore) {
          bestScore = result.score;
          bestId = candidate.id;
          bestResult = result;
        }
      }

      if (bestId && bestResult) {
        return { id: bestId, result: bestResult };
      }

      return null;
    },

    addSynonyms(group: string[]): void {
      if (group.length < 2) return;
      const normalized = group.map((w) => w.toLowerCase().trim()).filter(Boolean);
      if (normalized.length < 2) return;
      synonymGroups.push(normalized);
      rebuildSynonymIndex();
    },
  };
}
