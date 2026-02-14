/**
 * Tests for the start command.
 *
 * Since startCommand boots the entire agent stack (DB, providers,
 * heartware, web server), we mock all @tinyclaw/* package dependencies
 * to test control-flow logic in isolation.
 */

import { afterEach, beforeEach, describe, expect, test, mock, jest } from 'bun:test';

// ── Mock @tinyclaw/secrets ───────────────────────────────────────────

const mockSecretsCheck = mock(() => Promise.resolve(true));
const mockSecretsClose = mock(() => {});

mock.module('@tinyclaw/secrets', () => ({
  SecretsManager: {
    create: mock(() =>
      Promise.resolve({
        check: mockSecretsCheck,
        close: mockSecretsClose,
        storagePath: '/tmp/test-secrets',
      }),
    ),
  },
  createSecretsTools: mock(() => []),
  buildProviderKeyName: mock((p: string) => `provider.${p}.apiKey`),
}));

// ── Mock @tinyclaw/config ───────────────────────────────────────────

const mockConfigGet = mock((key: string) => {
  if (key === 'providers.starterBrain.model') return 'kimi-k2.5:cloud';
  if (key === 'providers.starterBrain.baseUrl') return 'https://ollama.com';
  return undefined;
});
const mockConfigClose = mock(() => {});

mock.module('@tinyclaw/config', () => ({
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
  createConfigTools: mock(() => []),
}));

// ── Mock @tinyclaw/core ─────────────────────────────────────────────

const mockDbClose = mock(() => {});

mock.module('@tinyclaw/core', () => ({
  createDatabase: mock(() => ({
    close: mockDbClose,
  })),
  agentLoop: mock(() => Promise.resolve('agent response')),
  createOllamaProvider: mock(() => ({
    isAvailable: mock(() => Promise.resolve(true)),
  })),
  DEFAULT_MODEL: 'kimi-k2.5:cloud',
  DEFAULT_BASE_URL: 'https://ollama.com',
  BUILTIN_MODEL_TAGS: ['kimi-k2.5:cloud', 'gpt-oss:120b-cloud'],
}));

mock.module('@tinyclaw/plugins', () => ({
  loadPlugins: mock(() => Promise.resolve({ channels: [], providers: [], tools: [] })),
}));

mock.module('@tinyclaw/pulse', () => ({
  createPulseScheduler: mock(() => ({
    register: mock(() => {}),
    start: mock(() => {}),
    stop: mock(() => {}),
    jobs: mock(() => []),
  })),
}));

// ── Mock @tinyclaw/intercom ─────────────────────────────────────────

mock.module('@tinyclaw/intercom', () => ({
  createIntercom: mock(() => ({
    on: mock(() => mock(() => {})),
    onAny: mock(() => mock(() => {})),
    emit: mock(() => {}),
    recent: mock(() => []),
    recentAll: mock(() => []),
    clear: mock(() => {}),
  })),
}));

// ── Mock @tinyclaw/matcher ──────────────────────────────────────────

mock.module('@tinyclaw/matcher', () => ({
  createHybridMatcher: mock(() => ({
    match: mock(() => ({ score: 0, matches: [] })),
  })),
}));

// ── Mock @tinyclaw/queue ────────────────────────────────────────────

mock.module('@tinyclaw/queue', () => ({
  createSessionQueue: mock(() => ({
    enqueue: mock(() => Promise.resolve('queued response')),
  })),
}));

// ── Mock @tinyclaw/logger ───────────────────────────────────────────

mock.module('@tinyclaw/logger', () => ({
  logger: {
    log: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

// ── Mock @tinyclaw/router ───────────────────────────────────────────

const mockSelectActiveProvider = mock(() => Promise.resolve({ chat: mock(() => {}) }));

mock.module('@tinyclaw/router', () => ({
  ProviderOrchestrator: mock().mockImplementation(() => ({
    selectActiveProvider: mockSelectActiveProvider,
    getRegistry: mock(() => ({
      ids: mock(() => ['ollama-cloud']),
    })),
  })),
}));

// ── Mock @tinyclaw/heartware ────────────────────────────────────────

const mockHeartwareInitialize = mock(() => Promise.resolve());

mock.module('@tinyclaw/heartware', () => ({
  HeartwareManager: mock().mockImplementation(() => ({
    initialize: mockHeartwareInitialize,
    close: mock(() => {}),
  })),
  createHeartwareTools: mock(() => []),
  loadHeartwareContext: mock(() => Promise.resolve({})),
}));

// ── Mock @tinyclaw/learning ─────────────────────────────────────────

const mockGetStats = mock(() => ({ totalPatterns: 5 }));

mock.module('@tinyclaw/learning', () => ({
  createLearningEngine: mock(() => ({
    getStats: mockGetStats,
    close: mock(() => {}),
  })),
}));

// ── Mock @tinyclaw/delegation ───────────────────────────────────────

mock.module('@tinyclaw/delegation', () => ({
  createDelegationTools: mock(() => ({
    tools: [],
    blackboard: { read: mock(() => null), write: mock(() => {}), list: mock(() => []) },
    estimator: { estimate: mock(() => 30000) },
  })),
  createBlackboard: mock(() => ({
    read: mock(() => null),
    write: mock(() => {}),
    list: mock(() => []),
  })),
  createTimeoutEstimator: mock(() => ({
    estimate: mock(() => 30000),
  })),
}));

// ── Mock @tinyclaw/memory ───────────────────────────────────────────

mock.module('@tinyclaw/memory', () => ({
  createMemoryEngine: mock(() => ({
    close: mock(() => {}),
  })),
}));

// ── Mock @tinyclaw/sandbox ──────────────────────────────────────────

mock.module('@tinyclaw/sandbox', () => ({
  createSandbox: mock(() => ({
    execute: mock(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
  })),
}));

// ── Mock @tinyclaw/types ────────────────────────────────────────────

mock.module('@tinyclaw/types', () => ({}));

// ── Mock @tinyclaw/ui ───────────────────────────────────────────────

const mockWebUIStart = mock(() => Promise.resolve());
const mockWebUIStop = mock(() => Promise.resolve());

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

  test('initializes provider orchestrator', async () => {
    await startCommand();
    // The orchestrator's registry is queried during boot to log available providers
    const orchestratorMock = (await import('@tinyclaw/router')).ProviderOrchestrator as any;
    expect(orchestratorMock).toHaveBeenCalled();
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
