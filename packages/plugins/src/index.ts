/**
 * Plugin Loader
 *
 * Discovers installed Tiny Claw plugins by dynamically importing package names
 * from the `plugins.enabled` config array, validates them, and returns them
 * grouped by type.
 *
 * Discovery is config-driven (not filesystem-based) so plugins explicitly
 * opt in via their pairing flow. Import failures are non-fatal — logged and
 * skipped so the rest of the system boots normally.
 *
 * Pairing-tool discovery scans the monorepo `plugins/` directories at runtime
 * so new plugins are picked up automatically without code changes.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@tinyclaw/logger';
import type {
  ChannelPlugin,
  ConfigManagerInterface,
  ProviderPlugin,
  SecretsManagerInterface,
  TinyClawPlugin,
  Tool,
  ToolsPlugin,
} from '@tinyclaw/types';

export interface LoadedPlugins {
  channels: ChannelPlugin[];
  providers: ProviderPlugin[];
  tools: ToolsPlugin[];
}

/**
 * Load all enabled plugins.
 *
 * @param configManager - Used to read the `plugins.enabled` list
 * @returns Grouped loaded plugin instances
 */
export async function loadPlugins(configManager: ConfigManagerInterface): Promise<LoadedPlugins> {
  const result: LoadedPlugins = { channels: [], providers: [], tools: [] };

  const enabledIds = configManager.get<string[]>('plugins.enabled') ?? [];

  if (enabledIds.length === 0) {
    logger.info('No plugins configured');
    return result;
  }

  logger.info('Loading plugins', { count: enabledIds.length, ids: enabledIds });

  for (const id of enabledIds) {
    try {
      const mod = await import(id);
      const plugin = mod.default as TinyClawPlugin | undefined;

      if (!plugin || typeof plugin !== 'object') {
        logger.warn(`Plugin "${id}" has no default export — skipping`);
        continue;
      }

      if (!isValidPlugin(plugin)) {
        logger.warn(`Plugin "${id}" failed validation — skipping`);
        continue;
      }

      switch (plugin.type) {
        case 'channel':
          result.channels.push(plugin as ChannelPlugin);
          logger.info(`Loaded channel plugin: ${plugin.name} (${plugin.id})`);
          break;
        case 'provider':
          result.providers.push(plugin as ProviderPlugin);
          logger.info(`Loaded provider plugin: ${plugin.name} (${plugin.id})`);
          break;
        case 'tools':
          result.tools.push(plugin as ToolsPlugin);
          logger.info(`Loaded tools plugin: ${plugin.name} (${plugin.id})`);
          break;
        default:
          logger.warn(`Plugin "${id}" has unknown type — skipping`);
      }
    } catch (err) {
      logger.warn(`Failed to load plugin "${id}": ${(err as Error).message}`);
    }
  }

  return result;
}

/**
 * Directories inside the monorepo `plugins/` folder that contain plugin
 * packages (each sub-folder must have a `package.json` with a `name` field).
 */
const PLUGIN_CATEGORY_DIRS = ['channel', 'provider'] as const;

/**
 * Scan the workspace `plugins/` directories and return all plugin package IDs.
 *
 * Walks `plugins/channel/*` and `plugins/provider/*`, reads each `package.json`,
 * and collects the `name` field. This way new plugins added to the monorepo
 * are discovered automatically — no hardcoded list to maintain.
 *
 * Works for all deployment types:
 * - **Source / dev**: scans the `plugins/` directory from the workspace root
 * - **Docker**: same — `plugins/` is copied into the image
 * - **npm global install**: `plugins/` won't exist, returns empty array
 *   (npm-installed plugins are resolved via dynamic `import()` at pairing
 *   time, once they're added to `plugins.enabled`)
 */
function scanInstalledPluginIds(): string[] {
  try {
    // Resolve monorepo root: this file lives at packages/plugins/src/index.ts
    // (or packages/plugins/dist/index.js after build), so root is 3 levels up.
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const workspaceRoot = join(thisDir, '..', '..', '..');
    const pluginsRoot = join(workspaceRoot, 'plugins');

    if (!existsSync(pluginsRoot)) {
      logger.debug('Plugin scan: plugins/ directory not found — no discoverable plugins');
      return [];
    }

    const ids: string[] = [];

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
          const pkg = JSON.parse(raw) as { name?: string };

          if (typeof pkg.name === 'string' && pkg.name.startsWith('@tinyclaw/plugin-')) {
            ids.push(pkg.name);
          }
        } catch {
          // Malformed package.json — skip silently
        }
      }
    }

    logger.debug('Plugin scan: discovered plugins', { ids });
    return ids;
  } catch {
    logger.debug('Plugin scan failed — no discoverable plugins');
    return [];
  }
}

/**
 * Discover pairing tools from all installed plugins — not just enabled ones.
 *
 * This solves the chicken-and-egg problem: pairing tools (e.g. `discord_pair`)
 * must be available to the agent *before* the plugin is enabled, otherwise the
 * agent has no way to activate plugins conversationally.
 *
 * Only pairing tools are extracted here; full plugin lifecycle (start/stop) is
 * still gated by `plugins.enabled` via `loadPlugins()`.
 *
 * @param enabledIds - IDs already in `plugins.enabled` (their tools are loaded
 *   separately via loadPlugins — we skip them here to avoid duplicates)
 * @param secrets - SecretsManager for pairing tools that need it
 * @param configManager - ConfigManager for pairing tools that need it
 * @returns Array of pairing tools from not-yet-enabled plugins
 */
export async function discoverPairingTools(
  enabledIds: string[],
  secrets: SecretsManagerInterface,
  configManager: ConfigManagerInterface,
): Promise<Tool[]> {
  const tools: Tool[] = [];
  const enabledSet = new Set(enabledIds);

  // Collect IDs from both official (monorepo) and community (config) sources
  const officialIds = scanInstalledPluginIds();
  const communityIds = configManager.get<string[]>('plugins.community') ?? [];
  const allPluginIds = [...new Set([...officialIds, ...communityIds])];

  for (const id of allPluginIds) {
    // Skip plugins that are already enabled — their pairing tools are loaded
    // through the normal loadPlugins → getPairingTools path.
    if (enabledSet.has(id)) continue;

    try {
      const mod = await import(id);
      const plugin = mod.default as TinyClawPlugin | undefined;

      if (!plugin || !isValidPlugin(plugin)) continue;

      // Extract pairing tools from channel and provider plugins
      if (
        (plugin.type === 'channel' || plugin.type === 'provider') &&
        'getPairingTools' in plugin &&
        typeof plugin.getPairingTools === 'function'
      ) {
        const pairingTools = plugin.getPairingTools(secrets, configManager);
        if (pairingTools.length > 0) {
          tools.push(...pairingTools);
          const source = communityIds.includes(id) ? 'community' : 'official';
          logger.info(`Discovered pairing tools from: ${plugin.name} (${plugin.id}) [${source}]`, {
            toolNames: pairingTools.map((t) => t.name),
          });
        }
      }
    } catch (err) {
      // Non-fatal — plugin may not be installed in this environment
      logger.debug(`Could not discover plugin "${id}": ${(err as Error).message}`);
    }
  }

  return tools;
}

/** Minimal structural validation for a plugin object. */
function isValidPlugin(obj: unknown): obj is TinyClawPlugin {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.type === 'string' &&
    ['channel', 'provider', 'tools'].includes(p.type as string)
  );
}

export type { CommunityPluginInfo, InstallResult } from './community.js';
// Re-export community plugin management
export {
  getCommunityPlugins,
  installCommunityPlugin,
  listCommunityPlugins,
  removeCommunityPlugin,
  validatePackageName,
} from './community.js';
export type { PluginUpdateInfo, PluginVersionInfo } from './update-checker.js';
// Re-export plugin update checker
export {
  buildPluginUpdateContext,
  checkPluginUpdates,
} from './update-checker.js';
