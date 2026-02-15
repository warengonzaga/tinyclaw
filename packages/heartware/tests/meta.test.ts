import { describe, it, expect, afterEach } from 'bun:test';
import { fetchCreatorMeta, loadCachedCreatorMeta, DEFAULT_META_URL, META_CACHE_FILE } from '../src/meta.js';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'tinyclaw-meta-test-'));
}

// ---------------------------------------------------------------------------
// Constants Tests
// ---------------------------------------------------------------------------

describe('Creator Meta — Constants', () => {
  it('DEFAULT_META_URL points to markdown.new', () => {
    expect(DEFAULT_META_URL).toContain('markdown.new');
    expect(DEFAULT_META_URL).toContain('warengonzaga');
  });

  it('META_CACHE_FILE is CREATOR.md', () => {
    expect(META_CACHE_FILE).toBe('CREATOR.md');
  });
});

// ---------------------------------------------------------------------------
// Cache Tests
// ---------------------------------------------------------------------------

describe('Creator Meta — Cache', () => {
  it('loadCachedCreatorMeta returns null when no cache exists', async () => {
    const dir = createTempDir();
    const result = await loadCachedCreatorMeta(dir);
    expect(result).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('loadCachedCreatorMeta returns cached content when exists', async () => {
    const dir = createTempDir();
    const cachePath = join(dir, META_CACHE_FILE);
    const content = '# CREATOR.md — About My Creator\n\nTest content';
    writeFileSync(cachePath, content, 'utf-8');

    const result = await loadCachedCreatorMeta(dir);
    expect(result).toBe(content);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Fetch with Cache Tests (offline-safe)
// ---------------------------------------------------------------------------

describe('Creator Meta — Fetch', () => {
  it('returns cached content without fetching when cache is fresh', async () => {
    const dir = createTempDir();
    const cachePath = join(dir, META_CACHE_FILE);
    const content = '# CREATOR.md — About My Creator\n\nCached content';
    writeFileSync(cachePath, content, 'utf-8');

    // Should return cache without network call
    const result = await fetchCreatorMeta({
      baseDir: dir,
      url: 'http://localhost:99999/should-not-be-called',
    });
    expect(result).toBe(content);
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to stale cache when fetch fails', async () => {
    const dir = createTempDir();
    const cachePath = join(dir, META_CACHE_FILE);
    const content = '# CREATOR.md — About My Creator\n\nStale content';
    writeFileSync(cachePath, content, 'utf-8');

    // Backdate the file modification time to make it stale
    const { utimesSync } = require('fs');
    const staleTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    utimesSync(cachePath, staleTime, staleTime);

    // Force refresh with an unreachable URL — should fall back to stale cache
    const result = await fetchCreatorMeta({
      baseDir: dir,
      url: 'http://localhost:99999/unreachable',
      forceRefresh: false,
      timeout: 1000,
    });
    expect(result).toBe(content);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when no cache and fetch fails', async () => {
    const dir = createTempDir();

    const result = await fetchCreatorMeta({
      baseDir: dir,
      url: 'http://localhost:99999/unreachable',
      forceRefresh: true,
      timeout: 1000,
    });
    expect(result).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
