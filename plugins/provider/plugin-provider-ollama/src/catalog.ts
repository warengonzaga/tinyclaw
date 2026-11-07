import { BUILTIN_MODEL_TAGS, DEFAULT_BASE_URL } from '@tinyclaw/core';
import { buildProviderKeyName } from '@tinyclaw/types';

export const OLLAMA_PLUGIN_ID = '@tinyclaw/plugin-provider-ollama';
export const OLLAMA_PROVIDER_ID = 'ollama';
export const OLLAMA_SECRET_KEY = buildProviderKeyName(OLLAMA_PROVIDER_ID);
export const OLLAMA_MODEL_CONFIG_KEY = 'providers.ollama.model';
export const OLLAMA_BASE_URL_CONFIG_KEY = 'providers.ollama.baseUrl';
export const OLLAMA_MODE_CONFIG_KEY = 'providers.ollama.mode';
export const OLLAMA_API_KEY_REF_CONFIG_KEY = 'providers.ollama.apiKeyRef';
export const OLLAMA_LOCAL_BASE_URL = 'http://127.0.0.1:11434';
export const OLLAMA_LOCAL_FALLBACK_MODEL = 'llama3.2:3b';
export const OLLAMA_CLOUD_FALLBACK_MODEL = 'qwen3:32b';

export type OllamaProviderMode = 'local' | 'cloud';

interface OllamaTagItem {
  name?: string;
  model?: string;
}

interface OllamaTagsResponse {
  models?: OllamaTagItem[];
}

export function normalizeOllamaMode(mode: string | null | undefined): OllamaProviderMode {
  return mode === 'cloud' ? 'cloud' : 'local';
}

export function getDefaultBaseUrl(mode: OllamaProviderMode): string {
  return mode === 'cloud' ? DEFAULT_BASE_URL : OLLAMA_LOCAL_BASE_URL;
}

export function getFallbackModel(mode: OllamaProviderMode): string {
  return mode === 'cloud' ? OLLAMA_CLOUD_FALLBACK_MODEL : OLLAMA_LOCAL_FALLBACK_MODEL;
}

export function shouldFilterBuiltinModel(mode: OllamaProviderMode, model: string): boolean {
  return mode === 'cloud' && (BUILTIN_MODEL_TAGS as readonly string[]).includes(model);
}

export function sortModels(models: string[]): string[] {
  return [...new Set(models)].sort((left, right) => left.localeCompare(right));
}

export async function fetchOllamaModels(config: {
  baseUrl: string;
  mode: OllamaProviderMode;
  apiKey?: string | null;
}): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(`${config.baseUrl}/api/tags`, { headers });
  if (!response.ok) {
    throw new Error(`Ollama model listing failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as OllamaTagsResponse;
  const models = (data.models ?? [])
    .map((entry) => entry.name ?? entry.model ?? '')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !shouldFilterBuiltinModel(config.mode, entry));

  return sortModels(models);
}

export function formatModelList(models: string[], currentModel?: string): string {
  if (models.length === 0) {
    return 'No supported models were found.';
  }

  return models
    .map((model) => (model === currentModel ? `• ${model} [current]` : `• ${model}`))
    .join('\n');
}
