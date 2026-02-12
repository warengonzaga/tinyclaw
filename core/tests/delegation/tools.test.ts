/**
 * Tests for the 6 delegation tools factory.
 */

import { describe, expect, test } from 'bun:test';
import { createDatabase } from '../../src/db.js';
import { createDelegationTools } from '../../src/delegation/tools.js';
import { createSessionQueue } from '../../src/queue.js';
import type { Provider, Tool, Message, LLMResponse, LearningEngine, LearnedContext } from '../../src/types.js';
import type { ProviderOrchestrator } from '../../src/router/orchestrator.js';
import type { ProviderRegistry } from '../../src/router/provider-registry.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

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
        return { type: 'text', content: 'No more responses.' };
      }
      return responses[callIndex++];
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

function createMockTool(name: string, result = 'tool result'): Tool {
  return {
    name,
    description: `Mock: ${name}`,
    parameters: { type: 'object', properties: {} },
    async execute(): Promise<string> {
      return result;
    },
  };
}

function createMockLearning(): LearningEngine {
  return {
    analyze() {},
    getContext(): LearnedContext {
      return { preferences: 'concise', patterns: '', recentCorrections: '' };
    },
    injectIntoPrompt(prompt: string) {
      return prompt;
    },
  };
}

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
      classification: { tier: 'simple' as const, score: 0.2, confidence: 0.9, signals: [] },
    }),
    routeWithHealth: async () => ({
      provider,
      classification: { tier: 'simple' as const, score: 0.2, confidence: 0.9, signals: [] },
      failedOver: false,
    }),
    getRegistry: () => mockRegistry,
    getDefaultProvider: () => provider,
    selectActiveProvider: async () => provider,
    getActiveProvider: () => provider,
  } as unknown as ProviderOrchestrator;
}

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

function setup(responses: LLMResponse[] = [{ type: 'text', content: 'Done.' }]) {
  const db = createDatabase(':memory:');
  const provider = createMockProvider(responses);
  const orchestrator = createMockOrchestrator(provider);
  const queue = createSessionQueue();
  const learning = createMockLearning();

  const allTools = [
    createMockTool('heartware_read'),
    createMockTool('heartware_search'),
    createMockTool('heartware_list'),
    createMockTool('memory_recall'),
    createMockTool('heartware_write'),
    createMockTool('memory_add'),
  ];

  const result = createDelegationTools({
    orchestrator,
    allTools,
    db,
    heartwareContext: '## Identity\nI am TinyClaw.',
    learning,
    queue,
  });

  return { db, result, queue, provider };
}

function findTool(tools: Tool[], name: string): Tool {
  const t = tools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool ${name} not found`);
  return t;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createDelegationTools', () => {
  test('returns 6 tools', () => {
    const { result } = setup();
    expect(result.tools.length).toBe(6);

    const names = result.tools.map((t) => t.name);
    expect(names).toContain('delegate_task');
    expect(names).toContain('delegate_background');
    expect(names).toContain('delegate_to_existing');
    expect(names).toContain('list_sub_agents');
    expect(names).toContain('manage_sub_agent');
    expect(names).toContain('manage_template');

    result.db?.close?.();
  });

  test('returns lifecycle, templates, and background managers', () => {
    const { result } = setup();
    expect(result.lifecycle).toBeDefined();
    expect(result.templates).toBeDefined();
    expect(result.background).toBeDefined();
  });
});

describe('delegate_task', () => {
  test('creates sub-agent and returns result', async () => {
    const { result, db } = setup([
      { type: 'text', content: 'Research complete: found 3 results.' },
    ]);

    const tool = findTool(result.tools, 'delegate_task');
    const output = await tool.execute({
      task: 'Research quantum computing',
      role: 'Research Analyst',
      user_id: 'user-1',
    });

    expect(output).toContain('Sub-agent (Research Analyst) completed');
    expect(output).toContain('found 3 results');
    expect(output).toContain('new');

    // Sub-agent should be persisted
    const agents = result.lifecycle.listActive('user-1');
    expect(agents.length).toBe(1);
    expect(agents[0].role).toBe('Research Analyst');
    expect(agents[0].totalTasks).toBe(1);
    expect(agents[0].successfulTasks).toBe(1);

    db.close();
  });

  test('reuses existing sub-agent with similar role', async () => {
    const { result, db } = setup([
      { type: 'text', content: 'First result.' },
      { type: 'text', content: 'Second result — reused agent.' },
    ]);

    const tool = findTool(result.tools, 'delegate_task');

    // First delegation creates a new agent
    await tool.execute({
      task: 'Research topic A',
      role: 'Technical Research Analyst',
      user_id: 'user-1',
    });

    // Second delegation with similar role should reuse
    const output = await tool.execute({
      task: 'Research topic B',
      role: 'Research Analyst',
      user_id: 'user-1',
    });

    expect(output).toContain('reused');

    // Should still be just 1 agent
    const agents = result.lifecycle.listActive('user-1');
    expect(agents.length).toBe(1);
    expect(agents[0].totalTasks).toBe(2);

    db.close();
  });

  test('auto-creates template on success', async () => {
    const { result, db } = setup([
      { type: 'text', content: 'Task done.' },
    ]);

    const tool = findTool(result.tools, 'delegate_task');

    await tool.execute({
      task: 'Analyze market data',
      role: 'Market Data Analyst',
      user_id: 'user-1',
    });

    const templates = result.templates.list('user-1');
    expect(templates.length).toBe(1);
    expect(templates[0].name).toBe('Market Data Analyst');

    db.close();
  });

  test('validates required parameters', async () => {
    const { result, db } = setup();

    const tool = findTool(result.tools, 'delegate_task');

    const emptyTask = await tool.execute({ task: '', role: 'Test' });
    expect(emptyTask).toContain('Error');

    const emptyRole = await tool.execute({ task: 'Do something', role: '' });
    expect(emptyRole).toContain('Error');

    db.close();
  });
});

describe('list_sub_agents', () => {
  test('returns formatted list of agents', async () => {
    const { result, db } = setup([
      { type: 'text', content: 'Done 1.' },
      { type: 'text', content: 'Done 2.' },
    ]);

    const delegateTool = findTool(result.tools, 'delegate_task');
    // Use very distinct roles so they won't be reused
    await delegateTool.execute({ task: 'Research quantum physics', role: 'Quantum Physics Researcher', user_id: 'u1' });
    await delegateTool.execute({ task: 'Write poetry about nature', role: 'Creative Poetry Writer', user_id: 'u1' });

    const listTool = findTool(result.tools, 'list_sub_agents');
    const output = await listTool.execute({ user_id: 'u1' });

    expect(output).toContain('Sub-agents (2)');
    expect(output).toContain('Quantum Physics Researcher');
    expect(output).toContain('Creative Poetry Writer');

    db.close();
  });

  test('returns message when no agents', async () => {
    const { result, db } = setup();

    const tool = findTool(result.tools, 'list_sub_agents');
    const output = await tool.execute({ user_id: 'u1' });

    expect(output).toContain('No sub-agents found');

    db.close();
  });
});

describe('manage_sub_agent', () => {
  test('dismiss and revive cycle', async () => {
    const { result, db } = setup([
      { type: 'text', content: 'Done.' },
    ]);

    // Create an agent
    const delegateTool = findTool(result.tools, 'delegate_task');
    await delegateTool.execute({ task: 'Task', role: 'Worker', user_id: 'u1' });

    const agents = result.lifecycle.listActive('u1');
    const agentId = agents[0].id;

    const manageTool = findTool(result.tools, 'manage_sub_agent');

    // Dismiss
    const dismissResult = await manageTool.execute({ agent_id: agentId, action: 'dismiss' });
    expect(dismissResult).toContain('dismissed');
    expect(result.lifecycle.listActive('u1').length).toBe(0);

    // Revive
    const reviveResult = await manageTool.execute({ agent_id: agentId, action: 'revive' });
    expect(reviveResult).toContain('revived');
    expect(result.lifecycle.listActive('u1').length).toBe(1);

    db.close();
  });

  test('kill permanently removes agent', async () => {
    const { result, db } = setup([
      { type: 'text', content: 'Done.' },
    ]);

    const delegateTool = findTool(result.tools, 'delegate_task');
    await delegateTool.execute({ task: 'Task', role: 'Doomed', user_id: 'u1' });

    const agents = result.lifecycle.listActive('u1');
    const agentId = agents[0].id;

    const manageTool = findTool(result.tools, 'manage_sub_agent');
    const killResult = await manageTool.execute({ agent_id: agentId, action: 'kill' });
    expect(killResult).toContain('permanently deleted');

    expect(result.lifecycle.get(agentId)).toBeNull();

    db.close();
  });

  test('validates action parameter', async () => {
    const { result, db } = setup();

    const tool = findTool(result.tools, 'manage_sub_agent');
    const output = await tool.execute({ agent_id: 'xxx', action: 'invalid' });
    expect(output).toContain('Error');

    db.close();
  });
});

describe('manage_template', () => {
  test('list returns all templates', async () => {
    const { result, db } = setup([
      { type: 'text', content: 'Done.' },
    ]);

    // Create a template via delegation (auto-create)
    const delegateTool = findTool(result.tools, 'delegate_task');
    await delegateTool.execute({ task: 'Research AI', role: 'AI Researcher', user_id: 'u1' });

    const tool = findTool(result.tools, 'manage_template');
    const output = await tool.execute({ action: 'list', user_id: 'u1' });
    expect(output).toContain('Role templates');
    expect(output).toContain('AI Researcher');

    db.close();
  });

  test('delete removes template', async () => {
    const { result, db } = setup([
      { type: 'text', content: 'Done.' },
    ]);

    const delegateTool = findTool(result.tools, 'delegate_task');
    await delegateTool.execute({ task: 'Research AI', role: 'Researcher', user_id: 'u1' });

    const templates = result.templates.list('u1');
    expect(templates.length).toBe(1);

    const tool = findTool(result.tools, 'manage_template');
    const output = await tool.execute({ action: 'delete', template_id: templates[0].id });
    expect(output).toContain('deleted');

    expect(result.templates.list('u1').length).toBe(0);

    db.close();
  });

  test('validates action parameter', async () => {
    const { result, db } = setup();

    const tool = findTool(result.tools, 'manage_template');
    const output = await tool.execute({ action: 'invalid' });
    expect(output).toContain('Error');

    db.close();
  });
});

describe('delegate_to_existing', () => {
  test('sends follow-up to existing agent', async () => {
    const { result, db } = setup([
      { type: 'text', content: 'First task done.' },
      { type: 'text', content: 'Follow-up done.' },
    ]);

    // Create an agent
    const delegateTool = findTool(result.tools, 'delegate_task');
    await delegateTool.execute({ task: 'Initial task', role: 'Worker', user_id: 'u1' });

    const agents = result.lifecycle.listActive('u1');
    const agentId = agents[0].id;

    // Send follow-up
    const followupTool = findTool(result.tools, 'delegate_to_existing');
    const output = await followupTool.execute({
      agent_id: agentId,
      task: 'Follow-up task',
      user_id: 'u1',
    });

    expect(output).toContain('completed follow-up');
    expect(output).toContain('Follow-up done');

    // Agent should have 2 completed tasks
    const updated = result.lifecycle.get(agentId);
    expect(updated!.totalTasks).toBe(2);

    db.close();
  });

  test('returns error for non-existent agent', async () => {
    const { result, db } = setup();

    const tool = findTool(result.tools, 'delegate_to_existing');
    const output = await tool.execute({ agent_id: 'non-existent', task: 'Task' });
    expect(output).toContain('Error');
    expect(output).toContain('not found');

    db.close();
  });
});
