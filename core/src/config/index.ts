/**
 * Config Public API
 *
 * TinyClaw's persistent configuration management powered by @wgtechlabs/config-engine.
 * Provides SQLite-backed, Zod-validated storage for agent settings, provider
 * preferences, channel configurations, and more.
 *
 * Non-sensitive data only — API keys and tokens belong in secrets-engine.
 *
 * @example
 * ```typescript
 * import { ConfigManager, createConfigTools } from '@tinyclaw/core';
 *
 * // Initialize config manager (uses ~/.tinyclaw/config.db by default)
 * const configManager = await ConfigManager.create();
 *
 * // Read agent settings
 * const agentName = configManager.get('agent.name'); // "TinyClaw"
 *
 * // Update a provider model
 * configManager.set('providers.starterBrain.model', 'llama3.2:3b');
 *
 * // Get full config snapshot
 * const snapshot = configManager.store;
 *
 * // Create agent tools
 * const tools = createConfigTools(configManager);
 * ```
 */

// Core exports
export { ConfigManager } from './manager.js';
export { createConfigTools } from './tools.js';

// Types
export type {
  TinyClawConfigData,
  ConfigManagerConfig,
  ConfigManagerInterface,
} from './types.js';
export { TinyClawConfigSchema, CONFIG_DEFAULTS } from './types.js';
