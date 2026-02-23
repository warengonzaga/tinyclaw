/**
 * Config Tools - Agent-Facing API
 *
 * Provides 4 built-in tools for the AI agent to manage its own configuration.
 */

import type { Tool } from '@tinyclaw/types';
import type { ConfigManager } from './manager.js';

export function createConfigTools(manager: ConfigManager): Tool[] {
  return [
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
              'Dot-notation key to retrieve (e.g., "agent.name", "learning.minConfidence")',
          },
        },
        required: ['key'],
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
      },
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
            description: 'Dot-notation key to set (e.g., "agent.name", "learning.minConfidence")',
          },
          value: {
            type: 'string',
            description:
              'The value to set. For objects, pass a JSON string (e.g. \'{"key": "val"}\').' +
              ' Booleans and numbers will be auto-detected from the string.',
          },
        },
        required: ['key', 'value'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        if (typeof args.key !== 'string' || args.key.trim() === '') {
          return 'Invalid config key: must be a non-empty string';
        }

        const key = args.key.trim();
        const raw = args.value;

        if (raw === undefined) {
          return 'Invalid config value: value is required';
        }

        // Auto-parse string values into native types
        let value: unknown = raw;
        if (typeof raw === 'string') {
          const trimmed = raw.trim();
          if (trimmed === 'true') value = true;
          else if (trimmed === 'false') value = false;
          else if (trimmed !== '' && !isNaN(Number(trimmed))) value = Number(trimmed);
          else {
            try {
              value = JSON.parse(trimmed);
            } catch {
              value = raw;
            }
          }
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
      },
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
            description: 'Dot-notation key to delete (e.g., "channels.telegram")',
          },
        },
        required: ['key'],
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
      },
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
        required: [],
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
      },
    },
  ];
}
