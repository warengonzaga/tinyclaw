/**
 * Tests for the CLI theme module.
 *
 * Validates that all theme helpers return non-empty strings
 * and apply expected formatting.
 */

import { describe, expect, test } from 'bun:test';
import { theme } from '../../src/ui/theme.js';

describe('theme', () => {
  const allHelpers = ['brand', 'success', 'warn', 'error', 'dim', 'bold', 'cmd', 'label'] as const;

  test('exports all expected helpers', () => {
    for (const name of allHelpers) {
      expect(typeof theme[name]).toBe('function');
    }
  });

  test.each(allHelpers)('%s returns a non-empty string', (name) => {
    const result = theme[name]('hello');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test.each(allHelpers)('%s embeds the input text', (name) => {
    const result = theme[name]('test-marker');
    // The raw text should appear somewhere in the ANSI-coded string
    expect(result).toContain('test-marker');
  });

  test('brand applies cyan color', () => {
    const result = theme.brand('hello');
    // picocolors cyan uses ANSI escape \x1b[36m
    expect(result).toContain('\x1b[36m');
  });

  test('success applies green color', () => {
    const result = theme.success('ok');
    // picocolors green uses ANSI escape \x1b[32m
    expect(result).toContain('\x1b[32m');
  });

  test('warn applies yellow color', () => {
    const result = theme.warn('caution');
    expect(result).toContain('\x1b[33m');
  });

  test('error applies red color', () => {
    const result = theme.error('fail');
    expect(result).toContain('\x1b[31m');
  });

  test('bold applies bold formatting', () => {
    const result = theme.bold('strong');
    expect(result).toContain('\x1b[1m');
  });

  test('cmd applies bold + cyan', () => {
    const result = theme.cmd('tinyclaw');
    expect(result).toContain('\x1b[1m');
    expect(result).toContain('\x1b[36m');
  });

  test('label applies bold + white', () => {
    const result = theme.label('Name');
    expect(result).toContain('\x1b[1m');
    expect(result).toContain('\x1b[37m');
  });
});
