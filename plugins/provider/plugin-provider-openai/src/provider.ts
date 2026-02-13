/**
 * OpenAI Provider
 *
 * Creates a Provider that talks to the OpenAI Chat Completions API.
 * Uses fetch directly — no external SDK dependency.
 *
 * Supports:
 * - Configurable model (default: gpt-4.1)
 * - Configurable base URL (for Azure / OpenAI-compatible endpoints)
 * - Tool/function calling with automatic format conversion
 * - API key resolution from secrets-engine
 */

import { logger } from '@tinyclaw/logger';
import type {
  Provider,
  Message,
  LLMResponse,
  Tool,
  ToolCall,
  SecretsManagerInterface,
} from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAIProviderConfig {
  secrets: SecretsManagerInterface;
  /** Model to use (default: 'gpt-4.1'). */
  model?: string;
  /** Base URL for the API (default: 'https://api.openai.com'). */
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Message format conversion
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  return messages.map((msg) => {
    const out: OpenAIMessage = {
      role: msg.role,
      content: msg.content ?? null,
    };

    // Assistant messages with tool calls
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      out.tool_calls = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    // Tool result messages
    if (msg.role === 'tool' && msg.toolCallId) {
      out.tool_call_id = msg.toolCallId;
    }

    return out;
  });
}

function toOpenAITools(
  tools: Tool[],
): { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function parseToolCalls(
  raw: { id: string; function: { name: string; arguments: string } }[],
): ToolCall[] {
  return raw.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export function createOpenAIProvider(config: OpenAIProviderConfig): Provider {
  const baseUrl = config.baseUrl || 'https://api.openai.com';
  const model = config.model || 'gpt-4.1';

  return {
    id: 'openai',
    name: `OpenAI (${model})`,

    async chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
      try {
        const apiKey = await config.secrets.resolveProviderKey('openai');
        if (!apiKey) {
          throw new Error(
            'No API key available for OpenAI. ' +
            'Store one with: store_secret key="provider.openai.apiKey" value="sk-..."',
          );
        }

        const body: Record<string, unknown> = {
          model,
          messages: toOpenAIMessages(messages),
        };

        if (tools?.length) {
          body.tools = toOpenAITools(tools);
        }

        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(
            `OpenAI API error: ${response.status} ${response.statusText} — ${errorBody}`,
          );
        }

        const data = await response.json();

        logger.debug('OpenAI raw response:', JSON.stringify(data).slice(0, 500));

        const choice = data.choices?.[0]?.message;
        if (!choice) {
          throw new Error('OpenAI API returned no choices');
        }

        // Tool calls response
        if (choice.tool_calls?.length) {
          return {
            type: 'tool_calls',
            content: choice.content ?? undefined,
            toolCalls: parseToolCalls(choice.tool_calls),
          };
        }

        // Text response
        return {
          type: 'text',
          content: choice.content ?? '',
        };
      } catch (error) {
        logger.error('OpenAI provider error:', error);
        throw error;
      }
    },

    async isAvailable(): Promise<boolean> {
      try {
        const apiKey = await config.secrets.resolveProviderKey('openai');
        if (!apiKey) return false;

        const response = await fetch(`${baseUrl}/v1/models`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
