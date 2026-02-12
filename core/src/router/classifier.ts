/**
 * Query Classifier
 *
 * Lightweight rule-based scoring engine that classifies incoming messages
 * into complexity tiers. Used by the ProviderOrchestrator to route queries
 * to the appropriate provider.
 *
 * Inspired by ClawRouter's 14-dimension weighted scoring, simplified to
 * 8 dimensions for TinyClaw's lightweight architecture. Pure function,
 * zero dependencies, sub-millisecond execution.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryTier = 'simple' | 'moderate' | 'complex' | 'reasoning';

export interface ClassificationResult {
  /** Determined complexity tier */
  tier: QueryTier;
  /** Raw weighted score across all dimensions */
  score: number;
  /** 0-1 confidence based on distance from nearest tier boundary */
  confidence: number;
  /** Human-readable signals that contributed to the score */
  signals: string[];
}

// ---------------------------------------------------------------------------
// Tier boundaries
// ---------------------------------------------------------------------------

const TIER_BOUNDARIES = {
  simple: -0.05,   // score < -0.05
  moderate: 0.15,  // score -0.05 to 0.15
  complex: 0.35,   // score 0.15 to 0.35
  // reasoning: score >= 0.35
} as const;

// ---------------------------------------------------------------------------
// Keyword lists
// ---------------------------------------------------------------------------

const REASONING_KEYWORDS = [
  'prove', 'theorem', 'derive', 'step by step', 'chain of thought',
  'analyze', 'compare and contrast', 'evaluate', 'critique', 'why does',
  'explain why', 'what causes', 'reasoning', 'logic', 'deduce',
];

const CODE_KEYWORDS = [
  'function', 'class', 'import', 'export', 'async', 'await',
  'const ', 'let ', 'var ', '```', 'debug', 'refactor',
  'compile', 'runtime', 'typescript', 'javascript', 'python',
  'implement', 'bug', 'error', 'stack trace', 'exception',
];

const MULTI_STEP_KEYWORDS = [
  'first', 'then', 'next', 'finally', 'step 1', 'step 2',
  'and then', 'after that', 'followed by', 'in order to',
  '1.', '2.', '3.',
];

const TECHNICAL_KEYWORDS = [
  'algorithm', 'architecture', 'database', 'api', 'deploy',
  'kubernetes', 'docker', 'distributed', 'microservice', 'scalab',
  'infrastructure', 'pipeline', 'protocol', 'encryption', 'oauth',
  'websocket', 'middleware', 'schema', 'migration', 'optimization',
];

const SIMPLE_KEYWORDS = [
  'hello', 'hi', 'hey', 'thanks', 'thank you', 'bye', 'goodbye',
  'what is', 'define', 'translate', 'who is', 'when was',
  'how are you', 'good morning', 'good night', 'yes', 'no', 'ok',
];

const CONSTRAINT_KEYWORDS = [
  'must', 'at most', 'at least', 'exactly', 'within', 'budget',
  'constraint', 'requirement', 'maximum', 'minimum', 'limit',
  'no more than', 'o(n)', 'time complexity', 'space complexity',
];

const CREATIVE_KEYWORDS = [
  'story', 'poem', 'brainstorm', 'imagine', 'creative',
  'fiction', 'narrative', 'write a', 'compose', 'invent',
];

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

/** Count keyword matches in lowercased text. */
function countMatches(text: string, keywords: string[]): number {
  let count = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) count++;
  }
  return count;
}

/**
 * Map a match count to a score using low/high thresholds.
 * 0 matches = 0, below low = 0.3, between low-high = 0.6, at/above high = 1.0
 */
function thresholdScore(count: number, low: number, high: number): number {
  if (count === 0) return 0;
  if (count < low) return 0.3;
  if (count < high) return 0.6;
  return 1.0;
}

/** Estimate token count (~4 chars per token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Sigmoid confidence based on distance from nearest tier boundary. */
function computeConfidence(score: number): number {
  const boundaries = [TIER_BOUNDARIES.simple, TIER_BOUNDARIES.moderate, TIER_BOUNDARIES.complex];
  let minDistance = Infinity;

  for (const boundary of boundaries) {
    const distance = Math.abs(score - boundary);
    if (distance < minDistance) minDistance = distance;
  }

  // Sigmoid: 1 / (1 + exp(-k * distance)), k=12 for steep curve
  return 1 / (1 + Math.exp(-12 * minDistance));
}

/** Determine tier from raw score. */
function scoreToTier(score: number): QueryTier {
  if (score < TIER_BOUNDARIES.simple) return 'simple';
  if (score < TIER_BOUNDARIES.moderate) return 'moderate';
  if (score < TIER_BOUNDARIES.complex) return 'complex';
  return 'reasoning';
}

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

interface DimensionResult {
  score: number;
  signal?: string;
}

const DIMENSIONS: Array<{
  name: string;
  weight: number;
  score: (text: string, tokens: number) => DimensionResult;
}> = [
  {
    name: 'reasoning',
    weight: 0.20,
    score: (text) => {
      const count = countMatches(text, REASONING_KEYWORDS);
      const matched = REASONING_KEYWORDS.filter((k) => text.includes(k));
      return {
        score: thresholdScore(count, 1, 2),
        signal: count > 0 ? `reasoning (${matched.slice(0, 3).join(', ')})` : undefined,
      };
    },
  },
  {
    name: 'code',
    weight: 0.18,
    score: (text) => {
      const count = countMatches(text, CODE_KEYWORDS);
      const matched = CODE_KEYWORDS.filter((k) => text.includes(k));
      return {
        score: thresholdScore(count, 1, 2),
        signal: count > 0 ? `code (${matched.slice(0, 3).join(', ')})` : undefined,
      };
    },
  },
  {
    name: 'multiStep',
    weight: 0.15,
    score: (text) => {
      const count = countMatches(text, MULTI_STEP_KEYWORDS);
      return {
        score: count >= 2 ? 0.8 : count === 1 ? 0.4 : 0,
        signal: count > 0 ? `multi-step (${count} markers)` : undefined,
      };
    },
  },
  {
    name: 'technical',
    weight: 0.12,
    score: (text) => {
      const count = countMatches(text, TECHNICAL_KEYWORDS);
      const matched = TECHNICAL_KEYWORDS.filter((k) => text.includes(k));
      return {
        score: thresholdScore(count, 1, 3),
        signal: count > 0 ? `technical (${matched.slice(0, 3).join(', ')})` : undefined,
      };
    },
  },
  {
    name: 'promptLength',
    weight: 0.10,
    score: (_text, tokens) => {
      if (tokens < 30) return { score: -0.5, signal: 'short prompt' };
      if (tokens > 200) return { score: 0.8, signal: 'long prompt' };
      if (tokens > 100) return { score: 0.3 };
      return { score: 0 };
    },
  },
  {
    name: 'simple',
    weight: 0.10,
    score: (text) => {
      const count = countMatches(text, SIMPLE_KEYWORDS);
      // Negative score — pulls toward simple tier
      return {
        score: count > 0 ? -1.0 : 0,
        signal: count > 0 ? 'simple language' : undefined,
      };
    },
  },
  {
    name: 'constraints',
    weight: 0.08,
    score: (text) => {
      const count = countMatches(text, CONSTRAINT_KEYWORDS);
      const matched = CONSTRAINT_KEYWORDS.filter((k) => text.includes(k));
      return {
        score: thresholdScore(count, 1, 2),
        signal: count > 0 ? `constraints (${matched.slice(0, 2).join(', ')})` : undefined,
      };
    },
  },
  {
    name: 'creative',
    weight: 0.07,
    score: (text) => {
      const count = countMatches(text, CREATIVE_KEYWORDS);
      return {
        score: count > 0 ? 0.7 : 0,
        signal: count > 0 ? 'creative task' : undefined,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a query into a complexity tier using rule-based weighted scoring.
 *
 * Pure function with no side effects. Runs in sub-millisecond time.
 */
export function classifyQuery(message: string): ClassificationResult {
  const text = message.toLowerCase();
  const tokens = estimateTokens(message);

  let totalScore = 0;
  const signals: string[] = [];

  for (const dimension of DIMENSIONS) {
    const result = dimension.score(text, tokens);
    totalScore += result.score * dimension.weight;
    if (result.signal) signals.push(result.signal);
  }

  const tier = scoreToTier(totalScore);
  const confidence = computeConfidence(totalScore);

  return { tier, score: totalScore, confidence, signals };
}
