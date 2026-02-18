/**
 * Update Checker
 *
 * Lightweight, non-blocking module that checks the npm registry for newer
 * versions of tinyclaw. Results are cached locally (24-hour TTL) to avoid
 * repeated network calls.
 *
 * The update info is injected into the agent's system prompt context so the
 * AI can conversationally inform the user about available upgrades.
 *
 * Runtime detection differentiates npm installs (self-upgradable via shell
 * tool) from Docker containers (manual pull required).
 */

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { logger } from '@tinyclaw/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpdateRuntime = 'npm' | 'docker' | 'source';

export interface UpdateInfo {
  /** Currently running version (e.g. "1.0.0"). */
  current: string;
  /** Latest version published on npm (e.g. "1.1.0"). */
  latest: string;
  /** Whether a newer version is available. */
  updateAvailable: boolean;
  /** Detected runtime environment. */
  runtime: UpdateRuntime;
  /** Timestamp (ms) of the last check. */
  checkedAt: number;
  /** GitHub release URL for the latest version. */
  releaseUrl: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Time-to-live for the cache file (24 hours). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** npm registry endpoint for the tinyclaw package. */
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/tinyclaw/latest';

/** Maximum time to wait for the registry response (ms). */
const FETCH_TIMEOUT_MS = 5_000;

/** Cache file name within the data directory. */
const CACHE_FILENAME = 'update-check.json';

/** GitHub releases base URL. */
const GITHUB_RELEASES_URL = 'https://github.com/warengonzaga/tinyclaw/releases/tag';

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

/**
 * Detect the runtime environment.
 *
 * - Docker: `/.dockerenv` exists or `TINYCLAW_RUNTIME` env is set to "docker"
 * - Source: `TINYCLAW_RUNTIME` env is set to "source"
 * - npm: everything else (global install via npm/bun/pnpm)
 */
export function detectRuntime(): UpdateRuntime {
  const envRuntime = process.env.TINYCLAW_RUNTIME?.toLowerCase();
  if (envRuntime === 'docker') return 'docker';
  if (envRuntime === 'source') return 'source';

  // Docker container detection
  try {
    if (existsSync('/.dockerenv')) return 'docker';
  } catch {
    // Permission errors on exotic platforms — assume npm
  }

  return 'npm';
}

// ---------------------------------------------------------------------------
// Semver comparison (minimal — avoids pulling a full semver library)
// ---------------------------------------------------------------------------

/**
 * Compare two semver strings. Returns true when `latest` is strictly newer
 * than `current`. Only handles `MAJOR.MINOR.PATCH`; pre-release suffixes
 * are ignored.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .replace(/[-+].*$/, '')
      .split('.')
      .map((s) => { const n = Number(s); return isNaN(n) ? 0 : n; })
      .slice(0, 3);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(current);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

// ---------------------------------------------------------------------------
// Cache I/O
// ---------------------------------------------------------------------------

function getCachePath(dataDir: string): string {
  return join(dataDir, 'data', CACHE_FILENAME);
}

function readCache(dataDir: string): UpdateInfo | null {
  try {
    const raw = readFileSync(getCachePath(dataDir), 'utf-8');
    const cached = JSON.parse(raw) as UpdateInfo;
    if (cached && typeof cached.checkedAt === 'number') return cached;
  } catch {
    // Missing or corrupt — will re-check
  }
  return null;
}

function writeCache(dataDir: string, info: UpdateInfo): void {
  try {
    const dir = join(dataDir, 'data');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(getCachePath(dataDir), JSON.stringify(info, null, 2), 'utf-8');
  } catch (err) {
    logger.debug('Failed to write update cache', err);
  }
}

// ---------------------------------------------------------------------------
// Registry fetch
// ---------------------------------------------------------------------------

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    // Network error, timeout, or offline — silently return null
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check for available updates.
 *
 * - Returns cached result if the cache is still fresh (< 24 hours old).
 * - Otherwise fetches the npm registry in the background.
 * - Never throws — returns null on any failure so startup is never delayed.
 *
 * @param currentVersion - The currently running version string.
 * @param dataDir - The tinyclaw data directory (e.g. `~/.tinyclaw`).
 */
export async function checkForUpdate(
  currentVersion: string,
  dataDir: string,
): Promise<UpdateInfo | null> {
  try {
    // Return cached result if still fresh
    const cached = readCache(dataDir);
    if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
      // Re-evaluate against the current binary version (in case user
      // upgraded manually since the last check)
      return {
        ...cached,
        current: currentVersion,
        updateAvailable: isNewerVersion(currentVersion, cached.latest),
      };
    }

    // Fetch latest version from npm
    const latest = await fetchLatestVersion();
    if (!latest) return cached ?? null; // Network failure — use stale cache if available

    const runtime = detectRuntime();
    const info: UpdateInfo = {
      current: currentVersion,
      latest,
      updateAvailable: isNewerVersion(currentVersion, latest),
      runtime,
      checkedAt: Date.now(),
      releaseUrl: `${GITHUB_RELEASES_URL}/v${latest}`,
    };

    writeCache(dataDir, info);

    if (info.updateAvailable) {
      logger.info('Update available', { current: currentVersion, latest, runtime }, { emoji: '🆕' });
    }

    return info;
  } catch (err) {
    logger.debug('Update check failed', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// System prompt context builder
// ---------------------------------------------------------------------------

/**
 * Build a system prompt section that informs the agent about an available
 * update. Returns an empty string if no update is available or info is null.
 */
export function buildUpdateContext(info: UpdateInfo | null): string {
  if (!info?.updateAvailable) return '';

  const upgradeInstructions =
    info.runtime === 'npm'
      ? `Since you are running as an npm global install, you can upgrade yourself using the shell tool:
\`bun install -g tinyclaw@latest\` or \`npm install -g tinyclaw@latest\`
After the upgrade completes, request a restart using the tinyclaw_restart tool so the supervisor can reload with the new version.`
      : info.runtime === 'docker'
        ? `Since you are running inside a Docker container, you cannot upgrade yourself directly.
Instruct the owner to run the following commands externally:
\`docker pull ghcr.io/warengonzaga/tinyclaw:latest\`
Then restart the container (e.g. \`docker restart tinyclaw\` or \`docker compose up -d\`).`
        : `Since you are running from source, instruct the owner to pull the latest changes and rebuild:
\`git pull && bun install && bun run build:packages\`
Then restart using the tinyclaw_restart tool.`;

  return `

## Software Update Available
- **Current version:** ${info.current}
- **Latest version:** ${info.latest}
- **Runtime:** ${info.runtime}
- **Release notes:** ${info.releaseUrl}

${upgradeInstructions}

**Behavior guidelines:**
- Mention the update naturally early in the conversation, but do not interrupt an ongoing task.
- Do not repeat the update reminder if the owner has already acknowledged or dismissed it.
- If the owner agrees to update, proceed with the appropriate upgrade path above.
- After a successful upgrade and restart, confirm the new version is running.`;
}
