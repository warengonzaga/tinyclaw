/**
 * Tests for the setup command.
 *
 * Mocks @clack/prompts, @tinyclaw/secrets, @tinyclaw/config,
 * @tinyclaw/core, @tinyclaw/heartware, and @tinyclaw/logger to
 * test the setup wizard logic without user interaction or real
 * filesystem side-effects.
 */

import { afterEach, beforeEach, describe, expect, test, mock, jest } from 'bun:test';

// ── Mock @clack/prompts ──────────────────────────────────────────────

const mockIntro = mock(() => {});
const mockOutro = mock(() => {});
const mockNote = mock(() => {});
const mockSelect = mock(() => 'keep');
const mockPassword = mock(() => 'test-api-key');
const mockText = mock(() => '');
const mockConfirm = mock(() => true);
const mockSpinnerStart = mock(() => {});
const mockSpinnerStop = mock(() => {});
const mockSpinner = mock(() => ({
  start: mockSpinnerStart,
  stop: mockSpinnerStop,
}));
const mockLogInfo = mock(() => {});
const mockLogWarn = mock(() => {});
const mockLogError = mock(() => {});
const mockLogSuccess = mock(() => {});
const mockIsCancel = mock(() => false);

mock.module('@clack/prompts', () => ({
  intro: mockIntro,
  outro: mockOutro,
  note: mockNote,
  select: mockSelect,
  password: mockPassword,
  text: mockText,
  confirm: mockConfirm,
  spinner: mockSpinner,
  isCancel: mockIsCancel,
  log: {
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
    success: mockLogSuccess,
  },
}));

// ── Mock @tinyclaw/secrets ───────────────────────────────────────────

const mockSecretsStore = mock(() => Promise.resolve());
const mockSecretsCheck = mock(() => Promise.resolve(false));
const mockSecretsClose = mock(() => {});

mock.module('@tinyclaw/secrets', () => ({
  SecretsManager: {
    create: mock(() =>
      Promise.resolve({
        store: mockSecretsStore,
        check: mockSecretsCheck,
        close: mockSecretsClose,
      }),
    ),
  },
  buildProviderKeyName: mock((provider: string) => `provider.${provider}.apiKey`),
}));

// ── Mock @tinyclaw/config ───────────────────────────────────────────

const mockConfigGet = mock(() => undefined);
const mockConfigSet = mock(() => {});
const mockConfigClose = mock(() => {});

mock.module('@tinyclaw/config', () => ({
  ConfigManager: {
    create: mock(() =>
      Promise.resolve({
        get: mockConfigGet,
        set: mockConfigSet,
        close: mockConfigClose,
      }),
    ),
  },
}));

// ── Mock @tinyclaw/core ─────────────────────────────────────────────

const mockIsAvailable = mock(() => Promise.resolve(true));

mock.module('@tinyclaw/core', () => ({
  createOllamaProvider: mock(() => ({
    isAvailable: mockIsAvailable,
  })),
  DEFAULT_PROVIDER: 'ollama',
  DEFAULT_MODEL: 'kimi-k2.5:cloud',
  DEFAULT_BASE_URL: 'https://ollama.com',
}));

// ── Mock @tinyclaw/heartware ────────────────────────────────────────

const mockParseSeed = mock((input: unknown) => {
  const n = Number(input);
  if (!input || isNaN(n)) return 42;
  return n;
});
const mockGenerateRandomSeed = mock(() => 42);
const mockGenerateSoul = mock(() => ({
  traits: {
    character: { suggestedName: 'TestClaw' },
    values: ['curiosity', 'kindness'],
  },
}));

mock.module('@tinyclaw/heartware', () => ({
  parseSeed: mockParseSeed,
  generateRandomSeed: mockGenerateRandomSeed,
  generateSoul: mockGenerateSoul,
}));

// ── Mock @tinyclaw/logger ───────────────────────────────────────────

mock.module('@tinyclaw/logger', () => ({
  setLogMode: mock(() => {}),
  logger: {
    log: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  },
}));

// ── Import after mocks are set up ────────────────────────────────────

import { setupCommand } from '../../src/commands/setup.js';

// ── Helpers ──────────────────────────────────────────────────────────

let originalConsoleLog: typeof console.log;
let consoleOutput: string[];

beforeEach(() => {
  originalConsoleLog = console.log;
  consoleOutput = [];
  console.log = (...args: any[]) => {
    consoleOutput.push(args.map(String).join(' '));
  };

  // Clear all mock call counts and reset to defaults
  mockIntro.mockClear();
  mockOutro.mockClear();
  mockNote.mockClear();
  mockSelect.mockClear();
  mockPassword.mockClear();
  mockText.mockClear();
  mockConfirm.mockClear();
  mockSpinner.mockClear();
  mockSpinnerStart.mockClear();
  mockSpinnerStop.mockClear();
  mockLogInfo.mockClear();
  mockLogWarn.mockClear();
  mockLogError.mockClear();
  mockLogSuccess.mockClear();
  mockIsCancel.mockClear();
  mockSecretsStore.mockClear();
  mockSecretsCheck.mockClear();
  mockSecretsClose.mockClear();
  mockConfigGet.mockClear();
  mockConfigSet.mockClear();
  mockConfigClose.mockClear();
  mockIsAvailable.mockClear();
  mockParseSeed.mockClear();
  mockGenerateRandomSeed.mockClear();
  mockGenerateSoul.mockClear();

  // Reset to default implementations
  mockIsCancel.mockImplementation(() => false);
  mockSecretsCheck.mockImplementation(() => Promise.resolve(false));
  mockConfirm.mockImplementation(() => true);
  mockPassword.mockImplementation(() => 'test-api-key');
  mockText.mockImplementation(() => '');
  mockSelect.mockImplementation(() => 'keep');
  mockIsAvailable.mockImplementation(() => Promise.resolve(true));
  mockParseSeed.mockImplementation((input: unknown) => {
    const n = Number(input);
    if (!input || isNaN(n)) return 42;
    return n;
  });
  mockGenerateRandomSeed.mockImplementation(() => 42);
  mockGenerateSoul.mockImplementation(() => ({
    traits: {
      character: { suggestedName: 'TestClaw' },
      values: ['curiosity', 'kindness'],
    },
  }));
});

afterEach(() => {
  console.log = originalConsoleLog;
});

// ── Tests ────────────────────────────────────────────────────────────

describe('setupCommand', () => {
  test('runs without throwing', async () => {
    await expect(setupCommand()).resolves.toBeUndefined();
  });

  test('calls intro with branded text', async () => {
    await setupCommand();
    expect(mockIntro).toHaveBeenCalled();
  });

  test('calls outro on successful completion', async () => {
    await setupCommand();
    expect(mockOutro).toHaveBeenCalled();
  });

  test('stores the API key in secrets manager', async () => {
    await setupCommand();
    expect(mockSecretsStore).toHaveBeenCalledWith(
      'provider.ollama.apiKey',
      'test-api-key',
    );
  });

  test('persists provider config with default model', async () => {
    await setupCommand();
    expect(mockConfigSet).toHaveBeenCalledWith('providers.starterBrain', {
      model: 'kimi-k2.5:cloud',
      baseUrl: 'https://ollama.com',
      apiKeyRef: 'provider.ollama.apiKey',
    });
  });

  test('validates API key on entry', async () => {
    await setupCommand();
    expect(mockIsAvailable).toHaveBeenCalled();
  });

  test('cleans up secrets and config managers', async () => {
    await setupCommand();
    expect(mockSecretsClose).toHaveBeenCalled();
    expect(mockConfigClose).toHaveBeenCalled();
  });
});

describe('setupCommand — cancellation', () => {
  test('exits early when API key entry is cancelled', async () => {
    const cancelSymbol = Symbol.for('cancel');
    mockPassword.mockImplementation(() => cancelSymbol as any);
    mockIsCancel.mockImplementation((val) => val === cancelSymbol);

    await setupCommand();
    expect(mockOutro).toHaveBeenCalled();
    // Should not attempt to store anything
    expect(mockConfigSet).not.toHaveBeenCalled();
  });
});

describe('setupCommand — existing configuration', () => {
  test('prompts to reconfigure when already configured', async () => {
    mockSecretsCheck.mockImplementation(() => Promise.resolve(true));
    // Return a saved seed so the setup detects "fully configured"
    mockConfigGet.mockImplementation((key: string) =>
      key === 'heartware.seed' ? 42 : undefined,
    );
    // confirm calls: risk acceptance → true, reconfigure → false (decline)
    let callCount = 0;
    mockConfirm.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? true : false;
    });

    await setupCommand();
    expect(mockConfirm).toHaveBeenCalled();
  });

  test('skips setup when user declines reconfiguration', async () => {
    mockSecretsCheck.mockImplementation(() => Promise.resolve(true));
    mockConfigGet.mockImplementation((key: string) =>
      key === 'heartware.seed' ? 42 : undefined,
    );
    let callCount = 0;
    mockConfirm.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? true : false;
    });

    await setupCommand();
    expect(mockSecretsStore).not.toHaveBeenCalled();
    expect(mockOutro).toHaveBeenCalled();
  });

  test('proceeds with setup when user confirms reconfiguration', async () => {
    mockSecretsCheck.mockImplementation(() => Promise.resolve(true));
    mockConfigGet.mockImplementation((key: string) =>
      key === 'heartware.seed' ? 42 : undefined,
    );
    mockConfirm.mockImplementation(() => true);

    await setupCommand();
    expect(mockSecretsStore).toHaveBeenCalled();
  });
});

describe('setupCommand — provider verification', () => {
  test('handles unreachable provider gracefully', async () => {
    mockIsAvailable.mockImplementation(() => Promise.resolve(false));

    await expect(setupCommand()).resolves.toBeUndefined();
    expect(mockSpinnerStop).toHaveBeenCalled();
  });

  test('handles verification error gracefully', async () => {
    mockIsAvailable.mockImplementation(() =>
      Promise.reject(new Error('connection refused')),
    );

    await expect(setupCommand()).resolves.toBeUndefined();
    expect(mockSpinnerStop).toHaveBeenCalled();
  });
});
