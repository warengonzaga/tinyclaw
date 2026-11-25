/**
 * Tests for container environment detection (detect-container.ts).
 *
 * Uses module mocking to simulate Docker, CI, and non-container environments.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Store original env so we can restore after each test
const originalEnv = { ...process.env };

// Mock node:fs so we can control existsSync and readFileSync
const mockExistsSync = mock(() => false);
const mockReadFileSync = mock(() => '');

mock.module('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

// Mock logger to avoid side effects
mock.module('@tinyclaw/logger', () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

// Import after mocks are set up
const { isRunningInContainer } = await import('../src/detect-container.js');

beforeEach(() => {
  // Reset env vars
  delete process.env.CI;
  delete process.env.CONTAINER;
  delete process.env.DOCKER_CONTAINER;

  // Reset mocks
  mockExistsSync.mockReset();
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockReset();
  mockReadFileSync.mockReturnValue('');
});

afterEach(() => {
  // Restore original environment
  process.env = { ...originalEnv };
});

// -----------------------------------------------------------------------
// Environment variable detection
// -----------------------------------------------------------------------

describe('environment variable detection', () => {
  test('detects CI environment', () => {
    process.env.CI = 'true';
    expect(isRunningInContainer()).toBe(true);
  });

  test('detects CONTAINER environment', () => {
    process.env.CONTAINER = 'true';
    expect(isRunningInContainer()).toBe(true);
  });

  test('detects DOCKER_CONTAINER environment', () => {
    process.env.DOCKER_CONTAINER = '1';
    expect(isRunningInContainer()).toBe(true);
  });
});

// -----------------------------------------------------------------------
// .dockerenv file detection
// -----------------------------------------------------------------------

describe('.dockerenv detection', () => {
  test('detects /.dockerenv file', () => {
    mockExistsSync.mockReturnValue(true);
    expect(isRunningInContainer()).toBe(true);
  });

  test('handles /.dockerenv check failure gracefully', () => {
    mockExistsSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    // Should not throw, should fall through to next check
    expect(isRunningInContainer()).toBe(false);
  });
});

// -----------------------------------------------------------------------
// cgroup detection
// -----------------------------------------------------------------------

describe('cgroup detection', () => {
  test('detects docker in cgroup', () => {
    mockReadFileSync.mockReturnValue('12:memory:/docker/abc123\n');
    expect(isRunningInContainer()).toBe(true);
  });

  test('detects containerd in cgroup', () => {
    mockReadFileSync.mockReturnValue('1:name=systemd:/containerd/abc\n');
    expect(isRunningInContainer()).toBe(true);
  });

  test('detects kubepods in cgroup', () => {
    mockReadFileSync.mockReturnValue('11:cpuset:/kubepods/pod-xyz\n');
    expect(isRunningInContainer()).toBe(true);
  });

  test('detects lxc in cgroup', () => {
    mockReadFileSync.mockReturnValue('10:devices:/lxc/container1\n');
    expect(isRunningInContainer()).toBe(true);
  });

  test('detects podman in cgroup', () => {
    mockReadFileSync.mockReturnValue('1:name=systemd:/podman/ctr-abc\n');
    expect(isRunningInContainer()).toBe(true);
  });

  test('handles cgroup read failure gracefully', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });
    expect(isRunningInContainer()).toBe(false);
  });
});

// -----------------------------------------------------------------------
// Non-container environment
// -----------------------------------------------------------------------

describe('non-container environment', () => {
  test('returns false when no container indicators found', () => {
    mockReadFileSync.mockReturnValue('1:name=systemd:/init.scope\n');
    expect(isRunningInContainer()).toBe(false);
  });

  test('returns false with empty cgroup', () => {
    mockReadFileSync.mockReturnValue('');
    expect(isRunningInContainer()).toBe(false);
  });
});
