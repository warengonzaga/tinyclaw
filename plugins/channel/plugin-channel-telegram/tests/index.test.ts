import { describe, expect, test } from 'bun:test';
import {
  normalizeTelegramText,
  shouldHandleTelegramMessage,
  splitIntoChunks,
  default as telegramPlugin,
} from '../src/index.js';

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

    // biome-ignore lint/suspicious/noExplicitAny: partial mock objects for testing
    const tools = telegramPlugin.getPairingTools?.(mockSecrets as any, mockConfig as any);
    expect(tools).toHaveLength(2);
    expect(tools?.map((tool) => tool.name)).toEqual(['telegram_pair', 'telegram_unpair']);
  });
});

describe('stop', () => {
  test('does not throw when called without start', async () => {
    await expect(telegramPlugin.stop()).resolves.toBeUndefined();
  });
});

describe('shouldHandleTelegramMessage', () => {
  test('accepts private messages', () => {
    expect(
      shouldHandleTelegramMessage({ chat: { id: 1, type: 'private' } }, 'hello', 'tinyclaw_bot'),
    ).toBe(true);
  });

  test('rejects group messages without a bot mention', () => {
    expect(
      shouldHandleTelegramMessage(
        { chat: { id: -1, type: 'group' } },
        'hello there',
        'tinyclaw_bot',
      ),
    ).toBe(false);
  });

  test('accepts group mentions', () => {
    expect(
      shouldHandleTelegramMessage(
        { chat: { id: -1, type: 'supergroup' } },
        '@tinyclaw_bot hello there',
        'tinyclaw_bot',
      ),
    ).toBe(true);
  });

  test('rejects channel posts', () => {
    expect(
      shouldHandleTelegramMessage(
        { chat: { id: -1, type: 'channel' } },
        '@tinyclaw_bot hello there',
        'tinyclaw_bot',
      ),
    ).toBe(false);
  });
});

describe('normalizeTelegramText', () => {
  test('removes bot mentions and normalizes spacing', () => {
    expect(normalizeTelegramText('  hey @tinyclaw_bot can you help?  ', 'tinyclaw_bot')).toBe(
      'hey can you help?',
    );
  });

  test('preserves text when no username is available', () => {
    expect(normalizeTelegramText('  hello there  ', null)).toBe('hello there');
  });

  test('removes repeated mentions case-insensitively', () => {
    expect(normalizeTelegramText('@TinyClaw_Bot hi @tinyclaw_bot', 'tinyclaw_bot')).toBe('hi');
  });
});

describe('splitIntoChunks', () => {
  test('splits long messages near word boundaries', () => {
    const chunks = splitIntoChunks('alpha beta gamma delta', 10);
    expect(chunks).toEqual(['alpha beta', 'gamma', 'delta']);
  });

  test('returns the original message when already within the limit', () => {
    expect(splitIntoChunks('hello', 10)).toEqual(['hello']);
  });

  test('returns empty array for empty string', () => {
    expect(splitIntoChunks('', 10)).toEqual([]);
  });

  test('hard splits when no whitespace exists', () => {
    const chunks = splitIntoChunks('a'.repeat(13), 5);
    expect(chunks).toEqual(['aaaaa', 'aaaaa', 'aaa']);
  });

  test('ensures every chunk respects the limit', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(8);
    const maxLength = 30;
    const chunks = splitIntoChunks(text, maxLength);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxLength);
    }
  });
});
