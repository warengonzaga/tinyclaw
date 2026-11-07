import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellExecutor, type ShellExecutor } from '../src/executor.js';

// Create temp helper scripts for cross-platform tests
const TEMP_DIR = join(tmpdir(), 'tinyclaw-shell-tests');
const SLEEP_SCRIPT = join(TEMP_DIR, 'sleep.js');
const BIGOUT_SCRIPT = join(TEMP_DIR, 'bigout.js');
const IS_WINDOWS = platform() === 'win32';
const PWD_COMMAND = IS_WINDOWS ? 'cd' : 'pwd';
const EMPTY_SUCCESS_COMMAND = IS_WINDOWS ? 'ver >nul' : 'true';
const FAILURE_COMMAND = IS_WINDOWS ? 'exit /b 1' : 'false';
const ENV_COMMAND = IS_WINDOWS ? 'set' : 'env';
const echoEnvCommand = (name: string) => (IS_WINDOWS ? `echo %${name}%` : `echo $${name}`);

describe('Shell Executor', () => {
  const executor: ShellExecutor = createShellExecutor({
    defaultTimeoutMs: 10_000,
    maxTimeoutMs: 30_000,
    maxOutputBytes: 5_000,
  });

  beforeAll(() => {
    mkdirSync(TEMP_DIR, { recursive: true });
    writeFileSync(SLEEP_SCRIPT, 'setTimeout(() => {}, 60000);');
    writeFileSync(
      BIGOUT_SCRIPT,
      'for (let i = 0; i < 500; i++) { console.log("Line " + i + ": This is a long line of output to test truncation behavior of the shell executor module"); }',
    );
  });

  afterAll(() => {
    try {
      unlinkSync(SLEEP_SCRIPT);
    } catch {}
    try {
      unlinkSync(BIGOUT_SCRIPT);
    } catch {}
  });

  // -----------------------------------------------------------------------
  // Basic execution
  // -----------------------------------------------------------------------

  describe('basic execution', () => {
    it('executes a simple echo command', async () => {
      const result = await executor.execute('echo hello world');
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('hello world');
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it('executes a working-directory command and returns a path', async () => {
      const result = await executor.execute(PWD_COMMAND);
      expect(result.success).toBe(true);
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    });

    it('captures stderr from failing commands', async () => {
      const result = await executor.execute('ls /nonexistent_directory_xyz_12345');
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      // stderr should contain an error message
      expect(result.stderr.length).toBeGreaterThan(0);
    });

    it('handles empty output commands', async () => {
      const result = await executor.execute(EMPTY_SUCCESS_COMMAND);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('returns non-zero exit codes', async () => {
      const result = await executor.execute(FAILURE_COMMAND);
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Timeout handling
  // -----------------------------------------------------------------------

  describe('timeout handling', () => {
    it('times out long-running commands', async () => {
      // Use a short timeout for the test
      const quickExecutor = createShellExecutor({
        defaultTimeoutMs: 1_000,
        maxTimeoutMs: 2_000,
      });

      const result = await quickExecutor.execute(`bun ${SLEEP_SCRIPT}`);
      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(124);
    }, 15_000);

    it('respects custom timeout parameter', async () => {
      const result = await executor.execute('echo fast', 5_000);
      expect(result.success).toBe(true);
      expect(result.durationMs).toBeLessThan(5_000);
    });

    it('clamps timeout to maxTimeoutMs', async () => {
      // Even if we request a very long timeout, it should be clamped
      const result = await executor.execute('echo clamped', 999_999);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Output truncation
  // -----------------------------------------------------------------------

  describe('output truncation', () => {
    it('truncates large output', async () => {
      // Run script that generates output larger than 5KB maxOutputBytes
      const result = await executor.execute(`bun ${BIGOUT_SCRIPT}`);
      expect(result.success).toBe(true);
      expect(result.truncated).toBe(true);
      expect(result.stdout).toContain('truncated');
    });

    it('does not truncate small output', async () => {
      const result = await executor.execute('echo "short output"');
      expect(result.success).toBe(true);
      expect(result.truncated).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Working directory
  // -----------------------------------------------------------------------

  describe('working directory', () => {
    it('executes in the configured working directory', async () => {
      const workingDirectory = tmpdir();
      const tempExecutor = createShellExecutor({
        workingDirectory,
      });

      const result = await tempExecutor.execute(PWD_COMMAND);
      expect(result.success).toBe(true);
      expect(result.stdout.trim().toLowerCase()).toBe(workingDirectory.toLowerCase());
    });

    it('allows updating the working directory', () => {
      const ex = createShellExecutor();
      const original = ex.getWorkingDirectory();
      const workingDirectory = tmpdir();

      ex.setWorkingDirectory(workingDirectory);
      expect(ex.getWorkingDirectory()).toBe(workingDirectory);

      // Restore
      ex.setWorkingDirectory(original);
    });
  });

  // -----------------------------------------------------------------------
  // Environment filtering
  // -----------------------------------------------------------------------

  describe('environment filtering', () => {
    it('does not expose sensitive environment variables', async () => {
      // Set a fake secret in the environment temporarily
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-test-secret-key';

      try {
        const result = await executor.execute(ENV_COMMAND);
        expect(result.success).toBe(true);
        expect(result.stdout).not.toContain('sk-test-secret-key');
        expect(result.stdout).not.toContain('OPENAI_API_KEY');
      } finally {
        if (originalKey !== undefined) {
          process.env.OPENAI_API_KEY = originalKey;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
      }
    });

    it('passes non-sensitive environment variables', async () => {
      const envExecutor = createShellExecutor({
        extraEnv: {
          TINYCLAW_SAFE_TEST_VALUE: 'visible-safe-value',
        },
      });

      const result = await envExecutor.execute(echoEnvCommand('TINYCLAW_SAFE_TEST_VALUE'));
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('visible-safe-value');
    });
  });

  // -----------------------------------------------------------------------
  // Stdin disabled
  // -----------------------------------------------------------------------

  describe('stdin disabled', () => {
    it('does not hang on commands expecting stdin', async () => {
      const quickExecutor = createShellExecutor({ defaultTimeoutMs: 3_000 });
      // `cat` with no args reads from stdin — with stdin ignored, it should exit quickly
      const result = await quickExecutor.execute('cat');
      // Should complete (either successfully or with error) instead of hanging
      expect(result.durationMs).toBeLessThan(3_000);
    });
  });

  // -----------------------------------------------------------------------
  // Duration tracking
  // -----------------------------------------------------------------------

  describe('duration tracking', () => {
    it('tracks execution duration', async () => {
      const result = await executor.execute('echo fast');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeLessThan(5_000);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('handles command not found gracefully', async () => {
      const result = await executor.execute('nonexistent_command_xyz_12345');
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });

    it('handles invalid working directory', async () => {
      const badExecutor = createShellExecutor({
        workingDirectory: '/nonexistent_dir_xyz_12345',
      });

      const result = await badExecutor.execute('echo test');
      expect(result.success).toBe(false);
    });
  });
});
