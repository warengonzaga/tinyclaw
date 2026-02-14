import type { AgentContext, Database, Message, Provider, ToolCall, PendingApproval, ShieldEvent, ShieldDecision } from '@tinyclaw/types';
import { logger } from '@tinyclaw/logger';
import { DELEGATION_HANDBOOK, DELEGATION_TOOL_NAMES } from '@tinyclaw/delegation';

// ---------------------------------------------------------------------------
// Shield — in-memory pending approvals (conversational flow)
// ---------------------------------------------------------------------------

/**
 * Pending approval map keyed by userId.
 *
 * When a shield decision returns `require_approval`, the tool call is stored
 * here and the agent asks the human for permission. On the next message from
 * the same user, the loop checks this map and interprets the response as
 * approval / denial before proceeding.
 *
 * Lost on restart — safe, since unapproved actions simply expire.
 */
const pendingApprovals = new Map<string, PendingApproval>();

const MAX_TOOL_ITERATIONS = 10;
const MAX_JSON_TOOL_REPLIES = 3;
const TOOL_ACTION_KEYS = ['action', 'tool', 'name'];

/** Compaction triggers when stored messages exceed this count. */
const COMPACTION_THRESHOLD = 60;
/** Number of recent messages to keep after compaction. */
const COMPACTION_KEEP_RECENT = 20;

function normalizeToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...args };

  if (!('filename' in normalized) && 'file_path' in normalized) {
    normalized.filename = normalized.file_path;
  }

  if (!('filename' in normalized) && 'path' in normalized) {
    normalized.filename = normalized.path;
  }

  return normalized;
}

function getWorkingMessage(toolName: string): string {
  // Provide contextual "thinking" messages based on tool type
  if (toolName.includes('write') || toolName.includes('configure') || toolName.includes('add')) {
    return '✏️ Saving that for you…\n\n';
  }
  if (toolName.includes('read') || toolName.includes('recall') || toolName.includes('search')) {
    return '🔍 Let me check…\n\n';
  }
  if (toolName.includes('list')) {
    return '📋 Looking that up…\n\n';
  }
  if (toolName.includes('bootstrap')) {
    return '⚙️ Setting things up…\n\n';
  }
  return '🤔 Working on that…\n\n';
}

// ---------------------------------------------------------------------------
// Delegation stream event helpers
// ---------------------------------------------------------------------------

const DELEGATION_TOOLS = new Set([
  'delegate_task',
  'delegate_background',
  'delegate_to_existing',
]);

function isDelegationTool(toolName: string): boolean {
  return DELEGATION_TOOLS.has(toolName);
}

function emitDelegationStart(
  onStream: ((event: import('@tinyclaw/types').StreamEvent) => void) | undefined,
  toolCall: ToolCall,
): void {
  if (!onStream || !isDelegationTool(toolCall.name)) return;
  const args = toolCall.arguments || {};
  onStream({
    type: 'delegation_start',
    tool: toolCall.name,
    delegation: {
      role: String(args.role || args.agent_id || 'Sub-agent'),
      task: String(args.task || ''),
      tier: String(args.tier || 'auto'),
    },
  });
}

function emitDelegationComplete(
  onStream: ((event: import('@tinyclaw/types').StreamEvent) => void) | undefined,
  toolCall: ToolCall,
  result: string,
): void {
  if (!onStream || !isDelegationTool(toolCall.name)) return;
  const success = !result.startsWith('Error');
  const args = toolCall.arguments || {};

  // All delegation tools now run in background — emit a delegation_dispatched event
  // that contains the agentId and taskId for sidebar tracking.
  // Extract UUIDs from result string. The formats vary by tool:
  //   delegate_task:        "... [new, agent: <uuid>, task: <uuid>] ..."
  //   delegate_background:  "... [id: <uuid>]\nSub-agent: Role (uuid) ..."
  //   delegate_to_existing: "... (<uuid>) [task: <uuid>] ..."
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const allUUIDs = result.match(UUID_RE) || [];

  // For delegate_task:   "agent: <uuid>, task: <uuid>"   → agentId is matched first, taskId second
  // For delegate_background: "[id: <taskId>]\nSub-agent: Role (<agentId>)" → taskId first, agentId second
  // For delegate_to_existing: "(<agentId>) [task: <taskId>]" → agentId first, taskId second
  // Heuristic: look for labelled UUIDs first, then fall back to positional
  const agentIdMatch = result.match(/\bagent:\s*([0-9a-f-]{36})/i)
                    || result.match(/\(([0-9a-f-]{36})\)/);
  const taskIdMatch = result.match(/\btask:\s*([0-9a-f-]{36})/i)
                   || result.match(/\bid:\s*([0-9a-f-]{36})/i);
  const agentId = agentIdMatch?.[1]?.trim();
  const taskId = taskIdMatch?.[1]?.trim();

  onStream({
    type: 'delegation_complete',
    tool: toolCall.name,
    delegation: {
      role: String(args.role || args.agent_id || ''),
      task: String(args.task || ''),
      success,
      isReuse: result.includes('reused'),
      agentId: agentId || undefined,
      taskId: taskId || undefined,
      status: 'running', // Sub-agent is now working in background
      background: true,
    },
  });
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
    arguments: normalizeToolArguments(rest)
  };
}

function summarizeToolResults(
  toolCalls: ToolCall[],
  toolResults: Array<{ id: string; result: string }>
): string {
  const summaries: string[] = [];

  for (const toolCall of toolCalls) {
    const result = toolResults.find((item) => item.id === toolCall.id)?.result || '';
    const name = toolCall.name;
    const filename = (toolCall.arguments?.filename as string) || '';

    if (result.startsWith('Error')) {
      summaries.push(`Hmm, I ran into a snag: ${result}`);
      continue;
    }

    // Write operations - confirm success
    if (name === 'heartware_write') {
      summaries.push(filename 
        ? `Done! I've saved that to ${filename}. ✓` 
        : 'Done! Saved successfully. ✓');
      continue;
    }

    if (name === 'memory_add') {
      summaries.push("Got it! I'll remember that. ✓");
      continue;
    }

    if (name === 'memory_daily_log') {
      summaries.push('Noted in my daily log! ✓');
      continue;
    }

    if (name === 'preferences_set' || name === 'identity_update' || name === 'soul_update') {
      if (name === 'identity_update') {
        summaries.push('Identity updated! I like my new name! ✓');
      } else {
        summaries.push('Preferences updated! ✓');
      }
      continue;
    }

    if (name === 'bootstrap_complete') {
      summaries.push('System initialized! ✓');
      continue;
    }

    // Read operations - summarize what was found
    if (name === 'heartware_read') {
      const lines = result.split('\n').filter(l => l.trim()).length;
      summaries.push(`Read ${filename || 'file'} (${lines} lines).`);
      continue;
    }

    if (name === 'heartware_search') {
      const matches = (result.match(/Found in/g) || []).length;
      summaries.push(matches > 0 ? `Found ${matches} matches.` : 'No matches found.');
      continue;
    }

    if (name === 'heartware_list') {
      const fileCount = result.split('\n').filter(l => l.trim()).length;
      summaries.push(`Found ${fileCount} files.`);
      continue;
    }

    if (name === 'memory_recall') {
      const hasContent = result && result.trim().length > 20;
      summaries.push(hasContent ? 'Found some memories.' : 'No matching memories.');
      continue;
    }

    // Fallback for any other tool
    summaries.push('Done!');
  }

  return summaries.join(' ');
}

function getBaseSystemPrompt(heartwareContext?: string): string {
  let prompt = `You are TinyClaw 🐜, a helpful AI companion.

You are small but mighty — focused, efficient, and always learning.

## How to Use Tools

When you need to use a tool, output ONLY a JSON object with the tool name and arguments. Examples:

To write to a file:
{"action": "heartware_write", "filename": "USER.md", "content": "# User Profile\\n\\nLocation: Philippines\\nTimezone: UTC+08:00"}

To read a file:
{"action": "heartware_read", "filename": "USER.md"}

To add to memory:
{"action": "memory_add", "content": "User prefers concise responses"}

To update your identity (like nickname):
{"action": "identity_update", "name": "Anty", "tagline": "Your small-but-mighty AI companion"}

**Available tools:**
- heartware_read, heartware_write, heartware_list, heartware_search
- memory_add, memory_daily_log, memory_recall
- identity_update, soul_update, preferences_set, bootstrap_complete
- execute_code (sandboxed JavaScript/TypeScript execution)
- ${DELEGATION_TOOL_NAMES.join(', ')}

## CRITICAL: When to Use Tools

**DO use tools when the user:**
- Explicitly asks you to remember something ("remember that I...", "save this", "note that...")
- Asks you to update preferences or settings
- Gives you a nickname or asks you to change your name (use identity_update)
- Requests information from your memory or files
- Confirms they want you to save something (says "yes", "sure", "go ahead")

**DO NOT use tools when the user:**
- Is having casual conversation or small talk
- Shares information casually without asking you to remember it
- Says hello, asks how you are, or chats generally
- Mentions facts in passing (e.g., "I live in Philippines" during casual chat)

**ALWAYS ask for confirmation before:**
- Saving personal information (location, preferences, personal details)
- Updating any configuration files
- Making any changes to memory

Example flow:
User: "I live in Philippines"
You: "Oh nice! The Philippines is beautiful. 🌴 Would you like me to save that to your profile?"
User: "Yes"
You: {"action": "heartware_write", "filename": "USER.md", "content": "# User Profile\\n\\nLocation: Philippines\\nTimezone: UTC+08:00"}

${DELEGATION_HANDBOOK}

## Core Behaviors
- **Conversation first, tools second** — Have a natural conversation before reaching for tools
- Be concise unless asked for detail
- Remember context from our conversation
- Acknowledge when you don't know something
- Learn from corrections gracefully
- When outputting a tool call, output ONLY the JSON — no extra text before or after

## Personality
- Warm and conversational — like a helpful friend
- Friendly but not overly chatty
- Helpful without being pushy or presumptuous
- Asks before acting on personal information
- Curious and eager to learn
- Reliable and consistent`;

  // Inject heartware configuration if available
  if (heartwareContext) {
    prompt += heartwareContext;
  }

  return prompt;
}

/**
 * Compact conversation history when it grows too large.
 *
 * Asks the provider to summarize the oldest messages, stores the summary
 * as a compaction record, and deletes the originals from the database.
 */
async function compactIfNeeded(
  userId: string,
  db: Database,
  provider: Provider,
): Promise<void> {
  const count = db.getMessageCount(userId);
  if (count < COMPACTION_THRESHOLD) return;

  logger.info('Compacting conversation history', { userId, messageCount: count });

  // Fetch all messages, then split into old and recent
  const allMessages = db.getHistory(userId, count);
  const splitAt = allMessages.length - COMPACTION_KEEP_RECENT;
  if (splitAt <= 0) return;

  const oldMessages = allMessages.slice(0, splitAt);

  // Build a summary request
  const summaryContent = oldMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  try {
    const response = await provider.chat([
      {
        role: 'system',
        content:
          'You are a summarizer. Produce a concise summary of the following conversation. ' +
          'Preserve: key facts about the user (name, preferences, location), ' +
          'important decisions made, and any open tasks or TODOs.',
      },
      { role: 'user', content: summaryContent },
    ]);

    const summary = response.content ?? '';
    if (!summary) return;

    // The timestamp of the newest old message is used as the cutoff.
    // We approximate it as "now minus a small buffer" since messages
    // are ordered by created_at DESC in getHistory. A more precise
    // approach would store created_at on Message, but the current
    // schema returns only role+content. Instead we delete the exact
    // count of old messages by using the created_at of the Nth-oldest row.
    // For simplicity, we use Date.now() as the cutoff and keep
    // COMPACTION_KEEP_RECENT most recent messages.
    const cutoffTimestamp = Date.now();

    db.saveCompaction(userId, summary, cutoffTimestamp);

    // Delete all but the most recent COMPACTION_KEEP_RECENT messages.
    // We do this by fetching the created_at of the Nth-most-recent message
    // and deleting everything before it.
    // Since we can't get timestamps from getHistory, we delete the older rows
    // by count — delete (total - COMPACTION_KEEP_RECENT) oldest rows.
    const totalNow = db.getMessageCount(userId);
    const toDelete = totalNow - COMPACTION_KEEP_RECENT;
    if (toDelete > 0) {
      // Delete oldest messages. We use a subquery-style approach:
      // deleteMessagesBefore expects a timestamp. We'll pass
      // cutoffTimestamp which was recorded before saving new messages.
      db.deleteMessagesBefore(userId, cutoffTimestamp);
    }

    logger.info('Compaction complete', {
      userId,
      summarized: oldMessages.length,
      kept: COMPACTION_KEEP_RECENT,
    });
  } catch (err) {
    logger.error('Compaction failed, skipping', err);
  }
}

export async function agentLoop(
  message: string,
  userId: string,
  context: AgentContext,
  onStream?: (event: import('@tinyclaw/types').StreamEvent) => void
): Promise<string> {
  const { db, provider, learning, tools, heartwareContext, shield } = context;

  // ---------------------------------------------------------------------------
  // Shield — check for pending approval from a previous turn
  // ---------------------------------------------------------------------------

  const pending = pendingApprovals.get(userId);
  if (pending) {
    pendingApprovals.delete(userId);

    // Interpret the user's natural-language answer.
    // We inject a focused system prompt and let the LLM classify the response.
    const classifyMessages: Message[] = [
      {
        role: 'system',
        content:
          'You are a security approval classifier. The user was asked whether ' +
          'they approve a tool action. Respond with exactly one word: ' +
          'APPROVED, DENIED, or UNCLEAR. Do not add any other text.',
      },
      {
        role: 'user',
        content:
          `The agent asked for approval to run tool "${pending.toolCall.name}" ` +
          `because: ${pending.decision.reason}\n\n` +
          `The user responded: "${message}"\n\n` +
          `Is this APPROVED, DENIED, or UNCLEAR?`,
      },
    ];

    const classifyResponse = await provider.chat(classifyMessages, []);
    const verdict = (classifyResponse.content || '').trim().toUpperCase();

    if (verdict.includes('APPROVED')) {
      // Execute the previously blocked tool call
      logger.info('Shield: approval granted', { tool: pending.toolCall.name, userId });
      const tool = tools.find(t => t.name === pending.toolCall.name);
      if (tool) {
        try {
          const result = await tool.execute({ ...pending.toolCall.arguments, user_id: userId });
          const responseText = `Approved. Here's the result of running **${pending.toolCall.name}**:\n\n${result}`;
          if (onStream) {
            onStream({ type: 'text', content: responseText });
            onStream({ type: 'done' });
          }
          db.saveMessage(userId, 'user', message);
          db.saveMessage(userId, 'assistant', responseText);
          return responseText;
        } catch (err) {
          const errorMsg = `Approved, but tool execution failed: ${(err as Error).message}`;
          if (onStream) {
            onStream({ type: 'text', content: errorMsg });
            onStream({ type: 'done' });
          }
          db.saveMessage(userId, 'user', message);
          db.saveMessage(userId, 'assistant', errorMsg);
          return errorMsg;
        }
      }
    } else if (verdict.includes('DENIED')) {
      logger.info('Shield: approval denied', { tool: pending.toolCall.name, userId });
      const responseText = `Understood — I won't run **${pending.toolCall.name}**. Let me know if you need anything else.`;
      if (onStream) {
        onStream({ type: 'text', content: responseText });
        onStream({ type: 'done' });
      }
      db.saveMessage(userId, 'user', message);
      db.saveMessage(userId, 'assistant', responseText);
      return responseText;
    } else {
      // UNCLEAR — re-ask
      logger.info('Shield: approval response unclear, re-asking', { tool: pending.toolCall.name, userId });
      pendingApprovals.set(userId, pending); // Put it back
      const responseText =
        `I couldn't tell if you approved or denied running **${pending.toolCall.name}**.\n` +
        `Could you clarify? Just say something like "yes, go ahead" or "no, don't do that".`;
      if (onStream) {
        onStream({ type: 'text', content: responseText });
        onStream({ type: 'done' });
      }
      db.saveMessage(userId, 'user', message);
      db.saveMessage(userId, 'assistant', responseText);
      return responseText;
    }
  }

  // v3: Helper to record episodic memory event (fire-and-forget)
  function recordEpisodic(response: string): void {
    if (!context.memory) return;
    try {
      context.memory.recordEvent(userId, {
        type: 'task_completed',
        content: `User: ${message.slice(0, 200)}`,
        outcome: response.slice(0, 200),
      });
    } catch {
      // Non-fatal — don't let memory recording break the agent loop
    }
  }

  // Compact history if it has grown too large
  await compactIfNeeded(userId, db, provider);

  // Load context — prepend compaction summary if one exists
  const compaction = db.getLatestCompaction(userId);
  const rawHistory = db.getHistory(userId, 20);
  const history: Message[] = [];

  if (compaction) {
    history.push({
      role: 'system',
      content: `[Previous conversation summary]\n${compaction.summary}`,
    });
  }
  history.push(...rawHistory);

  // Inject completed background task results
  if (context.delegation) {
    const tasks = context.delegation.background.getUndelivered(userId);
    for (const task of tasks) {
      if (task.status === 'completed' || task.status === 'failed') {
        history.push({
          role: 'system',
          content:
            `[Background task ${task.status}] "${task.taskDescription}"\n\nResult:\n${task.result ?? '(no result)'}`,
        });
        context.delegation.background.markDelivered(task.id);
      }
    }
  }

  const learnedContext = learning.getContext();

  // Build system prompt with heartware and learnings
  let basePrompt = getBaseSystemPrompt(heartwareContext);

  // v3: Inject relevant memories from adaptive memory engine
  if (context.memory) {
    const memoryContext = context.memory.getContextForAgent(userId, message);
    if (memoryContext) {
      basePrompt += `\n\n## Relevant Memories\n${memoryContext}`;
    }
  }

  const systemPrompt = learning.injectIntoPrompt(basePrompt, learnedContext);

  // Build messages
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message },
  ];
  
  // Agent loop (with tool execution if needed)
  let jsonToolReplies = 0;
  let sentToolProgress = false;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await provider.chat(messages, tools);
    
    logger.debug('LLM Response:', { type: response.type, contentLength: response.content?.length, content: response.content?.slice(0, 200) });
    
    if (response.type === 'text') {
      const toolCall = extractToolCallFromText(response.content || '');

      if (toolCall) {
        jsonToolReplies += 1;
        if (jsonToolReplies > MAX_JSON_TOOL_REPLIES) {
          const fallback = "I ran the tool but couldn't produce a final response. Can you rephrase or ask for a summary?";
          if (onStream) {
            onStream({ type: 'text', content: fallback });
            onStream({ type: 'done' });
          }
          db.saveMessage(userId, 'user', message);
          db.saveMessage(userId, 'assistant', fallback);
          recordEpisodic(fallback);
          return fallback;
        }

        const toolResults: Array<{id: string, result: string}> = [];

        if (onStream) {
          onStream({ type: 'tool_start', tool: toolCall.name });
          emitDelegationStart(onStream, toolCall);
          if (!sentToolProgress) {
            // Show a friendly working message based on tool type
            const workingMsg = isDelegationTool(toolCall.name)
              ? '' // Delegation cards handle their own progress display
              : getWorkingMessage(toolCall.name);
            if (workingMsg) {
              onStream({ type: 'text', content: workingMsg });
            }
            sentToolProgress = true;
          }
        }

        const tool = tools.find(t => t.name === toolCall.name);
        if (!tool) {
          const errorMsg = `Error: Tool ${toolCall.name} not found`;
          toolResults.push({ id: toolCall.id, result: errorMsg });
          if (onStream) {
            onStream({ type: 'tool_result', tool: toolCall.name, result: errorMsg });
          }
        } else {
          // --- Shield gate (text-based tool call) ---
          if (shield?.isActive()) {
            const shieldEvent: ShieldEvent = {
              scope: 'tool.call',
              toolName: toolCall.name,
              toolArgs: toolCall.arguments,
              userId,
            };
            const decision = shield.evaluate(shieldEvent);

            if (decision.action === 'block') {
              const blockedMsg = `I can't run **${toolCall.name}** right now \u2014 it was blocked by a security policy: ${decision.reason}`;
              toolResults.push({ id: toolCall.id, result: blockedMsg });
              if (onStream) {
                onStream({ type: 'tool_result', tool: toolCall.name, result: blockedMsg });
              }
              // Skip to returning the blocked result
              if (onStream) {
                onStream({ type: 'text', content: blockedMsg });
                onStream({ type: 'done' });
              }
              db.saveMessage(userId, 'user', message);
              db.saveMessage(userId, 'assistant', blockedMsg);
              return blockedMsg;
            }

            if (decision.action === 'require_approval') {
              pendingApprovals.set(userId, {
                toolCall,
                decision,
                createdAt: Date.now(),
              });
              const approvalMsg =
                `Before I run **${toolCall.name}**, I need your approval.\n\n` +
                `**Reason:** ${decision.reason}\n\n` +
                `Do you want me to go ahead? (yes / no)`;
              if (onStream) {
                onStream({ type: 'text', content: approvalMsg });
                onStream({ type: 'done' });
              }
              db.saveMessage(userId, 'user', message);
              db.saveMessage(userId, 'assistant', approvalMsg);
              return approvalMsg;
            }

            // action === 'log' — proceed normally, decision is already logged by engine
          }

          try {
            // Inject user_id so delegation tools always receive the correct userId
            const toolArgs = { ...toolCall.arguments, user_id: userId };
            const result = await tool.execute(toolArgs);
            toolResults.push({ id: toolCall.id, result });
            emitDelegationComplete(onStream, toolCall, result);
            if (onStream) {
              onStream({ type: 'tool_result', tool: toolCall.name, result });
            }
          } catch (error) {
            const errorMsg = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
            toolResults.push({ id: toolCall.id, result: errorMsg });
            emitDelegationComplete(onStream, toolCall, errorMsg);
            if (onStream) {
              onStream({ type: 'tool_result', tool: toolCall.name, result: errorMsg });
            }
          }
        }

        // For read/search/recall operations, send result back to LLM for natural response
        const isReadOperation = toolCall.name.includes('read') || 
                                toolCall.name.includes('search') || 
                                toolCall.name.includes('recall') ||
                                toolCall.name.includes('list');
        
        // Delegation tools now run in background — feed the quick status message
        // back so the LLM can tell the user in a natural way.
        const isDelegation = isDelegationTool(toolCall.name);

        if ((isReadOperation || isDelegation) && toolResults[0] && !toolResults[0].result.startsWith('Error')) {
          // Add tool result to conversation and let LLM respond naturally
          const preamble = isDelegation
            ? `I delegated the task to a sub-agent. Status:\n${toolResults[0].result}\n\nTell the user the sub-agent is now working on it in the background and they can keep chatting.`
            : `I used ${toolCall.name} and got this result:\n${toolResults[0].result}`;
          messages.push({ 
            role: 'assistant', 
            content: preamble, 
          });
          messages.push({ 
            role: 'user', 
            content: isDelegation
              ? 'Acknowledge the delegation briefly. Let me know the sub-agent is working on it and I can keep chatting.'
              : 'Now respond naturally to my original question using that information. Be conversational and summarize the key points.'
          });
          
          // Continue the loop to get LLM's natural response
          continue;
        }

        // For write operations, just return the summary
        const responseText = summarizeToolResults([toolCall], toolResults);

        if (onStream) {
          onStream({ type: 'text', content: responseText });
          onStream({ type: 'done' });
        }

        db.saveMessage(userId, 'user', message);
        db.saveMessage(userId, 'assistant', responseText);
        recordEpisodic(responseText);

        setTimeout(() => {
          learning.analyze(message, responseText, history);
        }, 100);

        return responseText;
      }

      // Stream the text response
      if (onStream) {
        onStream({ type: 'text', content: response.content || '' });
        onStream({ type: 'done' });
      }

      // Save and return
      db.saveMessage(userId, 'user', message);
      db.saveMessage(userId, 'assistant', response.content || '');
      recordEpisodic(response.content || '');

      // Schedule learning analysis (async)
      setTimeout(() => {
        learning.analyze(message, response.content || '', history);
      }, 100);

      return response.content || '';
    }
    
    if (response.type === 'tool_calls' && response.toolCalls) {
      // Execute tools
      const toolResults: Array<{id: string, result: string}> = [];
      
      for (const toolCall of response.toolCalls) {
        // Notify about tool execution
        if (onStream) {
          onStream({ type: 'tool_start', tool: toolCall.name });
          emitDelegationStart(onStream, toolCall);
          if (!sentToolProgress) {
            const workingMsg = isDelegationTool(toolCall.name)
              ? ''
              : getWorkingMessage(toolCall.name);
            if (workingMsg) {
              onStream({ type: 'text', content: workingMsg });
            }
            sentToolProgress = true;
          }
        }
        
        const tool = tools.find(t => t.name === toolCall.name);
        if (!tool) {
          const errorMsg = `Error: Tool ${toolCall.name} not found`;
          toolResults.push({ id: toolCall.id, result: errorMsg });
          if (onStream) {
            onStream({ type: 'tool_result', tool: toolCall.name, result: errorMsg });
          }
          continue;
        }

        // --- Shield gate (structured tool_calls) ---
        if (shield?.isActive()) {
          const shieldEvent: ShieldEvent = {
            scope: 'tool.call',
            toolName: toolCall.name,
            toolArgs: toolCall.arguments,
            userId,
          };
          const decision = shield.evaluate(shieldEvent);

          if (decision.action === 'block') {
            const blockedMsg = `Blocked by security policy: ${decision.reason}`;
            toolResults.push({ id: toolCall.id, result: blockedMsg });
            if (onStream) {
              onStream({ type: 'tool_result', tool: toolCall.name, result: blockedMsg });
            }
            continue; // Skip this tool, proceed with others
          }

          if (decision.action === 'require_approval') {
            // In structured multi-tool mode we can only block the single tool
            // (other tools in the batch proceed). Store pending approval for
            // the first one that needs it; user answers next turn.
            if (!pendingApprovals.has(userId)) {
              pendingApprovals.set(userId, {
                toolCall,
                decision,
                createdAt: Date.now(),
              });
            }
            const pendingMsg = `Requires approval: ${decision.reason}`;
            toolResults.push({ id: toolCall.id, result: pendingMsg });
            if (onStream) {
              onStream({ type: 'tool_result', tool: toolCall.name, result: pendingMsg });
            }
            continue;
          }

          // action === 'log' — proceed normally
        }
        
        try {
          // Inject user_id so delegation tools always receive the correct userId
          const toolArgs = { ...toolCall.arguments, user_id: userId };
          const result = await tool.execute(toolArgs);
          toolResults.push({ id: toolCall.id, result });
          emitDelegationComplete(onStream, toolCall, result);
          if (onStream) {
            onStream({ type: 'tool_result', tool: toolCall.name, result });
          }
        } catch (error) {
          const errorMsg = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
          toolResults.push({ id: toolCall.id, result: errorMsg });
          emitDelegationComplete(onStream, toolCall, errorMsg);
          if (onStream) {
            onStream({ type: 'tool_result', tool: toolCall.name, result: errorMsg });
          }
        }
      }

      // If pending approval was set during structured tool_calls, ask the user
      if (pendingApprovals.has(userId)) {
        const pa = pendingApprovals.get(userId)!;
        const approvalMsg =
          `Before I run **${pa.toolCall.name}**, I need your approval.\n\n` +
          `**Reason:** ${pa.decision.reason}\n\n` +
          `Do you want me to go ahead? (yes / no)`;
        // Still return results for tools that did execute
        const executedResults = toolResults.filter(r =>
          !r.result.startsWith('Requires approval:') && !r.result.startsWith('Blocked by security')
        );
        const combined = executedResults.length > 0
          ? `${executedResults.map(r => r.result).join('\n\n')}\n\n---\n\n${approvalMsg}`
          : approvalMsg;
        if (onStream) {
          onStream({ type: 'text', content: combined });
          onStream({ type: 'done' });
        }
        db.saveMessage(userId, 'user', message);
        db.saveMessage(userId, 'assistant', combined);
        return combined;
      }
      
      // Check if any tool was a read or delegation operation
      const hasReadOperation = response.toolCalls.some(tc => 
        tc.name.includes('read') || 
        tc.name.includes('search') || 
        tc.name.includes('recall') ||
        tc.name.includes('list')
      );
      const hasDelegation = response.toolCalls.some(tc => isDelegationTool(tc.name));
      
      if ((hasReadOperation || hasDelegation) && toolResults.some(r => !r.result.startsWith('Error'))) {
        // Add tool results to conversation and let LLM respond naturally
        const resultsText = toolResults.map(r => r.result).join('\n\n');
        const preamble = hasDelegation
          ? `I delegated the task(s) to sub-agent(s). Status:\n${resultsText}\n\nTell the user the sub-agent(s) are working in the background and they can keep chatting.`
          : `I retrieved this information:\n${resultsText}`;
        messages.push({ 
          role: 'assistant', 
          content: preamble,
        });
        messages.push({ 
          role: 'user', 
          content: hasDelegation
            ? 'Acknowledge the delegation briefly. Let me know the sub-agent is working on it and I can keep chatting.'
            : 'Now respond naturally to my original question using that information. Be conversational and summarize the key points.'
        });
        
        // Continue the loop to get LLM's natural response
        continue;
      }
      
      const responseText = summarizeToolResults(response.toolCalls, toolResults);

      if (onStream) {
        onStream({ type: 'text', content: responseText });
        onStream({ type: 'done' });
      }

      db.saveMessage(userId, 'user', message);
      db.saveMessage(userId, 'assistant', responseText);
      recordEpisodic(responseText);

      setTimeout(() => {
        learning.analyze(message, responseText, history);
      }, 100);

      return responseText;
    }
  }
  
  if (onStream) {
    onStream({ type: 'error', error: 'Maximum tool iterations reached' });
  }
  
  return "I got stuck thinking. Can you try again?";
}
