import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createDatabase } from '@tinyclaw/core';
import type { Database } from '@tinyclaw/types';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createCompactor } from '../src/compactor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): { db: Database; path: string } {
  const path = join(
    tmpdir(),
    `tinyclaw-test-compactor-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

function createMockProvider(summaryResponse: string = 'Summary of conversation.') {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    async chat() {
      return { content: summaryResponse, role: 'assistant' as const };
    },
    async isAvailable() {
      return true;
    },
    async chatStream() {
      return { content: summaryResponse, role: 'assistant' as const };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCompactor', () => {
  let db: Database;
  let dbPath: string;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    dbPath = result.path;
  });

  afterEach(() => {
    cleanupDb(db, dbPath);
  });

  it('creates a compactor engine', () => {
    const compactor = createCompactor(db);
    expect(compactor).toBeDefined();
    expect(compactor.compactIfNeeded).toBeInstanceOf(Function);
    expect(compactor.getLatestSummary).toBeInstanceOf(Function);
    expect(compactor.estimateTokens).toBeInstanceOf(Function);
  });

  it('does not compact when below threshold', async () => {
    const compactor = createCompactor(db, { threshold: 60 });
    const provider = createMockProvider();

    // Add only 10 messages
    for (let i = 0; i < 10; i++) {
      db.saveMessage('user1', 'user', `Message ${i}`);
    }

    const result = await compactor.compactIfNeeded('user1', provider);
    expect(result).toBeNull();
  });

  it('compacts when at threshold', async () => {
    const compactor = createCompactor(db, { threshold: 10, keepRecent: 3 });
    const provider = createMockProvider('User discussed 10 topics. Decision: use TypeScript.');

    // Add 10 messages
    for (let i = 0; i < 10; i++) {
      db.saveMessage('user1', i % 2 === 0 ? 'user' : 'assistant', `Message ${i}`);
    }

    const result = await compactor.compactIfNeeded('user1', provider);
    expect(result).not.toBeNull();
    expect(result!.summary.l2).toContain('TypeScript');
    expect(result!.metrics.messagesBefore).toBe(10);
    expect(result!.metrics.messagesKept).toBe(3);
  });

  it('saves compaction and allows retrieval', async () => {
    const compactor = createCompactor(db, { threshold: 5, keepRecent: 2 });
    const provider = createMockProvider('Important facts about the user.');

    for (let i = 0; i < 5; i++) {
      db.saveMessage('user1', 'user', `Message ${i}`);
    }

    await compactor.compactIfNeeded('user1', provider);

    const summary = compactor.getLatestSummary('user1');
    expect(summary).toContain('Important facts');
  });

  it('returns null summary when no compaction exists', () => {
    const compactor = createCompactor(db);
    expect(compactor.getLatestSummary('nonexistent')).toBeNull();
  });

  it('estimates tokens correctly', () => {
    const compactor = createCompactor(db);
    const tokens = compactor.estimateTokens('Hello world');
    expect(tokens).toBeGreaterThan(0);
  });

  it('respects custom configuration', async () => {
    const compactor = createCompactor(db, {
      threshold: 3,
      keepRecent: 1,
    });
    const provider = createMockProvider('Short summary.');

    for (let i = 0; i < 3; i++) {
      db.saveMessage('user1', 'user', `Message ${i}`);
    }

    const result = await compactor.compactIfNeeded('user1', provider);
    expect(result).not.toBeNull();
    expect(result!.metrics.messagesKept).toBe(1);
  });

  it('returns metrics with compression ratio', async () => {
    const compactor = createCompactor(db, { threshold: 5, keepRecent: 1 });
    const provider = createMockProvider('Brief summary.');

    for (let i = 0; i < 5; i++) {
      db.saveMessage('user1', 'user', `Message with some content about topic ${i}`);
    }

    const result = await compactor.compactIfNeeded('user1', provider);
    expect(result).not.toBeNull();
    expect(result!.metrics.compressionRatio).toBeGreaterThan(0);
    expect(result!.metrics.compressionRatio).toBeLessThanOrEqual(1);
    expect(result!.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handles provider failure gracefully', async () => {
    const compactor = createCompactor(db, { threshold: 5, keepRecent: 1 });
    const failingProvider = {
      id: 'fail',
      name: 'Failing Provider',
      async chat() {
        throw new Error('LLM unavailable');
      },
      async isAvailable() {
        return false;
      },
      async chatStream() {
        throw new Error('LLM unavailable');
      },
    };

    for (let i = 0; i < 5; i++) {
      db.saveMessage('user1', 'user', `Message ${i}`);
    }

    const result = await compactor.compactIfNeeded('user1', failingProvider);
    expect(result).toBeNull(); // Should not crash
  });
});
