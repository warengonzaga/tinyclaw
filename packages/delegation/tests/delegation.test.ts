/**
 * Tests for the dynamic agent delegation system.
 *
 * Tests both the sub-agent runner (runSubAgent) and the delegation tool
 * factory (createDelegationTool) using mock providers and tools.
 */

import { describe, expect, test } from 'bun:test';
import { runSubAgent, createDelegationTool } from '../src/index.js';
import type { Provider, Tool, Message, LLMResponse } from '@tinyclaw/types';
import type { ProviderOrchestrator } from '@tinyclaw/router';
import type { ProviderRegistry } from '@tinyclaw/router';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Create a mock provider that returns the given responses in sequence. */
function createMockProvider(
  responses: LLMResponse[],
  id = 'mock-provider',
): Provider {
  let callIndex = 0;
  return {
    id,
    name: `Mock (${id})`,
    async chat(_messages: Message[], _tools?: Tool[]): Promise<LLMResponse> {
      if (callIndex >= responses.length) {
        return { type: 'text', content: 'No more responses configured.' };
      }
      return responses[callIndex++];
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

/** Create a simple mock tool. */
function createMockTool(name: string, result = 'tool result'): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: { type: 'object', properties: {} },
    async execute(): Promise<string> {
      return result;
    },
  };
}

/** Create a mock orchestrator for testing createDelegationTool. */
function createMockOrchestrator(provider: Provider): ProviderOrchestrator {
  const mockRegistry: ProviderRegistry = {
    register() {},
    get: () => provider,
    ids: () => [provider.id],
    getForTier: () => provider,
  };

  return {
    route: () => ({
      provider,
      classification: {
        tier: 'simple' as const,
        score: 0.2,
        confidence: 0.9,
        signals: [],
      },
    }),
    routeWithHealth: async () => ({
      provider,
      classification: {
        tier: 'simple' as const,
        score: 0.2,
        confidence: 0.9,
        signals: [],
      },
      failedOver: false,
    }),
    getRegistry: () => mockRegistry,
    getDefaultProvider: () => provider,
    selectActiveProvider: async () => provider,
    getActiveProvider: () => provider,
  } as unknown as ProviderOrchestrator;
}

// ---------------------------------------------------------------------------
// runSubAgent
// ---------------------------------------------------------------------------

describe('runSubAgent', () => {
  test('returns text response on first iteration', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'Here is the research result.' },
    ]);

    const result = await runSubAgent({
      task: 'Research quantum computing',
      role: 'Researcher',
      provider,
      tools: [],
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe('Here is the research result.');
    expect(result.iterations).toBe(1);
    expect(result.providerId).toBe('mock-provider');
  });

  test('handles native tool_calls then text response', async () => {
    const provider = createMockProvider([
      {
        type: 'tool_calls',
        toolCalls: [
          { id: 'tc-1', name: 'heartware_read', arguments: { filename: 'FRIEND.md' } },
        ],
      },
      { type: 'text', content: 'Based on the file, here is the summary.' },
    ]);

    const mockTool = createMockTool('heartware_read', 'Name: Alice\nLocation: PH');

    const result = await runSubAgent({
      task: 'Summarize user profile',
      role: 'Profile Analyst',
      provider,
      tools: [mockTool],
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe('Based on the file, here is the summary.');
    expect(result.iterations).toBe(2);
  });

  test('handles JSON-in-text tool call', async () => {
    const provider = createMockProvider([
      {
        type: 'text',
        content: '{"action": "memory_recall", "query": "preferences"}',
      },
      { type: 'text', content: 'The user prefers concise responses.' },
    ]);

    const mockTool = createMockTool('memory_recall', 'User likes brevity.');

    const result = await runSubAgent({
      task: 'Recall user preferences',
      role: 'Memory Analyst',
      provider,
      tools: [mockTool],
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe('The user prefers concise responses.');
    expect(result.iterations).toBe(2);
  });

  test('returns failure when max iterations reached', async () => {
    // Provider always returns tool calls — never a text response
    const provider = createMockProvider(
      Array.from({ length: 15 }, () => ({
        type: 'tool_calls' as const,
        toolCalls: [
          { id: `tc-${Math.random()}`, name: 'heartware_list', arguments: {} },
        ],
      })),
    );

    const mockTool = createMockTool('heartware_list', 'file1.md\nfile2.md');

    const result = await runSubAgent({
      task: 'Infinite loop task',
      role: 'Loop Agent',
      provider,
      tools: [mockTool],
    });

    expect(result.success).toBe(false);
    expect(result.response).toContain('maximum iterations');
    expect(result.iterations).toBe(10);
  });

  test('returns failure on timeout', async () => {
    // Provider that never resolves
    const slowProvider: Provider = {
      id: 'slow',
      name: 'Slow Provider',
      async chat(): Promise<LLMResponse> {
        return new Promise(() => {}); // Never resolves
      },
      async isAvailable() {
        return true;
      },
    };

    const result = await runSubAgent({
      task: 'Slow task',
      role: 'Slow Agent',
      provider: slowProvider,
      tools: [],
      timeout: 100, // 100ms timeout
    });

    expect(result.success).toBe(false);
    expect(result.response).toContain('timed out');
  });

  test('handles tool not found gracefully', async () => {
    const provider = createMockProvider([
      {
        type: 'tool_calls',
        toolCalls: [
          { id: 'tc-1', name: 'nonexistent_tool', arguments: {} },
        ],
      },
      { type: 'text', content: 'Tool was not found, proceeding without it.' },
    ]);

    const result = await runSubAgent({
      task: 'Use missing tool',
      role: 'Tester',
      provider,
      tools: [],
    });

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(2);
  });

  test('handles tool execution error gracefully', async () => {
    const failingTool: Tool = {
      name: 'failing_tool',
      description: 'A tool that always fails',
      parameters: { type: 'object', properties: {} },
      async execute(): Promise<string> {
        throw new Error('Tool exploded');
      },
    };

    const provider = createMockProvider([
      {
        type: 'tool_calls',
        toolCalls: [
          { id: 'tc-1', name: 'failing_tool', arguments: {} },
        ],
      },
      { type: 'text', content: 'Recovered from tool error.' },
    ]);

    const result = await runSubAgent({
      task: 'Test error handling',
      role: 'Error Handler',
      provider,
      tools: [failingTool],
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe('Recovered from tool error.');
  });

  test('handles provider error gracefully', async () => {
    const errorProvider: Provider = {
      id: 'error',
      name: 'Error Provider',
      async chat(): Promise<LLMResponse> {
        throw new Error('Provider connection failed');
      },
      async isAvailable() {
        return false;
      },
    };

    const result = await runSubAgent({
      task: 'Will fail',
      role: 'Doomed Agent',
      provider: errorProvider,
      tools: [],
    });

    expect(result.success).toBe(false);
    expect(result.response).toContain('Provider connection failed');
  });

  test('handles empty content in text response', async () => {
    const provider = createMockProvider([
      { type: 'text', content: '' },
    ]);

    const result = await runSubAgent({
      task: 'Empty response task',
      role: 'Empty Agent',
      provider,
      tools: [],
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe('');
    expect(result.iterations).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// createDelegationTool
// ---------------------------------------------------------------------------

describe('createDelegationTool', () => {
  test('returns a tool named delegate_task', () => {
    const provider = createMockProvider([]);
    const orchestrator = createMockOrchestrator(provider);

    const tool = createDelegationTool({
      orchestrator,
      allTools: [],
    });

    expect(tool.name).toBe('delegate_task');
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toBeDefined();
  });

  test('executes a delegation and returns formatted result', async () => {
    const provider = createMockProvider([
      { type: 'text', content: 'Research complete: quantum computing is cool.' },
    ]);
    const orchestrator = createMockOrchestrator(provider);

    const tool = createDelegationTool({
      orchestrator,
      allTools: [],
    });

    const result = await tool.execute({
      task: 'Research quantum computing',
      role: 'Researcher',
    });

    expect(result).toContain('Sub-agent (Researcher) completed');
    expect(result).toContain('quantum computing is cool');
    expect(result).toContain('mock-provider');
  });

  test('filters tools to default safe set', async () => {
    let receivedTools: Tool[] = [];
    const provider: Provider = {
      id: 'spy',
      name: 'Spy Provider',
      async chat(_msgs: Message[], tools?: Tool[]): Promise<LLMResponse> {
        receivedTools = tools ?? [];
        return { type: 'text', content: 'done' };
      },
      async isAvailable() {
        return true;
      },
    };

    const orchestrator = createMockOrchestrator(provider);

    const allTools = [
      createMockTool('heartware_read'),
      createMockTool('heartware_search'),
      createMockTool('heartware_list'),
      createMockTool('heartware_write'), // NOT in default safe set
      createMockTool('memory_recall'),
      createMockTool('memory_add'),       // NOT in default safe set
      createMockTool('config_set'),       // NOT in default safe set
    ];

    const tool = createDelegationTool({ orchestrator, allTools });

    await tool.execute({
      task: 'Test tool filtering',
      role: 'Filter Tester',
    });

    const toolNames = receivedTools.map((t) => t.name);
    expect(toolNames).toContain('heartware_read');
    expect(toolNames).toContain('heartware_search');
    expect(toolNames).toContain('heartware_list');
    expect(toolNames).toContain('memory_recall');
    expect(toolNames).not.toContain('heartware_write');
    expect(toolNames).not.toContain('memory_add');
    expect(toolNames).not.toContain('config_set');
  });

  test('grants additional tools when requested', async () => {
    let receivedTools: Tool[] = [];
    const provider: Provider = {
      id: 'spy',
      name: 'Spy Provider',
      async chat(_msgs: Message[], tools?: Tool[]): Promise<LLMResponse> {
        receivedTools = tools ?? [];
        return { type: 'text', content: 'done' };
      },
      async isAvailable() {
        return true;
      },
    };

    const orchestrator = createMockOrchestrator(provider);

    const allTools = [
      createMockTool('heartware_read'),
      createMockTool('heartware_write'),
      createMockTool('memory_recall'),
      createMockTool('memory_add'),
    ];

    const tool = createDelegationTool({ orchestrator, allTools });

    await tool.execute({
      task: 'Test with extra tools',
      role: 'Writer',
      tools: ['heartware_write', 'memory_add'],
    });

    const toolNames = receivedTools.map((t) => t.name);
    expect(toolNames).toContain('heartware_read');
    expect(toolNames).toContain('heartware_write');
    expect(toolNames).toContain('memory_recall');
    expect(toolNames).toContain('memory_add');
  });

  test('prevents recursion by excluding delegate_task', async () => {
    let receivedTools: Tool[] = [];
    const provider: Provider = {
      id: 'spy',
      name: 'Spy Provider',
      async chat(_msgs: Message[], tools?: Tool[]): Promise<LLMResponse> {
        receivedTools = tools ?? [];
        return { type: 'text', content: 'done' };
      },
      async isAvailable() {
        return true;
      },
    };

    const orchestrator = createMockOrchestrator(provider);

    // Include delegate_task in allTools — it should be filtered out
    const delegateTool = createMockTool('delegate_task');
    const allTools = [
      createMockTool('heartware_read'),
      createMockTool('memory_recall'),
      delegateTool,
    ];

    const tool = createDelegationTool({ orchestrator, allTools });

    // Even if user explicitly requests it
    await tool.execute({
      task: 'Try to recurse',
      role: 'Recursive Agent',
      tools: ['delegate_task'],
    });

    const toolNames = receivedTools.map((t) => t.name);
    expect(toolNames).not.toContain('delegate_task');
  });

  test('validates required parameters', async () => {
    const provider = createMockProvider([]);
    const orchestrator = createMockOrchestrator(provider);

    const tool = createDelegationTool({ orchestrator, allTools: [] });

    const emptyTask = await tool.execute({ task: '', role: 'Test' });
    expect(emptyTask).toContain('Error');

    const emptyRole = await tool.execute({ task: 'Do something', role: '' });
    expect(emptyRole).toContain('Error');
  });

  test('returns error message on failed delegation', async () => {
    const errorProvider: Provider = {
      id: 'error',
      name: 'Error Provider',
      async chat(): Promise<LLMResponse> {
        throw new Error('Connection refused');
      },
      async isAvailable() {
        return false;
      },
    };

    const orchestrator = createMockOrchestrator(errorProvider);
    const tool = createDelegationTool({ orchestrator, allTools: [] });

    const result = await tool.execute({
      task: 'Will fail',
      role: 'Doomed Agent',
    });

    expect(result).toContain('Sub-agent (Doomed Agent) failed');
    expect(result).toContain('Connection refused');
  });

  test('supports custom default tool set', async () => {
    let receivedTools: Tool[] = [];
    const provider: Provider = {
      id: 'spy',
      name: 'Spy Provider',
      async chat(_msgs: Message[], tools?: Tool[]): Promise<LLMResponse> {
        receivedTools = tools ?? [];
        return { type: 'text', content: 'done' };
      },
      async isAvailable() {
        return true;
      },
    };

    const orchestrator = createMockOrchestrator(provider);

    const allTools = [
      createMockTool('custom_tool_a'),
      createMockTool('custom_tool_b'),
      createMockTool('heartware_read'),
    ];

    const tool = createDelegationTool({
      orchestrator,
      allTools,
      defaultSubAgentTools: ['custom_tool_a', 'custom_tool_b'],
    });

    await tool.execute({
      task: 'Test custom defaults',
      role: 'Custom Agent',
    });

    const toolNames = receivedTools.map((t) => t.name);
    expect(toolNames).toContain('custom_tool_a');
    expect(toolNames).toContain('custom_tool_b');
    expect(toolNames).not.toContain('heartware_read');
  });
});
