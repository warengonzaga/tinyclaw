/**
 * Tests for the start command.
 *
 * Since startCommand boots the entire agent stack (DB, providers,
 * heartware, web server), we mock all @tinyclaw/core and @tinyclaw/ui
 * dependencies to test control-flow logic in isolation.
 */

import { afterEach, beforeEach, describe, expect, test, mock, jest } from 'bun:test';

// ── Mock @tinyclaw/core ──────────────────────────────────────────────

const mockSecretsCheck = mock(() => Promise.resolve(true));
const mockSecretsClose = mock(() => {});

const mockConfigGet = mock((key: string) => {
  if (key === 'providers.starterBrain.model') return 'gpt-oss:120b-cloud';
  if (key === 'providers.starterBrain.baseUrl') return 'https://ollama.com';
  return undefined;
});
const mockConfigClose = mock(() => {});

const mockDbClose = mock(() => {});
const mockSelectActiveProvider = mock(() => Promise.resolve({ chat: mock(() => {}) }));
const mockHeartwareInitialize = mock(() => Promise.resolve());

const mockWebUIStart = mock(() => Promise.resolve());
const mockWebUIStop = mock(() => Promise.resolve());

const mockGetStats = mock(() => ({ totalPatterns: 5 }));

mock.module('@tinyclaw/core', () => ({
  SecretsManager: {
    create: mock(() =>
      Promise.resolve({
        check: mockSecretsCheck,
        close: mockSecretsClose,
        storagePath: '/tmp/test-secrets',
      }),
    ),
  },
  ConfigManager: {
    create: mock(() =>
      Promise.resolve({
        get: mockConfigGet,
        set: mock(() => {}),
        close: mockConfigClose,
        path: '/tmp/test-config/data/config.db',
      }),
    ),
  },
  createDatabase: mock(() => ({
    close: mockDbClose,
  })),
  agentLoop: mock(() => Promise.resolve('agent response')),
  createOllamaProvider: mock(() => ({
    isAvailable: mock(() => Promise.resolve(true)),
  })),
  ProviderOrchestrator: mock().mockImplementation(() => ({
    selectActiveProvider: mockSelectActiveProvider,
  })),
  logger: {
    log: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
  HeartwareManager: mock().mockImplementation(() => ({
    initialize: mockHeartwareInitialize,
    close: mock(() => {}),
  })),
  createHeartwareTools: mock(() => []),
  loadHeartwareContext: mock(() => Promise.resolve({})),
  createLearningEngine: mock(() => ({
    getStats: mockGetStats,
    close: mock(() => {}),
  })),
  createSecretsTools: mock(() => []),
  createConfigTools: mock(() => []),
  buildProviderKeyName: mock((p: string) => `provider.${p}.apiKey`),
}));

// ── Mock @tinyclaw/ui ────────────────────────────────────────────────

mock.module('@tinyclaw/ui', () => ({
  createWebUI: mock(() => ({
    start: mockWebUIStart,
    stop: mockWebUIStop,
  })),
}));

// ── Import after mocks ───────────────────────────────────────────────

import { startCommand } from '../../src/commands/start.js';

// ── Helpers ──────────────────────────────────────────────────────────

let originalConsoleLog: typeof console.log;
let originalExit: typeof process.exit;
let consoleOutput: string[];
let exitCode: number | undefined;

beforeEach(() => {
  originalConsoleLog = console.log;
  originalExit = process.exit;
  consoleOutput = [];
  exitCode = undefined;

  console.log = (...args: any[]) => {
    consoleOutput.push(args.map(String).join(' '));
  };

  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as never;

  // Reset to defaults
  mockSecretsCheck.mockImplementation(() => Promise.resolve(true));
});

afterEach(() => {
  console.log = originalConsoleLog;
  process.exit = originalExit;
});

// ── Tests ────────────────────────────────────────────────────────────

describe('startCommand', () => {
  test('boots successfully when API key is configured', async () => {
    await expect(startCommand()).resolves.toBeUndefined();
  });

  test('starts the web UI server', async () => {
    await startCommand();
    expect(mockWebUIStart).toHaveBeenCalled();
  });

  test('initializes heartware', async () => {
    await startCommand();
    expect(mockHeartwareInitialize).toHaveBeenCalled();
  });

  test('selects active provider', async () => {
    await startCommand();
    expect(mockSelectActiveProvider).toHaveBeenCalled();
  });

  test('reads learning stats', async () => {
    await startCommand();
    expect(mockGetStats).toHaveBeenCalled();
  });
});

describe('startCommand — missing API key', () => {
  test('exits with code 1 when no API key is found', async () => {
    mockSecretsCheck.mockImplementation(() => Promise.resolve(false));

    try {
      await startCommand();
    } catch (err: any) {
      expect(err.message).toContain('process.exit');
    }

    expect(exitCode).toBe(1);
  });

  test('prints guidance to run setup when key is missing', async () => {
    mockSecretsCheck.mockImplementation(() => Promise.resolve(false));

    try {
      await startCommand();
    } catch { /* expected process.exit */ }

    const fullOutput = consoleOutput.join('\n');
    expect(fullOutput).toContain('tinyclaw setup');
  });
});
