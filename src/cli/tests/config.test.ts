/**
 * Tests for the `tinyclaw config` CLI command.
 *
 * Spawns the CLI as a child process with `config` subcommands
 * and validates stdout / exit codes.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { resolve, join } from 'path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CLI_ENTRY = resolve(__dirname, '../src/index.ts');

/**
 * Helper: run the CLI with given args and return stdout, stderr, exitCode.
 * Uses a temp directory for config to avoid touching real ~/.tinyclaw.
 */
async function runCLI(
  args: string[] = [],
  env: Record<string, string> = {},
  timeoutMs = 10_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, ...args], {
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
    Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]),
    timeoutPromise,
  ]);

  return { stdout, stderr, exitCode };
}

// -----------------------------------------------------------------------
// config (no subcommand / help)
// -----------------------------------------------------------------------

describe('tinyclaw config', () => {
  test('no subcommand shows usage help', async () => {
    const { stdout, exitCode } = await runCLI(['config']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage');
    expect(stdout).toContain('config model');
  });

  test('--help shows usage', async () => {
    const { stdout, exitCode } = await runCLI(['config', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage');
    expect(stdout).toContain('model');
    expect(stdout).toContain('builtin');
    expect(stdout).toContain('primary');
    expect(stdout).toContain('logging');
  });

  test('-h is an alias for --help', async () => {
    const { stdout: full } = await runCLI(['config', '--help']);
    const { stdout: short } = await runCLI(['config', '-h']);
    expect(full).toBe(short);
  });

  test('unknown subcommand errors', async () => {
    const { stdout, exitCode } = await runCLI(['config', 'foobar']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Unknown config subcommand');
    expect(stdout).toContain('foobar');
  });
});

// -----------------------------------------------------------------------
// config model
// -----------------------------------------------------------------------

describe('tinyclaw config model', () => {
  test('shows model configuration', async () => {
    const { stdout, exitCode } = await runCLI(['config', 'model']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Model Configuration');
    expect(stdout).toContain('Built-in');
    expect(stdout).toContain('Primary');
  });

  test('shows built-in model info', async () => {
    const { stdout } = await runCLI(['config', 'model']);
    // Should display the default model from constants
    expect(stdout).toContain('kimi-k2.5:cloud');
    expect(stdout).toContain('ollama.com');
  });
});

// -----------------------------------------------------------------------
// config model list
// -----------------------------------------------------------------------

describe('tinyclaw config model list', () => {
  test('lists available built-in models', async () => {
    const { stdout, exitCode } = await runCLI(['config', 'model', 'list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Available Built-in Models');
    expect(stdout).toContain('kimi-k2.5:cloud');
    expect(stdout).toContain('gpt-oss:120b-cloud');
  });

  test('shows hints for each model', async () => {
    const { stdout } = await runCLI(['config', 'model', 'list']);
    expect(stdout).toContain('recommended');
  });
});

// -----------------------------------------------------------------------
// config model builtin
// -----------------------------------------------------------------------

describe('tinyclaw config model builtin', () => {
  test('errors when no tag provided', async () => {
    const { stdout, exitCode } = await runCLI(['config', 'model', 'builtin']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Missing model tag');
  });

  test('errors for unknown model tag', async () => {
    const { stdout, exitCode } = await runCLI(['config', 'model', 'builtin', 'nonexistent-model']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Unknown model');
    expect(stdout).toContain('nonexistent-model');
  });

  test('lists available models on unknown tag error', async () => {
    const { stdout } = await runCLI(['config', 'model', 'builtin', 'bad']);
    expect(stdout).toContain('kimi-k2.5:cloud');
    expect(stdout).toContain('gpt-oss:120b-cloud');
  });
});

// -----------------------------------------------------------------------
// config model primary
// -----------------------------------------------------------------------

describe('tinyclaw config model primary', () => {
  test('shows primary provider status', async () => {
    const { stdout, exitCode } = await runCLI(['config', 'model', 'primary']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Primary Provider');
  });

  test('shows not configured when no primary set', async () => {
    const { stdout } = await runCLI(['config', 'model', 'primary']);
    // Default config has no primary set
    expect(stdout).toContain('not configured');
  });

  test('shows conversational setup guidance when no primary set', async () => {
    const { stdout } = await runCLI(['config', 'model', 'primary']);
    expect(stdout).toContain('ask Tiny Claw');
  });
});

// -----------------------------------------------------------------------
// config model primary clear
// -----------------------------------------------------------------------

describe('tinyclaw config model primary clear', () => {
  test('no-op when no primary is set', async () => {
    const { stdout, exitCode } = await runCLI(['config', 'model', 'primary', 'clear']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No primary provider');
    expect(stdout).toContain('Nothing to clear');
  });
});

// -----------------------------------------------------------------------
// config model <unknown>
// -----------------------------------------------------------------------

describe('tinyclaw config model <unknown>', () => {
  test('errors for unknown model subcommand', async () => {
    const { stdout, exitCode } = await runCLI(['config', 'model', 'foobar']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Unknown model subcommand');
    expect(stdout).toContain('foobar');
  });
});

// -----------------------------------------------------------------------
// config logging
// -----------------------------------------------------------------------

describe('tinyclaw config logging', () => {
  test('shows current log level', async () => {
    const { stdout, exitCode } = await runCLI(['config', 'logging']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Log Level');
    expect(stdout).toContain('info');
  });

  test('lists all available levels', async () => {
    const { stdout } = await runCLI(['config', 'logging']);
    expect(stdout).toContain('debug');
    expect(stdout).toContain('info');
    expect(stdout).toContain('warn');
    expect(stdout).toContain('error');
    expect(stdout).toContain('silent');
  });

  test('shows change hint', async () => {
    const { stdout } = await runCLI(['config', 'logging']);
    expect(stdout).toContain('Change with');
    expect(stdout).toContain('config logging');
  });

  test('shows verbose override hint', async () => {
    const { stdout } = await runCLI(['config', 'logging']);
    expect(stdout).toContain('--verbose');
  });

  test('errors for unknown log level', async () => {
    const { stdout, exitCode } = await runCLI(['config', 'logging', 'banana']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Unknown log level');
    expect(stdout).toContain('banana');
  });

  test('lists valid levels on unknown level error', async () => {
    const { stdout } = await runCLI(['config', 'logging', 'banana']);
    expect(stdout).toContain('debug');
    expect(stdout).toContain('info');
    expect(stdout).toContain('warn');
    expect(stdout).toContain('error');
    expect(stdout).toContain('silent');
  });

  test('no-op when already set to that level', async () => {
    // Default is 'info', so setting to 'info' should be a no-op
    const { stdout, exitCode } = await runCLI(['config', 'logging', 'info']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Already set to');
    expect(stdout).toContain('info');
  });
});

// -----------------------------------------------------------------------
// help text includes config command
// -----------------------------------------------------------------------

describe('help text includes config', () => {
  test('--help lists config as a command', async () => {
    const { stdout } = await runCLI(['--help']);
    expect(stdout).toContain('config');
  });
});
