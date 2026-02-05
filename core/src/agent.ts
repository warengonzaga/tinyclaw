import { AgentContext, Message, ToolCall } from './types.js';
import { logger } from './logger.js';

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
          return fallback;
        }

        const toolResults: Array<{id: string, result: string}> = [];

        if (onStream) {
          onStream({ type: 'tool_start', tool: toolCall.name });
          if (!sentToolProgress) {
            // Show a friendly working message based on tool type
            const workingMsg = getWorkingMessage(toolCall.name);
            onStream({ type: 'text', content: workingMsg });
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

        // For read/search/recall operations, send result back to LLM for natural response
        const isReadOperation = toolCall.name.includes('read') || 
                                toolCall.name.includes('search') || 
                                toolCall.name.includes('recall') ||
                                toolCall.name.includes('list');
        
        if (isReadOperation && toolResults[0] && !toolResults[0].result.startsWith('Error')) {
          // Add tool result to conversation and let LLM respond naturally
          messages.push({ 
            role: 'assistant', 
            content: `I used ${toolCall.name} and got this result:\n${toolResults[0].result}` 
          });
          messages.push({ 
            role: 'user', 
            content: 'Now respond naturally to my original question using that information. Be conversational and summarize the key points.' 
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
            const workingMsg = getWorkingMessage(toolCall.name);
            onStream({ type: 'text', content: workingMsg });
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
      
      // Check if any tool was a read operation
      const hasReadOperation = response.toolCalls.some(tc => 
        tc.name.includes('read') || 
        tc.name.includes('search') || 
        tc.name.includes('recall') ||
        tc.name.includes('list')
      );
      
      if (hasReadOperation && toolResults.some(r => !r.result.startsWith('Error'))) {
        // Add tool results to conversation and let LLM respond naturally
        const resultsText = toolResults.map(r => r.result).join('\n\n');
        messages.push({ 
          role: 'assistant', 
          content: `I retrieved this information:\n${resultsText}` 
        });
        messages.push({ 
          role: 'user', 
          content: 'Now respond naturally to my original question using that information. Be conversational and summarize the key points.' 
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
