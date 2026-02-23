/**
 * Tests for delegation database tables: sub_agents, role_templates, background_tasks.
 */

import { describe, expect, test } from 'bun:test';
import { createDatabase } from '@tinyclaw/core';

function createTestDb() {
  return createDatabase(':memory:');
}

// ---------------------------------------------------------------------------
// sub_agents
// ---------------------------------------------------------------------------

describe('sub_agents table', () => {
  test('saveSubAgent and getSubAgent', () => {
    const db = createTestDb();
    const now = Date.now();

    db.saveSubAgent({
      id: 'sa-1',
      userId: 'user-1',
      role: 'Research Analyst',
      systemPrompt: 'You are a research analyst.',
      toolsGranted: ['heartware_read', 'memory_recall'],
      tierPreference: 'complex',
      status: 'active',
      performanceScore: 0.5,
      totalTasks: 0,
      successfulTasks: 0,
      templateId: null,
      createdAt: now,
      lastActiveAt: now,
      deletedAt: null,
    });

    const record = db.getSubAgent('sa-1');
    expect(record).not.toBeNull();
    expect(record!.id).toBe('sa-1');
    expect(record!.userId).toBe('user-1');
    expect(record!.role).toBe('Research Analyst');
    expect(record!.toolsGranted).toEqual(['heartware_read', 'memory_recall']);
    expect(record!.tierPreference).toBe('complex');
    expect(record!.status).toBe('active');
    expect(record!.performanceScore).toBe(0.5);
    expect(record!.templateId).toBeNull();

    db.close();
  });

  test('getSubAgent returns null for non-existent', () => {
    const db = createTestDb();
    expect(db.getSubAgent('non-existent')).toBeNull();
    db.close();
  });

  test('getActiveSubAgents filters by user and status', () => {
    const db = createTestDb();
    const now = Date.now();

    const base = {
      systemPrompt: 'test',
      toolsGranted: [],
      tierPreference: null,
      performanceScore: 0.5,
      totalTasks: 0,
      successfulTasks: 0,
      templateId: null,
      createdAt: now,
      lastActiveAt: now,
      deletedAt: null,
    };

    db.saveSubAgent({ ...base, id: 'sa-1', userId: 'user-1', role: 'Agent A', status: 'active' });
    db.saveSubAgent({
      ...base,
      id: 'sa-2',
      userId: 'user-1',
      role: 'Agent B',
      status: 'soft_deleted',
    });
    db.saveSubAgent({ ...base, id: 'sa-3', userId: 'user-2', role: 'Agent C', status: 'active' });
    db.saveSubAgent({
      ...base,
      id: 'sa-4',
      userId: 'user-1',
      role: 'Agent D',
      status: 'suspended',
    });

    const active = db.getActiveSubAgents('user-1');
    expect(active.length).toBe(2); // active + suspended (not soft_deleted)
    expect(active.some((a) => a.id === 'sa-1')).toBe(true);
    expect(active.some((a) => a.id === 'sa-4')).toBe(true);

    db.close();
  });

  test('getAllSubAgents with and without deleted', () => {
    const db = createTestDb();
    const now = Date.now();

    const base = {
      systemPrompt: 'test',
      toolsGranted: [],
      tierPreference: null,
      performanceScore: 0.5,
      totalTasks: 0,
      successfulTasks: 0,
      templateId: null,
      createdAt: now,
      lastActiveAt: now,
      deletedAt: null,
    };

    db.saveSubAgent({ ...base, id: 'sa-1', userId: 'user-1', role: 'A', status: 'active' });
    db.saveSubAgent({
      ...base,
      id: 'sa-2',
      userId: 'user-1',
      role: 'B',
      status: 'soft_deleted',
      deletedAt: now,
    });

    const withoutDeleted = db.getAllSubAgents('user-1', false);
    expect(withoutDeleted.length).toBe(1);

    const withDeleted = db.getAllSubAgents('user-1', true);
    expect(withDeleted.length).toBe(2);

    db.close();
  });

  test('updateSubAgent modifies fields', () => {
    const db = createTestDb();
    const now = Date.now();

    db.saveSubAgent({
      id: 'sa-1',
      userId: 'user-1',
      role: 'Test',
      systemPrompt: 'test',
      toolsGranted: [],
      tierPreference: null,
      status: 'active',
      performanceScore: 0.5,
      totalTasks: 0,
      successfulTasks: 0,
      templateId: null,
      createdAt: now,
      lastActiveAt: now,
      deletedAt: null,
    });

    db.updateSubAgent('sa-1', {
      status: 'soft_deleted',
      deletedAt: now + 1000,
      performanceScore: 0.8,
      totalTasks: 5,
      successfulTasks: 4,
    });

    const updated = db.getSubAgent('sa-1');
    expect(updated!.status).toBe('soft_deleted');
    expect(updated!.performanceScore).toBe(0.8);
    expect(updated!.totalTasks).toBe(5);
    expect(updated!.successfulTasks).toBe(4);

    db.close();
  });

  test('deleteExpiredSubAgents removes old soft-deleted agents', () => {
    const db = createTestDb();
    const now = Date.now();

    const base = {
      systemPrompt: 'test',
      toolsGranted: [],
      tierPreference: null,
      performanceScore: 0.5,
      totalTasks: 0,
      successfulTasks: 0,
      templateId: null,
      createdAt: now,
      lastActiveAt: now,
    };

    db.saveSubAgent({
      ...base,
      id: 'sa-old',
      userId: 'u1',
      role: 'Old',
      status: 'soft_deleted',
      deletedAt: now - 100_000,
    });
    db.saveSubAgent({
      ...base,
      id: 'sa-new',
      userId: 'u1',
      role: 'New',
      status: 'soft_deleted',
      deletedAt: now,
    });
    db.saveSubAgent({
      ...base,
      id: 'sa-active',
      userId: 'u1',
      role: 'Active',
      status: 'active',
      deletedAt: null,
    });

    const deleted = db.deleteExpiredSubAgents(now - 50_000);
    expect(deleted).toBe(1);
    expect(db.getSubAgent('sa-old')).toBeNull();
    expect(db.getSubAgent('sa-new')).not.toBeNull();
    expect(db.getSubAgent('sa-active')).not.toBeNull();

    db.close();
  });
});

// ---------------------------------------------------------------------------
// role_templates
// ---------------------------------------------------------------------------

describe('role_templates table', () => {
  test('saveRoleTemplate and getRoleTemplate', () => {
    const db = createTestDb();
    const now = Date.now();

    db.saveRoleTemplate({
      id: 'rt-1',
      userId: 'user-1',
      name: 'Research Analyst',
      roleDescription: 'Analyzes research papers and data',
      defaultTools: ['heartware_read'],
      defaultTier: 'complex',
      timesUsed: 0,
      avgPerformance: 0.5,
      tags: ['research', 'analysis'],
      createdAt: now,
      updatedAt: now,
    });

    const template = db.getRoleTemplate('rt-1');
    expect(template).not.toBeNull();
    expect(template!.name).toBe('Research Analyst');
    expect(template!.defaultTools).toEqual(['heartware_read']);
    expect(template!.tags).toEqual(['research', 'analysis']);

    db.close();
  });

  test('getRoleTemplates returns all for user', () => {
    const db = createTestDb();
    const now = Date.now();

    const base = {
      userId: 'user-1',
      roleDescription: 'test',
      defaultTools: [],
      defaultTier: null,
      timesUsed: 0,
      avgPerformance: 0.5,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };

    db.saveRoleTemplate({ ...base, id: 'rt-1', name: 'Template A' });
    db.saveRoleTemplate({ ...base, id: 'rt-2', name: 'Template B' });
    db.saveRoleTemplate({ ...base, id: 'rt-3', name: 'Other User', userId: 'user-2' });

    const templates = db.getRoleTemplates('user-1');
    expect(templates.length).toBe(2);

    db.close();
  });

  test('updateRoleTemplate modifies fields', () => {
    const db = createTestDb();
    const now = Date.now();

    db.saveRoleTemplate({
      id: 'rt-1',
      userId: 'user-1',
      name: 'Writer',
      roleDescription: 'Writes content',
      defaultTools: [],
      defaultTier: null,
      timesUsed: 0,
      avgPerformance: 0.5,
      tags: ['writing'],
      createdAt: now,
      updatedAt: now,
    });

    db.updateRoleTemplate('rt-1', {
      name: 'Technical Writer',
      roleDescription: 'Writes technical docs',
      tags: ['writing', 'technical'],
      timesUsed: 3,
      avgPerformance: 0.85,
      updatedAt: now + 1000,
    });

    const updated = db.getRoleTemplate('rt-1');
    expect(updated!.name).toBe('Technical Writer');
    expect(updated!.tags).toEqual(['writing', 'technical']);
    expect(updated!.timesUsed).toBe(3);
    expect(updated!.avgPerformance).toBe(0.85);

    db.close();
  });

  test('deleteRoleTemplate removes template', () => {
    const db = createTestDb();
    const now = Date.now();

    db.saveRoleTemplate({
      id: 'rt-1',
      userId: 'user-1',
      name: 'Test',
      roleDescription: 'test',
      defaultTools: [],
      defaultTier: null,
      timesUsed: 0,
      avgPerformance: 0.5,
      tags: [],
      createdAt: now,
      updatedAt: now,
    });

    db.deleteRoleTemplate('rt-1');
    expect(db.getRoleTemplate('rt-1')).toBeNull();

    db.close();
  });
});

// ---------------------------------------------------------------------------
// background_tasks
// ---------------------------------------------------------------------------

describe('background_tasks table', () => {
  test('saveBackgroundTask and getBackgroundTask', () => {
    const db = createTestDb();
    const now = Date.now();

    db.saveBackgroundTask({
      id: 'bt-1',
      userId: 'user-1',
      agentId: 'sa-1',
      taskDescription: 'Research AI frameworks',
      status: 'running',
      result: null,
      startedAt: now,
      completedAt: null,
      deliveredAt: null,
    });

    const task = db.getBackgroundTask('bt-1');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('bt-1');
    expect(task!.status).toBe('running');
    expect(task!.result).toBeNull();

    db.close();
  });

  test('updateBackgroundTask sets status and result', () => {
    const db = createTestDb();
    const now = Date.now();

    db.saveBackgroundTask({
      id: 'bt-1',
      userId: 'user-1',
      agentId: 'sa-1',
      taskDescription: 'Test task',
      status: 'running',
      result: null,
      startedAt: now,
      completedAt: null,
      deliveredAt: null,
    });

    db.updateBackgroundTask('bt-1', 'completed', 'Task result here', now + 5000);

    const updated = db.getBackgroundTask('bt-1');
    expect(updated!.status).toBe('completed');
    expect(updated!.result).toBe('Task result here');
    expect(updated!.completedAt).toBe(now + 5000);

    db.close();
  });

  test('getUndeliveredTasks returns completed but not delivered', () => {
    const db = createTestDb();
    const now = Date.now();

    const base = {
      userId: 'user-1',
      agentId: 'sa-1',
      startedAt: now,
      deliveredAt: null,
    };

    db.saveBackgroundTask({
      ...base,
      id: 'bt-1',
      taskDescription: 'Running',
      status: 'running',
      result: null,
      completedAt: null,
    });
    db.saveBackgroundTask({
      ...base,
      id: 'bt-2',
      taskDescription: 'Completed',
      status: 'completed',
      result: 'Done!',
      completedAt: now + 1000,
    });
    db.saveBackgroundTask({
      ...base,
      id: 'bt-3',
      taskDescription: 'Failed',
      status: 'failed',
      result: 'Error',
      completedAt: now + 2000,
    });
    db.saveBackgroundTask({
      ...base,
      id: 'bt-4',
      taskDescription: 'Delivered',
      status: 'delivered',
      result: 'Old',
      completedAt: now,
      deliveredAt: now + 3000,
    });

    const undelivered = db.getUndeliveredTasks('user-1');
    expect(undelivered.length).toBe(2);
    expect(undelivered[0].id).toBe('bt-2');
    expect(undelivered[1].id).toBe('bt-3');

    db.close();
  });

  test('markTaskDelivered sets delivered status', () => {
    const db = createTestDb();
    const now = Date.now();

    db.saveBackgroundTask({
      id: 'bt-1',
      userId: 'user-1',
      agentId: 'sa-1',
      taskDescription: 'Test',
      status: 'completed',
      result: 'Done',
      startedAt: now,
      completedAt: now + 1000,
      deliveredAt: null,
    });

    db.markTaskDelivered('bt-1');

    const task = db.getBackgroundTask('bt-1');
    expect(task!.status).toBe('delivered');
    expect(task!.deliveredAt).not.toBeNull();

    db.close();
  });

  test('getStaleBackgroundTasks finds old running tasks', () => {
    const db = createTestDb();
    const now = Date.now();

    db.saveBackgroundTask({
      id: 'bt-stale',
      userId: 'user-1',
      agentId: 'sa-1',
      taskDescription: 'Stale',
      status: 'running',
      result: null,
      startedAt: now - 600_000, // 10 minutes ago
      completedAt: null,
      deliveredAt: null,
    });

    db.saveBackgroundTask({
      id: 'bt-fresh',
      userId: 'user-1',
      agentId: 'sa-1',
      taskDescription: 'Fresh',
      status: 'running',
      result: null,
      startedAt: now, // just started
      completedAt: null,
      deliveredAt: null,
    });

    const stale = db.getStaleBackgroundTasks(300_000); // older than 5 min
    expect(stale.length).toBe(1);
    expect(stale[0].id).toBe('bt-stale');

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Sub-agent messages (reuse messages table)
// ---------------------------------------------------------------------------

describe('sub-agent messages via messages table', () => {
  test('saveMessage and getHistory with subagent prefix', () => {
    const db = createTestDb();

    db.saveMessage('subagent:sa-1', 'user', 'Research this topic');
    db.saveMessage('subagent:sa-1', 'assistant', 'Here are the results.');

    const history = db.getHistory('subagent:sa-1');
    expect(history.length).toBe(2);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');

    // Regular user messages are separate
    db.saveMessage('user-1', 'user', 'Hello');
    expect(db.getHistory('user-1').length).toBe(1);
    expect(db.getHistory('subagent:sa-1').length).toBe(2);

    db.close();
  });

  test('deleteMessagesForUser cleans up sub-agent messages', () => {
    const db = createTestDb();

    db.saveMessage('subagent:sa-1', 'user', 'Task 1');
    db.saveMessage('subagent:sa-1', 'assistant', 'Result 1');

    db.deleteMessagesForUser('subagent:sa-1');

    expect(db.getHistory('subagent:sa-1').length).toBe(0);

    db.close();
  });
});
