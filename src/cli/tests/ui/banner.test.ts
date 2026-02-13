/**
 * Tests for the CLI banner module.
 *
 * Validates getVersion() and showBanner() output.
 */

import { afterEach, beforeEach, describe, expect, test, jest } from 'bun:test';
import { getVersion, showBanner } from '../../src/ui/banner.js';

describe('getVersion', () => {
  test('returns a string', () => {
    const version = getVersion();
    expect(typeof version).toBe('string');
  });

  test('returns a non-empty string', () => {
    const version = getVersion();
    expect(version.length).toBeGreaterThan(0);
  });

  test('returns a semver-like string or "unknown"', () => {
    const version = getVersion();
    // Should either be a semver (e.g. "1.0.0") or "unknown"
    const isSemver = /^\d+\.\d+\.\d+/.test(version);
    expect(isSemver || version === 'unknown').toBe(true);
  });

  test('returns the same value on subsequent calls (caching)', () => {
    const v1 = getVersion();
    const v2 = getVersion();
    expect(v1).toBe(v2);
  });
});

describe('showBanner', () => {
  let originalLog: typeof console.log;
  let output: string[];

  beforeEach(() => {
    originalLog = console.log;
    output = [];
    console.log = (...args: any[]) => {
      output.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  test('prints the TinyClaw logo', () => {
    showBanner();
    const fullOutput = output.join('\n');
    // ASCII art contains distinctive box-drawing characters from the logo
    expect(fullOutput).toContain('|___/');
    expect(fullOutput).toContain('_____');
  });

  test('prints the version', () => {
    showBanner();
    const fullOutput = output.join('\n');
    const version = getVersion();
    expect(fullOutput).toContain(version);
  });

  test('prints the tagline', () => {
    showBanner();
    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Small agent, mighty friend');
  });

  test('produces multiple lines of output', () => {
    showBanner();
    expect(output.length).toBeGreaterThanOrEqual(2);
  });
});
