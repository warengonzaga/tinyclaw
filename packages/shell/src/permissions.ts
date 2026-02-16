/**
 * Shell Permission Engine
 *
 * Safe-by-default permission system for shell command execution.
 * All commands are DENIED unless explicitly allowed by:
 *   1. Built-in safe allowlist (basic read-only commands)
 *   2. User-configured allowed commands/patterns
 *   3. One-time owner approval (stored for future use)
 *
 * Even allowed commands are checked against a hardcoded blocklist
 * of dangerous patterns that can never be bypassed.
 */

import { logger } from '@tinyclaw/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShellDecision = 'allow' | 'deny' | 'require_approval';

export interface ShellPermissionResult {
  decision: ShellDecision;
  reason: string;
  /** Which rule matched (for audit trail). */
  matchedRule?: string;
}

export interface ShellApproval {
  /** The command pattern that was approved. */
  command: string;
  /** Whether this approval persists across sessions. */
  persistent: boolean;
  /** Timestamp when approval was granted. */
  approvedAt: number;
}

export interface ShellPermissionEngine {
  /** Evaluate whether a command is allowed. */
  evaluate(command: string): ShellPermissionResult;
  /** Record a one-time approval from the owner. */
  approve(command: string, persistent?: boolean): void;
  /** Revoke a previously granted approval. */
  revoke(command: string): boolean;
  /** List all current approvals. */
  listApprovals(): ShellApproval[];
  /** Clear all one-time (non-persistent) approvals. */
  clearSessionApprovals(): number;
  /** Add a command or glob pattern to the user allowlist. */
  addAllowPattern(pattern: string): void;
  /** Remove a pattern from the user allowlist. */
  removeAllowPattern(pattern: string): boolean;
  /** List user-configured allow patterns. */
  listAllowPatterns(): string[];
}

// ---------------------------------------------------------------------------
// Built-in Safe Allowlist
// ---------------------------------------------------------------------------

/**
 * Commands considered safe for read-only system interaction.
 * These pass without owner approval. Each entry is matched against
 * the base command (first token) of the user's input.
 */
const SAFE_COMMANDS: ReadonlySet<string> = new Set([
  // Filesystem reading
  'ls',
  'dir',
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'wc',
  'file',
  'find',
  'locate',
  'tree',
  'stat',
  'du',
  'df',
  // Text processing (read-only)
  'grep',
  'awk',
  'sed',
  'sort',
  'uniq',
  'cut',
  'tr',
  'diff',
  'comm',
  'tee',
  // System info
  'echo',
  'printf',
  'pwd',
  'whoami',
  'hostname',
  'uname',
  'date',
  'uptime',
  'env',
  'printenv',
  'which',
  'where',
  'type',
  'id',
  'arch',
  // Package/runtime version checks
  'node',
  'bun',
  'deno',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'python',
  'python3',
  'pip',
  'pip3',
  'cargo',
  'rustc',
  'go',
  'java',
  'javac',
  // Git (read-only operations handled by pattern check below)
  'git',
  // Network diagnostics
  'ping',
  'curl',
  'wget',
  'dig',
  'nslookup',
  'traceroute',
  'tracert',
  'netstat',
  'ss',
  // Process info
  'ps',
  'top',
  'htop',
  'lsof',
]);

/**
 * Git subcommands that are safe (read-only).
 * Write operations like push, commit, reset require approval.
 */
const SAFE_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'tag',
  'remote',
  'stash',
  'blame',
  'shortlog',
  'describe',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'ls-remote',
  'config',
  'reflog',
  'cherry',
  'name-rev',
  'rev-list',
]);

/**
 * Node/Bun/npm subcommands that are safe (info only).
 */
const SAFE_RUNTIME_SUBCOMMANDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['node', new Set(['--version', '-v', '-e', '--eval'])],
  ['bun', new Set(['--version', '-v', '--revision', 'pm', 'x'])],
  ['npm', new Set(['--version', '-v', 'ls', 'list', 'view', 'info', 'show', 'outdated', 'audit', 'doctor', 'explain', 'why', 'search', 'help'])],
  ['yarn', new Set(['--version', '-v', 'info', 'list', 'why', 'audit'])],
  ['pnpm', new Set(['--version', '-v', 'ls', 'list', 'why', 'audit', 'outdated'])],
  ['pip', new Set(['--version', 'list', 'show', 'freeze', 'check'])],
  ['pip3', new Set(['--version', 'list', 'show', 'freeze', 'check'])],
  ['cargo', new Set(['--version', '-V', 'tree', 'metadata', 'pkgid', 'verify-project'])],
  ['go', new Set(['version', 'env', 'list', 'doc', 'vet'])],
]);

// ---------------------------------------------------------------------------
// Dangerous Patterns (always blocked)
// ---------------------------------------------------------------------------

/**
 * Patterns that are ALWAYS blocked regardless of allowlist.
 * These represent commands that can cause irreversible damage,
 * escalate privileges, or exfiltrate data.
 */
const DANGEROUS_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  // Destructive filesystem operations
  { pattern: /\brm\s+(-[a-z]*r[a-z]*\s+)?(-[a-z]*f[a-z]*\s+)?\/\s*$/i, reason: 'Recursive delete of root filesystem' },
  { pattern: /\brm\s+.*-[a-z]*r[a-z]*f[a-z]*\s+\//i, reason: 'Forced recursive delete from root' },
  { pattern: /\bmkfs\b/i, reason: 'Filesystem formatting' },
  { pattern: /\bdd\b.*\bof=\/dev\//i, reason: 'Raw device write' },
  { pattern: />\s*\/dev\/[sh]d[a-z]/i, reason: 'Direct device write' },
  // Privilege escalation
  { pattern: /\bsudo\b/i, reason: 'Privilege escalation via sudo' },
  { pattern: /\bsu\s+/i, reason: 'User switch' },
  { pattern: /\bchmod\s+[0-7]*7[0-7]*\s/i, reason: 'World-writable permission' },
  { pattern: /\bchown\b/i, reason: 'Ownership change' },
  // Code injection / shell spawning
  { pattern: /\beval\b/i, reason: 'Dynamic code evaluation' },
  { pattern: /\bexec\b/i, reason: 'Process replacement' },
  { pattern: /\bsource\b/i, reason: 'Script sourcing' },
  { pattern: /\|\s*(ba)?sh\b/i, reason: 'Pipe to shell interpreter' },
  { pattern: /\|\s*zsh\b/i, reason: 'Pipe to zsh' },
  { pattern: /\$\(.*\)/i, reason: 'Command substitution' },
  { pattern: /`[^`]+`/, reason: 'Backtick command substitution' },
  // Network exfiltration
  { pattern: /\bnc\b.*-[a-z]*l/i, reason: 'Netcat listener (reverse shell)' },
  { pattern: /\bncat\b/i, reason: 'Ncat (network tool)' },
  { pattern: /\/dev\/tcp\//i, reason: 'Bash network device' },
  // System modification
  { pattern: /\bshutdown\b/i, reason: 'System shutdown' },
  { pattern: /\breboot\b/i, reason: 'System reboot' },
  { pattern: /\bsystemctl\b/i, reason: 'Service management' },
  { pattern: /\bservice\s+/i, reason: 'Service management' },
  { pattern: /\bcrontab\s+-[re]/i, reason: 'Crontab modification' },
  // Environment/credential access
  { pattern: /\bexport\b/i, reason: 'Environment modification' },
  { pattern: /\bunset\b/i, reason: 'Environment variable removal' },
  { pattern: /\.env\b/i, reason: 'Environment file access' },
  { pattern: /\b(ssh|scp|sftp)\b/i, reason: 'Remote access' },
  // History/log tampering
  { pattern: /\bhistory\s+-[cdw]/i, reason: 'History manipulation' },
  { pattern: />\s*\/var\/log\//i, reason: 'Log tampering' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the base command (first token) from a shell command string. */
function extractBaseCommand(command: string): string {
  const trimmed = command.trim();
  // Skip env prefixes like KEY=val, PATH=..., etc.
  const withoutEnvVars = trimmed.replace(/^(\w+=\S+\s+)+/, '');
  const firstToken = withoutEnvVars.split(/\s+/)[0] || '';
  // Strip path prefixes (e.g. /usr/bin/ls → ls)
  return firstToken.replace(/^.*[/\\]/, '');
}

/** Extract the subcommand (second token) from a shell command string. */
function extractSubcommand(command: string): string | null {
  const trimmed = command.trim();
  const withoutEnvVars = trimmed.replace(/^(\w+=\S+\s+)+/, '');
  const tokens = withoutEnvVars.split(/\s+/);
  // Skip flags to find the subcommand
  for (let i = 1; i < tokens.length; i++) {
    if (!tokens[i].startsWith('-')) return tokens[i];
  }
  return tokens[1] || null;
}

/** Match a command against a glob-like pattern. */
function matchesPattern(command: string, pattern: string): boolean {
  // Exact match
  if (command === pattern) return true;

  const base = extractBaseCommand(command);

  // Base command match (e.g., pattern "ls" matches "ls -la")
  if (base === pattern) return true;

  // Glob-style: pattern "git *" matches "git status", "git log", etc.
  if (pattern.endsWith(' *')) {
    const prefix = pattern.slice(0, -2);
    if (command.startsWith(prefix + ' ') || command === prefix) return true;
  }

  // Prefix pattern: "npm run *" matches "npm run build"
  if (pattern.includes('*')) {
    const regex = new RegExp(
      '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '*' ? '.*' : '\\' + m)) + '$',
    );
    if (regex.test(command)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a shell permission engine.
 *
 * @param userPatterns - Additional allow patterns from config
 * @param savedApprovals - Previously persisted approvals to restore
 */
export function createPermissionEngine(
  userPatterns: string[] = [],
  savedApprovals: ShellApproval[] = [],
): ShellPermissionEngine {
  const allowPatterns = new Set<string>(userPatterns);
  const approvals = new Map<string, ShellApproval>();

  // Restore saved approvals
  for (const approval of savedApprovals) {
    approvals.set(approval.command, approval);
  }

  function evaluate(command: string): ShellPermissionResult {
    const trimmed = command.trim();

    if (!trimmed) {
      return { decision: 'deny', reason: 'Empty command' };
    }

    // --- Step 1: Check dangerous patterns (always blocked) ---
    for (const { pattern, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        logger.warn('Shell command blocked by dangerous pattern', {
          command: trimmed.slice(0, 80),
          reason,
        });
        return {
          decision: 'deny',
          reason: `Blocked: ${reason}`,
          matchedRule: `dangerous:${pattern.source}`,
        };
      }
    }

    const base = extractBaseCommand(trimmed);
    const sub = extractSubcommand(trimmed);

    // --- Step 2: Check built-in safe commands ---

    // Special handling for git: only read-only subcommands are auto-allowed
    if (base === 'git') {
      if (sub && SAFE_GIT_SUBCOMMANDS.has(sub)) {
        return {
          decision: 'allow',
          reason: `Safe git subcommand: ${sub}`,
          matchedRule: `builtin:git.${sub}`,
        };
      }
      // Non-safe git subcommands need approval
      return {
        decision: 'require_approval',
        reason: `Git subcommand "${sub || '(none)'}" requires owner approval`,
        matchedRule: 'git:write',
      };
    }

    // Special handling for runtime commands with subcommand checks
    const runtimeSafeSubs = SAFE_RUNTIME_SUBCOMMANDS.get(base);
    if (runtimeSafeSubs) {
      if (sub && runtimeSafeSubs.has(sub)) {
        return {
          decision: 'allow',
          reason: `Safe ${base} subcommand: ${sub}`,
          matchedRule: `builtin:${base}.${sub}`,
        };
      }
      // If the runtime command is in SAFE_COMMANDS but the subcommand isn't safe,
      // require approval for potentially mutating operations
      if (sub && !runtimeSafeSubs.has(sub)) {
        return {
          decision: 'require_approval',
          reason: `${base} subcommand "${sub}" requires owner approval`,
          matchedRule: `runtime:${base}.write`,
        };
      }
    }

    // General safe command check
    if (SAFE_COMMANDS.has(base)) {
      return {
        decision: 'allow',
        reason: `Built-in safe command: ${base}`,
        matchedRule: `builtin:${base}`,
      };
    }

    // --- Step 3: Check user-configured patterns ---
    for (const pattern of allowPatterns) {
      if (matchesPattern(trimmed, pattern)) {
        return {
          decision: 'allow',
          reason: `Matched user allow pattern: ${pattern}`,
          matchedRule: `user:${pattern}`,
        };
      }
    }

    // --- Step 4: Check one-time approvals ---
    const approval = approvals.get(trimmed);
    if (approval) {
      return {
        decision: 'allow',
        reason: 'Previously approved by owner',
        matchedRule: `approval:${trimmed}`,
      };
    }

    // --- Step 5: Require approval for unknown commands ---
    return {
      decision: 'require_approval',
      reason: `Command "${base}" is not in the allowlist — owner approval required`,
    };
  }

  function approve(command: string, persistent = false): void {
    const trimmed = command.trim();
    approvals.set(trimmed, {
      command: trimmed,
      persistent,
      approvedAt: Date.now(),
    });
    logger.info('Shell command approved', {
      command: trimmed.slice(0, 80),
      persistent,
    });
  }

  function revoke(command: string): boolean {
    const trimmed = command.trim();
    const removed = approvals.delete(trimmed);
    if (removed) {
      logger.info('Shell approval revoked', { command: trimmed.slice(0, 80) });
    }
    return removed;
  }

  function listApprovals(): ShellApproval[] {
    return Array.from(approvals.values());
  }

  function clearSessionApprovals(): number {
    let cleared = 0;
    for (const [key, approval] of approvals) {
      if (!approval.persistent) {
        approvals.delete(key);
        cleared++;
      }
    }
    if (cleared > 0) {
      logger.info('Cleared session approvals', { count: cleared });
    }
    return cleared;
  }

  function addAllowPattern(pattern: string): void {
    allowPatterns.add(pattern);
    logger.info('Added shell allow pattern', { pattern });
  }

  function removeAllowPattern(pattern: string): boolean {
    const removed = allowPatterns.delete(pattern);
    if (removed) {
      logger.info('Removed shell allow pattern', { pattern });
    }
    return removed;
  }

  function listAllowPatterns(): string[] {
    return Array.from(allowPatterns);
  }

  return {
    evaluate,
    approve,
    revoke,
    listApprovals,
    clearSessionApprovals,
    addAllowPattern,
    removeAllowPattern,
    listAllowPatterns,
  };
}
