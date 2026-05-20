import { logger } from '@tinyclaw/logger';
import type {
  LLMResponse,
  Message,
  Provider,
  SecretsManagerInterface,
  Tool,
  ToolCall,
} from '@tinyclaw/types';
import {
  getDefaultBaseUrl,
  normalizeOllamaMode,
  OLLAMA_PROVIDER_ID,
  type OllamaProviderMode,
} from './catalog.js';

export interface OllamaPluginProviderConfig {
  secrets: SecretsManagerInterface;
  model: string;
  baseUrl?: string;
  mode?: OllamaProviderMode;
}

interface OllamaMessageResponse {
  content?: string;
  thinking?: string;
  tool_calls?: {
    function: { name: string; arguments: Record<string, unknown> | string };
  }[];
}

interface OllamaChatResponse {
  message?: OllamaMessageResponse;
  choices?: Array<{ message?: OllamaMessageResponse }>;
  response?: string;
  content?: string;
  text?: string;
}

function toOllamaTools(tools: Tool[]): {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseToolCalls(
  raw: { function: { name: string; arguments: Record<string, unknown> | string } }[],
): ToolCall[] {
  return raw.map((toolCall) => ({
    id: crypto.randomUUID(),
    name: toolCall.function.name,
    arguments:
      typeof toolCall.function.arguments === 'string'
        ? (JSON.parse(toolCall.function.arguments) as Record<string, unknown>)
        : toolCall.function.arguments,
  }));
}

const TOOL_ACTION_KEYS = ['action', 'tool', 'name'];

function extractToolCallFromText(text: string): ToolCall | null {
  if (!text) return null;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const actionKey = TOOL_ACTION_KEYS.find((key) => key in parsed);
    const name = actionKey ? String(parsed[actionKey]) : '';
    if (!name) return null;

    const { action, tool, name: ignoredName, ...rest } = parsed;
    void action;
    void tool;
    void ignoredName;

    return {
      id: crypto.randomUUID(),
      name,
      arguments: rest,
    };
  } catch {
    return null;
  }
}

async function resolveApiKey(
  secrets: SecretsManagerInterface,
  mode: OllamaProviderMode,
): Promise<string | null> {
  if (mode === 'local') {
    return null;
  }

  return secrets.resolveProviderKey(OLLAMA_PROVIDER_ID);
}

export function createOllamaPluginProvider(config: OllamaPluginProviderConfig): Provider {
  const mode = normalizeOllamaMode(config.mode);
  const baseUrl = config.baseUrl ?? getDefaultBaseUrl(mode);
  const model = config.model;
  const shortName = model.split(':')[0] || model;

  return {
    id: OLLAMA_PROVIDER_ID,
    name: mode === 'cloud' ? `Ollama Cloud (${shortName})` : `Ollama Local (${shortName})`,

    async chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
      const apiKey = await resolveApiKey(config.secrets, mode);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      try {
        const body: Record<string, unknown> = {
          model,
          messages,
          stream: false,
        };

        if (tools?.length) {
          body.tools = toOllamaTools(tools);
        }

        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new Error(
            `Ollama API error: ${response.status} ${response.statusText}` +
              (errorBody ? ` — ${errorBody}` : ''),
          );
        }

        const data = (await response.json()) as OllamaChatResponse;
        const message = data.message ?? data.choices?.[0]?.message;

        if (message?.tool_calls?.length) {
          return {
            type: 'tool_calls',
            content: message.content ?? undefined,
            toolCalls: parseToolCalls(message.tool_calls),
          };
        }

        const content = message?.content ?? data.response ?? data.content ?? data.text ?? '';
        if (content) {
          return { type: 'text', content };
        }

        const toolCall = extractToolCallFromText(message?.thinking ?? '');
        if (toolCall) {
          return {
            type: 'tool_calls',
            toolCalls: [toolCall],
          };
        }

        return { type: 'text', content: '' };
      } catch (error) {
        logger.error('Ollama provider plugin error:', error);
        throw error;
      }
    },

    async isAvailable(): Promise<boolean> {
      const apiKey = await resolveApiKey(config.secrets, mode);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      try {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'ping' }],
            stream: false,
          }),
        });

        if (response.status === 401 || response.status === 403) {
          const body = await response.text().catch(() => '');
          throw new Error(
            `Authentication failed (${response.status}): ${body || response.statusText}`,
          );
        }

        return response.ok;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Authentication failed')) {
          throw error;
        }

        return false;
      }
    },
  };
}
