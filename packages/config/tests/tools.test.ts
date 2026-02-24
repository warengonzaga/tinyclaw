/**
 * Tests for the config agent tools (createConfigTools).
 *
 * Validates all 4 tools: config_get, config_set, config_delete, config_list.
 * Each test uses a unique temp directory for isolation.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@tinyclaw/types';
import { ConfigManager } from '../src/manager.js';
import { createConfigTools } from '../src/tools.js';

let tmpDir: string;
let manager: ConfigManager;
let tools: Tool[];

/** Helper to find a tool by name */
function findTool(name: string): Tool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `tinyclaw-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  manager = await ConfigManager.create({ cwd: tmpDir });
  tools = createConfigTools(manager);
});

afterEach(() => {
  try {
    manager.close();
  } catch {
    /* ignore */
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// -----------------------------------------------------------------------
// Tool creation
// -----------------------------------------------------------------------

describe('createConfigTools', () => {
  test('returns exactly 4 tools', () => {
    expect(tools).toHaveLength(4);
  });

  test('returns tools with expected names', () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain('config_get');
    expect(names).toContain('config_set');
    expect(names).toContain('config_delete');
    expect(names).toContain('config_list');
  });

  test('all tools have description and parameters', () => {
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    }
  });
});

// -----------------------------------------------------------------------
// config_get
// -----------------------------------------------------------------------

describe('config_get tool', () => {
  test('retrieves an existing default value', async () => {
    const tool = findTool('config_get');
    const result = await tool.execute({ key: 'agent.name' });
    expect(result).toBe('"Tiny Claw"');
  });

  test('retrieves a nested default value', async () => {
    const tool = findTool('config_get');
    const result = await tool.execute({ key: 'learning.minConfidence' });
    expect(result).toBe('0.7');
  });

  test('returns not found for missing key', async () => {
    const tool = findTool('config_get');
    const result = await tool.execute({ key: 'nonexistent.key' });
    expect(result).toContain('not found');
  });

  test('rejects empty key', async () => {
    const tool = findTool('config_get');
    const result = await tool.execute({ key: '' });
    expect(result).toContain('Invalid config key');
  });

  test('rejects non-string key', async () => {
    const tool = findTool('config_get');
    const result = await tool.execute({ key: 123 });
    expect(result).toContain('Invalid config key');
  });
});

// -----------------------------------------------------------------------
// config_set
// -----------------------------------------------------------------------

describe('config_set tool', () => {
  test('sets a new value', async () => {
    const tool = findTool('config_set');
    const result = await tool.execute({ key: 'agent.identity', value: 'helper' });
    expect(result).toContain('Successfully');
    expect(manager.get('agent.identity')).toBe('helper');
  });

  test('updates an existing value', async () => {
    const tool = findTool('config_set');
    const result = await tool.execute({ key: 'agent.name', value: 'UpdatedBot' });
    expect(result).toContain('updated');
    expect(manager.get('agent.name')).toBe('UpdatedBot');
  });

  test('sets a numeric value', async () => {
    const tool = findTool('config_set');
    const result = await tool.execute({ key: 'learning.minConfidence', value: 0.85 });
    expect(result).toContain('Successfully');
    expect(manager.get('learning.minConfidence')).toBe(0.85);
  });

  test('sets a boolean value', async () => {
    const tool = findTool('config_set');
    const result = await tool.execute({ key: 'learning.enabled', value: false });
    expect(result).toContain('Successfully');
    expect(manager.get('learning.enabled')).toBe(false);
  });

  test('rejects empty key', async () => {
    const tool = findTool('config_set');
    const result = await tool.execute({ key: '', value: 'test' });
    expect(result).toContain('Invalid config key');
  });

  test('rejects missing value', async () => {
    const tool = findTool('config_set');
    const result = await tool.execute({ key: 'agent.name' });
    expect(result).toContain('value is required');
  });
});

// -----------------------------------------------------------------------
// config_delete
// -----------------------------------------------------------------------

describe('config_delete tool', () => {
  test('deletes an existing key', async () => {
    manager.set('agent.workspace', '/tmp/test');
    const tool = findTool('config_delete');
    const result = await tool.execute({ key: 'agent.workspace' });
    expect(result).toContain('Successfully deleted');
  });

  test('returns not found for missing key', async () => {
    const tool = findTool('config_delete');
    const result = await tool.execute({ key: 'nonexistent.key' });
    expect(result).toContain('not found');
  });

  test('rejects empty key', async () => {
    const tool = findTool('config_delete');
    const result = await tool.execute({ key: '' });
    expect(result).toContain('Invalid config key');
  });
});

// -----------------------------------------------------------------------
// config_list
// -----------------------------------------------------------------------

describe('config_list tool', () => {
  test('returns config snapshot as JSON', async () => {
    const tool = findTool('config_list');
    const result = await tool.execute({});
    expect(result).toContain('Configuration');
    expect(result).toContain('Tiny Claw');
    expect(result).toContain('entries');
  });

  test('includes default values in snapshot', async () => {
    const tool = findTool('config_list');
    const result = await tool.execute({});
    // Should contain default agent name
    expect(result).toContain('Tiny Claw');
    // Should contain learning defaults
    expect(result).toContain('minConfidence');
  });

  test('reflects recently set values', async () => {
    manager.set('agent.name', 'ToolTestBot');
    const tool = findTool('config_list');
    const result = await tool.execute({});
    expect(result).toContain('ToolTestBot');
  });
});
