/**
 * Tests for the config Zod schema and defaults.
 *
 * Validates that the TinyClawConfigSchema correctly accepts valid data,
 * rejects invalid data, and that CONFIG_DEFAULTS pass validation.
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '@tinyclaw/core';
import { CONFIG_DEFAULTS, TinyClawConfigSchema } from '../src/types.js';

// -----------------------------------------------------------------------
// Defaults validation
// -----------------------------------------------------------------------

describe('CONFIG_DEFAULTS', () => {
  test('defaults pass schema validation', () => {
    const result = TinyClawConfigSchema.safeParse(CONFIG_DEFAULTS);
    expect(result.success).toBe(true);
  });

  test('defaults include all expected sections', () => {
    expect(CONFIG_DEFAULTS.providers).toBeDefined();
    expect(CONFIG_DEFAULTS.channels).toBeDefined();
    expect(CONFIG_DEFAULTS.security).toBeDefined();
    expect(CONFIG_DEFAULTS.learning).toBeDefined();
    expect(CONFIG_DEFAULTS.heartware).toBeDefined();
    expect(CONFIG_DEFAULTS.agent).toBeDefined();
  });

  test('defaults have correct starter brain config', () => {
    expect(CONFIG_DEFAULTS.providers?.starterBrain?.model).toBe(DEFAULT_MODEL);
    expect(CONFIG_DEFAULTS.providers?.starterBrain?.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  test('defaults have correct learning config', () => {
    expect(CONFIG_DEFAULTS.learning?.enabled).toBe(true);
    expect(CONFIG_DEFAULTS.learning?.minConfidence).toBe(0.7);
  });

  test('defaults have correct agent name', () => {
    expect(CONFIG_DEFAULTS.agent?.name).toBe('Tiny Claw');
  });
});

// -----------------------------------------------------------------------
// Schema — valid data
// -----------------------------------------------------------------------

describe('TinyClawConfigSchema — valid data', () => {
  test('accepts empty object', () => {
    const result = TinyClawConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('accepts full valid config', () => {
    const result = TinyClawConfigSchema.safeParse({
      providers: {
        starterBrain: {
          model: 'llama3.2:3b',
          baseUrl: 'http://localhost:11434',
        },
        primary: {
          model: 'gpt-4',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyRef: 'provider.openai.apiKey',
        },
      },
      channels: {
        telegram: { enabled: true, tokenRef: 'channel.telegram.token' },
        discord: { enabled: false },
        slack: { enabled: false },
      },
      security: {
        rateLimit: { maxRequests: 100, windowMs: 60000 },
      },
      learning: {
        enabled: true,
        minConfidence: 0.8,
      },
      heartware: {
        templateDir: '/custom/templates',
        autoLoad: false,
      },
      agent: {
        name: 'TestAgent',
        identity: 'A helpful test assistant',
        workspace: '/tmp/test-workspace',
        defaultModel: 'llama3.2:3b',
      },
    });
    expect(result.success).toBe(true);
  });

  test('accepts partial config (only agent)', () => {
    const result = TinyClawConfigSchema.safeParse({
      agent: { name: 'MinimalBot' },
    });
    expect(result.success).toBe(true);
  });

  test('accepts unknown top-level keys (passthrough)', () => {
    const result = TinyClawConfigSchema.safeParse({
      agent: { name: 'Test' },
      customPlugin: { enabled: true },
    });
    expect(result.success).toBe(true);
  });

  test('accepts unknown provider keys (passthrough)', () => {
    const result = TinyClawConfigSchema.safeParse({
      providers: {
        starterBrain: { model: 'llama3.2:3b' },
        customProvider: { model: 'custom-model' },
      },
    });
    expect(result.success).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Schema — invalid data
// -----------------------------------------------------------------------

describe('TinyClawConfigSchema — invalid data', () => {
  test('rejects invalid baseUrl (not a URL)', () => {
    const result = TinyClawConfigSchema.safeParse({
      providers: {
        starterBrain: { baseUrl: 'not-a-url' },
      },
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid minConfidence (out of range)', () => {
    const result = TinyClawConfigSchema.safeParse({
      learning: { minConfidence: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  test('rejects negative minConfidence', () => {
    const result = TinyClawConfigSchema.safeParse({
      learning: { minConfidence: -0.1 },
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-positive maxRequests', () => {
    const result = TinyClawConfigSchema.safeParse({
      security: { rateLimit: { maxRequests: 0 } },
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-integer maxRequests', () => {
    const result = TinyClawConfigSchema.safeParse({
      security: { rateLimit: { maxRequests: 10.5 } },
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-boolean enabled in learning', () => {
    const result = TinyClawConfigSchema.safeParse({
      learning: { enabled: 'yes' },
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-boolean enabled in channel', () => {
    const result = TinyClawConfigSchema.safeParse({
      channels: { telegram: { enabled: 'true' } },
    });
    expect(result.success).toBe(false);
  });
});
