/**
 * Tests for the Discord channel plugin entry point.
 *
 * Covers the exported plugin metadata, splitIntoChunks helper,
 * and the start/stop lifecycle guards.
 */

import { describe, expect, test } from 'bun:test';
import discordPlugin, { splitIntoChunks } from '../src/index.js';

// ---------------------------------------------------------------------------
// Plugin metadata
// ---------------------------------------------------------------------------

describe('discordPlugin metadata', () => {
  test('has the correct id', () => {
    expect(discordPlugin.id).toBe('@tinyclaw/plugin-channel-discord');
  });

  test('has a human-readable name', () => {
    expect(discordPlugin.name).toBe('Discord');
  });

  test('type is channel', () => {
    expect(discordPlugin.type).toBe('channel');
  });

  test('has a version string', () => {
    expect(discordPlugin.version).toBeDefined();
    expect(typeof discordPlugin.version).toBe('string');
  });

  test('has a description', () => {
    expect(discordPlugin.description).toBeDefined();
    expect(discordPlugin.description.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getPairingTools
// ---------------------------------------------------------------------------

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
    const tools = discordPlugin.getPairingTools?.(mockSecrets as any, mockConfig as any);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['discord_pair', 'discord_unpair']);
  });
});

// ---------------------------------------------------------------------------
// stop() — safe to call when not started
// ---------------------------------------------------------------------------

describe('stop', () => {
  test('does not throw when called without start', async () => {
    await expect(discordPlugin.stop()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// splitIntoChunks
// ---------------------------------------------------------------------------

describe('splitIntoChunks', () => {
  test('returns single chunk for short text', () => {
    const result = splitIntoChunks('hello world', 100);
    expect(result).toEqual(['hello world']);
  });

  test('splits on newlines when possible', () => {
    const text = 'line one\nline two\nline three';
    const result = splitIntoChunks(text, 15);

    expect(result.length).toBeGreaterThan(1);
    // Rejoined text should equal original
    expect(result.join('\n').replace(/\n+/g, '\n')).toContain('line one');
    expect(result.join('\n')).toContain('line three');
  });

  test('splits on spaces when no newlines available', () => {
    const text = 'word1 word2 word3 word4 word5';
    const result = splitIntoChunks(text, 12);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(12);
    }
  });

  test('hard splits if no whitespace found', () => {
    const text = 'a'.repeat(30);
    const result = splitIntoChunks(text, 10);

    expect(result.length).toBe(3);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
  });

  test('returns empty array for empty string', () => {
    const result = splitIntoChunks('', 100);
    expect(result).toEqual([]);
  });

  test('handles text exactly at maxLength', () => {
    const text = 'a'.repeat(100);
    const result = splitIntoChunks(text, 100);
    expect(result).toEqual([text]);
  });

  test('preserves all content across chunks', () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`);
    const text = words.join(' ');
    const chunks = splitIntoChunks(text, 40);

    const reassembled = chunks.join(' ');
    for (const word of words) {
      expect(reassembled).toContain(word);
    }
  });

  test('each chunk respects maxLength', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(20);
    const maxLength = 50;
    const chunks = splitIntoChunks(text, maxLength);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxLength);
    }
  });
});
