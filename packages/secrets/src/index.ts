/**
 * Secrets Public API
 *
 * Tiny Claw's encrypted secrets management powered by @wgtechlabs/secrets-engine.
 * Provides machine-bound AES-256-GCM encryption for API keys and other secrets.
 */

// Core exports
export { SecretsManager } from './manager.js';
export { createSecretsTools } from './tools.js';

// Re-export shared types from @tinyclaw/types
export type { SecretsConfig, SecretsManagerInterface } from '@tinyclaw/types';
export { buildProviderKeyName, buildChannelKeyName, SECRET_KEY_PREFIXES } from '@tinyclaw/types';
