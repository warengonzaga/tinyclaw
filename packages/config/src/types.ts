/**
 * Config Module - Type Definitions
 *
 * Types for the Tiny Claw configuration management system powered by
 * @wgtechlabs/config-engine. Provides persistent, Zod-validated
 * SQLite-backed storage for agent configuration.
 */

import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '@tinyclaw/core';
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
 * Full Tiny Claw configuration schema.
 * Validated on every `.set()` call via config-engine's built-in Zod support.
 */
export const TinyClawConfigSchema = z
  .object({
    /** Owner authority — set during first-time claim flow */
    owner: z
      .object({
        /** The userId of the instance owner */
        ownerId: z.string().optional(),
        /** SHA-256 hash of the persistent session token */
        sessionTokenHash: z.string().optional(),
        /** Timestamp when ownership was claimed */
        claimedAt: z.number().optional(),
        /** Base32 TOTP secret used for owner login */
        totpSecret: z.string().optional(),
        /** Backup recovery code hashes (SHA-256) */
        backupCodeHashes: z.array(z.string()).optional(),
        /** Number of remaining backup codes */
        backupCodesRemaining: z.number().int().nonnegative().optional(),
        /** SHA-256 hash of the recovery token (required alongside backup codes) */
        recoveryTokenHash: z.string().optional(),
        /** Timestamp when owner MFA was configured */
        mfaConfiguredAt: z.number().optional(),
      })
      .optional(),

    /** Provider configurations keyed by provider name */
    providers: z
      .object({
        starterBrain: ProviderEntrySchema.optional(),
        primary: ProviderEntrySchema.optional(),
      })
      .passthrough()
      .optional(),

    /** Channel configurations (telegram, discord, slack, etc.) */
    channels: z
      .object({
        telegram: z
          .object({
            enabled: z.boolean().optional(),
            tokenRef: z.string().optional(),
          })
          .optional(),
        discord: z
          .object({
            enabled: z.boolean().optional(),
            tokenRef: z.string().optional(),
          })
          .optional(),
        slack: z
          .object({
            enabled: z.boolean().optional(),
            tokenRef: z.string().optional(),
          })
          .optional(),
      })
      .passthrough()
      .optional(),

    /** Security settings */
    security: z
      .object({
        rateLimit: z
          .object({
            maxRequests: z.number().int().positive().optional(),
            windowMs: z.number().int().positive().optional(),
          })
          .optional(),
      })
      .optional(),

    /** Learning engine settings */
    learning: z
      .object({
        enabled: z.boolean().optional(),
        minConfidence: z.number().min(0).max(1).optional(),
      })
      .optional(),

    /** Heartware settings */
    heartware: z
      .object({
        templateDir: z.string().optional(),
        autoLoad: z.boolean().optional(),
      })
      .optional(),

    /** Agent identity and workspace settings */
    agent: z
      .object({
        name: z.string().optional(),
        identity: z.string().optional(),
        workspace: z.string().optional(),
        defaultModel: z.string().optional(),
      })
      .optional(),

    /** Plugin system settings */
    plugins: z
      .object({
        enabled: z.array(z.string()).optional(),
      })
      .optional(),

    /** Smart routing settings */
    routing: z
      .object({
        /** Maps query complexity tiers to provider IDs */
        tierMapping: z
          .object({
            simple: z.string().optional(),
            moderate: z.string().optional(),
            complex: z.string().optional(),
            reasoning: z.string().optional(),
          })
          .optional(),
      })
      .optional(),

    /** Logging settings */
    logging: z
      .object({
        /** Log level: 'debug' | 'info' | 'warn' | 'error' | 'silent'. Default: 'info' */
        level: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
      })
      .optional(),

    /** Compaction settings */
    compaction: z
      .object({
        /** Message count threshold to trigger compaction. Default: 60 */
        threshold: z.number().int().positive().optional(),
        /** Number of recent messages to keep after compaction. Default: 20 */
        keepRecent: z.number().int().positive().optional(),
        /** Token budgets per summary tier */
        tierBudgets: z
          .object({
            l0: z.number().int().positive().optional(),
            l1: z.number().int().positive().optional(),
            l2: z.number().int().positive().optional(),
          })
          .optional(),
        /** Near-duplicate message detection */
        dedup: z
          .object({
            enabled: z.boolean().optional(),
            similarityThreshold: z.number().min(0).max(1).optional(),
          })
          .optional(),
        /** Pre-compression rules before LLM summarization */
        preCompression: z
          .object({
            stripEmoji: z.boolean().optional(),
            removeDuplicateLines: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),

    /** Nudge / proactive messaging settings */
    nudge: z
      .object({
        /** Master switch — disables all nudges when false. Default: true */
        enabled: z.boolean().optional(),
        /** Quiet hours start (24h format, e.g. '22:00'). */
        quietHoursStart: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
        /** Quiet hours end (24h format, e.g. '08:00'). */
        quietHoursEnd: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
        /** Max nudges per hour. Default: 5 */
        maxPerHour: z.number().int().positive().optional(),
        /** Categories to suppress (opt-out). */
        suppressedCategories: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .passthrough();

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
      model: DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL,
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
    name: 'Tiny Claw',
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
  logging: {
    level: 'info',
  },
  compaction: {
    threshold: 60,
    keepRecent: 20,
  },
};
