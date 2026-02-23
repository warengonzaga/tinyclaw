/**
 * Tests for the `tinyclaw purge` command.
 *
 * Uses temp directories and env overrides to avoid touching
 * real user data. Spawns the CLI as a child process.
 *
 * Interactive confirmation tests use --yes to bypass the prompt.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const CLI_ENTRY = resolve(__dirname, '../src/index.ts');

/**
 * Create a unique temp directory for each test
 */
function createTempDir(suffix: string): string {
  const dir = join(tmpdir(), `tinyclaw-purge-test-${suffix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Helper: run the CLI's purge command with given args.
 *
 * @param args - CLI arguments after `purge`
 * @param env - extra environment variables
 */
async function runPurge(
  args: string[] = [],
  env: Record<string, string> = {},
  timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, 'purge', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      ...env,
    },
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => {
      proc.kill();
      reject(new Error(`CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs),
  );

  const [stdout, stderr, exitCode] = await Promise.race([
    Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
    timeoutPromise,
  ]);

  return { stdout, stderr, exitCode };
}

// -----------------------------------------------------------------------
// Help integration
// -----------------------------------------------------------------------

describe('tinyclaw help includes purge', () => {
  test('help text mentions purge command', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(stdout).toContain('purge');
    expect(stdout).toContain('fresh install');
  });
});

// -----------------------------------------------------------------------
// Nothing to purge
// -----------------------------------------------------------------------

describe('tinyclaw purge — nothing to purge', () => {
  test('exits gracefully when data directory does not exist', async () => {
    const fakeDataDir = join(tmpdir(), `tinyclaw-nonexistent-${Date.now()}`);
    // Ensure it does NOT exist
    if (existsSync(fakeDataDir)) rmSync(fakeDataDir, { recursive: true, force: true });

    const { stdout, exitCode } = await runPurge(['--yes'], {
      TINYCLAW_DATA_DIR: fakeDataDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Nothing to purge');
  });
});

// -----------------------------------------------------------------------
// Default purge (data only, secrets preserved)
// -----------------------------------------------------------------------

describe('tinyclaw purge — default (data only)', () => {
  let tempDataDir: string;

  beforeEach(() => {
    tempDataDir = createTempDir('data');
    // Create some fake data files
    mkdirSync(join(tempDataDir, 'data'), { recursive: true });
    writeFileSync(join(tempDataDir, 'data', 'config.db'), 'fake-config');
    writeFileSync(join(tempDataDir, 'data', 'agent.db'), 'fake-agent');
    mkdirSync(join(tempDataDir, 'learning'), { recursive: true });
    writeFileSync(join(tempDataDir, 'learning', 'patterns.json'), '{}');
    mkdirSync(join(tempDataDir, 'heartware'), { recursive: true });
    writeFileSync(join(tempDataDir, 'heartware', 'IDENTITY.md'), '# Identity');
    mkdirSync(join(tempDataDir, 'audit'), { recursive: true });
    writeFileSync(join(tempDataDir, 'audit', 'log.txt'), 'audit-entry');
  });

  afterEach(() => {
    if (existsSync(tempDataDir)) {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  test('deletes the data directory after confirmation', async () => {
    expect(existsSync(tempDataDir)).toBe(true);
    expect(existsSync(join(tempDataDir, 'data'))).toBe(true);

    const { stdout, exitCode } = await runPurge(['--yes'], {
      TINYCLAW_DATA_DIR: tempDataDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Purge complete');
    expect(stdout).toContain('Data directory deleted');
    expect(existsSync(tempDataDir)).toBe(false);
    // data/ subdirectory must also be gone
    expect(existsSync(join(tempDataDir, 'data'))).toBe(false);
  });

  test('shows secrets preserved message when not using --force', async () => {
    const { stdout } = await runPurge(['--yes'], {
      TINYCLAW_DATA_DIR: tempDataDir,
    });

    expect(stdout).toContain('preserved');
  });
});

// -----------------------------------------------------------------------
// Force purge (data + secrets)
// -----------------------------------------------------------------------

describe('tinyclaw purge --force', () => {
  let tempDataDir: string;
  let tempSecretsDir: string;

  beforeEach(() => {
    tempDataDir = createTempDir('force-data');
    tempSecretsDir = createTempDir('force-secrets');
    // Populate both directories
    mkdirSync(join(tempDataDir, 'data'), { recursive: true });
    writeFileSync(join(tempDataDir, 'data', 'config.db'), 'fake');
    writeFileSync(join(tempSecretsDir, 'secrets.enc'), 'encrypted-key');
  });

  afterEach(() => {
    if (existsSync(tempDataDir)) rmSync(tempDataDir, { recursive: true, force: true });
    if (existsSync(tempSecretsDir)) rmSync(tempSecretsDir, { recursive: true, force: true });
  });

  test('deletes both data and secrets directories', async () => {
    expect(existsSync(tempDataDir)).toBe(true);
    expect(existsSync(tempSecretsDir)).toBe(true);

    const { stdout, exitCode } = await runPurge(['--force', '--yes'], {
      TINYCLAW_DATA_DIR: tempDataDir,
      TINYCLAW_SECRETS_DIR: tempSecretsDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Purge complete');
    expect(stdout).toContain('Data directory deleted');
    expect(stdout).toContain('Secrets store deleted');
    expect(existsSync(tempDataDir)).toBe(false);
    expect(existsSync(tempSecretsDir)).toBe(false);
  });

  test('warns about needing a new API key', async () => {
    const { stdout } = await runPurge(['--force', '--yes'], {
      TINYCLAW_DATA_DIR: tempDataDir,
      TINYCLAW_SECRETS_DIR: tempSecretsDir,
    });

    expect(stdout).toContain('Secrets were deleted');
  });
});
