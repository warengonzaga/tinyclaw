import { beforeEach, describe, expect, test } from 'bun:test';
import type { ConfigManagerInterface, SecretsManagerInterface, Tool } from '@tinyclaw/types';
import {
  createTelegramPairingTools,
  TELEGRAM_ENABLED_CONFIG_KEY,
  TELEGRAM_PLUGIN_ID,
  TELEGRAM_TOKEN_SECRET_KEY,
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
      for (const key of Object.keys(data)) delete data[key];
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
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool "${name}" not found`);
  }
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
    expect(tools.map((tool) => tool.name)).toEqual(['telegram_pair', 'telegram_unpair']);
  });

  test('stores token and enables the plugin on pair', async () => {
    const tool = findTool(tools, 'telegram_pair');
    const result = await tool.execute({ token: 'telegram-token' });

    expect(secrets.stored.get(TELEGRAM_TOKEN_SECRET_KEY)).toBe('telegram-token');
    expect(config.data[TELEGRAM_ENABLED_CONFIG_KEY]).toBe(true);
    expect(config.data['channels.telegram.tokenRef']).toBe(TELEGRAM_TOKEN_SECRET_KEY);
    expect(config.data['plugins.enabled']).toEqual([TELEGRAM_PLUGIN_ID]);
    expect(result).toContain('paired successfully');
  });

  test('trims whitespace from the token', async () => {
    const tool = findTool(tools, 'telegram_pair');
    await tool.execute({ token: '  telegram-token  ' });

    expect(secrets.stored.get(TELEGRAM_TOKEN_SECRET_KEY)).toBe('telegram-token');
  });

  test('keeps enabled plugins deduplicated', async () => {
    config.data['plugins.enabled'] = ['@tinyclaw/plugin-other', TELEGRAM_PLUGIN_ID];

    const tool = findTool(tools, 'telegram_pair');
    await tool.execute({ token: 'telegram-token' });

    expect(config.data['plugins.enabled']).toEqual(['@tinyclaw/plugin-other', TELEGRAM_PLUGIN_ID]);
  });

  test('rejects empty tokens', async () => {
    const tool = findTool(tools, 'telegram_pair');
    const result = await tool.execute({ token: '   ' });

    expect(result).toContain('Error');
    expect(secrets.stored.size).toBe(0);
  });

  test('preserves other enabled plugins when pairing', async () => {
    config.data['plugins.enabled'] = ['@tinyclaw/plugin-other'];

    const tool = findTool(tools, 'telegram_pair');
    await tool.execute({ token: 'telegram-token' });

    expect(config.data['plugins.enabled']).toEqual(['@tinyclaw/plugin-other', TELEGRAM_PLUGIN_ID]);
  });

  test('handles secrets.store failure gracefully', async () => {
    secrets.store = async () => {
      throw new Error('disk full');
    };

    const tool = findTool(tools, 'telegram_pair');
    const result = await tool.execute({ token: 'telegram-token' });

    expect(result).toContain('Error pairing Telegram');
    expect(result).toContain('disk full');
  });

  test('disables the plugin on unpair', async () => {
    config.data[TELEGRAM_ENABLED_CONFIG_KEY] = true;
    config.data['plugins.enabled'] = [TELEGRAM_PLUGIN_ID];

    const tool = findTool(tools, 'telegram_unpair');
    const result = await tool.execute({});

    expect(config.data[TELEGRAM_ENABLED_CONFIG_KEY]).toBe(false);
    expect(config.data['plugins.enabled']).toEqual([]);
    expect(result).toContain('disabled');
  });

  test('keeps the token in secrets on unpair', async () => {
    secrets.stored.set(TELEGRAM_TOKEN_SECRET_KEY, 'existing-token');
    config.data['plugins.enabled'] = [TELEGRAM_PLUGIN_ID];

    const tool = findTool(tools, 'telegram_unpair');
    await tool.execute({});

    expect(secrets.stored.get(TELEGRAM_TOKEN_SECRET_KEY)).toBe('existing-token');
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
