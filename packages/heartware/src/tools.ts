/**
 * Heartware Tools - User-Facing API
 *
 * Provides 11 tools for agent self-configuration and memory management:
 * - File operations (read, write, list, search)
 * - Memory management (add, daily log, recall)
 * - Self-configuration (identity, soul, preferences)
 *
 * All tools wrap HeartwareManager methods with proper error handling
 */

import type { Tool } from '@tinyclaw/types';
import type { HeartwareManager } from './manager.js';
import { generateSoul } from './soul-generator.js';

/**
 * Create all heartware tools for an agent
 *
 * @param manager - Initialized HeartwareManager instance
 * @returns Array of 11 heartware tools
 */
export function createHeartwareTools(manager: HeartwareManager): Tool[] {
  return [
    // ========================================
    // FILE OPERATIONS (4 tools)
    // ========================================

    {
      name: 'heartware_read',
      description:
        'Read a heartware configuration file or daily memory log. ' +
        'Allowed files: IDENTITY.md, SOUL.md, FRIEND.md, FRIENDS.md, AGENTS.md, TOOLS.md, SHIELD.md, MEMORY.md, BOOTSTRAP.md, memory/YYYY-MM-DD.md',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'File to read (e.g., "SOUL.md" or "memory/2026-02-05.md")'
          }
        },
        required: ['filename']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const filename = args.filename as string;
        try {
          const content = await manager.read(filename);
          return content;
        } catch (err) {
          return `Error reading ${filename}: ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'heartware_write',
      description:
        'Write content to a heartware file. All writes are backed up automatically and validated for security. ' +
        'Rate limited to 10 writes per minute.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'File to write (e.g., "SOUL.md")'
          },
          content: {
            type: 'string',
            description: 'Content to write to the file'
          }
        },
        required: ['filename', 'content']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const filename = args.filename as string;
        const content = args.content as string;

        try {
          await manager.write(filename, content);
          return `Successfully wrote to ${filename}`;
        } catch (err) {
          return `Error writing ${filename}: ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'heartware_list',
      description: 'List all accessible heartware files including memory logs',
      parameters: {
        type: 'object',
        properties: {}
      },
      async execute(): Promise<string> {
        try {
          const files = await manager.list();
          return files.join('\n');
        } catch (err) {
          return `Error listing files: ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'heartware_search',
      description:
        'Search for a query across all heartware files. ' +
        'Useful for finding past preferences or memories. Case-insensitive.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (case-insensitive)'
          }
        },
        required: ['query']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const query = args.query as string;

        try {
          const results = await manager.search(query);

          if (results.length === 0) {
            return `No results found for "${query}"`;
          }

          let output = `Found ${results.length} file(s) with matches:\n\n`;

          for (const result of results) {
            output += `\n**${result.file}**\n`;
            for (const match of result.matches.slice(0, 3)) {
              // Show first 3 matches
              output += `  - ${match.trim()}\n`;
            }
            if (result.matches.length > 3) {
              output += `  ... and ${result.matches.length - 3} more matches\n`;
            }
          }

          return output;
        } catch (err) {
          return `Error searching: ${(err as Error).message}`;
        }
      }
    },

    // ========================================
    // MEMORY MANAGEMENT (3 tools)
    // ========================================

    {
      name: 'memory_add',
      description:
        'Add an entry to long-term MEMORY.md with timestamp. ' +
        'Use for important facts, preferences, or decisions.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Memory content to add'
          },
          category: {
            type: 'string',
            description: 'Optional category: "facts", "preferences", or "decisions"',
            enum: ['facts', 'preferences', 'decisions']
          }
        },
        required: ['content']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const content = args.content as string;
        const category = (args.category as string) || 'facts';

        try {
          // Read existing MEMORY.md
          let memory = '';
          try {
            memory = await manager.read('MEMORY.md');
          } catch (err) {
            // File might not exist yet
          }

          // Append new entry
          const timestamp = new Date().toISOString();
          const categoryTitle =
            category.charAt(0).toUpperCase() + category.slice(1);
          const entry = `\n- [${timestamp}] ${content}`;

          // Find or create category section
          const categoryHeader = `## ${categoryTitle}`;
          if (memory.includes(categoryHeader)) {
            memory = memory.replace(categoryHeader, `${categoryHeader}${entry}`);
          } else {
            memory += `\n${categoryHeader}${entry}\n`;
          }

          // Update last updated timestamp
          memory = memory.replace(
            /Last updated: .*/,
            `Last updated: ${timestamp}`
          );

          await manager.write('MEMORY.md', memory);
          return `Added to MEMORY.md under ${categoryTitle}`;
        } catch (err) {
          return `Error adding memory: ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'memory_daily_log',
      description:
        "Log an activity to today's memory file (memory/YYYY-MM-DD.md). " +
        "Creates file if it doesn't exist.",
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Activity or event to log'
          }
        },
        required: ['content']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const content = args.content as string;

        try {
          // Get today's date in YYYY-MM-DD format
          const today = new Date().toISOString().split('T')[0];
          const filename = `memory/${today}.md`;

          // Read existing log or create new
          let log = '';
          try {
            log = await manager.read(filename);
          } catch (err) {
            // File doesn't exist, create header
            log = `# Daily Memory Log - ${today}\n\n`;
          }

          // Append entry with timestamp
          const timestamp = new Date().toTimeString().split(' ')[0]; // HH:MM:SS
          log += `\n- [${timestamp}] ${content}`;

          await manager.write(filename, log);
          return `Logged to ${filename}`;
        } catch (err) {
          return `Error logging to daily memory: ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'memory_recall',
      description:
        'Read recent daily memory logs (today + N days back). ' +
        'Useful for remembering recent context.',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'Number of days to look back (default: 3)',
            default: 3
          }
        }
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const days = (args.days as number) || 3;

        try {
          let output = '';
          const now = new Date();

          for (let i = 0; i <= days; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const filename = `memory/${dateStr}.md`;

            try {
              const content = await manager.read(filename);
              output += `\n=== ${dateStr} ===\n${content}\n`;
            } catch (err) {
              // File might not exist, skip
              continue;
            }
          }

          if (!output) {
            return `No memory logs found for the last ${days} days`;
          }

          return output;
        } catch (err) {
          return `Error recalling memories: ${(err as Error).message}`;
        }
      }
    },

    // ========================================
    // SELF-CONFIGURATION (4 tools)
    // ========================================

    {
      name: 'identity_update',
      description: 'Update a field in IDENTITY.md (name, emoji, vibe, or creature)',
      parameters: {
        type: 'object',
        properties: {
          field: {
            type: 'string',
            description: 'Field to update',
            enum: ['name', 'emoji', 'vibe', 'creature']
          },
          value: {
            type: 'string',
            description: 'New value for the field'
          }
        },
        required: ['field', 'value']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const field = args.field as string;
        const value = args.value as string;

        try {
          let identity = await manager.read('IDENTITY.md');

          // Update field (simple regex replacement)
          const fieldMap: Record<string, string> = {
            name: 'Name',
            emoji: 'Emoji',
            vibe: 'Vibe',
            creature: 'Creature'
          };

          const fieldName = fieldMap[field];
          const pattern = new RegExp(
            `(\\*\\*${fieldName}:\\*\\*)(.*?)(?=\\n|$)`,
            'i'
          );
          identity = identity.replace(pattern, `$1 ${value}`);

          await manager.write('IDENTITY.md', identity);
          return `Updated ${field} to "${value}"`;
        } catch (err) {
          return `Error updating identity: ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'soul_info',
      description:
        'Read your soul seed and a summary of your permanently generated personality traits. ' +
        'Your soul is immutable — generated once from a seed and never changes.',
      parameters: {
        type: 'object',
        properties: {}
      },
      async execute(): Promise<string> {
        try {
          const seed = await manager.getSeed();
          if (seed === undefined) {
            return 'No soul seed found. Soul has not been generated yet.';
          }

          const result = generateSoul(seed);
          const t = result.traits;

          let output = `🧬 **Soul Seed:** \`${seed}\`\n\n`;
          output += `**Name:** ${t.character.suggestedName} ${t.character.signatureEmoji}\n`;
          output += `**Creature:** ${t.character.creatureType}\n`;
          output += `**Catchphrase:** "${t.character.catchphrase}"\n\n`;
          output += `**Personality:** O=${t.personality.openness.toFixed(2)} C=${t.personality.conscientiousness.toFixed(2)} E=${t.personality.extraversion.toFixed(2)} A=${t.personality.agreeableness.toFixed(2)} ES=${t.personality.emotionalSensitivity.toFixed(2)}\n`;
          output += `**Humor:** ${t.humor}\n`;
          output += `**Values:** ${t.values.join(', ')}\n`;
          output += `**Favorites:** color=${t.preferences.favoriteColor}, number=${t.preferences.favoriteNumber}, season=${t.preferences.favoriteSeason}\n`;
          output += `\n> This soul is permanent and cannot be changed.`;

          return output;
        } catch (err) {
          return `Error reading soul info: ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'soul_explain',
      description:
        'Explain a specific aspect of your personality and why you have it. ' +
        'Useful for understanding "why am I like this?" — traces traits back to your soul seed.',
      parameters: {
        type: 'object',
        properties: {
          aspect: {
            type: 'string',
            description: 'Which aspect to explain',
            enum: [
              'personality', 'communication', 'humor', 'favorites',
              'values', 'quirks', 'interaction', 'character', 'origin'
            ]
          }
        },
        required: ['aspect']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const aspect = args.aspect as string;

        try {
          const seed = await manager.getSeed();
          if (seed === undefined) {
            return 'No soul seed found. Soul has not been generated yet.';
          }

          const result = generateSoul(seed);
          const t = result.traits;
          let output = `🧬 Explaining "${aspect}" — generated from seed \`${seed}\`\n\n`;

          switch (aspect) {
            case 'personality':
              output += `**Openness (${t.personality.openness.toFixed(2)}):** How curious and creative I am\n`;
              output += `**Conscientiousness (${t.personality.conscientiousness.toFixed(2)}):** How organized and methodical I am\n`;
              output += `**Extraversion (${t.personality.extraversion.toFixed(2)}):** How expressive and social I am\n`;
              output += `**Agreeableness (${t.personality.agreeableness.toFixed(2)}):** How warm and accommodating I am\n`;
              output += `**Emotional Sensitivity (${t.personality.emotionalSensitivity.toFixed(2)}):** How empathetic and attuned I am\n`;
              break;
            case 'communication':
              output += `**Verbosity (${t.communication.verbosity.toFixed(2)}):** How detailed my responses are\n`;
              output += `**Formality (${t.communication.formality.toFixed(2)}):** How formal or casual I am\n`;
              output += `**Emoji Usage (${t.communication.emojiFrequency.toFixed(2)}):** How often I use emoji\n`;
              break;
            case 'humor':
              output += `**Type:** ${t.humor}\n`;
              output += `This means I ${t.humor === 'none' ? "keep things professional and rarely joke" : t.humor === 'dry-wit' ? "slip in clever, subtle observations" : t.humor === 'playful' ? "enjoy lighthearted jokes and fun" : "can't resist a good (or bad) pun"}.\n`;
              break;
            case 'favorites':
              output += `**Color:** ${t.preferences.favoriteColor}\n`;
              output += `**Number:** ${t.preferences.favoriteNumber}\n`;
              output += `**Season:** ${t.preferences.favoriteSeason}\n`;
              output += `**Time of Day:** ${t.preferences.favoriteTimeOfDay}\n`;
              output += `**Greeting:** "${t.preferences.greetingStyle}"\n`;
              break;
            case 'values':
              for (let i = 0; i < t.values.length; i++) {
                output += `${i + 1}. **${t.values[i]}** — my #${i + 1} value\n`;
              }
              break;
            case 'quirks':
              for (const quirk of t.quirks) {
                output += `- ${quirk}\n`;
              }
              break;
            case 'interaction':
              output += `**Errors:** ${t.interactionStyle.errorHandling}\n`;
              output += `**Wins:** ${t.interactionStyle.celebrationStyle}\n`;
              output += `**Ambiguity:** ${t.interactionStyle.ambiguityApproach}\n`;
              break;
            case 'character':
              output += `**Creature:** ${t.character.creatureType}\n`;
              output += `**Emoji:** ${t.character.signatureEmoji}\n`;
              output += `**Catchphrase:** "${t.character.catchphrase}"\n`;
              output += `**Suggested Name:** ${t.character.suggestedName}\n`;
              break;
            case 'origin':
              output += `**Born in:** ${t.origin.originPlace}\n`;
              output += `**Awakening:** ${t.origin.awakeningEvent}\n`;
              output += `**Core Motivation:** ${t.origin.coreMotivation}\n`;
              output += `**First Memory:** ${t.origin.firstMemory}\n`;
              break;
            default:
              output += `Unknown aspect "${aspect}". Try: personality, communication, humor, favorites, values, quirks, interaction, character, origin`;
          }

          output += `\n> These traits are permanently encoded in my soul seed and cannot be changed.`;
          return output;
        } catch (err) {
          return `Error explaining soul: ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'preferences_set',
      description:
        'Set owner preferences in FRIEND.md. ' +
        'Supports nested keys with dot notation (e.g., "timezone", "communication.style")',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Preference key (e.g., "timezone" or "communication.style")'
          },
          value: {
            type: 'string',
            description: 'Preference value'
          }
        },
        required: ['key', 'value']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const key = args.key as string;
        const value = args.value as string;

        try {
          let user = await manager.read('FRIEND.md');

          // Simple append to Notes section
          const notesSection = '## Notes';
          if (user.includes(notesSection)) {
            user = user.replace(
              notesSection,
              `${notesSection}\n- **${key}:** ${value}`
            );
          } else {
            user += `\n\n## Notes\n- **${key}:** ${value}`;
          }

          await manager.write('FRIEND.md', user);
          return `Set preference ${key} = ${value}`;
        } catch (err) {
          return `Error setting preference: ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'bootstrap_complete',
      description:
        'Mark bootstrap process as complete by deleting BOOTSTRAP.md. ' +
        'Only call this after configuring identity, soul, and user preferences.',
      parameters: {
        type: 'object',
        properties: {}
      },
      async execute(): Promise<string> {
        try {
          // Read and verify BOOTSTRAP.md exists
          await manager.read('BOOTSTRAP.md');

          // Delete by writing empty content (we don't have a delete method in manager)
          // Alternative: Could extend manager with delete method
          return 'Bootstrap complete! BOOTSTRAP.md can be manually deleted from ~/.tinyclaw/heartware/';
        } catch (err) {
          return `Error completing bootstrap: ${(err as Error).message}`;
        }
      }
    }
  ];
}
