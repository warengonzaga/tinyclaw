/**
 * Tests for Discord pairing tools (discord_pair / discord_unpair).
 *
 * Validates token storage, config writes, plugin-list deduplication,
 * error handling, and the unpair cleanup flow.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import type { ConfigManagerInterface, SecretsManagerInterface, Tool } from '@tinyclaw/types';
import {
  createDiscordPairingTools,
  DISCORD_ENABLED_CONFIG_KEY,
  DISCORD_PLUGIN_ID,
  DISCORD_TOKEN_SECRET_KEY,
} from '../src/pairing.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockSecrets(): SecretsManagerInterface & { stored: Map<string, string> } {
  const stored = new Map<string, string>();
  return {
    stored,
    async store(key: string, value: string) {
      stored.set(key, value);
    },
    async check(key: string) {
      return stored.has(key);
    },
    async retrieve(key: string) {
      return stored.get(key) ?? null;
    },
    async list(_pattern?: string) {
      return Array.from(stored.keys());
    },
    async resolveProviderKey(_provider: string) {
      return null;
    },
    async close() {},
  };
}

function createMockConfig(): ConfigManagerInterface & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get<V = unknown>(key: string, defaultValue?: V): V | undefined {
      return (data[key] as V) ?? defaultValue;
    },
    has(key: string) {
      return key in data;
    },
    set(keyOrObj: string | Record<string, unknown>, value?: unknown) {
      if (typeof keyOrObj === 'string') {
        data[keyOrObj] = value;
      } else {
        Object.assign(data, keyOrObj);
      }
    },
    delete(key: string) {
      delete data[key];
    },
    reset() {},
    clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
    get store() {
      return { ...data };
    },
    get size() {
      return Object.keys(data).length;
    },
    get path() {
      return ':memory:';
    },
    onDidChange() {
      return () => {};
    },
    onDidAnyChange() {
      return () => {};
    },
    close() {},
  };
}

function findTool(tools: Tool[], name: string): Tool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createDiscordPairingTools', () => {
  let secrets: ReturnType<typeof createMockSecrets>;
  let config: ReturnType<typeof createMockConfig>;
  let tools: Tool[];

  beforeEach(() => {
    secrets = createMockSecrets();
    config = createMockConfig();
    tools = createDiscordPairingTools(secrets, config);
  });

  test('returns two tools', () => {
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['discord_pair', 'discord_unpair']);
  });

  // -----------------------------------------------------------------------
  // discord_pair
  // -----------------------------------------------------------------------
  describe('discord_pair', () => {
    test('stores token in secrets and enables config', async () => {
      const tool = findTool(tools, 'discord_pair');
      const result = await tool.execute({ token: 'my-bot-token' });

      // Token stored
      expect(secrets.stored.get(DISCORD_TOKEN_SECRET_KEY)).toBe('my-bot-token');

      // Config enabled
      expect(config.data[DISCORD_ENABLED_CONFIG_KEY]).toBe(true);
      expect(config.data['channels.discord.tokenRef']).toBe(DISCORD_TOKEN_SECRET_KEY);

      // Plugin added to enabled list
      const enabled = config.data['plugins.enabled'] as string[];
      expect(enabled).toContain(DISCORD_PLUGIN_ID);

      // Success message
      expect(result).toContain('paired successfully');
    });

    test('trims whitespace from token', async () => {
      const tool = findTool(tools, 'discord_pair');
      await tool.execute({ token: '  spaced-token  ' });

      expect(secrets.stored.get(DISCORD_TOKEN_SECRET_KEY)).toBe('spaced-token');
    });

    test('rejects empty token', async () => {
      const tool = findTool(tools, 'discord_pair');
      const result = await tool.execute({ token: '' });

      expect(result).toContain('Error');
      expect(secrets.stored.size).toBe(0);
    });

    test('rejects whitespace-only token', async () => {
      const tool = findTool(tools, 'discord_pair');
      const result = await tool.execute({ token: '   ' });

      expect(result).toContain('Error');
      expect(secrets.stored.size).toBe(0);
    });

    test('deduplicates plugin in enabled list', async () => {
      // Pre-populate the enabled list with the plugin
      config.data['plugins.enabled'] = [DISCORD_PLUGIN_ID];

      const tool = findTool(tools, 'discord_pair');
      await tool.execute({ token: 'token-123' });

      const enabled = config.data['plugins.enabled'] as string[];
      const count = enabled.filter((id) => id === DISCORD_PLUGIN_ID).length;
      expect(count).toBe(1);
    });

    test('preserves other plugins in enabled list', async () => {
      config.data['plugins.enabled'] = ['@tinyclaw/plugin-other'];

      const tool = findTool(tools, 'discord_pair');
      await tool.execute({ token: 'token-123' });

      const enabled = config.data['plugins.enabled'] as string[];
      expect(enabled).toContain('@tinyclaw/plugin-other');
      expect(enabled).toContain(DISCORD_PLUGIN_ID);
    });

    test('handles secrets.store failure gracefully', async () => {
      secrets.store = async () => {
        throw new Error('disk full');
      };

      const tool = findTool(tools, 'discord_pair');
      const result = await tool.execute({ token: 'token-123' });

      expect(result).toContain('Error pairing Discord');
      expect(result).toContain('disk full');
    });
  });

  // -----------------------------------------------------------------------
  // discord_unpair
  // -----------------------------------------------------------------------
  describe('discord_unpair', () => {
    test('disables the plugin in config', async () => {
      config.data[DISCORD_ENABLED_CONFIG_KEY] = true;
      config.data['plugins.enabled'] = [DISCORD_PLUGIN_ID];

      const tool = findTool(tools, 'discord_unpair');
      const result = await tool.execute({});

      expect(config.data[DISCORD_ENABLED_CONFIG_KEY]).toBe(false);
      expect(result).toContain('disabled');
    });

    test('removes plugin from enabled list', async () => {
      config.data['plugins.enabled'] = ['@tinyclaw/other', DISCORD_PLUGIN_ID];

      const tool = findTool(tools, 'discord_unpair');
      await tool.execute({});

      const enabled = config.data['plugins.enabled'] as string[];
      expect(enabled).not.toContain(DISCORD_PLUGIN_ID);
      expect(enabled).toContain('@tinyclaw/other');
    });

    test('handles empty plugins.enabled list', async () => {
      const tool = findTool(tools, 'discord_unpair');
      const result = await tool.execute({});

      expect(config.data[DISCORD_ENABLED_CONFIG_KEY]).toBe(false);
      expect(result).toContain('disabled');
    });

    test('keeps token in secrets (does not delete)', async () => {
      secrets.stored.set(DISCORD_TOKEN_SECRET_KEY, 'old-token');
      config.data['plugins.enabled'] = [DISCORD_PLUGIN_ID];

      const tool = findTool(tools, 'discord_unpair');
      await tool.execute({});

      // Token should still be there
      expect(secrets.stored.has(DISCORD_TOKEN_SECRET_KEY)).toBe(true);
    });
  });
});

describe('exported constants', () => {
  test('DISCORD_TOKEN_SECRET_KEY follows channel naming convention', () => {
    expect(DISCORD_TOKEN_SECRET_KEY).toBe('channel.discord.token');
  });

  test('DISCORD_ENABLED_CONFIG_KEY matches config schema', () => {
    expect(DISCORD_ENABLED_CONFIG_KEY).toBe('channels.discord.enabled');
  });

  test('DISCORD_PLUGIN_ID is the npm package name', () => {
    expect(DISCORD_PLUGIN_ID).toBe('@tinyclaw/plugin-channel-discord');
  });
});
