/**
 * Config Public API
 *
 * Tiny Claw's persistent configuration management powered by @wgtechlabs/config-engine.
 * Provides SQLite-backed, Zod-validated storage for agent settings, provider
 * preferences, channel configurations, and more.
 *
 * Non-sensitive data only — API keys and tokens belong in secrets-engine.
 */

// Core exports
export { ConfigManager } from './manager.js';
export { createConfigTools } from './tools.js';

// Types
export type {
  TinyClawConfigData,
} from './types.js';
export { TinyClawConfigSchema, CONFIG_DEFAULTS } from './types.js';

// Re-export shared types from @tinyclaw/types
export type { ConfigManagerConfig, ConfigManagerInterface } from '@tinyclaw/types';
