/**
 * Tests for the start command.
 *
 * Since startCommand boots the entire agent stack (DB, providers,
 * heartware, web server), we mock all @tinyclaw/* package dependencies
 * to test control-flow logic in isolation.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

let capturedContext: Record<string, unknown> | undefined;

// ── Mock @tinyclaw/secrets ───────────────────────────────────────────

const mockSecretsCheck = mock(() => Promise.resolve(true));
const mockSecretsClose = mock(() => {});

mock.module('@tinyclaw/secrets', () => ({
  SecretsManager: {
    create: mock(() =>
      Promise.resolve({
        check: mockSecretsCheck,
        close: mockSecretsClose,
        destroy: mock(() => Promise.resolve()),
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
  if (key === 'heartware.seed') return 42;
  if (key === 'owner.ownerId') return 'cli:owner';
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
        onDidAnyChange: mock(() => mock(() => {})),
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
    getActiveSubAgents: mock(() => []),
    getUserBackgroundTasks: mock(() => []),
  })),
  agentLoop: mock(() => Promise.resolve('agent response')),
  createOllamaProvider: mock(() => ({
    isAvailable: mock(() => Promise.resolve(true)),
  })),
  DEFAULT_MODEL: 'kimi-k2.5:cloud',
  DEFAULT_BASE_URL: 'https://ollama.com',
  BUILTIN_MODEL_TAGS: ['kimi-k2.5:cloud', 'gpt-oss:120b-cloud'],
  checkForUpdate: mock(() => Promise.resolve(null)),
  buildUpdateContext: mock(() => undefined),
}));

mock.module('@tinyclaw/plugins', () => ({
  loadPlugins: mock(() => Promise.resolve({ channels: [], providers: [], tools: [] })),
  discoverPairingTools: mock(() => Promise.resolve([])),
  checkPluginUpdates: mock(() => Promise.resolve(null)),
  buildPluginUpdateContext: mock(() => undefined),
  getCommunityPlugins: mock(() => []),
  installCommunityPlugin: mock(() => Promise.resolve({ success: false, message: 'mock' })),
  removeCommunityPlugin: mock(() => Promise.resolve({ success: false, message: 'mock' })),
  listCommunityPlugins: mock(() => Promise.resolve([])),
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
    log: mock((...args: unknown[]) => {
      console.log(...args);
    }),
    info: mock((...args: unknown[]) => {
      console.log(...args);
    }),
    warn: mock((...args: unknown[]) => {
      console.log(...args);
    }),
    error: mock((...args: unknown[]) => {
      console.log(...args);
    }),
    debug: mock(() => {}),
  },
  setLogMode: mock(() => {}),
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
  loadShieldContent: mock(() => Promise.resolve('')),
  parseSeed: mock((input: unknown) => {
    const n = Number(input);
    return Number.isNaN(n) ? undefined : n;
  }),
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
    lifecycle: {},
    templates: {},
    background: {
      getAll: mock(() => []),
      getUndelivered: mock(() => []),
      markDelivered: mock(() => {}),
      cancelAll: mock(() => {}),
      cleanupStale: mock(() => 0),
    },
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
    shutdown: mock(() => Promise.resolve()),
  })),
}));

// ── Mock @tinyclaw/shield ───────────────────────────────────────────

mock.module('@tinyclaw/shield', () => ({
  createShieldEngine: mock(() => ({
    getThreats: mock(() => []),
  })),
}));

// ── Mock @tinyclaw/compactor ────────────────────────────────────────

mock.module('@tinyclaw/compactor', () => ({
  createCompactor: mock(() => ({
    compactIfNeeded: mock(() => Promise.resolve({})),
    getLatestSummary: mock(() => null),
    estimateTokens: mock(() => 0),
  })),
}));

// ── Mock @tinyclaw/shell ────────────────────────────────────────────

mock.module('@tinyclaw/shell', () => ({
  createShellEngine: mock(() => ({
    shutdown: mock(() => Promise.resolve()),
    clearApprovals: mock(() => {}),
  })),
  createShellTools: mock(() => []),
}));

// ── Mock @tinyclaw/types ────────────────────────────────────────────

mock.module('@tinyclaw/types', () => ({}));

// ── Mock @tinyclaw/web ───────────────────────────────────────────────

const mockWebUIStart = mock(() => Promise.resolve());
const mockWebUIStop = mock(() => Promise.resolve());

// ── Mock @tinyclaw/gateway ────────────────────────────────────────────

const mockGatewayRegister = mock(() => {});

mock.module('@tinyclaw/gateway', () => ({
  createGateway: mock(() => ({
    register: mockGatewayRegister,
    unregister: mock(() => {}),
    send: mock(() => Promise.resolve({ success: true, channel: 'web', userId: 'web:owner' })),
    broadcast: mock(() => Promise.resolve([])),
    getRegisteredChannels: mock(() => ['discord']),
  })),
}));

const mockDiscordRuntimeStatus = mock(() => ({
  state: 'connected',
  readyTag: 'Tiny Claw#1234',
  lastError: null,
}));

mock.module('@tinyclaw/plugin-channel-discord', () => ({
  getDiscordRuntimeStatus: mockDiscordRuntimeStatus,
}));

// ── Mock @tinyclaw/web ────────────────────────────────────────────────

mock.module('@tinyclaw/web', () => ({
  createWebUI: mock(() => ({
    start: mockWebUIStart,
    stop: mockWebUIStop,
    getChannelSender: mock(() => ({
      name: 'Web UI (SSE)',
      send: mock(() => Promise.resolve()),
      broadcast: mock(() => Promise.resolve()),
    })),
  })),
}));

// ── Mock @tinyclaw/nudge ──────────────────────────────────────────────

mock.module('@tinyclaw/nudge', () => ({
  createNudgeEngine: mock(() => ({
    schedule: mock(() => 'nudge-1'),
    flush: mock(() => Promise.resolve()),
    pending: mock(() => []),
    cancel: mock(() => true),
    setPreferences: mock(() => {}),
    getPreferences: mock(() => ({ enabled: true, maxPerHour: 5, suppressedCategories: [] })),
    stop: mock(() => {}),
  })),
  wireNudgeToIntercom: mock(() => mock(() => {})),
  createNudgeTools: mock(() => []),
  createCompanionJobs: mock((args: Record<string, unknown>) => {
    capturedContext = args.context as Record<string, unknown>;
    return [];
  }),
  getCompanionTouchActivity: mock(() => mock(() => {})),
}));

// ── Import after mocks ───────────────────────────────────────────────

let startCommand: typeof import('../../src/commands/start.js').startCommand;

beforeAll(async () => {
  ({ startCommand } = await import('../../src/commands/start.js'));
});

// ── Helpers ──────────────────────────────────────────────────────────

let originalConsoleLog: typeof console.log;
let originalExit: typeof process.exit;
let originalArgv: string[];
let consoleOutput: string[];
let exitCode: number | undefined;

beforeEach(() => {
  originalConsoleLog = console.log;
  originalExit = process.exit;
  originalArgv = [...process.argv];
  consoleOutput = [];
  exitCode = undefined;
  capturedContext = undefined;

  console.log = (...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  };

  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
  }) as never;

  // Reset to defaults
  mockSecretsCheck.mockImplementation(() => Promise.resolve(true));
  mockConfigGet.mockImplementation((key: string) => {
    if (key === 'providers.starterBrain.model') return 'kimi-k2.5:cloud';
    if (key === 'providers.starterBrain.baseUrl') return 'https://ollama.com';
    if (key === 'heartware.seed') return 42;
    if (key === 'owner.ownerId') return 'cli:owner';
    if (key === 'channels.discord.enabled') return true;
    if (key === 'plugins.enabled') return ['@tinyclaw/plugin-channel-discord'];
    return undefined;
  });
  mockDiscordRuntimeStatus.mockImplementation(() => ({
    state: 'connected',
    readyTag: 'Tiny Claw#1234',
    lastError: null,
  }));
  mockGatewayRegister.mockClear();
});

afterEach(() => {
  console.log = originalConsoleLog;
  process.exit = originalExit;
  process.argv = originalArgv;
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

  test('registers cli channel alias for cli-prefixed owner', async () => {
    await startCommand();
    const registeredChannels = mockGatewayRegister.mock.calls.map(
      ([channel]: [string, ...unknown[]]) => channel,
    );
    expect(registeredChannels).toContain('cli');
  });

  test('does not register cli channel alias for non-cli-prefixed owner', async () => {
    mockConfigGet.mockImplementation((key: string) => {
      if (key === 'providers.starterBrain.model') return 'kimi-k2.5:cloud';
      if (key === 'providers.starterBrain.baseUrl') return 'https://ollama.com';
      if (key === 'heartware.seed') return 42;
      if (key === 'owner.ownerId') return 'web:owner';
      if (key === 'channels.discord.enabled') return true;
      if (key === 'plugins.enabled') return ['@tinyclaw/plugin-channel-discord'];
      return undefined;
    });
    await startCommand();
    const registeredChannels = mockGatewayRegister.mock.calls.map(
      ([channel]: [string, ...unknown[]]) => channel,
    );
    expect(registeredChannels).not.toContain('cli');
  });

  test('initializes heartware', async () => {
    await startCommand();
    expect(mockHeartwareInitialize).toHaveBeenCalled();
  });

  test('initializes provider orchestrator', async () => {
    await startCommand();
    // The orchestrator's registry is queried during boot to log available providers
    // biome-ignore lint/suspicious/noExplicitAny: accessing mock constructor for assertion
    const orchestratorMock = (await import('@tinyclaw/router')).ProviderOrchestrator as any;
    expect(orchestratorMock).toHaveBeenCalled();
  });

  test('reads learning stats', async () => {
    await startCommand();
    expect(mockGetStats).toHaveBeenCalled();
  });

  test('registers discord_status in the runtime tool list', async () => {
    await startCommand();

    const tools = capturedContext?.tools as Array<{ name: string }> | undefined;
    expect(tools?.some((tool) => tool.name === 'discord_status')).toBe(true);
  });

  test('discord_status reports connected runtime state', async () => {
    await startCommand();

    const tools = capturedContext?.tools as
      | Array<{ name: string; execute: (args: Record<string, unknown>) => Promise<string> }>
      | undefined;
    const discordStatusTool = tools?.find((tool) => tool.name === 'discord_status');

    expect(discordStatusTool).toBeDefined();

    const result = await discordStatusTool!.execute({});

    expect(result).toContain('Enabled in channels config: yes');
    expect(result).toContain('Present in plugins.enabled: yes');
    expect(result).toContain('Bot token stored: yes');
    expect(result).toContain('Gateway sender registered: yes');
    expect(result).toContain('Runtime state: connected');
    expect(result).toContain('Logged in as: Tiny Claw#1234');
    expect(result).toContain('Summary: Discord is connected in this Tiny Claw runtime.');
  });

  test('discord_status reports plugin helper load failures', async () => {
    mockDiscordRuntimeStatus.mockImplementation(() => {
      throw new Error('status helper unavailable');
    });

    await startCommand();

    const tools = capturedContext?.tools as
      | Array<{ name: string; execute: (args: Record<string, unknown>) => Promise<string> }>
      | undefined;
    const discordStatusTool = tools?.find((tool) => tool.name === 'discord_status');

    expect(discordStatusTool).toBeDefined();

    const result = await discordStatusTool!.execute({});

    expect(result).toContain('Runtime state: unavailable');
    expect(result).toContain(
      'Last error: Could not load Discord status helper: status helper unavailable',
    );
    expect(result).toContain('Summary: Discord is configured but not yet confirmed online.');
  });
});

describe('startCommand — missing API key', () => {
  test('exits with code 1 when no API key is found', async () => {
    mockSecretsCheck.mockImplementation(() => Promise.resolve(false));
    await expect(startCommand()).resolves.toBeUndefined();
    expect(exitCode).toBe(1);
  });

  test('prints guidance for both CLI and Web onboarding when key is missing', async () => {
    mockSecretsCheck.mockImplementation(() => Promise.resolve(false));
    await startCommand();

    const fullOutput = consoleOutput.join('\n');
    expect(fullOutput).toContain('tinyclaw setup');
    expect(fullOutput).toContain('tinyclaw setup --web');
  });
});
