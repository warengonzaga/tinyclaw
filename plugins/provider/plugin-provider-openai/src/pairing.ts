/**
 * OpenAI Pairing Tools
 *
 * Two tools that implement the OpenAI provider pairing flow:
 *
 * 1. openai_pair — Store the API key, configure model, enable plugin, update tier mapping
 * 2. openai_unpair — Disable plugin and reset tier mapping
 *
 * These tools are injected into the agent's tool list at boot so the agent
 * can invoke them conversationally when a user asks to connect OpenAI.
 */

import type { Tool, SecretsManagerInterface, ConfigManagerInterface } from '@tinyclaw/types';

/** Secret key for the OpenAI API key. */
export const OPENAI_SECRET_KEY = 'provider.openai.apiKey';
/** Config key for the model setting. */
export const OPENAI_MODEL_CONFIG_KEY = 'providers.openai.model';
/** The plugin's package ID. */
export const OPENAI_PLUGIN_ID = '@tinyclaw/plugin-provider-openai';
/** The provider ID used in tier mapping. */
export const OPENAI_PROVIDER_ID = 'openai';
/** Default model. */
export const OPENAI_DEFAULT_MODEL = 'gpt-4.1';

export function createOpenAIPairingTools(
  secrets: SecretsManagerInterface,
  configManager: ConfigManagerInterface,
): Tool[] {
  return [
    {
      name: 'openai_pair',
      description:
        'Pair TinyClaw with OpenAI as a provider. ' +
        'Stores the API key securely, configures the model, enables the plugin, ' +
        'and routes complex/reasoning queries to OpenAI. ' +
        'After pairing, call tinyclaw_restart to apply the changes. ' +
        'To get an API key: go to https://platform.openai.com/api-keys and create one.',,
      parameters: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            description: 'OpenAI API key (starts with sk-)',
          },
          model: {
            type: 'string',
            description:
              'OpenAI model to use (default: gpt-4.1). ' +
              'Examples: gpt-4.1, gpt-4o, gpt-4.1-mini',
          },
        },
        required: ['apiKey'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const apiKey = args.apiKey as string;
        if (!apiKey || apiKey.trim() === '') {
          return 'Error: apiKey must be a non-empty string.';
        }

        const model = (args.model as string)?.trim() || OPENAI_DEFAULT_MODEL;

        try {
          // 1. Store API key in secrets engine
          await secrets.store(OPENAI_SECRET_KEY, apiKey.trim());

          // 2. Set model in config
          configManager.set(OPENAI_MODEL_CONFIG_KEY, model);

          // 3. Add plugin to enabled list (deduplicated)
          const current = configManager.get<string[]>('plugins.enabled') ?? [];
          if (!current.includes(OPENAI_PLUGIN_ID)) {
            configManager.set('plugins.enabled', [...current, OPENAI_PLUGIN_ID]);
          }

          // 4. Update tier mapping — route complex + reasoning to OpenAI
          configManager.set('routing.tierMapping.complex', OPENAI_PROVIDER_ID);
          configManager.set('routing.tierMapping.reasoning', OPENAI_PROVIDER_ID);

          return (
            `OpenAI provider paired successfully! ` +
            `Model: ${model}. API key stored securely. ` +
            `Complex and reasoning queries will be routed to OpenAI. ` +
            `Use the tinyclaw_restart tool now to apply the changes.`
          );
        } catch (err) {
          return `Error pairing OpenAI: ${(err as Error).message}`;
        }
      },
    },

    {
      name: 'openai_unpair',
      description:
        'Disconnect OpenAI provider and disable the plugin. ' +
        'Resets routing so all queries go back to the default provider. ' +
        'The API key is kept in secrets for safety. Call tinyclaw_restart after.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute(): Promise<string> {
        try {
          // 1. Remove from plugins.enabled
          const current = configManager.get<string[]>('plugins.enabled') ?? [];
          configManager.set(
            'plugins.enabled',
            current.filter((id) => id !== OPENAI_PLUGIN_ID),
          );

          // 2. Reset tier mapping entries that point to 'openai'
          const tiers = ['simple', 'moderate', 'complex', 'reasoning'] as const;
          for (const tier of tiers) {
            const key = `routing.tierMapping.${tier}`;
            const val = configManager.get<string>(key);
            if (val === OPENAI_PROVIDER_ID) {
              configManager.set(key, 'ollama-cloud');
            }
          }

          return (
            'OpenAI provider disabled. ' +
            'All queries will route to the default provider. ' +
            'Use the tinyclaw_restart tool now to apply the changes. ' +
            'The API key is still stored in secrets — use list_secrets to manage it.'
          );
        } catch (err) {
          return `Error unpairing OpenAI: ${(err as Error).message}`;
        }
      },
    },
  ];
}
