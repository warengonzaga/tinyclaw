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
import type { Provider, Tool, Message, ToolCall, ShieldEngine, ShieldEvent } from '@tinyclaw/types';
import type {
  SubAgentConfig,
  SubAgentResult,
  SubAgentRunConfig,
  SubAgentRunResult,
  OrientationContext,
} from './types.js';
import type { TimeoutEstimator } from './timeout-estimator.js';
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
  shield?: ShieldEngine,
): Promise<string> {
  // --- Shield gate for sub-agents ---
  // In sub-agent context, require_approval downgrades to block
  // (sub-agents can't ask the user directly).
  if (shield?.isActive()) {
    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: toolCall.name,
      toolArgs: toolCall.arguments,
    };
    const decision = shield.evaluate(event);

    if (decision.action === 'block' || decision.action === 'require_approval') {
      logger.info('Shield: sub-agent tool blocked', {
        tool: toolCall.name,
        originalAction: decision.action,
        reason: decision.reason,
      });
      return `Error: Tool "${toolCall.name}" blocked by security policy: ${decision.reason}`;
    }
    // action === 'log' — proceed normally
  }

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
//
// Now supports adaptive timeout: when a TimeoutEstimator is provided the
// loop checks `shouldExtend()` at each iteration boundary and can bump
// both the iteration cap and the time budget dynamically.
//
// Cancellation: the caller provides an AbortSignal.  When the agent
// finishes (text reply with no tool call) or the timeout fires, the
// signal is aborted so the *other* side stops immediately — no dangling
// timers, no wasted LLM calls after completion.
// ---------------------------------------------------------------------------

interface AdaptiveLoopConfig {
  provider: Provider;
  tools: Tool[];
  messages: Message[];
  maxIterations: number;
  timeoutMs: number;
  estimator?: TimeoutEstimator;
  /** Optional shield engine — require_approval downgrades to block for sub-agents. */
  shield?: ShieldEngine;
}

async function runAgentLoop(
  provider: Provider,
  tools: Tool[],
  messages: Message[],
): Promise<{ success: boolean; response: string; iterations: number }> {
  return runAdaptiveAgentLoop({
    provider,
    tools,
    messages,
    maxIterations: SUB_AGENT_MAX_ITERATIONS,
    timeoutMs: SUB_AGENT_TIMEOUT_MS,
  });
}

async function runAdaptiveAgentLoop(
  config: AdaptiveLoopConfig,
): Promise<{ success: boolean; response: string; iterations: number }> {
  const { provider, tools, messages, estimator, shield } = config;

  let maxIterations = config.maxIterations;
  let timeoutMs = config.timeoutMs;
  let extensionsGranted = 0;
  const startTime = Date.now();

  // --- Cancellable timeout -----------------------------------------------
  // We use AbortController so the agent loop and the timer can stop each
  // other cleanly.  When the agent finishes first it aborts → timer clears.
  // When the timer fires first it aborts → the next iteration check bails.

  const ac = new AbortController();
  const { signal } = ac;

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  function startTimer(ms: number): void {
    clearTimer();
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, ms);
  }

  function clearTimer(): void {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }

  // Start the initial timer
  startTimer(timeoutMs);

  /** Race a promise against the abort signal so a never-resolving LLM call
   *  doesn't prevent the timeout from taking effect. */
  function raceAbort<T>(promise: Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
        (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
      );
    });
  }

  let iterations = 0;

  try {
    for (let i = 0; i < maxIterations; i++) {
      // --- Check cancellation before each LLM call -------------------------
      if (signal.aborted) break;

      iterations = i + 1;

      let response;
      try {
        response = await raceAbort(provider.chat(messages, tools));
      } catch (err: any) {
        if (err?.name === 'AbortError') break;
        throw err;
      }

      // If timer fired while we were waiting for the LLM, bail out
      if (signal.aborted) break;

      // --- Text response ---------------------------------------------------
      if (response.type === 'text') {
        const toolCall = extractToolCallFromText(response.content || '');

        if (toolCall) {
          const result = await executeToolCall(toolCall, tools, shield);
          messages.push({
            role: 'assistant',
            content: response.content || '',
          });
          messages.push({
            role: 'tool',
            content: result,
            toolCallId: toolCall.id,
          });
          // fall through to extension check
        } else {
          // Agent is done — signal the timer to stop immediately
          clearTimer();
          ac.abort();       // harmless if already aborted
          return {
            success: true,
            response: response.content || '',
            iterations,
          };
        }
      }

      // --- Native tool calls ------------------------------------------------
      else if (response.type === 'tool_calls' && response.toolCalls?.length) {
        const assistantContent = response.content ?? '';

        for (const tc of response.toolCalls) {
          const result = await executeToolCall(tc, tools, shield);
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
        // fall through to extension check
      }

      // --- Adaptive extension check -----------------------------------------
      if (estimator) {
        const elapsed = Date.now() - startTime;
        const decision = estimator.shouldExtend(
          iterations,
          maxIterations,
          elapsed,
          timeoutMs,
          extensionsGranted,
        );

        if (decision.extend) {
          extensionsGranted++;
          if (decision.extraIterations > 0) {
            maxIterations += decision.extraIterations;
            logger.info('Adaptive extension: +iterations', {
              extra: decision.extraIterations,
              newMax: maxIterations,
              extensionsGranted,
            });
          }
          if (decision.extraMs > 0) {
            timeoutMs += decision.extraMs;
            // Restart timer with the remaining + extra time
            const remaining = timeoutMs - elapsed;
            startTimer(Math.max(remaining, decision.extraMs));
            logger.info('Adaptive extension: +time', {
              extraMs: decision.extraMs,
              newTimeoutMs: timeoutMs,
              extensionsGranted,
            });
          }
        }
      }
    }
  } finally {
    // Always clean up — no dangling timers
    clearTimer();
  }

  if (timedOut) {
    return {
      success: false,
      response: 'Sub-agent timed out.',
      iterations,
    };
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

  try {
    const result = await runAdaptiveAgentLoop({
      provider,
      tools,
      messages,
      maxIterations: SUB_AGENT_MAX_ITERATIONS,
      timeoutMs: timeout,
    });

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
      iterations: 0,
      providerId: provider.id,
    };
  }
}

// ---------------------------------------------------------------------------
// V2 Runner (with orientation + message persistence)
// ---------------------------------------------------------------------------

/**
 * Run a sub-agent with v2 features: orientation context, message
 * continuity, and adaptive timeouts.
 *
 * If `existingMessages` is provided, they're included for context continuity.
 * If `timeoutEstimator` is provided, the runner uses adaptive timeouts with
 * live extension — the sub-agent signals completion and the timer stops
 * immediately.  No dangling timers, no wasted LLM calls.
 *
 * Returns the full message array for persistence by the caller.
 */
export async function runSubAgentV2(
  config: SubAgentRunConfig,
): Promise<SubAgentRunResult> {
  const {
    task,
    role,
    provider,
    tools,
    orientation,
    existingMessages,
    timeoutEstimator,
  } = config;

  const timeout = config.timeout ?? SUB_AGENT_TIMEOUT_MS;
  const maxIter = config.maxIterations ?? SUB_AGENT_MAX_ITERATIONS;

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

  try {
    const result = await runAdaptiveAgentLoop({
      provider,
      tools,
      messages,
      maxIterations: maxIter,
      timeoutMs: timeout,
      estimator: timeoutEstimator,
    });

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
      iterations: 0,
      providerId: provider.id,
      messages: messages.filter((m) => m.role !== 'system'),
    };
  }
}
