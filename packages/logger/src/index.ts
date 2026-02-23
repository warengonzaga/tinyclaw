import {
  EMOJI_MAPPINGS,
  EmojiSelector,
  FALLBACK_EMOJI,
  type LogCallOptions,
  LogEngine,
  LogMode,
} from '@wgtechlabs/log-engine';

// Only local time with context-aware emoji
LogEngine.configure({
  mode: LogMode.DEBUG,
  format: {
    includeIsoTimestamp: false,
    includeLocalTime: true,
    includeEmoji: true,
    emoji: {
      customMappings: [
        {
          emoji: '🤖',
          code: ':robot:',
          description: 'Agent operations',
          keywords: ['agent', 'heartware', 'plugin', 'orchestrator'],
        },
        {
          emoji: '🔑',
          code: ':key:',
          description: 'Secrets operations',
          keywords: ['secret', 'vault', 'encrypt', 'decrypt', 'credential'],
        },
        {
          emoji: '🧠',
          code: ':brain:',
          description: 'Learning operations',
          keywords: ['learn', 'pattern', 'detect', 'adapt', 'training'],
        },
        {
          emoji: '🔀',
          code: ':twisted_rightwards_arrows:',
          description: 'Router operations',
          keywords: ['route', 'router', 'dispatch', 'forward', 'command'],
        },
      ],
    },
  },
});

// ---------------------------------------------------------------------------
// Runtime log-mode switching
// ---------------------------------------------------------------------------

/** Human-readable log level names the agent and CLI can use. */
export const LOG_MODES = {
  debug: LogMode.DEBUG,
  info: LogMode.INFO,
  warn: LogMode.WARN,
  error: LogMode.ERROR,
  silent: LogMode.SILENT,
  off: LogMode.OFF,
} as const;

export type LogModeName = keyof typeof LOG_MODES;

/**
 * Change the active log level at runtime.
 *
 * Accepts either a human-readable name ("debug", "info", …) or a
 * numeric `LogMode` value.  Invalid input is silently ignored.
 */
export function setLogMode(level: LogModeName | LogMode): void {
  const mode = typeof level === 'string' ? LOG_MODES[level as LogModeName] : level;

  if (mode === undefined) return;
  LogEngine.configure({ mode });
}

// Re-export configured logger and emoji utilities
export const logger = LogEngine;
export { LogMode, EmojiSelector, EMOJI_MAPPINGS, FALLBACK_EMOJI, type LogCallOptions };
