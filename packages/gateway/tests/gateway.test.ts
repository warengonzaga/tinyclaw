import { describe, it, expect, beforeEach } from 'bun:test';
import { createGateway } from '../src/index';
import type { ChannelSender, OutboundMessage } from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMessage(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    content: 'Hello from the agent!',
    priority: 'normal',
    source: 'system',
    ...overrides,
  };
}

function createMockSender(name: string, overrides: Partial<ChannelSender> = {}): ChannelSender & { calls: Array<{ userId: string; message: OutboundMessage }> } {
  const calls: Array<{ userId: string; message: OutboundMessage }> = [];
  return {
    name,
    async send(userId: string, message: OutboundMessage) {
      calls.push({ userId, message });
    },
    calls,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OutboundGateway', () => {
  let gateway: ReturnType<typeof createGateway>;

  beforeEach(() => {
    gateway = createGateway();
  });

  // --- Registration -------------------------------------------------------

  describe('register / unregister', () => {
    it('registers a channel sender', () => {
      const sender = createMockSender('Web UI');
      gateway.register('web', sender);

      expect(gateway.getRegisteredChannels()).toEqual(['web']);
    });

    it('registers multiple channel senders', () => {
      gateway.register('web', createMockSender('Web UI'));
      gateway.register('discord', createMockSender('Discord'));
      gateway.register('friend', createMockSender('Friends'));

      expect(gateway.getRegisteredChannels()).toContain('web');
      expect(gateway.getRegisteredChannels()).toContain('discord');
      expect(gateway.getRegisteredChannels()).toContain('friend');
      expect(gateway.getRegisteredChannels().length).toBe(3);
    });

    it('overwrites a sender for the same prefix', () => {
      const sender1 = createMockSender('Web UI v1');
      const sender2 = createMockSender('Web UI v2');

      gateway.register('web', sender1);
      gateway.register('web', sender2);

      expect(gateway.getRegisteredChannels()).toEqual(['web']);
    });

    it('unregisters a channel sender', () => {
      gateway.register('web', createMockSender('Web UI'));
      gateway.unregister('web');

      expect(gateway.getRegisteredChannels()).toEqual([]);
    });

    it('unregistering a non-existent prefix is a no-op', () => {
      gateway.unregister('nonexistent');
      expect(gateway.getRegisteredChannels()).toEqual([]);
    });
  });

  // --- send() -------------------------------------------------------------

  describe('send', () => {
    it('delivers a message to the correct channel', async () => {
      const webSender = createMockSender('Web UI');
      const discordSender = createMockSender('Discord');
      gateway.register('web', webSender);
      gateway.register('discord', discordSender);

      const message = createMessage({ content: 'Task done!' });
      const result = await gateway.send('web:owner', message);

      expect(result.success).toBe(true);
      expect(result.channel).toBe('web');
      expect(result.userId).toBe('web:owner');
      expect(webSender.calls.length).toBe(1);
      expect(webSender.calls[0].userId).toBe('web:owner');
      expect(webSender.calls[0].message.content).toBe('Task done!');
      expect(discordSender.calls.length).toBe(0);
    });

    it('returns failure for invalid userId format', async () => {
      const result = await gateway.send('no-colon', createMessage());

      expect(result.success).toBe(false);
      expect(result.channel).toBe('unknown');
      expect(result.error).toContain('Invalid userId format');
    });

    it('returns failure for unregistered prefix', async () => {
      const result = await gateway.send('slack:user123', createMessage());

      expect(result.success).toBe(false);
      expect(result.channel).toBe('slack');
      expect(result.error).toContain('No channel registered');
    });

    it('catches and reports sender errors', async () => {
      const failingSender: ChannelSender = {
        name: 'Failing Channel',
        async send() {
          throw new Error('Connection lost');
        },
      };
      gateway.register('fail', failingSender);

      const result = await gateway.send('fail:user1', createMessage());

      expect(result.success).toBe(false);
      expect(result.channel).toBe('fail');
      expect(result.error).toBe('Connection lost');
    });

    it('handles userId with multiple colons correctly', async () => {
      const sender = createMockSender('Web UI');
      gateway.register('web', sender);

      const result = await gateway.send('web:owner:extra', createMessage());

      expect(result.success).toBe(true);
      expect(result.channel).toBe('web');
      expect(sender.calls[0].userId).toBe('web:owner:extra');
    });

    it('delivers messages with all priority levels', async () => {
      const sender = createMockSender('Web UI');
      gateway.register('web', sender);

      await gateway.send('web:owner', createMessage({ priority: 'urgent' }));
      await gateway.send('web:owner', createMessage({ priority: 'normal' }));
      await gateway.send('web:owner', createMessage({ priority: 'low' }));

      expect(sender.calls.length).toBe(3);
      expect(sender.calls[0].message.priority).toBe('urgent');
      expect(sender.calls[1].message.priority).toBe('normal');
      expect(sender.calls[2].message.priority).toBe('low');
    });

    it('delivers messages from all source types', async () => {
      const sender = createMockSender('Web UI');
      gateway.register('web', sender);

      const sources = ['background_task', 'sub_agent', 'reminder', 'pulse', 'system', 'agent'] as const;
      for (const source of sources) {
        await gateway.send('web:owner', createMessage({ source }));
      }

      expect(sender.calls.length).toBe(6);
    });
  });

  // --- broadcast() --------------------------------------------------------

  describe('broadcast', () => {
    it('broadcasts to all channels that support it', async () => {
      const broadcastCalls: string[] = [];
      const webSender: ChannelSender = {
        name: 'Web UI',
        async send() {},
        async broadcast() { broadcastCalls.push('web'); },
      };
      const discordSender: ChannelSender = {
        name: 'Discord',
        async send() {},
        async broadcast() { broadcastCalls.push('discord'); },
      };

      gateway.register('web', webSender);
      gateway.register('discord', discordSender);

      const results = await gateway.broadcast(createMessage());

      expect(results.length).toBe(2);
      expect(results.every(r => r.success)).toBe(true);
      expect(broadcastCalls).toContain('web');
      expect(broadcastCalls).toContain('discord');
    });

    it('skips channels that do not support broadcast', async () => {
      const sender = createMockSender('Web UI'); // no broadcast method
      gateway.register('web', sender);

      const results = await gateway.broadcast(createMessage());

      expect(results.length).toBe(0);
    });

    it('reports broadcast failures per channel', async () => {
      const goodSender: ChannelSender = {
        name: 'Good Channel',
        async send() {},
        async broadcast() {},
      };
      const badSender: ChannelSender = {
        name: 'Bad Channel',
        async send() {},
        async broadcast() { throw new Error('Broadcast failed'); },
      };

      gateway.register('good', goodSender);
      gateway.register('bad', badSender);

      const results = await gateway.broadcast(createMessage());

      expect(results.length).toBe(2);
      const goodResult = results.find(r => r.channel === 'good');
      const badResult = results.find(r => r.channel === 'bad');
      expect(goodResult?.success).toBe(true);
      expect(badResult?.success).toBe(false);
      expect(badResult?.error).toBe('Broadcast failed');
    });

    it('returns empty array when no channels registered', async () => {
      const results = await gateway.broadcast(createMessage());
      expect(results).toEqual([]);
    });
  });

  // --- getRegisteredChannels() --------------------------------------------

  describe('getRegisteredChannels', () => {
    it('returns empty array initially', () => {
      expect(gateway.getRegisteredChannels()).toEqual([]);
    });

    it('reflects registrations and unregistrations', () => {
      gateway.register('web', createMockSender('Web'));
      gateway.register('discord', createMockSender('Discord'));
      expect(gateway.getRegisteredChannels().length).toBe(2);

      gateway.unregister('web');
      expect(gateway.getRegisteredChannels()).toEqual(['discord']);
    });
  });
});
