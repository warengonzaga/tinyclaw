/**
 * Plugin Loader
 *
 * Discovers installed TinyClaw plugins by dynamically importing package names
 * from the `plugins.enabled` config array, validates them, and returns them
 * grouped by type.
 *
 * Discovery is config-driven (not filesystem-based) so plugins explicitly
 * opt in via their pairing flow. Import failures are non-fatal — logged and
 * skipped so the rest of the system boots normally.
 */

import { logger } from './logger.js';
import type {
  TinyClawPlugin,
  ChannelPlugin,
  ProviderPlugin,
  ToolsPlugin,
} from './types.js';
import type { ConfigManagerInterface } from './config/types.js';

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
export async function loadPlugins(
  configManager: ConfigManagerInterface,
): Promise<LoadedPlugins> {
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
      logger.warn(
        `Failed to load plugin "${id}": ${(err as Error).message}`,
      );
    }
  }

  return result;
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
