import { LogEngine, LogMode, EmojiSelector, EMOJI_MAPPINGS, FALLBACK_EMOJI } from '@wgtechlabs/log-engine';

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
          keywords: ['agent', 'heartware', 'plugin', 'orchestrator']
        },
        {
          emoji: '🔑',
          code: ':key:',
          description: 'Secrets operations',
          keywords: ['secret', 'vault', 'encrypt', 'decrypt', 'credential']
        },
        {
          emoji: '🧠',
          code: ':brain:',
          description: 'Learning operations',
          keywords: ['learn', 'pattern', 'detect', 'adapt', 'training']
        },
        {
          emoji: '🔀',
          code: ':twisted_rightwards_arrows:',
          description: 'Router operations',
          keywords: ['route', 'router', 'dispatch', 'forward', 'command']
        }
      ]
    }
  }
});

// Re-export configured logger and emoji utilities
export const logger = LogEngine;
export { EmojiSelector, EMOJI_MAPPINGS, FALLBACK_EMOJI };
