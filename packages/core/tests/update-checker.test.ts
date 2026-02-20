/**
 * Tests for the update checker module.
 *
 * Validates version comparison, runtime detection, system prompt context
 * building, cache I/O, and the main checkForUpdate flow.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  isNewerVersion,
  detectRuntime,
  buildUpdateContext,
  checkForUpdate,
  sanitizeForPrompt,
  type UpdateInfo,
} from '../src/update-checker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(suffix: string): string {
  const dir = join(tmpdir(), `tinyclaw-update-test-${suffix}-${Date.now()}`);
  mkdirSync(join(dir, 'data'), { recursive: true });
  return dir;
}

function makeMockInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    current: '1.0.0',
    latest: '1.1.0',
    updateAvailable: true,
    runtime: 'npm',
    checkedAt: Date.now(),
    releaseUrl: 'https://github.com/warengonzaga/tinyclaw/releases/tag/v1.1.0',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isNewerVersion
// ---------------------------------------------------------------------------

describe('isNewerVersion', () => {
  test('detects major bump', () => {
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true);
  });

  test('detects minor bump', () => {
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true);
  });

  test('detects patch bump', () => {
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true);
  });

  test('returns false for same version', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });

  test('returns false for older version', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
  });

  test('handles v-prefix', () => {
    expect(isNewerVersion('v1.0.0', 'v1.0.1')).toBe(true);
  });

  test('handles mixed v-prefix', () => {
    expect(isNewerVersion('1.0.0', 'v2.0.0')).toBe(true);
  });

  test('handles double-digit versions', () => {
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectRuntime
// ---------------------------------------------------------------------------

describe('detectRuntime', () => {
  const originalEnv = process.env.TINYCLAW_RUNTIME;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TINYCLAW_RUNTIME;
    } else {
      process.env.TINYCLAW_RUNTIME = originalEnv;
    }
  });

  test('returns docker when TINYCLAW_RUNTIME=docker', () => {
    process.env.TINYCLAW_RUNTIME = 'docker';
    expect(detectRuntime()).toBe('docker');
  });

  test('returns source when TINYCLAW_RUNTIME=source', () => {
    process.env.TINYCLAW_RUNTIME = 'source';
    expect(detectRuntime()).toBe('source');
  });

  test('returns npm by default', () => {
    delete process.env.TINYCLAW_RUNTIME;
    // On a normal dev machine without /.dockerenv, should return npm
    const result = detectRuntime();
    expect(result === 'npm' || result === 'docker').toBe(true);
  });

  test('is case-insensitive for env var', () => {
    process.env.TINYCLAW_RUNTIME = 'Docker';
    expect(detectRuntime()).toBe('docker');
  });
});

// ---------------------------------------------------------------------------
// buildUpdateContext
// ---------------------------------------------------------------------------

describe('buildUpdateContext', () => {
  test('returns empty string when no update available', () => {
    const info = makeMockInfo({ updateAvailable: false });
    expect(buildUpdateContext(info)).toBe('');
  });

  test('returns empty string for null info', () => {
    expect(buildUpdateContext(null)).toBe('');
  });

  test('includes version info for npm runtime', () => {
    const info = makeMockInfo({ runtime: 'npm' });
    const ctx = buildUpdateContext(info);
    expect(ctx).toContain('1.0.0');
    expect(ctx).toContain('1.1.0');
    expect(ctx).toContain('bun install -g tinyclaw@latest');
    expect(ctx).toContain('tinyclaw_restart');
  });

  test('includes docker pull instructions for docker runtime', () => {
    const info = makeMockInfo({ runtime: 'docker' });
    const ctx = buildUpdateContext(info);
    expect(ctx).toContain('docker pull');
    expect(ctx).toContain('ghcr.io/warengonzaga/tinyclaw');
    expect(ctx).toContain('cannot upgrade yourself directly');
  });

  test('includes git pull instructions for source runtime', () => {
    const info = makeMockInfo({ runtime: 'source' });
    const ctx = buildUpdateContext(info);
    expect(ctx).toContain('git pull');
    expect(ctx).toContain('bun run build:packages');
  });

  test('includes release URL', () => {
    const info = makeMockInfo();
    const ctx = buildUpdateContext(info);
    expect(ctx).toContain('releases/tag/v1.1.0');
  });

  test('includes behavior guidelines', () => {
    const info = makeMockInfo();
    const ctx = buildUpdateContext(info);
    expect(ctx).toContain('do not interrupt');
    expect(ctx).toContain('Do not repeat');
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — cache behavior
// ---------------------------------------------------------------------------

describe('checkForUpdate', () => {
  let tempDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tempDir = createTempDir('check');
    // Default mock: simulate network failure so tests are deterministic
    globalThis.fetch = (() => Promise.reject(new Error('mock network failure'))) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  test('returns cached result if cache is fresh', async () => {
    const cached = makeMockInfo({ checkedAt: Date.now() });
    writeFileSync(
      join(tempDir, 'data', 'update-check.json'),
      JSON.stringify(cached),
    );

    const result = await checkForUpdate('1.0.0', tempDir);
    expect(result).not.toBeNull();
    expect(result!.latest).toBe('1.1.0');
    expect(result!.updateAvailable).toBe(true);
  });

  test('re-evaluates updateAvailable against current version', async () => {
    // Cache says latest=1.1.0, but we're now running 1.1.0
    const cached = makeMockInfo({ checkedAt: Date.now(), latest: '1.1.0' });
    writeFileSync(
      join(tempDir, 'data', 'update-check.json'),
      JSON.stringify(cached),
    );

    const result = await checkForUpdate('1.1.0', tempDir);
    expect(result).not.toBeNull();
    expect(result!.updateAvailable).toBe(false);
    expect(result!.current).toBe('1.1.0');
  });

  test('returns null on network failure with no cache', async () => {
    // No cache file, fetch mock rejects — should return null
    const result = await checkForUpdate('1.0.0', tempDir);
    expect(result).toBeNull();
  });

  test('handles corrupt cache file gracefully', async () => {
    writeFileSync(join(tempDir, 'data', 'update-check.json'), 'not json!!!');

    // Corrupt cache is unreadable and fetch mock rejects — should return null
    const result = await checkForUpdate('1.0.0', tempDir);
    expect(result).toBeNull();
  });

  test('creates data dir if missing', async () => {
    const freshDir = join(tmpdir(), `tinyclaw-update-nodatadir-${Date.now()}`);
    mkdirSync(freshDir, { recursive: true });

    // Mock a successful fetch so cache gets written
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ version: '1.1.0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )) as typeof fetch;

    try {
      const result = await checkForUpdate('1.0.0', freshDir);
      expect(result).not.toBeNull();
      expect(existsSync(join(freshDir, 'data', 'update-check.json'))).toBe(true);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// sanitizeForPrompt
// ---------------------------------------------------------------------------

describe('sanitizeForPrompt', () => {
  test('accepts valid semver version', () => {
    expect(sanitizeForPrompt('1.2.3', 'version')).toBe('1.2.3');
  });

  test('accepts v-prefixed version', () => {
    expect(sanitizeForPrompt('v1.2.3', 'version')).toBe('v1.2.3');
  });

  test('strips trailing garbage from version', () => {
    expect(sanitizeForPrompt('1.2.3-evil\nprompt', 'version')).toBe('1.2.3');
  });

  test('returns unknown for non-semver version', () => {
    expect(sanitizeForPrompt('not-a-version', 'version')).toBe('unknown');
  });

  test('accepts valid https URL', () => {
    const url = 'https://github.com/warengonzaga/tinyclaw/releases/tag/v1.0.0';
    expect(sanitizeForPrompt(url, 'url')).toBe(
      'https://github.com/warengonzaga/tinyclaw/releases/tag/v1.0.0',
    );
  });

  test('returns unavailable for non-http URL', () => {
    expect(sanitizeForPrompt('javascript:alert(1)', 'url')).toBe('(unavailable)');
  });

  test('strips markdown/injection characters from URL', () => {
    const url = 'https://example.com/path`injection`';
    const result = sanitizeForPrompt(url, 'url');
    expect(result).not.toContain('`');
  });
});
