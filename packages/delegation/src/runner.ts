/**
 * Sub-Agent Runner
 *
 * Runs a lightweight agent loop for sub-agents. Supports both ephemeral
 * (v1 compat) and persistent (v2) modes via optional orientation context
 * and existing message history.
 *
 * Returns a result object — never throws.
 */

import { logger } from '@tinyclaw/logger';
import type { Provider, Tool, Message, ToolCall } from '@tinyclaw/types';
import type {
  SubAgentConfig,
  SubAgentResult,
  SubAgentRunConfig,
  SubAgentRunResult,
  OrientationContext,
} from './types.js';
import { formatOrientation } from './orientation.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUB_AGENT_MAX_ITERATIONS = 10;
const SUB_AGENT_TIMEOUT_MS = 60_000;
const TOOL_ACTION_KEYS = ['action', 'tool', 'name'];

// ---------------------------------------------------------------------------
// Tool call parsing helpers
// (Duplicated from loop.ts — pure functions, candidates for future
//  extraction into core/src/tool-utils.ts)
// ---------------------------------------------------------------------------

function normalizeToolArguments(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...args };

  if (!('filename' in normalized) && 'file_path' in normalized) {
    normalized.filename = normalized.file_path;
  }

  if (!('filename' in normalized) && 'path' in normalized) {
    normalized.filename = normalized.path;
  }

  return normalized;
}

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
    arguments: normalizeToolArguments(rest),
  };
}

// ---------------------------------------------------------------------------
// Tool execution helper
// ---------------------------------------------------------------------------

async function executeToolCall(
  toolCall: ToolCall,
  tools: Tool[],
): Promise<string> {
  const tool = tools.find((t) => t.name === toolCall.name);
  if (!tool) {
    return `Error: Tool "${toolCall.name}" not found`;
  }

  try {
    return await tool.execute(toolCall.arguments);
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

// ---------------------------------------------------------------------------
// Build system prompt
// ---------------------------------------------------------------------------

function buildSubAgentPrompt(
  role: string,
  orientation?: OrientationContext,
): string {
  let prompt = '';

  if (orientation) {
    prompt += formatOrientation(orientation) + '\n\n';
  }

  prompt +=
    `You are a focused sub-agent with the role: ${role}.\n\n` +
    `Complete the following task and return a clear, concise result.\n` +
    `Do not ask follow-up questions — use your best judgment and available tools.\n` +
    `When you have finished, respond with your final answer as plain text.`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Core runner loop (shared between v1 and v2)
// ---------------------------------------------------------------------------

async function runAgentLoop(
  provider: Provider,
  tools: Tool[],
  messages: Message[],
): Promise<{ success: boolean; response: string; iterations: number }> {
  let iterations = 0;

  for (let i = 0; i < SUB_AGENT_MAX_ITERATIONS; i++) {
    iterations = i + 1;

    const response = await provider.chat(messages, tools);

    // --- Text response ---------------------------------------------------
    if (response.type === 'text') {
      const toolCall = extractToolCallFromText(response.content || '');

      if (toolCall) {
        const result = await executeToolCall(toolCall, tools);
        messages.push({
          role: 'assistant',
          content: response.content || '',
        });
        messages.push({
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
        });
        continue;
      }

      return {
        success: true,
        response: response.content || '',
        iterations,
      };
    }

    // --- Native tool calls ------------------------------------------------
    if (response.type === 'tool_calls' && response.toolCalls?.length) {
      const assistantContent = response.content ?? '';

      for (const tc of response.toolCalls) {
        const result = await executeToolCall(tc, tools);
        messages.push({
          role: 'assistant',
          content: assistantContent,
          toolCalls: [tc],
        });
        messages.push({
          role: 'tool',
          content: result,
          toolCallId: tc.id,
        });
      }
      continue;
    }
  }

  return {
    success: false,
    response: 'Sub-agent reached maximum iterations without completing the task.',
    iterations,
  };
}

// ---------------------------------------------------------------------------
// V1 Runner (backward compatible)
// ---------------------------------------------------------------------------

/**
 * Run an ephemeral sub-agent to completion (v1 API).
 *
 * The sub-agent runs a lightweight agent loop entirely in-memory:
 * - No database writes
 * - No learning engine analysis
 * - No conversation history or compaction
 *
 * Returns a result object — never throws.
 */
export async function runSubAgent(
  config: SubAgentConfig,
): Promise<SubAgentResult> {
  const { task, role, provider, tools } = config;
  const timeout = config.timeout ?? SUB_AGENT_TIMEOUT_MS;

  const systemPrompt = buildSubAgentPrompt(role);

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ];

  let iterations = 0;

  try {
    const result = await Promise.race([
      (async () => {
        const r = await runAgentLoop(provider, tools, messages);
        iterations = r.iterations;
        return r;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sub-agent timed out')), timeout),
      ),
    ]);

    return {
      success: result.success,
      response: result.response,
      iterations: result.iterations,
      providerId: provider.id,
    };
  } catch (err) {
    logger.error('Sub-agent error:', err);
    return {
      success: false,
      response: `Sub-agent error: ${(err as Error).message}`,
      iterations,
      providerId: provider.id,
    };
  }
}

// ---------------------------------------------------------------------------
// V2 Runner (with orientation + message persistence)
// ---------------------------------------------------------------------------

/**
 * Run a sub-agent with v2 features: orientation context and message continuity.
 *
 * If `existingMessages` is provided, they're included for context continuity.
 * Returns the full message array for persistence by the caller.
 */
export async function runSubAgentV2(
  config: SubAgentRunConfig,
): Promise<SubAgentRunResult> {
  const { task, role, provider, tools, orientation, existingMessages } = config;
  const timeout = config.timeout ?? SUB_AGENT_TIMEOUT_MS;

  const systemPrompt = buildSubAgentPrompt(role, orientation);

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Include existing messages for continuity (reused sub-agents)
  if (existingMessages?.length) {
    messages.push(...existingMessages);
  }

  // Add the new task
  messages.push({ role: 'user', content: task });

  let iterations = 0;

  try {
    const result = await Promise.race([
      (async () => {
        const r = await runAgentLoop(provider, tools, messages);
        iterations = r.iterations;
        return r;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sub-agent timed out')), timeout),
      ),
    ]);

    return {
      success: result.success,
      response: result.response,
      iterations: result.iterations,
      providerId: provider.id,
      messages: messages.filter((m) => m.role !== 'system'),
    };
  } catch (err) {
    logger.error('Sub-agent v2 error:', err);
    return {
      success: false,
      response: `Sub-agent error: ${(err as Error).message}`,
      iterations,
      providerId: provider.id,
      messages: messages.filter((m) => m.role !== 'system'),
    };
  }
}
