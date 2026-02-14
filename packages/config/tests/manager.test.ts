/**
 * Tests for the ConfigManager class.
 *
 * Each test uses a unique temp directory so tests are fully isolated
 * and never touch the user's real ~/.tinyclaw/ config.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigManager } from '../src/manager.js';
import { CONFIG_DEFAULTS } from '../src/types.js';

let tmpDir: string;
let manager: ConfigManager;

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `tinyclaw-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  manager = await ConfigManager.create({ cwd: tmpDir });
});

afterEach(() => {
  try { manager.close(); } catch { /* ignore */ }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// -----------------------------------------------------------------------
// Factory & initialization
// -----------------------------------------------------------------------

describe('ConfigManager — factory', () => {
  test('create() returns a ConfigManager instance', () => {
    expect(manager).toBeInstanceOf(ConfigManager);
  });

  test('config path points to the cwd directory', () => {
    expect(manager.path).toContain(tmpDir.replace(/\\/g, '/').split('/').pop()!);
  });

  test('config path ends with config.db', () => {
    expect(manager.path).toMatch(/config\.db$/);
  });

  test('defaults are populated on first open', () => {
    expect(manager.get('agent.name')).toBe('TinyClaw');
    expect(manager.get('learning.enabled')).toBe(true);
    expect(manager.get('learning.minConfidence')).toBe(0.7);
    expect(manager.get('security.rateLimit.maxRequests')).toBe(20);
    // Model default comes from @tinyclaw/core — just verify it's a non-empty string
    expect(typeof manager.get('providers.starterBrain.model')).toBe('string');
    expect((manager.get('providers.starterBrain.model') as string).length).toBeGreaterThan(0);
  });

  test('defaults are not overwritten on second open', async () => {
    manager.set('agent.name', 'MyAgent');
    manager.close();

    const manager2 = await ConfigManager.create({ cwd: tmpDir });
    expect(manager2.get('agent.name')).toBe('MyAgent');
    manager2.close();
  });
});

// -----------------------------------------------------------------------
// Read operations
// -----------------------------------------------------------------------

describe('ConfigManager — reads', () => {
  test('get returns default for missing key', () => {
    expect(manager.get('nonexistent.key', 'fallback')).toBe('fallback');
  });

  test('get returns undefined for missing key without default', () => {
    expect(manager.get('totally.missing')).toBeUndefined();
  });

  test('has returns true for existing key', () => {
    expect(manager.has('agent')).toBe(true);
  });

  test('has returns false for missing key', () => {
    expect(manager.has('nonexistent')).toBe(false);
  });

  test('store returns full config snapshot', () => {
    const snapshot = manager.store;
    expect(snapshot).toBeDefined();
    expect(snapshot.agent).toBeDefined();
    expect(snapshot.learning).toBeDefined();
    expect(snapshot.providers).toBeDefined();
  });

  test('size reflects top-level entry count', () => {
    expect(manager.size).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------
// Write operations
// -----------------------------------------------------------------------

describe('ConfigManager — writes', () => {
  test('set and get a string value', () => {
    manager.set('agent.name', 'TestBot');
    expect(manager.get('agent.name')).toBe('TestBot');
  });

  test('set and get a numeric value', () => {
    manager.set('learning.minConfidence', 0.9);
    expect(manager.get('learning.minConfidence')).toBe(0.9);
  });

  test('set and get a boolean value', () => {
    manager.set('learning.enabled', false);
    expect(manager.get('learning.enabled')).toBe(false);
  });

  test('set multiple values via object', () => {
    manager.set({
      agent: { name: 'BatchBot' },
      learning: { enabled: false, minConfidence: 0.5 },
    });
    expect(manager.get('agent.name')).toBe('BatchBot');
    expect(manager.get('learning.enabled')).toBe(false);
    expect(manager.get('learning.minConfidence')).toBe(0.5);
  });

  test('set nested dot-notation path', () => {
    manager.set('providers.starterBrain.model', 'gemma2:2b');
    expect(manager.get('providers.starterBrain.model')).toBe('gemma2:2b');
  });
});

// -----------------------------------------------------------------------
// Delete & reset
// -----------------------------------------------------------------------

describe('ConfigManager — delete & reset', () => {
  test('delete removes a key', () => {
    manager.set('agent.identity', 'helper');
    expect(manager.has('agent.identity')).toBe(true);

    manager.delete('agent');
    // After deleting the top-level 'agent' key, it should be gone
    expect(manager.has('agent')).toBe(false);
  });

  test('clear restores defaults', () => {
    manager.set('agent.name', 'CustomBot');
    manager.set('learning.minConfidence', 0.1);
    manager.clear();

    // Defaults should be restored
    expect(manager.get('agent.name')).toBe(CONFIG_DEFAULTS.agent?.name);
    expect(manager.get('learning.minConfidence')).toBe(CONFIG_DEFAULTS.learning?.minConfidence);
  });

  test('reset restores specific keys to defaults', () => {
    manager.set('agent.name', 'CustomBot');
    manager.reset('agent');

    expect(manager.get('agent.name')).toBe(CONFIG_DEFAULTS.agent?.name);
  });
});

// -----------------------------------------------------------------------
// Persistence across opens
// -----------------------------------------------------------------------

describe('ConfigManager — persistence', () => {
  test('values persist across close and reopen', async () => {
    manager.set('agent.name', 'PersistBot');
    manager.set('learning.minConfidence', 0.55);
    manager.close();

    const manager2 = await ConfigManager.create({ cwd: tmpDir });
    expect(manager2.get('agent.name')).toBe('PersistBot');
    expect(manager2.get('learning.minConfidence')).toBe(0.55);
    manager2.close();
  });

  test('non-default keys stay deleted after reopen', async () => {
    // Set a key that has no default, then delete it
    manager.set('agent.workspace', '/tmp/test');
    manager.delete('agent.workspace');
    manager.close();

    const manager2 = await ConfigManager.create({ cwd: tmpDir });
    expect(manager2.has('agent.workspace')).toBe(false);
    manager2.close();
  });

  test('deleted default keys are restored on reopen', async () => {
    // Deleting a key that has a default — it comes back on reopen
    manager.delete('heartware');
    manager.close();

    const manager2 = await ConfigManager.create({ cwd: tmpDir });
    // Defaults fill in missing keys on open
    expect(manager2.has('heartware')).toBe(true);
    manager2.close();
  });
});

// -----------------------------------------------------------------------
// Change events
// -----------------------------------------------------------------------

describe('ConfigManager — change events', () => {
  test('onDidChange fires on key change', () => {
    let fired = false;
    let newVal: unknown;
    let oldVal: unknown;

    manager.onDidChange('agent.name', (nv, ov) => {
      fired = true;
      newVal = nv;
      oldVal = ov;
    });

    manager.set('agent.name', 'EventBot');

    expect(fired).toBe(true);
    expect(newVal).toBe('EventBot');
    expect(oldVal).toBe('TinyClaw');
  });

  test('onDidAnyChange fires on any change', () => {
    let fired = false;

    manager.onDidAnyChange(() => {
      fired = true;
    });

    manager.set('learning.enabled', false);

    expect(fired).toBe(true);
  });

  test('unsubscribe stops notifications', () => {
    let count = 0;

    const unsubscribe = manager.onDidChange('agent.name', () => {
      count++;
    });

    manager.set('agent.name', 'First');
    unsubscribe();
    manager.set('agent.name', 'Second');

    expect(count).toBe(1);
  });
});
