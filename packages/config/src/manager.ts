/**
 * Config Manager
 *
 * Wraps @wgtechlabs/config-engine to provide persistent configuration
 * storage for TinyClaw. Configuration is stored as a SQLite database
 * at ~/.tinyclaw/data/config.db by default.
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
import { logger } from '@tinyclaw/logger';
import type { ConfigManagerConfig, ConfigManagerInterface } from '@tinyclaw/types';
import {
  TinyClawConfigSchema,
  CONFIG_DEFAULTS,
} from './types.js';
import type { TinyClawConfigData } from './types.js';

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
    const cwd = config?.cwd ?? join(homedir(), '.tinyclaw', 'data');

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

  get<V = unknown>(key: string, defaultValue?: V): V | undefined {
    return this.engine.get(key, defaultValue) as V | undefined;
  }

  has(key: string): boolean {
    return this.engine.has(key);
  }

  set(keyOrObject: string | Partial<TinyClawConfigData>, value?: unknown): void {
    if (typeof keyOrObject === 'string') {
      this.engine.set(keyOrObject, value);
      logger.debug('Config set', { key: keyOrObject });
    } else {
      this.engine.set(keyOrObject);
      logger.debug('Config set (batch)', { keys: Object.keys(keyOrObject) });
    }
  }

  delete(key: string): void {
    this.engine.delete(key);
    logger.debug('Config deleted', { key });
  }

  reset(...keys: string[]): void {
    this.engine.reset(...keys);
    logger.debug('Config reset', { keys });
  }

  clear(): void {
    this.engine.clear();
    logger.debug('Config cleared');
  }

  get store(): TinyClawConfigData {
    return this.engine.store;
  }

  get size(): number {
    return this.engine.size;
  }

  get path(): string {
    return this.engine.path;
  }

  onDidChange<V = unknown>(key: string, callback: ChangeCallback<V>): Unsubscribe {
    return this.engine.onDidChange(key, callback as ChangeCallback<unknown>);
  }

  onDidAnyChange(callback: AnyChangeCallback<TinyClawConfigData>): Unsubscribe {
    return this.engine.onDidAnyChange(callback);
  }

  close(): void {
    this.engine.close();
    logger.debug('Config engine closed');
  }
}
