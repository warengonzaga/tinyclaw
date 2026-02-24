/**
 * Tests for Telegram pairing tools (telegram_pair / telegram_unpair).
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import type { Tool, SecretsManagerInterface, ConfigManagerInterface } from '@tinyclaw/types';
import {
  createTelegramPairingTools,
  TELEGRAM_TOKEN_SECRET_KEY,
  TELEGRAM_ENABLED_CONFIG_KEY,
  TELEGRAM_PLUGIN_ID,
} from '../src/pairing.js';

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

describe('createTelegramPairingTools', () => {
  let secrets: ReturnType<typeof createMockSecrets>;
  let config: ReturnType<typeof createMockConfig>;
  let tools: Tool[];

  beforeEach(() => {
    secrets = createMockSecrets();
    config = createMockConfig();
    tools = createTelegramPairingTools(secrets, config);
  });

  test('returns two tools', () => {
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['telegram_pair', 'telegram_unpair']);
  });

  describe('telegram_pair', () => {
    test('stores token in secrets and enables config', async () => {
      const tool = findTool(tools, 'telegram_pair');
      const result = await tool.execute({ token: 'my-bot-token' });

      expect(secrets.stored.get(TELEGRAM_TOKEN_SECRET_KEY)).toBe('my-bot-token');
      expect(config.data[TELEGRAM_ENABLED_CONFIG_KEY]).toBe(true);
      expect(config.data['channels.telegram.tokenRef']).toBe(TELEGRAM_TOKEN_SECRET_KEY);

      const enabled = config.data['plugins.enabled'] as string[];
      expect(enabled).toContain(TELEGRAM_PLUGIN_ID);

      expect(result).toContain('paired successfully');
    });

    test('trims whitespace from token', async () => {
      const tool = findTool(tools, 'telegram_pair');
      await tool.execute({ token: '  spaced-token  ' });

      expect(secrets.stored.get(TELEGRAM_TOKEN_SECRET_KEY)).toBe('spaced-token');
    });

    test('rejects empty token', async () => {
      const tool = findTool(tools, 'telegram_pair');
      const result = await tool.execute({ token: '' });

      expect(result).toContain('Error');
      expect(secrets.stored.size).toBe(0);
    });

    test('rejects whitespace-only token', async () => {
      const tool = findTool(tools, 'telegram_pair');
      const result = await tool.execute({ token: '   ' });

      expect(result).toContain('Error');
      expect(secrets.stored.size).toBe(0);
    });

    test('deduplicates plugin in enabled list', async () => {
      config.data['plugins.enabled'] = [TELEGRAM_PLUGIN_ID];

      const tool = findTool(tools, 'telegram_pair');
      await tool.execute({ token: 'token-123' });

      const enabled = config.data['plugins.enabled'] as string[];
      const count = enabled.filter((id) => id === TELEGRAM_PLUGIN_ID).length;
      expect(count).toBe(1);
    });

    test('preserves other plugins in enabled list', async () => {
      config.data['plugins.enabled'] = ['@tinyclaw/plugin-other'];

      const tool = findTool(tools, 'telegram_pair');
      await tool.execute({ token: 'token-123' });

      const enabled = config.data['plugins.enabled'] as string[];
      expect(enabled).toContain('@tinyclaw/plugin-other');
      expect(enabled).toContain(TELEGRAM_PLUGIN_ID);
    });

    test('handles secrets.store failure gracefully', async () => {
      secrets.store = async () => {
        throw new Error('disk full');
      };

      const tool = findTool(tools, 'telegram_pair');
      const result = await tool.execute({ token: 'token-123' });

      expect(result).toContain('Error pairing Telegram');
      expect(result).toContain('disk full');
    });
  });

  describe('telegram_unpair', () => {
    test('disables the plugin in config', async () => {
      config.data[TELEGRAM_ENABLED_CONFIG_KEY] = true;
      config.data['plugins.enabled'] = [TELEGRAM_PLUGIN_ID];

      const tool = findTool(tools, 'telegram_unpair');
      const result = await tool.execute({});

      expect(config.data[TELEGRAM_ENABLED_CONFIG_KEY]).toBe(false);
      expect(result).toContain('disabled');
    });

    test('removes plugin from enabled list', async () => {
      config.data['plugins.enabled'] = ['@tinyclaw/other', TELEGRAM_PLUGIN_ID];

      const tool = findTool(tools, 'telegram_unpair');
      await tool.execute({});

      const enabled = config.data['plugins.enabled'] as string[];
      expect(enabled).not.toContain(TELEGRAM_PLUGIN_ID);
      expect(enabled).toContain('@tinyclaw/other');
    });

    test('handles empty plugins.enabled list', async () => {
      const tool = findTool(tools, 'telegram_unpair');
      const result = await tool.execute({});

      expect(config.data[TELEGRAM_ENABLED_CONFIG_KEY]).toBe(false);
      expect(result).toContain('disabled');
    });

    test('keeps token in secrets (does not delete)', async () => {
      secrets.stored.set(TELEGRAM_TOKEN_SECRET_KEY, 'old-token');
      config.data['plugins.enabled'] = [TELEGRAM_PLUGIN_ID];

      const tool = findTool(tools, 'telegram_unpair');
      await tool.execute({});

      expect(secrets.stored.has(TELEGRAM_TOKEN_SECRET_KEY)).toBe(true);
    });
  });
});

describe('exported constants', () => {
  test('TELEGRAM_TOKEN_SECRET_KEY follows channel naming convention', () => {
    expect(TELEGRAM_TOKEN_SECRET_KEY).toBe('channel.telegram.token');
  });

  test('TELEGRAM_ENABLED_CONFIG_KEY matches config schema', () => {
    expect(TELEGRAM_ENABLED_CONFIG_KEY).toBe('channels.telegram.enabled');
  });

  test('TELEGRAM_PLUGIN_ID is the npm package name', () => {
    expect(TELEGRAM_PLUGIN_ID).toBe('@tinyclaw/plugin-channel-telegram');
  });
});
