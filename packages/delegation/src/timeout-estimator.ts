/**
 * Adaptive Timeout Estimator (v3)
 *
 * Replaces fixed 60s/120s timeouts with intelligent estimation based on
 * historical task execution data + live extension mechanism.
 *
 * Estimation logic:
 *   1. Classify task → task_type ('research', 'code', 'analysis', 'writing', 'simple_lookup')
 *   2. Query task_metrics for (task_type, tier) from last 30 days
 *   3. If >= 5 data points:
 *      - timeout = P85_duration * 1.5  (avoid outlier inflation)
 *      - confidence = min(1.0, data_points / 20)
 *   4. If < 5 data points, use tier defaults
 *   5. Clamp: min 15s, max 300s (5 min absolute cap)
 *
 * Extension mechanism:
 *   - After 70% of max iterations used but < 80% time elapsed → grant +5 iterations
 *   - After 90% time elapsed but < 50% iterations used → grant +30s (max 2 extensions)
 *
 * Why this beats static timeouts:
 *   - Learns from every execution
 *   - Auto-adjusts per task type AND provider tier
 *   - Gets more accurate over time (self-improving)
 *   - Falls back gracefully when no history exists
 */

import type { DelegationStore } from './store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeoutEstimate {
  /** Estimated timeout in milliseconds. */
  timeoutMs: number;
  /** Confidence in the estimate (0.0–1.0). Higher = more historical data. */
  confidence: number;
  /** Basis of the estimate. */
  basedOn: 'historical' | 'tier_default' | 'fallback';
  /** Estimated number of iterations needed. */
  estimatedIterations: number;
}

export interface ExtensionDecision {
  /** Whether to grant an extension. */
  extend: boolean;
  /** Extra time in milliseconds (0 if no extension). */
  extraMs: number;
  /** Extra iterations (0 if no extension). */
  extraIterations: number;
}

export interface TimeoutEstimator {
  /** Estimate timeout for a task based on historical data. */
  estimate(taskDescription: string, tier: string): TimeoutEstimate;

  /** Record a completed task for future estimation. */
  record(
    userId: string,
    taskType: string,
    tier: string,
    durationMs: number,
    iterations: number,
    success: boolean,
  ): void;

  /** Check if a running task should be granted an extension. */
  shouldExtend(
    currentIteration: number,
    maxIterations: number,
    elapsedMs: number,
    timeoutMs: number,
    extensionsGranted: number,
  ): ExtensionDecision;

  /** Classify a task description into a task type. */
  classifyTask(description: string): string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TIMEOUT_MS = 15_000;   // 15 seconds
const MAX_TIMEOUT_MS = 300_000;  // 5 minutes
const MIN_DATA_POINTS = 5;
const MAX_EXTENSIONS = 2;
const EXTENSION_TIME_MS = 30_000; // 30s per extension
const EXTENSION_ITERATIONS = 5;

/** Tier default timeouts (used when < 5 historical data points). */
const TIER_DEFAULTS: Record<string, { timeoutMs: number; iterations: number }> = {
  simple: { timeoutMs: 30_000, iterations: 5 },
  moderate: { timeoutMs: 60_000, iterations: 8 },
  complex: { timeoutMs: 120_000, iterations: 10 },
  reasoning: { timeoutMs: 180_000, iterations: 12 },
};

/** Fallback for unknown tiers. */
const FALLBACK_TIMEOUT = { timeoutMs: 60_000, iterations: 10 };

/**
 * Task type classification keywords.
 * Each task type has a list of keywords that, when found in the description,
 * indicate that task type.
 */
const TASK_TYPE_KEYWORDS: Record<string, string[]> = {
  research: ['research', 'investigate', 'study', 'explore', 'survey', 'compare', 'analyze', 'review', 'find'],
  code: ['code', 'implement', 'build', 'develop', 'program', 'create', 'fix', 'debug', 'refactor', 'write code'],
  analysis: ['analysis', 'evaluate', 'assess', 'examine', 'data', 'metric', 'statistic', 'benchmark', 'report'],
  writing: ['write', 'draft', 'compose', 'document', 'blog', 'article', 'email', 'summary', 'describe'],
  simple_lookup: ['what is', 'define', 'explain', 'list', 'get', 'fetch', 'look up', 'check', 'status'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute P85 (85th percentile) of an array of numbers.
 * Used instead of P95 to avoid outlier inflation.
 */
function percentile85(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(0.85 * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTimeoutEstimator(db: DelegationStore): TimeoutEstimator {
  return {
    estimate(taskDescription: string, tier: string): TimeoutEstimate {
      const taskType = this.classifyTask(taskDescription);

      // Query historical data
      const metrics = db.getTaskMetrics(taskType, tier, 30);

      if (metrics.length >= MIN_DATA_POINTS) {
        // Historical estimation
        const durations = metrics.map((m) => m.durationMs);
        const iterations = metrics.map((m) => m.iterations);

        const p85Duration = percentile85(durations);
        const p85Iterations = percentile85(iterations);

        const timeoutMs = Math.max(
          MIN_TIMEOUT_MS,
          Math.min(MAX_TIMEOUT_MS, Math.round(p85Duration * 1.5)),
        );

        const confidence = Math.min(1.0, metrics.length / 20);

        return {
          timeoutMs,
          confidence,
          basedOn: 'historical',
          estimatedIterations: Math.ceil(p85Iterations * 1.2),
        };
      }

      // Tier default
      const tierDefault = TIER_DEFAULTS[tier];
      if (tierDefault) {
        return {
          timeoutMs: tierDefault.timeoutMs,
          confidence: 0,
          basedOn: 'tier_default',
          estimatedIterations: tierDefault.iterations,
        };
      }

      // Absolute fallback
      return {
        timeoutMs: FALLBACK_TIMEOUT.timeoutMs,
        confidence: 0,
        basedOn: 'fallback',
        estimatedIterations: FALLBACK_TIMEOUT.iterations,
      };
    },

    record(
      userId: string,
      taskType: string,
      tier: string,
      durationMs: number,
      iterations: number,
      success: boolean,
    ): void {
      db.saveTaskMetric({
        id: crypto.randomUUID(),
        userId,
        taskType,
        tier,
        durationMs,
        iterations,
        success,
        createdAt: Date.now(),
      });
    },

    shouldExtend(
      currentIteration: number,
      maxIterations: number,
      elapsedMs: number,
      timeoutMs: number,
      extensionsGranted: number,
    ): ExtensionDecision {
      // No more extensions allowed
      if (extensionsGranted >= MAX_EXTENSIONS) {
        return { extend: false, extraMs: 0, extraIterations: 0 };
      }

      // Case 1: Used most iterations but still have time
      // Agent is making progress but running out of iterations
      if (
        currentIteration >= maxIterations * 0.7 &&
        elapsedMs < timeoutMs * 0.8
      ) {
        return {
          extend: true,
          extraMs: 0,
          extraIterations: EXTENSION_ITERATIONS,
        };
      }

      // Case 2: Running out of time but hasn't used many iterations
      // Agent is doing heavy computation per iteration
      if (
        elapsedMs >= timeoutMs * 0.9 &&
        currentIteration < maxIterations * 0.5
      ) {
        return {
          extend: true,
          extraMs: EXTENSION_TIME_MS,
          extraIterations: 0,
        };
      }

      return { extend: false, extraMs: 0, extraIterations: 0 };
    },

    classifyTask(description: string): string {
      const lower = description.toLowerCase();
      let bestType = 'simple_lookup';
      let bestScore = 0;

      for (const [taskType, keywords] of Object.entries(TASK_TYPE_KEYWORDS)) {
        let score = 0;
        for (const keyword of keywords) {
          if (lower.includes(keyword)) score++;
        }
        if (score > bestScore) {
          bestScore = score;
          bestType = taskType;
        }
      }

      return bestType;
    },
  };
}
