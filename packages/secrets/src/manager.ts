/**
 * Secrets Manager
 *
 * Wraps @wgtechlabs/secrets-engine to provide encrypted secret storage
 * for Tiny Claw. Secrets are stored in the user's home directory at
 * ~/.secrets-engine/ by default (machine-bound, AES-256-GCM encrypted).
 *
 * Provider API keys follow the naming convention: provider.<name>.apiKey
 */

import { SecretsEngine } from '@wgtechlabs/secrets-engine';
import { logger } from '@tinyclaw/logger';
import { buildProviderKeyName } from '@tinyclaw/types';
import type { SecretsConfig, SecretsManagerInterface } from '@tinyclaw/types';

export class SecretsManager implements SecretsManagerInterface {
  private engine: SecretsEngine;

  private constructor(engine: SecretsEngine) {
    this.engine = engine;
  }

  static async create(config?: SecretsConfig): Promise<SecretsManager> {
    const options = config?.path ? { path: config.path } : undefined;
    const engine = await SecretsEngine.open(options);
    logger.debug('Secrets engine opened', { storagePath: engine.storagePath });
    return new SecretsManager(engine);
  }

  async store(key: string, value: string): Promise<void> {
    await this.engine.set(key, value);
    logger.debug('Secret stored', { key });
  }

  async check(key: string): Promise<boolean> {
    return await this.engine.has(key);
  }

  async retrieve(key: string): Promise<string | null> {
    return await this.engine.get(key);
  }

  async list(pattern?: string): Promise<string[]> {
    return await this.engine.keys(pattern);
  }

  async resolveProviderKey(providerName: string): Promise<string | null> {
    const key = buildProviderKeyName(providerName);
    return await this.retrieve(key);
  }

  get size(): number {
    return this.engine.size;
  }

  get storagePath(): string {
    return this.engine.storagePath;
  }

  async close(): Promise<void> {
    await this.engine.close();
    logger.debug('Secrets engine closed');
  }
}
