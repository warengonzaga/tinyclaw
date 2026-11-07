import { DEFAULT_BASE_URL } from '@tinyclaw/core';
import type { ConfigManagerInterface, SecretsManagerInterface, Tool } from '@tinyclaw/types';
import {
  fetchOllamaModels,
  formatModelList,
  getDefaultBaseUrl,
  getFallbackModel,
  normalizeOllamaMode,
  OLLAMA_API_KEY_REF_CONFIG_KEY,
  OLLAMA_BASE_URL_CONFIG_KEY,
  OLLAMA_MODE_CONFIG_KEY,
  OLLAMA_MODEL_CONFIG_KEY,
  OLLAMA_PLUGIN_ID,
  OLLAMA_PROVIDER_ID,
  OLLAMA_SECRET_KEY,
  type OllamaProviderMode,
} from './catalog.js';

function getSavedMode(configManager: ConfigManagerInterface): OllamaProviderMode {
  return normalizeOllamaMode(configManager.get<string>(OLLAMA_MODE_CONFIG_KEY));
}

function getSavedBaseUrl(
  configManager: ConfigManagerInterface,
  mode: OllamaProviderMode,
  override?: string,
): string {
  return (
    override?.trim() ||
    configManager.get<string>(OLLAMA_BASE_URL_CONFIG_KEY) ||
    getDefaultBaseUrl(mode)
  );
}

async function resolveRequestedModel(config: {
  model: string | undefined;
  mode: OllamaProviderMode;
  baseUrl: string;
  apiKey: string | null;
}): Promise<string> {
  const explicit = config.model?.trim();
  if (explicit) {
    return explicit;
  }

  try {
    const models = await fetchOllamaModels({
      baseUrl: config.baseUrl,
      mode: config.mode,
      apiKey: config.apiKey,
    });
    return models[0] ?? getFallbackModel(config.mode);
  } catch {
    return getFallbackModel(config.mode);
  }
}

function upsertPlugin(configManager: ConfigManagerInterface): void {
  const current = configManager.get<string[]>('plugins.enabled') ?? [];
  if (!current.includes(OLLAMA_PLUGIN_ID)) {
    configManager.set('plugins.enabled', [...current, OLLAMA_PLUGIN_ID]);
  }
}

function assignDefaultRouting(configManager: ConfigManagerInterface): void {
  configManager.set('routing.tierMapping.complex', OLLAMA_PROVIDER_ID);
  configManager.set('routing.tierMapping.reasoning', OLLAMA_PROVIDER_ID);
}

export function createOllamaPairingTools(
  secrets: SecretsManagerInterface,
  configManager: ConfigManagerInterface,
): Tool[] {
  return [
    {
      name: 'ollama_pair',
      description:
        'Pair Tiny Claw with the Ollama provider plugin. Supports local Ollama and custom Ollama Cloud models. ' +
        'Cloud pairing excludes the built-in Ollama Cloud starter models from selection. ' +
        'Reuses the existing built-in Ollama API key automatically for cloud mode unless you explicitly provide a replacement. ' +
        'Configures the model, enables the plugin, and routes complex/reasoning queries to Ollama.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['local', 'cloud'],
            description: 'Use local Ollama or Ollama Cloud. Default: local.',
          },
          model: {
            type: 'string',
            description:
              'Model tag to use. If omitted, Tiny Claw will pick the first supported model it can discover.',
          },
          baseUrl: {
            type: 'string',
            description: `Optional custom base URL. Defaults to local Ollama (${getDefaultBaseUrl('local')}) or Ollama Cloud (${DEFAULT_BASE_URL}).`,
          },
          apiKey: {
            type: 'string',
            description:
              'Optional replacement Ollama API key for cloud mode. If omitted, Tiny Claw reuses the existing provider.ollama.apiKey from the built-in setup.',
          },
        },
        required: [],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const mode = normalizeOllamaMode(args.mode as string | undefined);
        const baseUrl = getSavedBaseUrl(configManager, mode, args.baseUrl as string | undefined);
        const providedApiKey = (args.apiKey as string | undefined)?.trim() || null;
        const existingApiKey = mode === 'cloud' ? await secrets.retrieve(OLLAMA_SECRET_KEY) : null;
        const effectiveApiKey = providedApiKey || existingApiKey;

        if (mode === 'cloud' && !effectiveApiKey) {
          return (
            'Error: cloud mode requires an API key. Provide apiKey or store one first in ' +
            `${OLLAMA_SECRET_KEY}.`
          );
        }

        const model = await resolveRequestedModel({
          model: args.model as string | undefined,
          mode,
          baseUrl,
          apiKey: effectiveApiKey,
        });

        try {
          if (providedApiKey) {
            await secrets.store(OLLAMA_SECRET_KEY, providedApiKey);
          }

          configManager.set({
            providers: {
              ollama: {
                mode,
                model,
                baseUrl,
                apiKeyRef: mode === 'cloud' ? OLLAMA_SECRET_KEY : undefined,
              },
            },
          });

          upsertPlugin(configManager);
          assignDefaultRouting(configManager);

          return (
            `Ollama provider paired successfully in ${mode} mode. ` +
            `Model: ${model}. Base URL: ${baseUrl}. ` +
            'Use ollama_model_list to review supported models or ollama_model_set to switch later. ' +
            'Use the tinyclaw_restart tool now to apply the changes.'
          );
        } catch (error) {
          return `Error pairing Ollama: ${(error as Error).message}`;
        }
      },
    },
    {
      name: 'ollama_model_list',
      description:
        'List the models supported by the Ollama provider plugin. ' +
        'Defaults to the currently configured mode and base URL. In cloud mode, the built-in starter models are excluded and the stored built-in Ollama API key is reused by default.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['local', 'cloud'],
            description: 'Optional mode override. Defaults to the current Ollama provider mode.',
          },
          baseUrl: {
            type: 'string',
            description: 'Optional base URL override.',
          },
          apiKey: {
            type: 'string',
            description:
              'Optional temporary replacement API key for cloud mode. If omitted, Tiny Claw reuses provider.ollama.apiKey.',
          },
        },
        required: [],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const mode = normalizeOllamaMode(
          (args.mode as string | undefined) ?? getSavedMode(configManager),
        );
        const baseUrl = getSavedBaseUrl(configManager, mode, args.baseUrl as string | undefined);
        const providedApiKey = (args.apiKey as string | undefined)?.trim() || null;
        const storedApiKey = mode === 'cloud' ? await secrets.retrieve(OLLAMA_SECRET_KEY) : null;

        if (mode === 'cloud' && !providedApiKey && !storedApiKey) {
          return `Error: cloud mode requires an API key in ${OLLAMA_SECRET_KEY} or via apiKey.`;
        }

        try {
          const models = await fetchOllamaModels({
            baseUrl,
            mode,
            apiKey: providedApiKey || storedApiKey,
          });
          const currentModel = configManager.get<string>(OLLAMA_MODEL_CONFIG_KEY) ?? undefined;

          return [
            `Ollama ${mode} models (${models.length})`,
            `Base URL: ${baseUrl}`,
            formatModelList(models, currentModel),
          ].join('\n');
        } catch (error) {
          return `Error listing Ollama models: ${(error as Error).message}`;
        }
      },
    },
    {
      name: 'ollama_model_set',
      description:
        'Update the Ollama provider plugin model, and optionally switch mode or base URL. ' +
        'Use this after pairing when the user wants a different local or cloud model. ' +
        'Cloud mode reuses the existing built-in Ollama API key unless you provide a replacement.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'The Ollama model to set.',
          },
          mode: {
            type: 'string',
            enum: ['local', 'cloud'],
            description: 'Optional mode override. Defaults to the current mode.',
          },
          baseUrl: {
            type: 'string',
            description: 'Optional base URL override.',
          },
          apiKey: {
            type: 'string',
            description:
              'Optional replacement API key when switching to cloud mode. If omitted, Tiny Claw reuses provider.ollama.apiKey.',
          },
        },
        required: ['model'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const model = (args.model as string | undefined)?.trim();
        if (!model) {
          return 'Error: model is required.';
        }

        const mode = normalizeOllamaMode(
          (args.mode as string | undefined) ?? getSavedMode(configManager),
        );
        const baseUrl = getSavedBaseUrl(configManager, mode, args.baseUrl as string | undefined);
        const providedApiKey = (args.apiKey as string | undefined)?.trim() || null;

        if (mode === 'cloud') {
          const effectiveApiKey = providedApiKey || (await secrets.retrieve(OLLAMA_SECRET_KEY));
          if (!effectiveApiKey) {
            return `Error: cloud mode requires an API key in ${OLLAMA_SECRET_KEY} or via apiKey.`;
          }

          try {
            const models = await fetchOllamaModels({
              baseUrl,
              mode,
              apiKey: effectiveApiKey,
            });
            if (!models.includes(model)) {
              return (
                `Model "${model}" is not available for Ollama ${mode}. ` +
                'Use ollama_model_list to see the supported models.'
              );
            }

            if (providedApiKey) {
              await secrets.store(OLLAMA_SECRET_KEY, providedApiKey);
            }
          } catch (error) {
            return `Error validating Ollama model: ${(error as Error).message}`;
          }
        }

        configManager.set(OLLAMA_MODE_CONFIG_KEY, mode);
        configManager.set(OLLAMA_BASE_URL_CONFIG_KEY, baseUrl);
        configManager.set(OLLAMA_MODEL_CONFIG_KEY, model);
        configManager.set(
          OLLAMA_API_KEY_REF_CONFIG_KEY,
          mode === 'cloud' ? OLLAMA_SECRET_KEY : undefined,
        );

        return (
          `Ollama provider updated to ${model} in ${mode} mode. ` +
          'Use the tinyclaw_restart tool now to apply the change.'
        );
      },
    },
    {
      name: 'ollama_unpair',
      description:
        'Disable the Ollama provider plugin and restore any routing entries that point at it back to the built-in provider. ' +
        'Stored API keys are left intact for convenience.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute(): Promise<string> {
        try {
          const current = configManager.get<string[]>('plugins.enabled') ?? [];
          configManager.set(
            'plugins.enabled',
            current.filter((pluginId) => pluginId !== OLLAMA_PLUGIN_ID),
          );

          const tiers = ['simple', 'moderate', 'complex', 'reasoning'] as const;
          for (const tier of tiers) {
            const key = `routing.tierMapping.${tier}`;
            if (configManager.get<string>(key) === OLLAMA_PROVIDER_ID) {
              configManager.set(key, 'ollama-cloud');
            }
          }

          return (
            'Ollama provider disabled. Any routing entries that pointed to it now fall back to the built-in provider. ' +
            'Use the tinyclaw_restart tool now to apply the changes.'
          );
        } catch (error) {
          return `Error unpairing Ollama: ${(error as Error).message}`;
        }
      },
    },
  ];
}
