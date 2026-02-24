/**
 * Shell Executor
 *
 * Executes shell commands in a controlled environment using Bun.spawn.
 * Enforces:
 *   - Working directory confinement
 *   - Execution timeout (default 30s, max 120s)
 *   - Output truncation (max 10KB)
 *   - Environment variable filtering (strips sensitive vars)
 *   - No interactive/stdin access
 *   - Audit logging of all executions
 */

import { logger } from '@tinyclaw/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShellResult {
  /** Whether the command completed successfully (exit code 0). */
  success: boolean;
  /** Combined stdout output (truncated if necessary). */
  stdout: string;
  /** Combined stderr output (truncated if necessary). */
  stderr: string;
  /** Process exit code. */
  exitCode: number;
  /** Execution duration in milliseconds. */
  durationMs: number;
  /** Whether the command was killed due to timeout. */
  timedOut: boolean;
  /** Whether stdout was truncated. */
  truncated: boolean;
}

export interface ShellExecutorConfig {
  /** Default timeout in milliseconds (default: 30_000). */
  defaultTimeoutMs?: number;
  /** Maximum allowed timeout in milliseconds (default: 120_000). */
  maxTimeoutMs?: number;
  /** Maximum output size in bytes before truncation (default: 10_240). */
  maxOutputBytes?: number;
  /** Working directory for command execution. If unset, uses cwd. */
  workingDirectory?: string;
  /** Additional environment variables to pass. */
  extraEnv?: Record<string, string>;
}

export interface ShellExecutor {
  /** Execute a shell command and return the result. */
  execute(command: string, timeoutMs?: number): Promise<ShellResult>;
  /** Get the configured working directory. */
  getWorkingDirectory(): string;
  /** Update the working directory. */
  setWorkingDirectory(dir: string): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 10_240; // 10 KB

/**
 * Environment variables that are stripped before passing to child processes.
 * Prevents accidental exposure of secrets or tokens.
 */
const STRIPPED_ENV_VARS: ReadonlySet<string> = new Set([
  // API keys and tokens
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'AZURE_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'NPM_TOKEN',
  'DISCORD_TOKEN',
  'SLACK_TOKEN',
  'TELEGRAM_TOKEN',
  'HUGGINGFACE_TOKEN',
  'HF_TOKEN',
  // Database credentials
  'DATABASE_URL',
  'DB_PASSWORD',
  'REDIS_PASSWORD',
  'MONGO_PASSWORD',
  // Generic secret patterns
  'SECRET',
  'SECRET_KEY',
  'PRIVATE_KEY',
  'ACCESS_TOKEN',
  'REFRESH_TOKEN',
  'AUTH_TOKEN',
  'API_SECRET',
  'CLIENT_SECRET',
  'ENCRYPTION_KEY',
  'JWT_SECRET',
  'SESSION_SECRET',
  'COOKIE_SECRET',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Filter environment variables, stripping sensitive ones. */
function filterEnv(
  base: Record<string, string | undefined>,
  extra?: Record<string, string>,
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;

    // Strip known sensitive vars
    if (STRIPPED_ENV_VARS.has(key)) continue;

    // Strip vars with common secret-like naming patterns
    const upper = key.toUpperCase();
    if (
      upper.includes('_KEY') ||
      upper.includes('_SECRET') ||
      upper.includes('_TOKEN') ||
      upper.includes('_PASSWORD') ||
      upper.includes('_CREDENTIAL')
    ) {
      continue;
    }

    filtered[key] = value;
  }

  // Merge extra env (these are intentionally passed, so don't filter)
  if (extra) {
    Object.assign(filtered, extra);
  }

  return filtered;
}

/** Truncate output to max bytes with a truncation notice. */
function truncateOutput(output: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(output, 'utf-8');
  if (bytes <= maxBytes) {
    return { text: output, truncated: false };
  }

  // Find a clean cut point (don't break mid-line)
  const cutAt = maxBytes;
  const buf = Buffer.from(output, 'utf-8');
  const truncated = buf.subarray(0, cutAt).toString('utf-8');
  const lastNewline = truncated.lastIndexOf('\n');
  const cleanCut = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;

  return {
    text:
      cleanCut +
      `\n\n... [output truncated — ${bytes} bytes total, showing first ${Buffer.byteLength(cleanCut, 'utf-8')} bytes]`,
    truncated: true,
  };
}

/** Determine the shell and flag for the current platform. */
function getShellArgs(): [string, string] {
  if (process.platform === 'win32') {
    return ['cmd.exe', '/c'];
  }
  return ['/bin/sh', '-c'];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a shell executor with safety controls.
 *
 * @param config - Executor configuration
 */
export function createShellExecutor(config: ShellExecutorConfig = {}): ShellExecutor {
  const defaultTimeout = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTimeout = config.maxTimeoutMs ?? MAX_TIMEOUT_MS;
  const maxOutput = config.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  let workingDirectory = config.workingDirectory ?? process.cwd();
  const extraEnv = config.extraEnv;

  async function execute(command: string, timeoutMs?: number): Promise<ShellResult> {
    const timeout = Math.min(timeoutMs ?? defaultTimeout, maxTimeout);
    const startTime = Date.now();

    logger.debug('Shell execute', {
      command: command.slice(0, 120),
      timeout,
      cwd: workingDirectory,
    });

    const [shell, flag] = getShellArgs();
    const env = filterEnv(process.env as Record<string, string>, extraEnv);

    try {
      const proc = Bun.spawn([shell, flag, command], {
        cwd: workingDirectory,
        env,
        stdin: 'ignore', // No interactive input
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Start reading streams immediately (collect in parallel with process)
      const stdoutPromise = new Response(proc.stdout).text();
      const stderrPromise = new Response(proc.stderr).text();

      // Race between process completion and timeout
      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          proc.kill(9); // SIGKILL for immediate termination
          reject(new Error('timeout'));
        }, timeout);
      });

      let exitCode: number;
      try {
        exitCode = (await Promise.race([proc.exited, timeoutPromise])) as number;
      } catch {
        exitCode = 124; // Standard timeout exit code
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }

      const durationMs = Date.now() - startTime;

      // Read outputs with a short deadline to avoid hanging on killed processes
      let rawStdout = '';
      let rawStderr = '';

      if (timedOut) {
        // For killed processes, race stream reads with a 500ms deadline
        const streamDeadline = new Promise<string>((resolve) => setTimeout(() => resolve(''), 500));
        [rawStdout, rawStderr] = await Promise.all([
          Promise.race([stdoutPromise, streamDeadline]),
          Promise.race([stderrPromise, streamDeadline]),
        ]);
      } else {
        [rawStdout, rawStderr] = await Promise.all([stdoutPromise, stderrPromise]);
      }

      const { text: stdout, truncated: stdoutTruncated } = truncateOutput(rawStdout, maxOutput);
      const { text: stderr } = truncateOutput(rawStderr, maxOutput);

      const result: ShellResult = {
        success: exitCode === 0 && !timedOut,
        stdout,
        stderr,
        exitCode,
        durationMs,
        timedOut,
        truncated: stdoutTruncated,
      };

      logger.debug('Shell result', {
        exitCode,
        durationMs,
        timedOut,
        stdoutLen: rawStdout.length,
        stderrLen: rawStderr.length,
      });

      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      logger.error('Shell execution failed', { command: command.slice(0, 80), error: message });

      return {
        success: false,
        stdout: '',
        stderr: `Execution error: ${message}`,
        exitCode: 1,
        durationMs,
        timedOut: false,
        truncated: false,
      };
    }
  }

  return {
    execute,
    getWorkingDirectory: () => workingDirectory,
    setWorkingDirectory: (dir: string) => {
      workingDirectory = dir;
    },
  };
}
