/**
 * Config Manager
 *
 * Wraps @wgtechlabs/config-engine to provide persistent configuration
 * storage for TinyClaw. Configuration is stored as a SQLite database
 * at ~/.tinyclaw/config.db by default.
 *
 * Non-sensitive settings only — API keys and tokens belong in
 * secrets-engine via the SecretsManager.
 *
 * Configuration sections use dot-notation:
 *   - providers.starterBrain.model
 *   - learning.enabled
 *   - agent.name
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigEngine } from '@wgtechlabs/config-engine';
import type { Unsubscribe, ChangeCallback, AnyChangeCallback } from '@wgtechlabs/config-engine';
import { logger } from '../logger.js';
import {
  TinyClawConfigSchema,
  CONFIG_DEFAULTS,
} from './types.js';
import type {
  TinyClawConfigData,
  ConfigManagerConfig,
  ConfigManagerInterface,
} from './types.js';

export class ConfigManager implements ConfigManagerInterface {
  private engine: ConfigEngine<TinyClawConfigData>;

  private constructor(engine: ConfigEngine<TinyClawConfigData>) {
    this.engine = engine;
  }

  /**
   * Factory method — opens or creates the config database
   *
   * @param config - Optional config with explicit storage directory
   * @returns Initialized ConfigManager
   */
  static async create(config?: ConfigManagerConfig): Promise<ConfigManager> {
    const cwd = config?.cwd ?? join(homedir(), '.tinyclaw');

    const engine = await ConfigEngine.open<TinyClawConfigData>({
      projectName: 'tinyclaw',
      cwd,
      configName: 'config',
      defaults: CONFIG_DEFAULTS,
      schema: TinyClawConfigSchema,
      flushStrategy: 'batched',
      accessPropertiesByDotNotation: true,
    });

    logger.debug('Config engine opened', { configPath: engine.path });
    return new ConfigManager(engine);
  }

  /**
   * Get a config value by dot-notation key
   *
   * @param key - Dot-notation key (e.g., "agent.name", "learning.enabled")
   * @param defaultValue - Fallback value if the key doesn't exist
   * @returns The config value or defaultValue
   */
  get<V = unknown>(key: string, defaultValue?: V): V | undefined {
    return this.engine.get(key, defaultValue) as V | undefined;
  }

  /**
   * Check if a config key exists
   *
   * @param key - Dot-notation key
   * @returns true if the key exists
   */
  has(key: string): boolean {
    return this.engine.has(key);
  }

  /**
   * Set a config value or multiple values at once.
   * All values are validated against the Zod schema.
   *
   * @param keyOrObject - Dot-notation key string, or a partial config object
   * @param value - The value to set (when first arg is a key string)
   */
  set(keyOrObject: string | Partial<TinyClawConfigData>, value?: unknown): void {
    if (typeof keyOrObject === 'string') {
      this.engine.set(keyOrObject, value);
      logger.debug('Config set', { key: keyOrObject });
    } else {
      this.engine.set(keyOrObject);
      logger.debug('Config set (batch)', { keys: Object.keys(keyOrObject) });
    }
  }

  /**
   * Delete a config key
   *
   * @param key - Dot-notation key to remove
   */
  delete(key: string): void {
    this.engine.delete(key);
    logger.debug('Config deleted', { key });
  }

  /**
   * Reset specific keys to their default values
   *
   * @param keys - One or more dot-notation keys to reset
   */
  reset(...keys: string[]): void {
    this.engine.reset(...keys);
    logger.debug('Config reset', { keys });
  }

  /**
   * Clear all config values and restore defaults
   */
  clear(): void {
    this.engine.clear();
    logger.debug('Config cleared');
  }

  /**
   * Get the full config snapshot as a typed object
   */
  get store(): TinyClawConfigData {
    return this.engine.store;
  }

  /**
   * Get the number of top-level config entries
   */
  get size(): number {
    return this.engine.size;
  }

  /**
   * Get the absolute path to the config database file
   */
  get path(): string {
    return this.engine.path;
  }

  /**
   * Watch a specific key for changes
   *
   * @param key - Dot-notation key to watch
   * @param callback - Called with (newValue, oldValue) on change
   * @returns Unsubscribe function
   */
  onDidChange<V = unknown>(key: string, callback: ChangeCallback<V>): Unsubscribe {
    return this.engine.onDidChange(key, callback as ChangeCallback<unknown>);
  }

  /**
   * Watch the entire config for any change
   *
   * @param callback - Called with (newStore, oldStore) on change
   * @returns Unsubscribe function
   */
  onDidAnyChange(callback: AnyChangeCallback<TinyClawConfigData>): Unsubscribe {
    return this.engine.onDidAnyChange(callback);
  }

  /**
   * Close the underlying config engine connection.
   * Flushes pending writes before closing.
   */
  close(): void {
    this.engine.close();
    logger.debug('Config engine closed');
  }
}
