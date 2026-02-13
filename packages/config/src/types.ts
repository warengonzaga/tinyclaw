/**
 * Config Module - Type Definitions
 *
 * Types for the TinyClaw configuration management system powered by
 * @wgtechlabs/config-engine. Provides persistent, Zod-validated
 * SQLite-backed storage for agent configuration.
 */

import { z } from 'zod';

// Re-export shared interfaces from @tinyclaw/types
export type { ConfigManagerConfig, ConfigManagerInterface } from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Zod Schema
// ---------------------------------------------------------------------------

/**
 * Provider configuration schema.
 * Defines model name, base URL, and a reference key to the API key
 * stored in secrets-engine (never the actual secret).
 */
const ProviderEntrySchema = z.object({
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  apiKeyRef: z.string().optional(),
});

/**
 * Full TinyClaw configuration schema.
 * Validated on every `.set()` call via config-engine's built-in Zod support.
 */
export const TinyClawConfigSchema = z.object({
  /** Provider configurations keyed by provider name */
  providers: z.object({
    starterBrain: ProviderEntrySchema.optional(),
    primary: ProviderEntrySchema.optional(),
  }).passthrough().optional(),

  /** Channel configurations (telegram, discord, slack, etc.) */
  channels: z.object({
    telegram: z.object({
      enabled: z.boolean().optional(),
      tokenRef: z.string().optional(),
    }).optional(),
    discord: z.object({
      enabled: z.boolean().optional(),
      tokenRef: z.string().optional(),
    }).optional(),
    slack: z.object({
      enabled: z.boolean().optional(),
      tokenRef: z.string().optional(),
    }).optional(),
  }).passthrough().optional(),

  /** Security settings */
  security: z.object({
    rateLimit: z.object({
      maxRequests: z.number().int().positive().optional(),
      windowMs: z.number().int().positive().optional(),
    }).optional(),
  }).optional(),

  /** Learning engine settings */
  learning: z.object({
    enabled: z.boolean().optional(),
    minConfidence: z.number().min(0).max(1).optional(),
  }).optional(),

  /** Heartware settings */
  heartware: z.object({
    templateDir: z.string().optional(),
    autoLoad: z.boolean().optional(),
  }).optional(),

  /** Agent identity and workspace settings */
  agent: z.object({
    name: z.string().optional(),
    identity: z.string().optional(),
    workspace: z.string().optional(),
    defaultModel: z.string().optional(),
  }).optional(),

  /** Plugin system settings */
  plugins: z.object({
    enabled: z.array(z.string()).optional(),
  }).optional(),

  /** Smart routing settings */
  routing: z.object({
    /** Maps query complexity tiers to provider IDs */
    tierMapping: z.object({
      simple: z.string().optional(),
      moderate: z.string().optional(),
      complex: z.string().optional(),
      reasoning: z.string().optional(),
    }).optional(),
  }).optional(),
}).passthrough();

/**
 * Inferred TypeScript type from the Zod schema.
 * Use this for type-safe access to configuration values.
 */
export type TinyClawConfigData = z.infer<typeof TinyClawConfigSchema>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Sensible default configuration values.
 * Applied on first open when no existing config is found.
 */
export const CONFIG_DEFAULTS: Partial<TinyClawConfigData> = {
  providers: {
    starterBrain: {
      model: 'gpt-oss:120b-cloud',
      baseUrl: 'https://ollama.com',
    },
  },
  channels: {},
  security: {
    rateLimit: {
      maxRequests: 20,
      windowMs: 60_000,
    },
  },
  learning: {
    enabled: true,
    minConfidence: 0.7,
  },
  heartware: {
    autoLoad: true,
  },
  agent: {
    name: 'TinyClaw',
  },
  plugins: {
    enabled: [],
  },
  routing: {
    tierMapping: {
      simple: 'ollama-cloud',
      moderate: 'ollama-cloud',
      complex: 'ollama-cloud',
      reasoning: 'ollama-cloud',
    },
  },
};
