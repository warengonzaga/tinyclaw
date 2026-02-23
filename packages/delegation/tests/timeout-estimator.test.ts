import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createDatabase } from '@tinyclaw/core';
import type { Database } from '@tinyclaw/types';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTimeoutEstimator, type TimeoutEstimator } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): { db: Database; path: string } {
  const path = join(
    tmpdir(),
    `tinyclaw-test-timeout-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const db = createDatabase(path);
  return { db, path };
}

function cleanupDb(db: Database, path: string): void {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimeoutEstimator', () => {
  let db: Database;
  let dbPath: string;
  let estimator: TimeoutEstimator;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    dbPath = result.path;
    estimator = createTimeoutEstimator(db);
  });

  afterEach(() => {
    cleanupDb(db, dbPath);
  });

  // -----------------------------------------------------------------------
  // Task type classification
  // -----------------------------------------------------------------------

  describe('classifyTask', () => {
    it('classifies research tasks', () => {
      expect(estimator.classifyTask('Research the latest ML frameworks')).toBe('research');
      expect(estimator.classifyTask('Investigate the performance issue')).toBe('research');
      expect(estimator.classifyTask('Study the competitive landscape')).toBe('research');
    });

    it('classifies code tasks', () => {
      expect(estimator.classifyTask('Implement the login feature')).toBe('code');
      expect(estimator.classifyTask('Fix the authentication bug')).toBe('code');
      expect(estimator.classifyTask('Build a REST API endpoint')).toBe('code');
    });

    it('classifies analysis tasks', () => {
      expect(estimator.classifyTask('Analyze the sales data and generate a report')).toBe(
        'analysis',
      );
      expect(estimator.classifyTask('Evaluate the benchmark results')).toBe('analysis');
    });

    it('classifies writing tasks', () => {
      expect(estimator.classifyTask('Write documentation for the API')).toBe('writing');
      expect(estimator.classifyTask('Draft a blog post about TypeScript')).toBe('writing');
      expect(estimator.classifyTask('Compose an email to the team')).toBe('writing');
    });

    it('classifies simple lookup tasks', () => {
      expect(estimator.classifyTask('What is the capital of France?')).toBe('simple_lookup');
      expect(estimator.classifyTask('Define machine learning')).toBe('simple_lookup');
      expect(estimator.classifyTask('List all available tools')).toBe('simple_lookup');
    });

    it('defaults to simple_lookup for ambiguous descriptions', () => {
      expect(estimator.classifyTask('hello world')).toBe('simple_lookup');
    });
  });

  // -----------------------------------------------------------------------
  // Estimation with no history (tier defaults)
  // -----------------------------------------------------------------------

  describe('estimate with no history', () => {
    it('returns tier default for simple tier', () => {
      const result = estimator.estimate('What is TypeScript?', 'simple');

      expect(result.basedOn).toBe('tier_default');
      expect(result.timeoutMs).toBe(30_000);
      expect(result.confidence).toBe(0);
    });

    it('returns tier default for moderate tier', () => {
      const result = estimator.estimate('Research TypeScript', 'moderate');

      expect(result.basedOn).toBe('tier_default');
      expect(result.timeoutMs).toBe(60_000);
    });

    it('returns tier default for complex tier', () => {
      const result = estimator.estimate('Build an ML pipeline', 'complex');

      expect(result.basedOn).toBe('tier_default');
      expect(result.timeoutMs).toBe(120_000);
    });

    it('returns tier default for reasoning tier', () => {
      const result = estimator.estimate('Analyze complex data', 'reasoning');

      expect(result.basedOn).toBe('tier_default');
      expect(result.timeoutMs).toBe(180_000);
    });

    it('returns inferred tier default for unknown tier based on task classification', () => {
      const result = estimator.estimate('Some task', 'unknown-tier');

      // 'Some task' classifies as 'simple_lookup' → tier 'simple' → 30s
      expect(result.basedOn).toBe('tier_default');
      expect(result.timeoutMs).toBe(30_000);
    });

    it('returns inferred complex tier for research task with unknown tier', () => {
      const result = estimator.estimate('Research comprehensive information about fungi', 'auto');

      // 'research' task type → tier 'complex' → 120s
      expect(result.basedOn).toBe('tier_default');
      expect(result.timeoutMs).toBe(120_000);
    });
  });

  // -----------------------------------------------------------------------
  // Estimation with history (P85-based)
  // -----------------------------------------------------------------------

  describe('estimate with historical data', () => {
    it('returns P85-based estimate with 5+ data points', () => {
      // Record 6 research tasks on simple tier with varying durations
      const durations = [10_000, 15_000, 20_000, 25_000, 30_000, 35_000];
      for (const duration of durations) {
        estimator.record('user1', 'research', 'simple', duration, 5, true);
      }

      const result = estimator.estimate('Research something', 'simple');

      expect(result.basedOn).toBe('historical');
      expect(result.confidence).toBeGreaterThan(0);
      // P85 of [10k, 15k, 20k, 25k, 30k, 35k] ≈ 30k-35k, * 1.5 = 45k-52.5k
      expect(result.timeoutMs).toBeGreaterThan(15_000);
      expect(result.timeoutMs).toBeLessThanOrEqual(300_000);
    });

    it('confidence increases with more data points', () => {
      for (let i = 0; i < 5; i++) {
        estimator.record('user1', 'code', 'moderate', 20_000, 5, true);
      }
      const result5 = estimator.estimate('Implement feature', 'moderate');

      for (let i = 0; i < 15; i++) {
        estimator.record('user1', 'code', 'moderate', 20_000, 5, true);
      }
      const result20 = estimator.estimate('Implement feature', 'moderate');

      expect(result20.confidence).toBeGreaterThan(result5.confidence);
      expect(result20.confidence).toBe(1.0); // 20/20 = 1.0
    });

    it('clamps to minimum timeout (15s)', () => {
      // All tasks were very fast
      for (let i = 0; i < 10; i++) {
        estimator.record('user1', 'simple_lookup', 'simple', 1_000, 2, true);
      }

      const result = estimator.estimate('What is this?', 'simple');
      expect(result.timeoutMs).toBeGreaterThanOrEqual(15_000);
    });

    it('clamps to maximum timeout (300s)', () => {
      // All tasks were extremely slow
      for (let i = 0; i < 10; i++) {
        estimator.record('user1', 'research', 'reasoning', 250_000, 15, true);
      }

      const result = estimator.estimate('Deep research task', 'reasoning');
      expect(result.timeoutMs).toBeLessThanOrEqual(300_000);
    });

    it('records persist and improve future estimates', () => {
      // First estimate — no history
      const before = estimator.estimate('Research topic', 'moderate');
      expect(before.basedOn).toBe('tier_default');

      // Record some data
      for (let i = 0; i < 7; i++) {
        estimator.record('user1', 'research', 'moderate', 40_000, 7, true);
      }

      // Second estimate — now has history
      const after = estimator.estimate('Research topic', 'moderate');
      expect(after.basedOn).toBe('historical');
      expect(after.confidence).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Extension decisions
  // -----------------------------------------------------------------------

  describe('shouldExtend', () => {
    it('grants iteration extension when iterations high but time available', () => {
      // Used 8/10 iterations (80% > 70%), only 40% time elapsed
      const decision = estimator.shouldExtend(8, 10, 24_000, 60_000, 0);

      expect(decision.extend).toBe(true);
      expect(decision.extraIterations).toBe(5);
      expect(decision.extraMs).toBe(0);
    });

    it('grants time extension when time almost up but few iterations used', () => {
      // Used 3/10 iterations (30% < 50%), 92% time elapsed (> 90%)
      const decision = estimator.shouldExtend(3, 10, 55_200, 60_000, 0);

      expect(decision.extend).toBe(true);
      expect(decision.extraMs).toBe(30_000);
      expect(decision.extraIterations).toBe(0);
    });

    it('denies extension when max extensions reached', () => {
      const decision = estimator.shouldExtend(8, 10, 24_000, 60_000, 2);

      expect(decision.extend).toBe(false);
      expect(decision.extraMs).toBe(0);
      expect(decision.extraIterations).toBe(0);
    });

    it('denies extension when neither condition is met', () => {
      // Used 3/10 iterations, 30% time elapsed — neither condition met
      const decision = estimator.shouldExtend(3, 10, 18_000, 60_000, 0);

      expect(decision.extend).toBe(false);
    });

    it('denies extension when both iterations and time are nearly exhausted', () => {
      // 9/10 iterations AND 95% time — too late for extension
      const decision = estimator.shouldExtend(9, 10, 57_000, 60_000, 0);

      // Iteration condition: 9 >= 7 AND 57000 < 48000? No (57000 >= 48000)
      // Time condition: 57000 >= 54000 AND 9 < 5? No (9 >= 5)
      expect(decision.extend).toBe(false);
    });

    it('grants extension when exactly at iteration threshold', () => {
      // Used 7/10 iterations (70%), 50% time elapsed (< 80%)
      const decision = estimator.shouldExtend(7, 10, 30_000, 60_000, 0);

      expect(decision.extend).toBe(true);
      expect(decision.extraIterations).toBe(5);
    });

    it('allows up to MAX_EXTENSIONS extensions', () => {
      // First extension
      const d1 = estimator.shouldExtend(8, 10, 24_000, 60_000, 0);
      expect(d1.extend).toBe(true);

      // Second extension
      const d2 = estimator.shouldExtend(13, 15, 30_000, 60_000, 1);
      expect(d2.extend).toBe(true);

      // Third extension — denied
      const d3 = estimator.shouldExtend(18, 20, 36_000, 60_000, 2);
      expect(d3.extend).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Record
  // -----------------------------------------------------------------------

  describe('record', () => {
    it('records a task metric', () => {
      estimator.record('user1', 'research', 'moderate', 25_000, 6, true);

      const metrics = db.getTaskMetrics('research', 'moderate');
      expect(metrics.length).toBe(1);
      expect(metrics[0].durationMs).toBe(25_000);
      expect(metrics[0].iterations).toBe(6);
      expect(metrics[0].success).toBe(true);
    });

    it('records multiple metrics', () => {
      estimator.record('user1', 'code', 'complex', 45_000, 8, true);
      estimator.record('user1', 'code', 'complex', 55_000, 10, false);
      estimator.record('user1', 'code', 'complex', 35_000, 7, true);

      const metrics = db.getTaskMetrics('code', 'complex');
      expect(metrics.length).toBe(3);
    });

    it('metrics are specific to task_type and tier', () => {
      estimator.record('user1', 'research', 'simple', 10_000, 3, true);
      estimator.record('user1', 'code', 'simple', 20_000, 5, true);
      estimator.record('user1', 'research', 'complex', 40_000, 8, true);

      expect(db.getTaskMetrics('research', 'simple').length).toBe(1);
      expect(db.getTaskMetrics('code', 'simple').length).toBe(1);
      expect(db.getTaskMetrics('research', 'complex').length).toBe(1);
      expect(db.getTaskMetrics('code', 'complex').length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty task description', () => {
      const taskType = estimator.classifyTask('');
      expect(taskType).toBe('simple_lookup');

      const result = estimator.estimate('', 'simple');
      expect(result.basedOn).toBe('tier_default');
    });

    it('handles zero iterations and time', () => {
      const decision = estimator.shouldExtend(0, 10, 0, 60_000, 0);
      expect(decision.extend).toBe(false);
    });

    it('estimate returns consistent results for same input', () => {
      const r1 = estimator.estimate('Research ML', 'moderate');
      const r2 = estimator.estimate('Research ML', 'moderate');

      expect(r1.timeoutMs).toBe(r2.timeoutMs);
      expect(r1.basedOn).toBe(r2.basedOn);
    });
  });
});
