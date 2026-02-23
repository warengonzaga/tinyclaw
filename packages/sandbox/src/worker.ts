/**
 * Sandbox Worker Script
 *
 * Runs inside a Bun Worker thread with restricted globals.
 * Receives code + config via postMessage, executes it, and
 * returns the result via postMessage.
 *
 * Security measures:
 *   - process, require, Bun globals are blocked
 *   - fetch/WebSocket blocked unless allowNet is true
 *   - __dirname, __filename removed
 *   - Self-terminates on timeout
 */

/// <reference lib="webworker" />

interface WorkerMessage {
  code: string;
  input?: unknown;
  config: {
    timeoutMs: number;
    allowNet: boolean;
    allowFs: boolean;
  };
}

interface WorkerResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

// Block dangerous globals before running user code
function lockdown(config: { allowNet: boolean; allowFs: boolean }): void {
  const BLOCKED_GLOBALS = ['process', 'require', '__dirname', '__filename'];

  for (const name of BLOCKED_GLOBALS) {
    try {
      Object.defineProperty(globalThis, name, {
        get() {
          throw new Error(`Access to '${name}' is blocked in sandbox`);
        },
        configurable: false,
      });
    } catch {
      // Already defined or non-configurable — skip
    }
  }

  // Block Bun global
  try {
    Object.defineProperty(globalThis, 'Bun', {
      get() {
        throw new Error("Access to 'Bun' is blocked in sandbox");
      },
      configurable: false,
    });
  } catch {
    // Already defined
  }

  // Block network unless explicitly allowed
  if (!config.allowNet) {
    (globalThis as any).fetch = () => {
      throw new Error('Network access blocked in sandbox');
    };
    (globalThis as any).WebSocket = undefined;
    (globalThis as any).XMLHttpRequest = undefined;
  }
}

// Listen for code execution requests
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { code, input, config } = event.data;
  const startTime = performance.now();

  // Set up timeout self-termination
  const timeout = setTimeout(() => {
    const result: WorkerResult = {
      success: false,
      output: '',
      error: `Execution timeout after ${config.timeoutMs}ms`,
      durationMs: config.timeoutMs,
    };
    self.postMessage(result);
    // Self-terminate after sending result
    setTimeout(() => self.close?.(), 10);
  }, config.timeoutMs);

  try {
    // Apply security lockdown
    lockdown(config);

    // Make input available to user code
    (globalThis as any).input = input;

    // Execute user code
    // We use AsyncFunction to support await in user code
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const fn = new AsyncFunction('input', code);
    const result = await fn(input);

    clearTimeout(timeout);

    const durationMs = Math.round(performance.now() - startTime);
    const output = result !== undefined ? String(result) : '';

    const response: WorkerResult = {
      success: true,
      output,
      durationMs,
    };

    self.postMessage(response);
  } catch (err: unknown) {
    clearTimeout(timeout);

    const durationMs = Math.round(performance.now() - startTime);
    const error = err instanceof Error ? err.message : String(err);

    const response: WorkerResult = {
      success: false,
      output: '',
      error,
      durationMs,
    };

    self.postMessage(response);
  }
};
