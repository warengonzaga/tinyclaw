/**
 * Secrets Public API
 *
 * TinyClaw's encrypted secrets management powered by @wgtechlabs/secrets-engine.
 * Provides machine-bound AES-256-GCM encryption for API keys and other secrets.
 *
 * @example
 * ```typescript
 * import { SecretsManager, createSecretsTools } from '@tinyclaw/core';
 *
 * // Initialize secrets manager (uses ~/.secrets-engine/ by default)
 * const secretsManager = await SecretsManager.create();
 *
 * // Store a provider API key
 * await secretsManager.store('provider.ollama.apiKey', 'sk-...');
 *
 * // Resolve a provider key by name
 * const apiKey = await secretsManager.resolveProviderKey('ollama');
 *
 * // Create agent tools
 * const tools = createSecretsTools(secretsManager);
 * ```
 */

// Core exports
export { SecretsManager } from './manager.js';
export { createSecretsTools } from './tools.js';

// Types
export type { SecretsConfig, SecretsManagerInterface } from './types.js';
export { buildProviderKeyName, SECRET_KEY_PREFIXES } from './types.js';
