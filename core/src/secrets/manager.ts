/**
 * Secrets Manager
 *
 * Wraps @wgtechlabs/secrets-engine to provide encrypted secret storage
 * for TinyClaw. Secrets are stored in the user's home directory at
 * ~/.secrets-engine/ by default (machine-bound, AES-256-GCM encrypted).
 *
 * Provider API keys follow the naming convention: provider.<name>.apiKey
 */

import { SecretsEngine } from '@wgtechlabs/secrets-engine';
import { logger } from '../logger.js';
import { buildProviderKeyName } from './types.js';
import type { SecretsConfig, SecretsManagerInterface } from './types.js';

export class SecretsManager implements SecretsManagerInterface {
  private engine: SecretsEngine;

  private constructor(engine: SecretsEngine) {
    this.engine = engine;
  }

  /**
   * Factory method — opens or creates the encrypted secrets store
   *
   * @param config - Optional config with explicit path
   * @returns Initialized SecretsManager
   */
  static async create(config?: SecretsConfig): Promise<SecretsManager> {
    const options = config?.path ? { path: config.path } : undefined;
    const engine = await SecretsEngine.open(options);
    logger.debug('Secrets engine opened', { storagePath: engine.storagePath });
    return new SecretsManager(engine);
  }

  /**
   * Store or overwrite a secret
   *
   * @param key - Dot-notation key (e.g., "provider.ollama.apiKey")
   * @param value - Secret value to encrypt and store
   */
  async store(key: string, value: string): Promise<void> {
    await this.engine.set(key, value);
    logger.debug('Secret stored', { key });
  }

  /**
   * Check if a secret exists without decrypting it
   *
   * @param key - Dot-notation key
   * @returns true if the secret exists
   */
  async check(key: string): Promise<boolean> {
    return await this.engine.has(key);
  }

  /**
   * Retrieve a decrypted secret value
   *
   * @param key - Dot-notation key
   * @returns Decrypted value or null if not found
   */
  async retrieve(key: string): Promise<string | null> {
    return await this.engine.get(key);
  }

  /**
   * List secret key names matching an optional glob pattern
   *
   * @param pattern - Glob pattern (e.g., "provider.*")
   * @returns Array of matching key names (never values)
   */
  async list(pattern?: string): Promise<string[]> {
    return await this.engine.keys(pattern);
  }

  /**
   * Convenience method to resolve a provider API key
   *
   * Looks up `provider.<providerName>.apiKey` in the store.
   *
   * @param providerName - Provider identifier (e.g., "ollama", "openai")
   * @returns Decrypted API key or null if not stored
   */
  async resolveProviderKey(providerName: string): Promise<string | null> {
    const key = buildProviderKeyName(providerName);
    return await this.retrieve(key);
  }

  /**
   * Get the number of stored secrets
   */
  get size(): number {
    return this.engine.size;
  }

  /**
   * Get the absolute path to the storage directory
   */
  get storagePath(): string {
    return this.engine.storagePath;
  }

  /**
   * Close the underlying secrets engine connection
   */
  async close(): Promise<void> {
    await this.engine.close();
    logger.debug('Secrets engine closed');
  }
}
