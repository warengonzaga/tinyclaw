/**
 * Code Execution Sandbox (v3)
 *
 * Lightweight sandboxed code execution using Bun Worker threads
 * with a permission guard layer.
 *
 * Why Bun Workers beat Docker:
 *   | Feature          | Docker (mrcloudchase)  | Bun Workers (Tiny Claw) |
 *   |------------------|------------------------|------------------------|
 *   | Boot time        | 1-3 seconds            | <1ms                   |
 *   | Memory overhead  | ~50MB per container     | ~1MB per worker        |
 *   | Dependency       | Docker daemon required  | None — built into Bun  |
 *   | Portability      | Linux/Mac (daemon)      | Everywhere Bun runs    |
 *   | Teardown         | Container cleanup       | Worker.terminate()     |
 *
 * Security model:
 *   - process, require, Bun globals are blocked
 *   - fetch/WebSocket blocked by default (allowNet: false)
 *   - Filesystem access blocked by default (allowFs: false)
 *   - Configurable timeout with hard kill
 *   - Each execution runs in a fresh worker (no state leakage)
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export interface SandboxConfig {
  /** Execution timeout in ms. Default: 10_000 (10s). Max: 30_000 (30s). */
  timeoutMs?: number;
  /** Allow network access (fetch, WebSocket). Default: false. */
  allowNet?: boolean;
  /** Allow filesystem access. Default: false. */
  allowFs?: boolean;
}

export interface Sandbox {
  /** Execute JavaScript/TypeScript code in isolation. */
  execute(code: string, config?: SandboxConfig): Promise<SandboxResult>;
  /** Execute with input data (passed as `input` variable in sandbox). */
  executeWithInput(code: string, input: unknown, config?: SandboxConfig): Promise<SandboxResult>;
  /** Terminate all running workers. */
  shutdown(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000; // 10 seconds
const MAX_TIMEOUT_MS = 30_000; // 30 seconds

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSandbox(): Sandbox {
  const activeWorkers = new Set<Worker>();

  // Resolve worker path relative to this module
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const workerPath = join(currentDir, 'worker.ts');

  async function runInWorker(
    code: string,
    input: unknown | undefined,
    config: SandboxConfig = {},
  ): Promise<SandboxResult> {
    const timeoutMs = Math.min(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const allowNet = config.allowNet ?? false;
    const allowFs = config.allowFs ?? false;

    return new Promise<SandboxResult>((resolve) => {
      let resolved = false;

      const worker = new Worker(workerPath);
      activeWorkers.add(worker);

      // Hard timeout — kill worker if it doesn't respond
      const hardTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          worker.terminate();
          activeWorkers.delete(worker);
          resolve({
            success: false,
            output: '',
            error: `Execution timeout after ${timeoutMs}ms (hard kill)`,
            durationMs: timeoutMs,
          });
        }
      }, timeoutMs + 1000); // Give worker 1s grace period to self-terminate

      worker.onmessage = (event: MessageEvent) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(hardTimeout);
          worker.terminate();
          activeWorkers.delete(worker);
          resolve(event.data as SandboxResult);
        }
      };

      worker.onerror = (error: ErrorEvent) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(hardTimeout);
          worker.terminate();
          activeWorkers.delete(worker);
          resolve({
            success: false,
            output: '',
            error: error.message || 'Worker error',
            durationMs: 0,
          });
        }
      };

      // Send code to worker
      worker.postMessage({
        code,
        input,
        config: { timeoutMs, allowNet, allowFs },
      });
    });
  }

  return {
    async execute(code: string, config?: SandboxConfig): Promise<SandboxResult> {
      return runInWorker(code, undefined, config);
    },

    async executeWithInput(
      code: string,
      input: unknown,
      config?: SandboxConfig,
    ): Promise<SandboxResult> {
      return runInWorker(code, input, config);
    },

    shutdown(): void {
      for (const worker of activeWorkers) {
        try {
          worker.terminate();
        } catch {
          // Ignore termination errors
        }
      }
      activeWorkers.clear();
    },
  };
}
