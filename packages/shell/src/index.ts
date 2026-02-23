/**
 * Shell Public API
 *
 * Controlled shell execution for Tiny Claw AI agents.
 * Combines the permission engine (safe allowlist + approval store)
 * with the shell executor (Bun.spawn + safety controls) and exposes
 * agent tools for shell interaction.
 *
 * Safety layers:
 *   1. Permission engine — allowlist + blocklist + approval store
 *   2. Shield integration — runtime SHIELD.md threat evaluation
 *   3. Owner authority — only the owner can run shell commands
 *   4. Executor safety — timeout, output truncation, env filtering
 *
 * @example
 * ```typescript
 * import { createShellEngine, createShellTools } from '@tinyclaw/shell';
 *
 * const shell = createShellEngine({ workingDirectory: '/project' });
 * const tools = createShellTools(shell);
 * ```
 */

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  createShellExecutor,
  type ShellExecutor,
  type ShellExecutorConfig,
  type ShellResult,
} from './executor.js';
export {
  createPermissionEngine,
  type ShellApproval,
  type ShellDecision,
  type ShellPermissionEngine,
  type ShellPermissionResult,
} from './permissions.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tool names provided by the shell package (used by the loop to skip redundant shield approval). */
export const SHELL_TOOL_NAMES = ['run_shell', 'shell_approve', 'shell_allow'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { logger } from '@tinyclaw/logger';
import type { Tool } from '@tinyclaw/types';
import { createShellExecutor, type ShellExecutor, type ShellExecutorConfig } from './executor.js';
import {
  createPermissionEngine,
  type ShellApproval,
  type ShellPermissionEngine,
} from './permissions.js';

export interface ShellEngineConfig extends ShellExecutorConfig {
  /** Additional allow patterns from user config. */
  allowPatterns?: string[];
  /** Previously persisted approvals to restore. */
  savedApprovals?: ShellApproval[];
}

export interface ShellEngine {
  /** The permission engine for evaluating commands. */
  permissions: ShellPermissionEngine;
  /** The shell executor for running commands. */
  executor: ShellExecutor;
  /**
   * Execute a command with full permission checks.
   * Returns a formatted result string suitable for the agent.
   */
  run(command: string, timeoutMs?: number): Promise<string>;
  /** Shutdown and clean up resources. */
  shutdown(): void;
}

// ---------------------------------------------------------------------------
// Shell Engine Factory
// ---------------------------------------------------------------------------

/**
 * Create a shell engine that combines permission checks with execution.
 */
export function createShellEngine(config: ShellEngineConfig = {}): ShellEngine {
  const permissions = createPermissionEngine(
    config.allowPatterns ?? [],
    config.savedApprovals ?? [],
  );

  const executor = createShellExecutor(config);

  async function run(command: string, timeoutMs?: number): Promise<string> {
    // Check permissions first
    const check = permissions.evaluate(command);

    if (check.decision === 'deny') {
      return `Shell command denied: ${check.reason}`;
    }

    if (check.decision === 'require_approval') {
      return (
        `This command requires owner approval before it can run.\n` +
        `Command: ${command}\n` +
        `Reason: ${check.reason}\n\n` +
        `Ask the owner to approve this command using the shell_approve tool, ` +
        `or add it to the allowlist with shell_allow.`
      );
    }

    // Permission granted — execute
    const result = await executor.execute(command, timeoutMs);

    // Format output for the agent
    const parts: string[] = [];

    if (result.timedOut) {
      parts.push(`[Command timed out after ${result.durationMs}ms]`);
    }

    if (result.stdout) {
      parts.push(result.stdout);
    }

    if (result.stderr) {
      parts.push(`[stderr] ${result.stderr}`);
    }

    if (!result.stdout && !result.stderr) {
      parts.push(
        result.success ? '(command completed with no output)' : '(command failed with no output)',
      );
    }

    if (!result.success && !result.timedOut) {
      parts.push(`[exit code: ${result.exitCode}]`);
    }

    if (result.truncated) {
      parts.push('[note: output was truncated]');
    }

    return parts.join('\n');
  }

  function shutdown(): void {
    permissions.clearSessionApprovals();
    logger.info('Shell engine shut down');
  }

  return {
    permissions,
    executor,
    run,
    shutdown,
  };
}

// ---------------------------------------------------------------------------
// Tool Factory
// ---------------------------------------------------------------------------

/**
 * Create agent tools for shell interaction.
 *
 * Returns 3 tools:
 *   - `run_shell` — Execute a shell command
 *   - `shell_approve` — Approve a pending command
 *   - `shell_allow` — Add a command pattern to the allowlist
 */
export function createShellTools(shell: ShellEngine): Tool[] {
  const runShellTool: Tool = {
    name: 'run_shell',
    description:
      'Execute a shell command in a controlled environment. ' +
      'Commands are checked against a permission system: safe read-only commands ' +
      '(ls, cat, grep, git status, etc.) run automatically. Commands not in the ' +
      'allowlist require owner approval first. Dangerous operations (sudo, rm -rf /, ' +
      'eval, etc.) are always blocked. ' +
      'Output is truncated at 10KB. Timeout is 30s by default (max 120s). ' +
      'No interactive commands (stdin is disabled). ' +
      'Environment variables with secrets/tokens are filtered out.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Override timeout in milliseconds (max 120000)',
        },
      },
      required: ['command'],
    },
    async execute(args) {
      const command = String(args.command || '').trim();
      if (!command) return 'Error: command is required.';

      const timeout = args.timeout ? Math.min(Number(args.timeout), 120_000) : undefined;
      return shell.run(command, timeout);
    },
  };

  const shellApproveTool: Tool = {
    name: 'shell_approve',
    description:
      'Approve a shell command that was previously blocked by the permission system. ' +
      'Only the owner can approve commands. Use this after run_shell returns a ' +
      '"requires owner approval" message. Set persistent=true to remember this ' +
      'approval across sessions.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The exact command string to approve',
        },
        persistent: {
          type: 'boolean',
          description: 'Whether to persist the approval across sessions (default: false)',
        },
      },
      required: ['command'],
    },
    async execute(args) {
      const command = String(args.command || '').trim();
      if (!command) return 'Error: command is required.';

      const persistent = Boolean(args.persistent);

      // Re-check dangerous patterns — never approve those
      const check = shell.permissions.evaluate(command);
      if (check.decision === 'deny') {
        return `Cannot approve this command: ${check.reason}`;
      }

      shell.permissions.approve(command, persistent);
      return (
        `Command approved${persistent ? ' (persistent)' : ' (this session only)'}. ` +
        `You can now run it with run_shell.`
      );
    },
  };

  const shellAllowTool: Tool = {
    name: 'shell_allow',
    description:
      'Add a command pattern to the shell allowlist. Patterns support glob-style ' +
      'matching: "make *" allows all make targets, "docker ps" allows that specific ' +
      'command. Added patterns persist for the current session. ' +
      'Use action="list" to see current patterns, action="remove" to remove one.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action to perform: "add", "remove", or "list"',
          enum: ['add', 'remove', 'list'],
        },
        pattern: {
          type: 'string',
          description: 'The command pattern to add or remove (not needed for "list")',
        },
      },
      required: ['action'],
    },
    async execute(args) {
      const action = String(args.action || 'add');

      if (action === 'list') {
        const patterns = shell.permissions.listAllowPatterns();
        const approvals = shell.permissions.listApprovals();

        const lines: string[] = ['Shell Permission Status:'];

        if (patterns.length > 0) {
          lines.push('\nAllow Patterns:');
          for (const p of patterns) {
            lines.push(`  • ${p}`);
          }
        } else {
          lines.push('\nNo custom allow patterns configured.');
        }

        if (approvals.length > 0) {
          lines.push(`\nApproved Commands (${approvals.length}):`);
          for (const a of approvals) {
            const tag = a.persistent ? '[persistent]' : '[session]';
            lines.push(`  • ${a.command} ${tag}`);
          }
        } else {
          lines.push('\nNo approved commands.');
        }

        return lines.join('\n');
      }

      const pattern = String(args.pattern || '').trim();
      if (!pattern) return 'Error: pattern is required for add/remove actions.';

      if (action === 'add') {
        shell.permissions.addAllowPattern(pattern);
        return `Added allow pattern: "${pattern}"`;
      }

      if (action === 'remove') {
        const removed = shell.permissions.removeAllowPattern(pattern);
        return removed
          ? `Removed allow pattern: "${pattern}"`
          : `Pattern "${pattern}" was not in the allowlist.`;
      }

      return `Unknown action: "${action}". Use "add", "remove", or "list".`;
    },
  };

  return [runShellTool, shellApproveTool, shellAllowTool];
}
