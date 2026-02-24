/**
 * Tests for the CLI main router (index.ts).
 *
 * Spawns the CLI as a child process with various arguments
 * and validates stdout / exit codes.
 */

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const CLI_ENTRY = resolve(__dirname, '../src/index.ts');

/**
 * Helper: run the CLI with given args and return stdout, stderr, exitCode.
 */
async function runCLI(
  args: string[] = [],
  timeoutMs = 10_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      // Disable color output for predictable assertions
      NO_COLOR: '1',
      FORCE_COLOR: '0',
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
// --version / -v
// -----------------------------------------------------------------------

describe('tinyclaw --version', () => {
  test('prints the version and exits 0', async () => {
    const { stdout, exitCode } = await runCLI(['--version']);
    expect(exitCode).toBe(0);
    // Should be a semver string or "unknown"
    const trimmed = stdout.trim();
    const isSemver = /^\d+\.\d+\.\d+/.test(trimmed);
    expect(isSemver || trimmed === 'unknown').toBe(true);
  });

  test('-v is an alias for --version', async () => {
    const { stdout: full } = await runCLI(['--version']);
    const { stdout: short } = await runCLI(['-v']);
    expect(full.trim()).toBe(short.trim());
  });
});

// -----------------------------------------------------------------------
// --help / -h / no args
// -----------------------------------------------------------------------

describe('tinyclaw --help', () => {
  test('prints help text and exits 0', async () => {
    const { stdout, exitCode } = await runCLI(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage');
    expect(stdout).toContain('Commands');
    expect(stdout).toContain('setup');
    expect(stdout).toContain('start');
  });

  test('-h is an alias for --help', async () => {
    const { stdout: full, exitCode: code1 } = await runCLI(['--help']);
    const { stdout: short, exitCode: code2 } = await runCLI(['-h']);
    expect(code1).toBe(0);
    expect(code2).toBe(0);
    expect(full).toBe(short);
  });

  test('no args shows help', async () => {
    const { stdout, exitCode } = await runCLI([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage');
    expect(stdout).toContain('Commands');
  });
});

// -----------------------------------------------------------------------
// Help text content
// -----------------------------------------------------------------------

describe('help text content', () => {
  test('displays available options', async () => {
    const { stdout } = await runCLI(['--help']);
    expect(stdout).toContain('Options');
    expect(stdout).toContain('--version');
    expect(stdout).toContain('--help');
  });

  test('shows the Tiny Claw banner', async () => {
    const { stdout } = await runCLI(['--help']);
    expect(stdout).toContain('Tiny Claw');
  });
});

// -----------------------------------------------------------------------
// Unknown command
// -----------------------------------------------------------------------

describe('unknown command', () => {
  test('prints error for unknown command and exits 1', async () => {
    const { stdout, exitCode } = await runCLI(['foobar']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Unknown command');
    expect(stdout).toContain('foobar');
  });

  test('still shows help after unknown command error', async () => {
    const { stdout } = await runCLI(['nonexistent']);
    expect(stdout).toContain('Usage');
    expect(stdout).toContain('Commands');
  });
});
