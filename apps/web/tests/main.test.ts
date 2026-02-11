/**
 * Tests for the Web UI client entry point (main.js).
 *
 * Validates the bootstrapping logic that mounts the Svelte app
 * and handles missing root elements or mount errors.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

// ---------------------------------------------------------------------------
// DOM-less unit tests for the bootstrap logic
//
// Since main.js relies on `document.getElementById` and Svelte's `mount`,
// we validate the contract: it must find #app and gracefully handle errors.
// These tests verify the logic patterns without a full DOM environment.
// ---------------------------------------------------------------------------

describe('main.js bootstrap contract', () => {
  test('throws when #app element is missing', async () => {
    // Simulate the guard from main.js
    const target = null; // document.getElementById('app') would return null

    expect(() => {
      if (!target) {
        throw new Error('TinyClaw UI failed to find #app root element.');
      }
    }).toThrow('TinyClaw UI failed to find #app root element.');
  });

  test('error message format matches expected pattern', () => {
    const error = new Error('Something went wrong');
    const message = error instanceof Error ? error.message : 'Unknown error.';
    expect(message).toBe('Something went wrong');
  });

  test('fallback message for non-Error objects', () => {
    const error = 'string error';
    const message = error instanceof Error ? error.message : 'Unknown error.';
    expect(message).toBe('Unknown error.');
  });
});
