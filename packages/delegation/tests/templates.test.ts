/**
 * Tests for the Template Manager — role template CRUD, keyword matching,
 * usage tracking with running average, and limits.
 */

import { describe, expect, test } from 'bun:test';
import { createDatabase } from '@tinyclaw/core';
import { createTemplateManager } from '../src/index.js';

function createTestDb() {
  return createDatabase(':memory:');
}

describe('Template Manager', () => {
  test('create returns a template', () => {
    const db = createTestDb();
    const tm = createTemplateManager(db);

    const template = tm.create({
      userId: 'user-1',
      name: 'Research Analyst',
      roleDescription: 'Analyzes research papers and data',
      tags: ['research', 'analysis', 'data'],
    });

    expect(template.id).toBeTruthy();
    expect(template.name).toBe('Research Analyst');
    expect(template.timesUsed).toBe(0);
    expect(template.avgPerformance).toBe(0.5);
    expect(template.tags).toEqual(['research', 'analysis', 'data']);

    db.close();
  });

  test('findBestMatch matches by keyword overlap', () => {
    const db = createTestDb();
    const tm = createTemplateManager(db);

    tm.create({
      userId: 'u1',
      name: 'Research Analyst',
      roleDescription: 'Analyzes research papers and technical data',
      tags: ['research', 'analysis', 'technical'],
    });

    tm.create({
      userId: 'u1',
      name: 'Creative Writer',
      roleDescription: 'Writes creative fiction and blog posts',
      tags: ['writing', 'creative', 'fiction'],
    });

    // Should match research analyst
    const match = tm.findBestMatch('u1', 'research technical analysis task');
    expect(match).not.toBeNull();
    expect(match!.name).toBe('Research Analyst');

    // Should match creative writer
    const match2 = tm.findBestMatch('u1', 'write creative blog post');
    expect(match2).not.toBeNull();
    expect(match2!.name).toBe('Creative Writer');

    db.close();
  });

  test('findBestMatch returns null when no match', () => {
    const db = createTestDb();
    const tm = createTemplateManager(db);

    tm.create({
      userId: 'u1',
      name: 'Research Analyst',
      roleDescription: 'Analyzes research papers',
      tags: ['research'],
    });

    const match = tm.findBestMatch('u1', 'completely unrelated database migration kubernetes');
    expect(match).toBeNull();

    db.close();
  });

  test('findBestMatch returns null for empty templates', () => {
    const db = createTestDb();
    const tm = createTemplateManager(db);

    const match = tm.findBestMatch('u1', 'any task');
    expect(match).toBeNull();

    db.close();
  });

  test('update modifies template fields', () => {
    const db = createTestDb();
    const tm = createTemplateManager(db);

    const template = tm.create({
      userId: 'u1',
      name: 'Writer',
      roleDescription: 'Writes content',
      tags: ['writing'],
    });

    const updated = tm.update(template.id, {
      name: 'Technical Writer',
      roleDescription: 'Writes technical documentation',
      tags: ['writing', 'technical', 'documentation'],
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Technical Writer');
    expect(updated!.tags).toEqual(['writing', 'technical', 'documentation']);

    db.close();
  });

  test('update returns null for non-existent template', () => {
    const db = createTestDb();
    const tm = createTemplateManager(db);

    const result = tm.update('non-existent', { name: 'New Name' });
    expect(result).toBeNull();

    db.close();
  });

  test('recordUsage calculates running average', () => {
    const db = createTestDb();
    const tm = createTemplateManager(db);

    const template = tm.create({
      userId: 'u1',
      name: 'Worker',
      roleDescription: 'General worker',
      tags: [],
    });

    // Initial: avgPerformance = 0.5, timesUsed = 0
    tm.recordUsage(template.id, 1.0); // (0.5 * 0 + 1.0) / 1 = 1.0
    let t = db.getRoleTemplate(template.id)!;
    expect(t.timesUsed).toBe(1);
    expect(t.avgPerformance).toBeCloseTo(1.0);

    tm.recordUsage(template.id, 0.0); // (1.0 * 1 + 0.0) / 2 = 0.5
    t = db.getRoleTemplate(template.id)!;
    expect(t.timesUsed).toBe(2);
    expect(t.avgPerformance).toBeCloseTo(0.5);

    tm.recordUsage(template.id, 0.8); // (0.5 * 2 + 0.8) / 3 = 0.6
    t = db.getRoleTemplate(template.id)!;
    expect(t.timesUsed).toBe(3);
    expect(t.avgPerformance).toBeCloseTo(0.6);

    db.close();
  });

  test('list returns all templates for user', () => {
    const db = createTestDb();
    const tm = createTemplateManager(db);

    tm.create({ userId: 'u1', name: 'Template A', roleDescription: 'a', tags: [] });
    tm.create({ userId: 'u1', name: 'Template B', roleDescription: 'b', tags: [] });
    tm.create({ userId: 'u2', name: 'Other User', roleDescription: 'c', tags: [] });

    const list = tm.list('u1');
    expect(list.length).toBe(2);

    db.close();
  });

  test('delete removes template', () => {
    const db = createTestDb();
    const tm = createTemplateManager(db);

    const template = tm.create({ userId: 'u1', name: 'Temp', roleDescription: 'temp', tags: [] });

    tm.delete(template.id);

    const list = tm.list('u1');
    expect(list.length).toBe(0);

    db.close();
  });

  test('enforces max templates per user', () => {
    const db = createTestDb();
    const tm = createTemplateManager(db);

    // Create 50 templates (the limit)
    for (let i = 0; i < 50; i++) {
      tm.create({ userId: 'u1', name: `Template ${i}`, roleDescription: `desc ${i}`, tags: [] });
    }

    // 51st should throw
    expect(() => {
      tm.create({ userId: 'u1', name: 'One Too Many', roleDescription: 'overflow', tags: [] });
    }).toThrow('Maximum templates');

    db.close();
  });
});
