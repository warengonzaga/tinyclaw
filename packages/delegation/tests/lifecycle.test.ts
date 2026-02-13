/**
 * Tests for the Lifecycle Manager — sub-agent CRUD, reuse, performance,
 * suspension/revival, and cleanup.
 */

import { describe, expect, test } from 'bun:test';
import { createDatabase } from '@tinyclaw/core';
import { createLifecycleManager } from '../src/index.js';
import type { OrientationContext } from '../src/index.js';

function createTestDb() {
  return createDatabase(':memory:');
}

const ORIENTATION: OrientationContext = {
  identity: 'I am TinyClaw, a helpful AI companion.',
  preferences: 'User prefers concise responses.',
  memories: '- timezone: UTC+08:00',
};

describe('Lifecycle Manager', () => {
  test('create returns a sub-agent record', () => {
    const db = createTestDb();
    const lm = createLifecycleManager(db);

    const agent = lm.create({
      userId: 'user-1',
      role: 'Research Analyst',
      toolsGranted: ['heartware_read'],
      orientation: ORIENTATION,
    });

    expect(agent.id).toBeTruthy();
    expect(agent.role).toBe('Research Analyst');
    expect(agent.status).toBe('active');
    expect(agent.performanceScore).toBe(0.5);
    expect(agent.systemPrompt).toContain('ORIENTATION');
    expect(agent.systemPrompt).toContain('Research Analyst');

    db.close();
  });

  test('get retrieves a created sub-agent', () => {
    const db = createTestDb();
    const lm = createLifecycleManager(db);

    const agent = lm.create({
      userId: 'user-1',
      role: 'Writer',
      toolsGranted: [],
      orientation: ORIENTATION,
    });

    const fetched = lm.get(agent.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(agent.id);
    expect(fetched!.role).toBe('Writer');

    db.close();
  });

  test('listActive returns only active agents', () => {
    const db = createTestDb();
    const lm = createLifecycleManager(db);

    lm.create({ userId: 'u1', role: 'Agent A', toolsGranted: [], orientation: ORIENTATION });
    lm.create({ userId: 'u1', role: 'Agent B', toolsGranted: [], orientation: ORIENTATION });
    const agentC = lm.create({ userId: 'u1', role: 'Agent C', toolsGranted: [], orientation: ORIENTATION });

    lm.suspend(agentC.id);

    const active = lm.listActive('u1');
    expect(active.length).toBe(2);

    db.close();
  });

  test('findReusable matches similar roles', () => {
    const db = createTestDb();
    const lm = createLifecycleManager(db);

    lm.create({ userId: 'u1', role: 'Technical Research Analyst', toolsGranted: [], orientation: ORIENTATION });
    lm.create({ userId: 'u1', role: 'Creative Writer', toolsGranted: [], orientation: ORIENTATION });

    // Should match the research analyst
    const match = lm.findReusable('u1', 'Research Analyst');
    expect(match).not.toBeNull();
    expect(match!.role).toBe('Technical Research Analyst');

    // No match for unrelated role
    const noMatch = lm.findReusable('u1', 'Database Administrator Expert');
    expect(noMatch).toBeNull();

    db.close();
  });

  test('recordTaskResult updates performance', () => {
    const db = createTestDb();
    const lm = createLifecycleManager(db);

    const agent = lm.create({ userId: 'u1', role: 'Test', toolsGranted: [], orientation: ORIENTATION });

    lm.recordTaskResult(agent.id, true);
    lm.recordTaskResult(agent.id, true);
    lm.recordTaskResult(agent.id, false);

    const updated = lm.get(agent.id);
    expect(updated!.totalTasks).toBe(3);
    expect(updated!.successfulTasks).toBe(2);
    expect(updated!.performanceScore).toBeCloseTo(2 / 3);

    db.close();
  });

  test('suspend and revive lifecycle', () => {
    const db = createTestDb();
    const lm = createLifecycleManager(db);

    const agent = lm.create({ userId: 'u1', role: 'Agent', toolsGranted: [], orientation: ORIENTATION });

    // Suspend
    lm.suspend(agent.id);
    const suspended = lm.get(agent.id);
    expect(suspended!.status).toBe('soft_deleted');
    expect(suspended!.deletedAt).not.toBeNull();

    // Revive
    const revived = lm.revive(agent.id);
    expect(revived).not.toBeNull();
    expect(revived!.status).toBe('active');
    expect(revived!.deletedAt).toBeNull();

    db.close();
  });

  test('revive returns null for non-deleted agent', () => {
    const db = createTestDb();
    const lm = createLifecycleManager(db);

    const agent = lm.create({ userId: 'u1', role: 'Agent', toolsGranted: [], orientation: ORIENTATION });
    const result = lm.revive(agent.id);
    expect(result).toBeNull();

    db.close();
  });

  test('kill permanently removes agent and messages', () => {
    const db = createTestDb();
    const lm = createLifecycleManager(db);

    const agent = lm.create({ userId: 'u1', role: 'Doomed', toolsGranted: [], orientation: ORIENTATION });

    // Save some messages
    lm.saveMessage(agent.id, 'user', 'Task 1');
    lm.saveMessage(agent.id, 'assistant', 'Done');

    lm.kill(agent.id);

    expect(lm.get(agent.id)).toBeNull();
    expect(lm.getMessages(agent.id).length).toBe(0);

    db.close();
  });

  test('message persistence (save + get)', () => {
    const db = createTestDb();
    const lm = createLifecycleManager(db);

    const agent = lm.create({ userId: 'u1', role: 'Messenger', toolsGranted: [], orientation: ORIENTATION });

    lm.saveMessage(agent.id, 'user', 'Hello sub-agent');
    lm.saveMessage(agent.id, 'assistant', 'Hello! How can I help?');

    const msgs = lm.getMessages(agent.id);
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');

    db.close();
  });

  test('enforces max active sub-agents per user', () => {
    const db = createTestDb();
    const lm = createLifecycleManager(db);

    // Create 10 agents (the limit)
    for (let i = 0; i < 10; i++) {
      lm.create({ userId: 'u1', role: `Agent ${i}`, toolsGranted: [], orientation: ORIENTATION });
    }

    // 11th should throw
    expect(() => {
      lm.create({ userId: 'u1', role: 'One Too Many', toolsGranted: [], orientation: ORIENTATION });
    }).toThrow('Maximum active sub-agents');

    db.close();
  });

  test('cleanup removes expired soft-deleted agents', () => {
    const db = createTestDb();
    const lm = createLifecycleManager(db);

    const agent = lm.create({ userId: 'u1', role: 'Old Agent', toolsGranted: [], orientation: ORIENTATION });

    // Manually set deletedAt far in the past via db
    db.updateSubAgent(agent.id, { status: 'soft_deleted', deletedAt: Date.now() - 15 * 24 * 60 * 60 * 1000 });

    const cleaned = lm.cleanup(); // 14-day default retention
    expect(cleaned).toBe(1);
    expect(lm.get(agent.id)).toBeNull();

    db.close();
  });
});
