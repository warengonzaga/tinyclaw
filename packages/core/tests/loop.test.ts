import { describe, expect, test } from 'bun:test';
import type { AgentContext, LearnedContext, Message, Provider, Tool } from '@tinyclaw/types';
import { createDatabase } from '../src/database.js';
import { agentLoop } from '../src/loop.js';

function createLearningStub() {
  return {
    analyze() {},
    getContext(): LearnedContext {
      return {
        preferences: '',
        patterns: '',
        recentCorrections: '',
      };
    },
    injectIntoPrompt(basePrompt: string) {
      return basePrompt;
    },
  };
}

describe('agentLoop', () => {
  test('injects plugin setup walkthrough guidance into the system prompt', async () => {
    let firstPrompt: Message[] = [];

    const provider: Provider = {
      id: 'test-provider',
      name: 'Test Provider',
      async chat(messages) {
        firstPrompt = messages.map((message) => ({ ...message }));
        return {
          type: 'text',
          content: 'Tell me when you are ready to continue.',
        };
      },
      async isAvailable() {
        return true;
      },
    };

    const context: AgentContext = {
      db: createDatabase(':memory:'),
      provider,
      learning: createLearningStub(),
      tools: [],
    };

    await agentLoop('Help me set up the Discord plugin.', 'web:test', context);

    const systemPrompt = firstPrompt[0]?.content ?? '';
    expect(firstPrompt[0]?.role).toBe('system');
    expect(systemPrompt).toContain('## Plugin Setup Guidance');
    expect(systemPrompt).toContain('For Discord, explain that they need to create an application');
    expect(systemPrompt).toContain('do not pretend the plugin is configured');
  });

  test('turns structured write tool calls into a natural final reply', async () => {
    const prompts: Message[][] = [];

    const provider: Provider = {
      id: 'test-provider',
      name: 'Test Provider',
      async chat(messages) {
        prompts.push(messages.map((message) => ({ ...message })));

        if (prompts.length === 1) {
          return {
            type: 'tool_calls',
            toolCalls: [
              {
                id: 'restart-1',
                name: 'tinyclaw_restart_notice',
                arguments: { reason: 'refresh config' },
              },
            ],
          };
        }

        return {
          type: 'text',
          content: 'I refreshed the configuration. Please restart Tiny Claw when convenient.',
        };
      },
      async isAvailable() {
        return true;
      },
    };

    const tools: Tool[] = [
      {
        name: 'tinyclaw_restart_notice',
        description: 'Records that a restart is needed.',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
        },
        async execute(args) {
          return `Restart required: ${String(args.reason)}`;
        },
      },
    ];

    const context: AgentContext = {
      db: createDatabase(':memory:'),
      provider,
      learning: createLearningStub(),
      tools,
    };

    const result = await agentLoop('Please apply the config change.', 'web:test', context);

    expect(result).toBe('I refreshed the configuration. Please restart Tiny Claw when convenient.');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]?.at(-2)?.role).toBe('assistant');
    expect(prompts[1]?.at(-2)?.content).toContain('I used these tools and the results were:');
    expect(prompts[1]?.at(-2)?.content).toContain('Restart required: refresh config');
    expect(prompts[1]?.at(-1)?.role).toBe('user');
    expect(prompts[1]?.at(-1)?.content).toContain('respond naturally to my original message');

    const savedHistory = context.db.getHistory('web:test', 10);
    expect(savedHistory[0]?.content).toBe('Please apply the config change.');
    expect(savedHistory[1]?.content).toBe(result);
  });

  test('auto-restarts after successful plugin pairing during structured tool calls', async () => {
    const prompts: Message[][] = [];
    let restartCalls = 0;

    const provider: Provider = {
      id: 'test-provider',
      name: 'Test Provider',
      async chat(messages) {
        prompts.push(messages.map((message) => ({ ...message })));

        if (prompts.length === 1) {
          return {
            type: 'tool_calls',
            toolCalls: [
              {
                id: 'discord-pair-1',
                name: 'discord_pair',
                arguments: { token: 'discord-token' },
              },
            ],
          };
        }

        return {
          type: 'text',
          content: 'Discord is paired, and Tiny Claw is restarting now so the bot can connect.',
        };
      },
      async isAvailable() {
        return true;
      },
    };

    const tools: Tool[] = [
      {
        name: 'discord_pair',
        description: 'Stores a Discord token and enables the plugin.',
        parameters: {
          type: 'object',
          properties: {
            token: { type: 'string' },
          },
        },
        async execute() {
          return 'Discord bot paired successfully! Use the tinyclaw_restart tool now to connect the bot.';
        },
      },
      {
        name: 'tinyclaw_restart',
        description: 'Restarts Tiny Claw.',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
        },
        async execute() {
          restartCalls += 1;
          return 'Restart initiated. Tiny Claw will automatically respawn with the updated configuration.';
        },
      },
    ];

    const context: AgentContext = {
      db: createDatabase(':memory:'),
      provider,
      learning: createLearningStub(),
      tools,
    };

    const result = await agentLoop('Connect my Discord bot.', 'web:test', context);

    expect(result).toBe('Discord is paired, and Tiny Claw is restarting now so the bot can connect.');
    expect(restartCalls).toBe(1);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]?.at(-2)?.content).toContain('Discord bot paired successfully');
    expect(prompts[1]?.at(-2)?.content).toContain('Restart initiated. Tiny Claw will automatically respawn');
  });

  test('includes auto-restart results in the single-tool natural reply path', async () => {
    const prompts: Message[][] = [];
    let restartCalls = 0;

    const provider: Provider = {
      id: 'test-provider',
      name: 'Test Provider',
      async chat(messages) {
        prompts.push(messages.map((message) => ({ ...message })));

        if (prompts.length === 1) {
          return {
            type: 'text',
            content: JSON.stringify({ tool: 'discord_pair', token: 'discord-token' }),
          };
        }

        return {
          type: 'text',
          content: 'Discord is paired, and Tiny Claw is restarting now so the bot can connect.',
        };
      },
      async isAvailable() {
        return true;
      },
    };

    const tools: Tool[] = [
      {
        name: 'discord_pair',
        description: 'Stores a Discord token and enables the plugin.',
        parameters: {
          type: 'object',
          properties: {
            token: { type: 'string' },
          },
        },
        async execute() {
          return 'Discord bot paired successfully! Use the tinyclaw_restart tool now to connect the bot.';
        },
      },
      {
        name: 'tinyclaw_restart',
        description: 'Restarts Tiny Claw.',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
        },
        async execute() {
          restartCalls += 1;
          return 'Restart initiated. Tiny Claw will automatically respawn with the updated configuration.';
        },
      },
    ];

    const context: AgentContext = {
      db: createDatabase(':memory:'),
      provider,
      learning: createLearningStub(),
      tools,
    };

    const result = await agentLoop('Connect my Discord bot.', 'web:test', context);

    expect(result).toBe('Discord is paired, and Tiny Claw is restarting now so the bot can connect.');
    expect(restartCalls).toBe(1);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]?.at(-2)?.role).toBe('assistant');
    expect(prompts[1]?.at(-2)?.content).toContain('Discord bot paired successfully');
    expect(prompts[1]?.at(-2)?.content).toContain('Restart initiated. Tiny Claw will automatically respawn');
    expect(prompts[1]?.at(-1)?.role).toBe('user');
    expect(prompts[1]?.at(-1)?.content).toContain('respond naturally to my original message');
  });
});