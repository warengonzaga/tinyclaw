/**
 * Tests for the Telegram channel plugin entry point.
 */

import { describe, test, expect } from 'bun:test';
import telegramPlugin from '../src/index.js';

describe('telegramPlugin metadata', () => {
  test('has the correct id', () => {
    expect(telegramPlugin.id).toBe('@tinyclaw/plugin-channel-telegram');
  });

  test('has a human-readable name', () => {
    expect(telegramPlugin.name).toBe('Telegram');
  });

  test('type is channel', () => {
    expect(telegramPlugin.type).toBe('channel');
  });

  test('has a version string', () => {
    expect(telegramPlugin.version).toBeDefined();
    expect(typeof telegramPlugin.version).toBe('string');
  });

  test('has a description', () => {
    expect(telegramPlugin.description).toBeDefined();
    expect(telegramPlugin.description.length).toBeGreaterThan(0);
  });

  test('has telegram channel prefix for outbound routing', () => {
    expect(telegramPlugin.channelPrefix).toBe('telegram');
  });
});

describe('getPairingTools', () => {
  test('returns tools when called with mock managers', () => {
    const mockSecrets = {
      store: async () => {},
      check: async () => false,
      retrieve: async () => null,
      list: async () => [],
      resolveProviderKey: async () => null,
      close: async () => {},
    };
    const mockConfig = {
      get: () => undefined,
      has: () => false,
      set: () => {},
      delete: () => {},
      reset: () => {},
      clear: () => {},
      store: {},
      size: 0,
      path: ':memory:',
      onDidChange: () => () => {},
      onDidAnyChange: () => () => {},
      close: () => {},
    };

    const tools = telegramPlugin.getPairingTools!(mockSecrets as any, mockConfig as any);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['telegram_pair', 'telegram_unpair']);
  });
});

describe('stop', () => {
  test('does not throw when called without start', async () => {
    await expect(telegramPlugin.stop()).resolves.toBeUndefined();
  });
});
