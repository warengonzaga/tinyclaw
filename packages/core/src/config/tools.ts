/**
 * Config Tools - Agent-Facing API
 *
 * Provides 4 built-in tools for the AI agent to manage its own configuration:
 * - config_get: Retrieve a config value by dot-notation key
 * - config_set: Set a config value by dot-notation key
 * - config_delete: Remove a config key
 * - config_list: List the full config snapshot as JSON
 *
 * All tools wrap ConfigManager methods with proper error handling.
 * The agent interacts only through these tools, never touching
 * ConfigEngine or ConfigManager directly.
 */

import type { Tool } from '../types.js';
import type { ConfigManager } from './manager.js';

/**
 * Create all config tools for an agent
 *
 * @param manager - Initialized ConfigManager instance
 * @returns Array of 4 config tools
 */
export function createConfigTools(manager: ConfigManager): Tool[] {
  return [
    // ========================================
    // CONFIG OPERATIONS (4 tools)
    // ========================================

    {
      name: 'config_get',
      description:
        'Retrieve a configuration value by dot-notation key. ' +
        'Supports nested access like "providers.starterBrain.model", "learning.enabled", ' +
        '"agent.name". Returns the value as a JSON string, or a "not found" message.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description:
              'Dot-notation key to retrieve (e.g., "agent.name", "learning.minConfidence")'
          }
        },
        required: ['key']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        if (typeof args.key !== 'string' || args.key.trim() === '') {
          return 'Invalid config key: must be a non-empty string';
        }

        const key = args.key.trim();

        try {
          if (!manager.has(key)) {
            return `Config key "${key}" not found`;
          }

          const value = manager.get(key);
          return JSON.stringify(value, null, 2);
        } catch (err) {
          return `Error getting config "${key}": ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'config_set',
      description:
        'Set a configuration value by dot-notation key. ' +
        'The value is validated against the config schema. ' +
        'Use this to update agent settings like model preferences, learning thresholds, ' +
        'or channel configurations. Do NOT store secrets here — use store_secret instead.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description:
              'Dot-notation key to set (e.g., "agent.name", "learning.minConfidence")'
          },
          value: {
            description:
              'The value to set. Can be a string, number, boolean, or object depending on the key.'
          }
        },
        required: ['key', 'value']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        if (typeof args.key !== 'string' || args.key.trim() === '') {
          return 'Invalid config key: must be a non-empty string';
        }

        const key = args.key.trim();
        const value = args.value;

        if (value === undefined) {
          return 'Invalid config value: value is required';
        }

        try {
          const existed = manager.has(key);
          manager.set(key, value);
          return existed
            ? `Successfully updated config "${key}"`
            : `Successfully set config "${key}"`;
        } catch (err) {
          return `Error setting config "${key}": ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'config_delete',
      description:
        'Remove a configuration key and its value. ' +
        'The key will revert to its default value if one exists in the defaults.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description:
              'Dot-notation key to delete (e.g., "channels.telegram")'
          }
        },
        required: ['key']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        if (typeof args.key !== 'string' || args.key.trim() === '') {
          return 'Invalid config key: must be a non-empty string';
        }

        const key = args.key.trim();

        try {
          if (!manager.has(key)) {
            return `Config key "${key}" not found`;
          }

          manager.delete(key);
          return `Successfully deleted config "${key}"`;
        } catch (err) {
          return `Error deleting config "${key}": ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'config_list',
      description:
        'List the full configuration snapshot as formatted JSON. ' +
        'Returns all current config values including defaults. ' +
        'Use this to inspect the current state of the agent configuration.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
      async execute(): Promise<string> {
        try {
          const snapshot = manager.store;
          const size = manager.size;

          if (size === 0) {
            return 'No configuration values stored';
          }

          return `Configuration (${size} top-level entries):\n${JSON.stringify(snapshot, null, 2)}`;
        } catch (err) {
          return `Error listing config: ${(err as Error).message}`;
        }
      }
    }
  ];
}
