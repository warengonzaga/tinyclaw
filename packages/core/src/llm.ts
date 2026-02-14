import { logger } from '@tinyclaw/logger';
import type { Provider, Message, LLMResponse, Tool, ToolCall } from '@tinyclaw/types';
import type { SecretsManager } from '@tinyclaw/secrets';
import { DEFAULT_MODEL } from './models.js';

export interface OllamaConfig {
  apiKey?: string;
  secrets?: SecretsManager;
  model?: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Tool format conversion helpers
// ---------------------------------------------------------------------------

/** Convert internal Tool[] to the Ollama API tools format. */
function toOllamaTools(
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

/**
 * Parse tool_calls from Ollama API response.
 *
 * Ollama returns tool call arguments as an **object** (not a JSON string
 * like OpenAI), and does not include an `id` field — we generate one.
 */
function parseOllamaToolCalls(
  raw: { function: { name: string; arguments: Record<string, unknown> | string } }[],
): ToolCall[] {
  return raw.map((tc) => ({
    id: crypto.randomUUID(),
    name: tc.function.name,
    arguments:
      typeof tc.function.arguments === 'string'
        ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
        : tc.function.arguments,
  }));
}

/**
 * Attempt to extract a JSON tool-call object from freeform text.
 *
 * Used as a last-resort fallback when the model puts tool-call intent
 * in its `thinking` field or in content text instead of using native
 * tool calling.
 */
const TOOL_ACTION_KEYS = ['action', 'tool', 'name'];

function extractToolCallFromText(text: string): ToolCall | null {
  if (!text) return null;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  const raw = text.slice(start, end + 1).trim();
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const actionKey = TOOL_ACTION_KEYS.find((key) => key in parsed);
  const toolName = actionKey ? String(parsed[actionKey]) : '';
  if (!toolName) return null;

  const { action, tool, name, ...rest } = parsed as Record<string, unknown>;

  return {
    id: crypto.randomUUID(),
    name: toolName,
    arguments: rest,
  };
}

/**
 * Create an Ollama provider.
 *
 * API key resolution: uses `config.apiKey` if given, otherwise resolves
 * `provider.ollama.apiKey` from the SecretsManager at call time.
 */
export function createOllamaProvider(config: OllamaConfig): Provider {
  const baseUrl = config.baseUrl || 'https://ollama.com';
  const model = config.model || DEFAULT_MODEL;

  // Derive a human-readable short name from the model tag
  const shortName = model.split(':')[0];
  
  return {
    id: 'ollama-cloud',
    name: `Ollama Cloud (${shortName})`,
    
    async chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
      try {
        // Resolve API key: explicit value or secrets-engine lookup
        const apiKey = config.apiKey ?? (await config.secrets?.resolveProviderKey('ollama'));
        if (!apiKey) {
          throw new Error(
            'No API key available for Ollama. ' +
            'Store one with: store_secret key="provider.ollama.apiKey" value="sk-..."'
          );
        }

        const body: Record<string, unknown> = {
          model,
          messages,
          stream: false,
        };

        // Pass tools to the Ollama API so it can return native tool calls
        if (tools?.length) {
          body.tools = toOllamaTools(tools);
        }

        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        
        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new Error(
            `Ollama API error: ${response.status} ${response.statusText}` +
            (errorBody ? ` — ${errorBody}` : '')
          );
        }
        
        const data = await response.json();
        
        // Debug: log raw API response to understand its structure
        logger.debug('Raw API response:', JSON.stringify(data).slice(0, 500));

        // Resolve the message object (Ollama vs OpenAI vs direct format)
        const msg = data.message || data.choices?.[0]?.message;

        // 1. Native tool calls — highest priority
        if (msg?.tool_calls?.length) {
          logger.debug('Ollama tool_calls detected', { count: msg.tool_calls.length });
          return {
            type: 'tool_calls',
            content: msg.content ?? undefined,
            toolCalls: parseOllamaToolCalls(msg.tool_calls),
          };
        }

        // 2. Text content
        const content =
          msg?.content ||
          data.response ||              // Simple format
          data.content ||               // Direct content
          data.text ||                  // Text format
          '';

        if (content) {
          return { type: 'text', content };
        }

        // 3. Fallback — content is empty; try to extract a tool call from
        //    the model's `thinking` field (reasoning models put intent there)
        const thinking: string = msg?.thinking || '';
        if (thinking) {
          logger.debug('Content empty, checking thinking field for tool calls');
          const toolCall = extractToolCallFromText(thinking);
          if (toolCall) {
            logger.info('Extracted tool call from thinking field', { tool: toolCall.name });
            return {
              type: 'tool_calls',
              toolCalls: [toolCall],
            };
          }
        }

        // 4. Nothing useful — return empty text
        return { type: 'text', content: '' };
      } catch (error) {
        logger.error('Ollama provider error:', (error as Error).message);
        throw error;
      }
    },
    
    async isAvailable(): Promise<boolean> {
      try {
        const apiKey = config.apiKey ?? (await config.secrets?.resolveProviderKey('ollama'));
        if (!apiKey) return false;

        // Use the chat endpoint with a minimal ping message so we validate
        // the same auth path the real requests will take.
        // /api/tags may not enforce auth the same way /api/chat does.
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'ping' }],
            stream: false,
          }),
        });

        // Surface auth errors explicitly so callers can distinguish
        // "provider is down" from "bad API key"
        if (response.status === 401 || response.status === 403) {
          const body = await response.text().catch(() => '');
          throw new Error(
            `Authentication failed (${response.status}): ${body || response.statusText}`,
          );
        }

        return response.ok;
      } catch (err) {
        // Re-throw auth errors so they propagate to the caller
        if (err instanceof Error && err.message.startsWith('Authentication failed')) {
          throw err;
        }
        return false;
      }
    }
  };
}
