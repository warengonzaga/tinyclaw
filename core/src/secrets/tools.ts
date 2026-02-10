/**
 * Secrets Tools - Agent-Facing API
 *
 * Provides 4 built-in tools for the AI agent to manage secrets:
 * - store_secret: Store or overwrite an encrypted secret
 * - check_secret: Check if a secret exists (no decryption)
 * - retrieve_secret: Retrieve a decrypted secret value
 * - list_secrets: List secret key names (never values)
 *
 * All tools wrap SecretsManager methods with proper error handling.
 * The destroy() method is intentionally never exposed for safety.
 */

import type { Tool } from '../types.js';
import type { SecretsManager } from './manager.js';

/**
 * Create all secrets tools for an agent
 *
 * @param manager - Initialized SecretsManager instance
 * @returns Array of 4 secrets tools
 */
export function createSecretsTools(manager: SecretsManager): Tool[] {
  return [
    // ========================================
    // SECRET OPERATIONS (4 tools)
    // ========================================

    {
      name: 'store_secret',
      description:
        'Store or overwrite an encrypted secret such as an API key. ' +
        'Provider API keys should follow the naming convention: provider.<name>.apiKey ' +
        '(e.g., "provider.ollama.apiKey", "provider.openai.apiKey"). ' +
        'If the key already exists, its value will be overwritten.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description:
              'Dot-notation key for the secret (e.g., "provider.ollama.apiKey")'
          },
          value: {
            type: 'string',
            description: 'The secret value to encrypt and store'
          }
        },
        required: ['key', 'value']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const key = args.key as string;
        const value = args.value as string;

        try {
          const existed = await manager.check(key);
          await manager.store(key, value);
          return existed
            ? `Successfully updated secret "${key}"`
            : `Successfully stored secret "${key}"`;
        } catch (err) {
          return `Error storing secret "${key}": ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'check_secret',
      description:
        'Check if a secret exists in the encrypted store without decrypting it. ' +
        'Use this before attempting to retrieve a secret to verify it has been stored.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description:
              'Dot-notation key to check (e.g., "provider.ollama.apiKey")'
          }
        },
        required: ['key']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const key = args.key as string;

        try {
          const exists = await manager.check(key);
          return exists
            ? `Secret "${key}" exists`
            : `Secret "${key}" not found`;
        } catch (err) {
          return `Error checking secret "${key}": ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'retrieve_secret',
      description:
        'Retrieve and decrypt a stored secret value. ' +
        'Returns the decrypted value if found, or a "not found" message. ' +
        'Use this to get API keys when configuring providers at runtime.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description:
              'Dot-notation key to retrieve (e.g., "provider.ollama.apiKey")'
          }
        },
        required: ['key']
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const key = args.key as string;

        try {
          const value = await manager.retrieve(key);
          if (value === null) {
            return `Secret "${key}" not found`;
          }
          return value;
        } catch (err) {
          return `Error retrieving secret "${key}": ${(err as Error).message}`;
        }
      }
    },

    {
      name: 'list_secrets',
      description:
        'List all secret key names matching an optional glob pattern. ' +
        'Returns only key names, never secret values. ' +
        'Use pattern "provider.*.*" to list all provider API keys (glob * does not cross dots).',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description:
              'Optional glob pattern to filter keys (e.g., "provider.*.*"). ' +
              'Note: * matches within a single dot-segment only. Omit to list all keys.'
          }
        },
        required: []
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const pattern = args.pattern as string | undefined;

        try {
          const keys = await manager.list(pattern);

          if (keys.length === 0) {
            return pattern
              ? `No secrets found matching "${pattern}"`
              : 'No secrets stored';
          }

          let output = `Found ${keys.length} secret(s):\n`;
          for (const key of keys) {
            output += `  - ${key}\n`;
          }
          return output;
        } catch (err) {
          return `Error listing secrets: ${(err as Error).message}`;
        }
      }
    }
  ];
}
