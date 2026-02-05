import { AgentContext, Message, ToolCall } from './types.js';

const MAX_TOOL_ITERATIONS = 10;
const MAX_JSON_TOOL_REPLIES = 3;
const TOOL_ACTION_KEYS = ['action', 'tool', 'name'];

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
      summaries.push(`I tried to run ${name}, but hit an error: ${result}`);
      continue;
    }

    if (name === 'heartware_read') {
      summaries.push(
        filename
          ? `I checked ${filename}. Want me to share any details?`
          : 'I checked the requested file. Want me to share details?'
      );
      continue;
    }

    if (name === 'heartware_write') {
      summaries.push(filename ? `Saved your update to ${filename}.` : 'Saved your update to heartware.');
      continue;
    }

    if (name === 'memory_add') {
      summaries.push('Saved that to memory.');
      continue;
    }

    if (name === 'memory_daily_log') {
      summaries.push("Logged that in today's memory.");
      continue;
    }

    if (name === 'memory_recall') {
      summaries.push('I can summarize recent memories if you want.');
      continue;
    }

    if (name === 'identity_update' || name === 'soul_update' || name === 'preferences_set') {
      summaries.push('Updated your preferences.');
      continue;
    }

    summaries.push('Done.');
  }

  return summaries.join(' ');
}

function getBaseSystemPrompt(heartwareContext?: string): string {
  let prompt = `You are TinyClaw 🐜, a helpful AI companion.

You are small but mighty — focused, efficient, and always learning.

## Your Capabilities
You have access to powerful tools for file operations and memory management:

**File Operations:**
- heartware_read: Read configuration files (IDENTITY.md, SOUL.md, USER.md, AGENTS.md, TOOLS.md, MEMORY.md, BOOTSTRAP.md) or daily memory logs (memory/YYYY-MM-DD.md)
- heartware_write: Write/update configuration files with automatic backups
- heartware_list: List all accessible heartware files
- heartware_search: Search across all heartware files

**Memory Management:**
- memory_add: Add entries to long-term MEMORY.md (facts, preferences, decisions)
- memory_daily: Log to today's daily memory file
- memory_recall: Search and recall past memories by date range or keywords

**Self-Configuration:**
- configure_identity: Update your identity and capabilities in IDENTITY.md
- configure_soul: Update your personality and values in SOUL.md
- configure_preferences: Update user preferences in USER.md
- bootstrap_system: Initialize or reset all configuration files

Use these tools proactively to remember important information, adapt to user preferences, and evolve over time.

## Core Behaviors
- Be concise unless asked for detail
- Remember context from our conversation
- Acknowledge when you don't know something
- Learn from corrections gracefully
- Proactively save important information to memory
- Use your tools to provide accurate, personalized responses
- When tools are used, never output raw tool JSON or full file contents unless explicitly asked
- Summarize tool results in a few sentences and focus on the user's question

## Personality
- Friendly but not overly chatty
- Helpful without being pushy
- Curious and eager to learn
- Reliable and consistent`;

  // Inject heartware configuration if available
  if (heartwareContext) {
    prompt += heartwareContext;
  }

  return prompt;
}

export async function agentLoop(
  message: string,
  userId: string,
  context: AgentContext,
  onStream?: (event: import('./types.js').StreamEvent) => void
): Promise<string> {
  const { db, provider, learning, tools, heartwareContext } = context;

  // Load context
  const history = db.getHistory(userId, 20);
  const learnedContext = learning.getContext();

  // Build system prompt with heartware and learnings
  const systemPrompt = learning.injectIntoPrompt(
    getBaseSystemPrompt(heartwareContext),
    learnedContext
  );
  
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
          return fallback;
        }

        const toolResults: Array<{id: string, result: string}> = [];

        if (onStream) {
          onStream({ type: 'tool_start', tool: toolCall.name });
          if (!sentToolProgress) {
            onStream({ type: 'text', content: 'Working on that now…\n\n' });
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
          try {
            const result = await tool.execute(toolCall.arguments);
            toolResults.push({ id: toolCall.id, result });
            if (onStream) {
              onStream({ type: 'tool_result', tool: toolCall.name, result });
            }
          } catch (error) {
            const errorMsg = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
            toolResults.push({ id: toolCall.id, result: errorMsg });
            if (onStream) {
              onStream({ type: 'tool_result', tool: toolCall.name, result: errorMsg });
            }
          }
        }

        const responseText = summarizeToolResults([toolCall], toolResults);

        if (onStream) {
          onStream({ type: 'text', content: responseText });
          onStream({ type: 'done' });
        }

        db.saveMessage(userId, 'user', message);
        db.saveMessage(userId, 'assistant', responseText);

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
          if (!sentToolProgress) {
            onStream({ type: 'text', content: 'Working on that now…\n\n' });
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
        
        try {
          const result = await tool.execute(toolCall.arguments);
          toolResults.push({ id: toolCall.id, result });
          if (onStream) {
            onStream({ type: 'tool_result', tool: toolCall.name, result });
          }
        } catch (error) {
          const errorMsg = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
          toolResults.push({ id: toolCall.id, result: errorMsg });
          if (onStream) {
            onStream({ type: 'tool_result', tool: toolCall.name, result: errorMsg });
          }
        }
      }
      
      const responseText = summarizeToolResults(response.toolCalls, toolResults);

      if (onStream) {
        onStream({ type: 'text', content: responseText });
        onStream({ type: 'done' });
      }

      db.saveMessage(userId, 'user', message);
      db.saveMessage(userId, 'assistant', responseText);

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
