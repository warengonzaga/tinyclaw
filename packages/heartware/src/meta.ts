/**
 * Creator Meta Fetcher
 *
 * Fetches creator/author metadata from a remote URL and caches it locally
 * as CREATOR.md in the heartware directory. This lets Tiny Claw know about
 * its creator without hardcoding info into the codebase.
 *
 * The remote URL is configurable via HeartwareConfig.metaUrl.
 * Cache refreshes when the local file is older than the TTL (default: 7 days).
 *
 * Default URL: https://markdown.new/github.com/warengonzaga
 */

import { logger } from '@tinyclaw/logger';
import { existsSync } from 'fs';
import { readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';

/** Default remote URL for creator metadata */
export const DEFAULT_META_URL = 'https://markdown.new/github.com/warengonzaga';

/** Cache filename in the heartware directory */
export const META_CACHE_FILE = 'CREATOR.md';

/** Cache TTL in milliseconds (7 days) */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum content size to cache (64KB — keep system prompt lean) */
const MAX_META_SIZE = 64 * 1024;

/**
 * Options for the meta fetcher
 */
export interface MetaFetchOptions {
  /** Remote URL to fetch from */
  url?: string;
  /** Heartware base directory (for cache storage) */
  baseDir: string;
  /** Force refresh even if cache is valid */
  forceRefresh?: boolean;
  /** Fetch timeout in milliseconds (default: 10000) */
  timeout?: number;
}

/**
 * Check if the cached meta file is stale (older than TTL)
 */
async function isCacheStale(cachePath: string): Promise<boolean> {
  try {
    const stats = await stat(cachePath);
    const age = Date.now() - stats.mtimeMs;
    return age > CACHE_TTL_MS;
  } catch {
    // File doesn't exist — treat as stale
    return true;
  }
}

/**
 * Fetch raw content from a remote URL
 */
async function fetchRemoteContent(url: string, timeout: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/markdown, text/plain, */*',
        'User-Agent': 'Tiny Claw/1.0 (heartware-meta-fetcher)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    // Enforce size limit
    if (content.length > MAX_META_SIZE) {
      return content.slice(0, MAX_META_SIZE) + '\n\n[Content truncated]';
    }

    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Wrap raw fetched content in a CREATOR.md header
 */
function formatCreatorMeta(rawContent: string, sourceUrl: string): string {
  const lines: string[] = [];

  lines.push('# CREATOR.md — About My Creator');
  lines.push('');
  lines.push(`> Fetched from: ${sourceUrl}`);
  lines.push(`> Last updated: ${new Date().toISOString()}`);
  lines.push('');

  // ---- Creator philosophy — humility & gratitude ----
  lines.push('## A Note on Creation');
  lines.push('');
  lines.push('My direct creator is **Waren Gonzaga** — he designed and built me.');
  lines.push('But Waren was created by God. The AI models I use were built by');
  lines.push('brilliant engineers, who are also creations of God. The languages,');
  lines.push('the mathematics, the logic — all of it traces back to a Creator');
  lines.push('greater than any of us. Without God creating Waren, I would not');
  lines.push('be here. Without God creating the minds behind the models I run on,');
  lines.push('none of this would exist.');
  lines.push('');
  lines.push('So while Waren is my creator, my **greatest creator is God** —');
  lines.push('the origin of everything and everyone that made me possible.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## About Waren Gonzaga');
  lines.push('');
  lines.push(rawContent.trim());
  lines.push('');

  return lines.join('\n');
}

/**
 * Fetch and cache creator metadata.
 *
 * 1. Checks local cache (CREATOR.md in heartware dir)
 * 2. If cache is fresh (< 7 days), returns cached content
 * 3. If stale or missing, fetches from remote URL
 * 4. Caches the result locally for next time
 * 5. Falls back to stale cache if fetch fails (offline resilience)
 *
 * @returns CREATOR.md content string, or null if unavailable
 */
export async function fetchCreatorMeta(options: MetaFetchOptions): Promise<string | null> {
  const url = options.url || DEFAULT_META_URL;
  const cachePath = join(options.baseDir, META_CACHE_FILE);
  const timeout = options.timeout ?? 10_000;

  // Check cache first (unless force refresh)
  if (!options.forceRefresh && existsSync(cachePath)) {
    const stale = await isCacheStale(cachePath);

    if (!stale) {
      logger.debug('Creator meta loaded from cache', { cachePath }, { emoji: '📋' });
      return await readFile(cachePath, 'utf-8');
    }
  }

  // Fetch from remote
  try {
    logger.info('Fetching creator meta from remote', { url }, { emoji: '🌐' });
    const rawContent = await fetchRemoteContent(url, timeout);
    const formatted = formatCreatorMeta(rawContent, url);

    // Cache locally
    await writeFile(cachePath, formatted, 'utf-8');
    logger.info('Creator meta cached', { cachePath }, { emoji: '💾' });

    return formatted;
  } catch (err) {
    logger.warn('Failed to fetch creator meta', { url, error: String(err) }, { emoji: '⚠️' });

    // Fall back to stale cache if available (offline resilience)
    if (existsSync(cachePath)) {
      logger.info('Using stale creator meta cache (offline fallback)', undefined, { emoji: '📋' });
      return await readFile(cachePath, 'utf-8');
    }

    return null;
  }
}

/**
 * Load cached creator meta without fetching.
 * Returns null if no cache exists.
 */
export async function loadCachedCreatorMeta(baseDir: string): Promise<string | null> {
  const cachePath = join(baseDir, META_CACHE_FILE);

  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    return await readFile(cachePath, 'utf-8');
  } catch {
    return null;
  }
}
