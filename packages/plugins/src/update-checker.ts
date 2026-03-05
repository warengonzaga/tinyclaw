/**
 * Plugin Update Checker
 *
 * Checks the npm registry for newer versions of installed Tiny Claw plugins.
 * Results are cached locally (24-hour TTL) to avoid repeated network calls.
 *
 * The update info is injected into the agent's system prompt context so the
 * AI can conversationally inform the user about available plugin upgrades.
 *
 * Follows the same pattern as the core update checker in @tinyclaw/core.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@tinyclaw/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginVersionInfo {
  /** Plugin package name (e.g. "@tinyclaw/plugin-channel-discord"). */
  id: string;
  /** Human-readable name (e.g. "Discord"). */
  name: string;
  /** Currently installed version. */
  current: string;
  /** Latest version published on npm. */
  latest: string;
  /** Whether a newer version is available. */
  updateAvailable: boolean;
}

export interface PluginUpdateInfo {
  /** Plugins with version information. */
  plugins: PluginVersionInfo[];
  /** Number of plugins with available updates. */
  updatableCount: number;
  /** Detected runtime environment. */
  runtime: 'npm' | 'docker' | 'source';
  /** Timestamp (ms) of the last check. */
  checkedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Time-to-live for the cache file (24 hours). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** npm registry base URL. */
const NPM_REGISTRY_BASE = 'https://registry.npmjs.org';

/** Maximum time to wait for each registry response (ms). */
const FETCH_TIMEOUT_MS = 5_000;

/** Cache file name within the data directory. */
const CACHE_FILENAME = 'plugin-update-check.json';

/**
 * Directories inside the monorepo `plugins/` folder that contain plugin
 * packages.
 */
const PLUGIN_CATEGORY_DIRS = ['channel', 'provider'] as const;

// ---------------------------------------------------------------------------
// Semver comparison (minimal — same as core update-checker)
// ---------------------------------------------------------------------------

function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .replace(/[-+].*$/, '')
      .split('.')
      .map((s) => {
        const n = Number(s);
        return Number.isNaN(n) ? 0 : n;
      })
      .slice(0, 3);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(current);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

/** Matches a semver-like version string. */
const SEMVER_RE = /^v?\d+\.\d+\.\d+/;

/** Sanitize a version string for safe prompt interpolation. */
function sanitizeVersion(value: string): string {
  const trimmed = value.trim();
  if (!SEMVER_RE.test(trimmed)) return 'unknown';
  return trimmed.replace(/^(v?\d+\.\d+\.\d+)[\s\S]*$/, '$1');
}

/** Sanitize a package name for safe prompt interpolation. */
function sanitizePackageName(value: string): string {
  // Only allow scoped npm package names: @scope/name with alphanumeric, hyphens, dots
  return value.replace(/[^a-zA-Z0-9@/_.-]/g, '');
}

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

function detectRuntime(): 'npm' | 'docker' | 'source' {
  const envRuntime = process.env.TINYCLAW_RUNTIME?.toLowerCase();
  if (envRuntime === 'docker') return 'docker';
  if (envRuntime === 'source') return 'source';
  try {
    if (existsSync('/.dockerenv')) return 'docker';
  } catch {
    // Permission errors — assume npm
  }
  return 'npm';
}

// ---------------------------------------------------------------------------
// Plugin scanning — read installed plugin IDs and versions from workspace
// ---------------------------------------------------------------------------

interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Community plugin scanning
// ---------------------------------------------------------------------------

/**
 * Resolve community (non-monorepo) plugins by dynamically importing them
 * and reading their package metadata. Imports run in parallel.
 */
async function scanCommunityPlugins(communityIds: string[]): Promise<InstalledPlugin[]> {
  const results = await Promise.all(
    communityIds
      .filter((id) => !id.startsWith('@tinyclaw/plugin-'))
      .map(async (id): Promise<InstalledPlugin | null> => {
        try {
          const mod = await import(id);
          const plugin = mod.default as Record<string, unknown> | undefined;

          if (plugin && typeof plugin === 'object' && typeof plugin.version === 'string') {
            return {
              id,
              name: typeof plugin.name === 'string' ? plugin.name : id,
              version: plugin.version,
            };
          }
          return null;
        } catch {
          return null;
        }
      }),
  );

  return results.filter((p): p is InstalledPlugin => p !== null);
}

// ---------------------------------------------------------------------------
// Official plugin scanning
// ---------------------------------------------------------------------------

/**
 * Scan the workspace for installed plugins and their current versions.
 */
function scanInstalledPlugins(): InstalledPlugin[] {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const workspaceRoot = join(thisDir, '..', '..', '..');
    const pluginsRoot = join(workspaceRoot, 'plugins');

    if (!existsSync(pluginsRoot)) return [];

    const plugins: InstalledPlugin[] = [];

    for (const category of PLUGIN_CATEGORY_DIRS) {
      const categoryDir = join(pluginsRoot, category);
      if (!existsSync(categoryDir)) continue;

      const entries = readdirSync(categoryDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pkgPath = join(categoryDir, entry.name, 'package.json');
        if (!existsSync(pkgPath)) continue;

        try {
          const raw = readFileSync(pkgPath, 'utf-8');
          const pkg = JSON.parse(raw) as {
            name?: string;
            version?: string;
            description?: string;
          };

          if (typeof pkg.name === 'string' && pkg.name.startsWith('@tinyclaw/plugin-')) {
            plugins.push({
              id: pkg.name,
              name: pkg.description?.replace(/plugin for Tiny Claw/i, '').trim() || entry.name,
              version: pkg.version || '0.0.0',
            });
          }
        } catch {
          // Malformed package.json — skip
        }
      }
    }

    return plugins;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cache I/O
// ---------------------------------------------------------------------------

function getCachePath(dataDir: string): string {
  return join(dataDir, 'data', CACHE_FILENAME);
}

function readCache(dataDir: string): PluginUpdateInfo | null {
  try {
    const raw = readFileSync(getCachePath(dataDir), 'utf-8');
    const cached = JSON.parse(raw) as PluginUpdateInfo;
    if (
      cached &&
      typeof cached.checkedAt === 'number' &&
      Array.isArray(cached.plugins) &&
      typeof cached.updatableCount === 'number'
    ) {
      return cached;
    }
  } catch {
    // Missing or corrupt — will re-check
  }
  return null;
}

function writeCache(dataDir: string, info: PluginUpdateInfo): void {
  try {
    const dir = join(dataDir, 'data');
    mkdirSync(dir, { recursive: true });
    writeFileSync(getCachePath(dataDir), JSON.stringify(info, null, 2), 'utf-8');
  } catch (err) {
    logger.debug('Failed to write plugin update cache', err);
  }
}

// ---------------------------------------------------------------------------
// Registry fetch
// ---------------------------------------------------------------------------

async function fetchLatestPluginVersion(packageName: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${NPM_REGISTRY_BASE}/${encodeURIComponent(packageName)}/latest`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check all installed plugins for available updates.
 *
 * Scans both official (monorepo) and community (config-registered) plugins.
 *
 * - Returns cached result if still fresh (< 24 hours old).
 * - Otherwise fetches the npm registry for each plugin.
 * - Never throws — returns null on any failure.
 *
 * @param dataDir - The tinyclaw data directory (e.g. `~/.tinyclaw`).
 * @param communityPluginIds - Optional list of community plugin IDs to also check.
 */
export async function checkPluginUpdates(
  dataDir: string,
  communityPluginIds?: string[],
): Promise<PluginUpdateInfo | null> {
  try {
    const officialPlugins = scanInstalledPlugins();
    const communityPlugins = await scanCommunityPlugins(communityPluginIds ?? []);
    const installed = [...officialPlugins, ...communityPlugins];
    if (installed.length === 0) return null;

    // Return cached result if still fresh AND the plugin set hasn't changed.
    // Adding or removing a plugin busts the cache so the new plugin is checked.
    const cached = readCache(dataDir);
    const cachedIds = new Set(cached?.plugins.map((p) => p.id) ?? []);
    const installedIds = new Set(installed.map((p) => p.id));
    const samePluginSet =
      cachedIds.size === installedIds.size && [...installedIds].every((id) => cachedIds.has(id));

    if (cached && samePluginSet && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
      // Re-evaluate against currently installed versions
      const refreshed = cached.plugins.map((cp) => {
        const local = installed.find((ip) => ip.id === cp.id);
        const current = local?.version ?? cp.current;
        return {
          ...cp,
          current,
          updateAvailable: isNewerVersion(current, cp.latest),
        };
      });
      const updatableCount = refreshed.filter((p) => p.updateAvailable).length;
      return { ...cached, plugins: refreshed, updatableCount };
    }

    // Fetch latest versions from npm (parallel, with individual timeouts)
    const results: PluginVersionInfo[] = await Promise.all(
      installed.map(async (plugin) => {
        const latest = await fetchLatestPluginVersion(plugin.id);
        return {
          id: plugin.id,
          name: plugin.name,
          current: plugin.version,
          latest: latest ?? plugin.version,
          updateAvailable: latest ? isNewerVersion(plugin.version, latest) : false,
        };
      }),
    );

    const runtime = detectRuntime();
    const info: PluginUpdateInfo = {
      plugins: results,
      updatableCount: results.filter((p) => p.updateAvailable).length,
      runtime,
      checkedAt: Date.now(),
    };

    writeCache(dataDir, info);

    if (info.updatableCount > 0) {
      logger.info(
        'Plugin updates available',
        {
          count: info.updatableCount,
          plugins: results
            .filter((p) => p.updateAvailable)
            .map((p) => `${p.id}@${p.current} → ${p.latest}`),
        },
        { emoji: '🔌' },
      );
    }

    return info;
  } catch (err) {
    logger.debug('Plugin update check failed', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// System prompt context builder
// ---------------------------------------------------------------------------

/**
 * Build a system prompt section that informs the agent about available
 * plugin updates. Returns an empty string if no updates are available.
 */
export function buildPluginUpdateContext(info: PluginUpdateInfo | null): string {
  if (!info || info.updatableCount === 0) return '';

  const updatable = info.plugins.filter((p) => p.updateAvailable);

  const pluginLines = updatable
    .map((p) => {
      const safeName = sanitizePackageName(p.id);
      const safeCurrent = sanitizeVersion(p.current);
      const safeLatest = sanitizeVersion(p.latest);
      return `- **${safeName}**: ${safeCurrent} → ${safeLatest}`;
    })
    .join('\n');

  const upgradeInstructions =
    info.runtime === 'npm'
      ? `Since you are running as an npm global install, you can upgrade plugins using the shell tool:
${updatable.map((p) => `\`bun install -g ${sanitizePackageName(p.id)}@latest\``).join('\n')}
After upgrading, request a restart using the tinyclaw_restart tool.`
      : info.runtime === 'docker'
        ? `Since you are running inside a Docker container, plugin updates are included in the new image.
Instruct the owner to pull the latest image and restart the container.`
        : `Since you are running from source, instruct the owner to update and rebuild:
\`git pull && bun install && bun run build:plugins\`
Then restart using the tinyclaw_restart tool.`;

  return `

## Plugin Updates Available
${pluginLines}

${upgradeInstructions}

**Behavior guidelines:**
- Mention plugin updates naturally when relevant, but do not interrupt ongoing tasks.
- Do not repeat the plugin update reminder if the owner has already acknowledged or dismissed it.
- Plugin updates are separate from core Tiny Claw updates — both should be kept current.`;
}
