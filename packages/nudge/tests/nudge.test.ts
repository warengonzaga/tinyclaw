import { beforeEach, describe, expect, it } from 'bun:test';
import type {
  ChannelSender,
  NudgeEngine,
  OutboundDeliveryResult,
  OutboundGateway,
  OutboundMessage,
} from '@tinyclaw/types';
import { createNudgeEngine, wireNudgeToIntercom } from '../src/index';

// ---------------------------------------------------------------------------
// Mock Gateway
// ---------------------------------------------------------------------------

function createMockGateway() {
  const sends: Array<{ userId: string; message: OutboundMessage }> = [];
  const gateway: OutboundGateway = {
    register(_prefix: string, _sender: ChannelSender) {},
    unregister(_prefix: string) {},
    async send(userId: string, message: OutboundMessage): Promise<OutboundDeliveryResult> {
      sends.push({ userId, message });
      return { success: true, channel: 'web', userId };
    },
    async broadcast(_message: OutboundMessage) {
      return [];
    },
    getRegisteredChannels() {
      return ['web'];
    },
  };
  return { gateway, sends };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NudgeEngine', () => {
  let engine: NudgeEngine;
  let mockGw: ReturnType<typeof createMockGateway>;

  beforeEach(() => {
    mockGw = createMockGateway();
    engine = createNudgeEngine({ gateway: mockGw.gateway });
  });

  // --- schedule -----------------------------------------------------------

  describe('schedule', () => {
    it('returns a unique nudge id', () => {
      const id1 = engine.schedule({
        userId: 'web:owner',
        category: 'task_complete',
        content: 'Done!',
        priority: 'normal',
        deliverAfter: 0,
      });
      const id2 = engine.schedule({
        userId: 'web:owner',
        category: 'reminder',
        content: "Don't forget!",
        priority: 'normal',
        deliverAfter: 0,
      });
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it('adds nudge to pending queue', () => {
      engine.schedule({
        userId: 'web:owner',
        category: 'task_complete',
        content: 'Done!',
        priority: 'normal',
        deliverAfter: 0,
      });
      expect(engine.pending().length).toBe(1);
    });
  });

  // --- flush --------------------------------------------------------------

  describe('flush', () => {
    it('delivers due nudges via gateway', async () => {
      engine.schedule({
        userId: 'web:owner',
        category: 'task_complete',
        content: 'Task finished!',
        priority: 'normal',
        deliverAfter: 0,
      });

      await engine.flush();

      expect(mockGw.sends.length).toBe(1);
      expect(mockGw.sends[0].userId).toBe('web:owner');
      expect(mockGw.sends[0].message.content).toBe('Task finished!');
      expect(engine.pending().length).toBe(0);
    });

    it('does not deliver future nudges', async () => {
      engine.schedule({
        userId: 'web:owner',
        category: 'reminder',
        content: 'Later!',
        priority: 'normal',
        deliverAfter: Date.now() + 60_000, // 1 minute from now
      });

      await engine.flush();

      expect(mockGw.sends.length).toBe(0);
      expect(engine.pending().length).toBe(1);
    });

    it('delivers urgent nudges first', async () => {
      engine.schedule({
        userId: 'web:owner',
        category: 'system',
        content: 'low priority',
        priority: 'low',
        deliverAfter: 0,
      });
      engine.schedule({
        userId: 'web:owner',
        category: 'task_failed',
        content: 'URGENT!',
        priority: 'urgent',
        deliverAfter: 0,
      });
      engine.schedule({
        userId: 'web:owner',
        category: 'task_complete',
        content: 'normal priority',
        priority: 'normal',
        deliverAfter: 0,
      });

      await engine.flush();

      expect(mockGw.sends.length).toBe(3);
      expect(mockGw.sends[0].message.content).toBe('URGENT!');
      expect(mockGw.sends[1].message.content).toBe('normal priority');
      expect(mockGw.sends[2].message.content).toBe('low priority');
    });

    it('skips suppressed categories', async () => {
      engine.setPreferences({ suppressedCategories: ['system'] });

      engine.schedule({
        userId: 'web:owner',
        category: 'system',
        content: 'suppressed',
        priority: 'normal',
        deliverAfter: 0,
      });
      engine.schedule({
        userId: 'web:owner',
        category: 'task_complete',
        content: 'not suppressed',
        priority: 'normal',
        deliverAfter: 0,
      });

      await engine.flush();

      expect(mockGw.sends.length).toBe(1);
      expect(mockGw.sends[0].message.content).toBe('not suppressed');
    });

    it('does nothing when engine is disabled', async () => {
      engine.setPreferences({ enabled: false });

      engine.schedule({
        userId: 'web:owner',
        category: 'task_complete',
        content: 'should not send',
        priority: 'normal',
        deliverAfter: 0,
      });

      await engine.flush();

      expect(mockGw.sends.length).toBe(0);
      // Nudge stays in queue — will deliver when re-enabled
      expect(engine.pending().length).toBe(1);
    });

    it('rate limits non-urgent nudges', async () => {
      engine.setPreferences({ maxPerHour: 2 });

      for (let i = 0; i < 5; i++) {
        engine.schedule({
          userId: 'web:owner',
          category: 'task_complete',
          content: `nudge ${i}`,
          priority: 'normal',
          deliverAfter: 0,
        });
      }

      await engine.flush();

      // Only 2 should be delivered (rate limit)
      expect(mockGw.sends.length).toBe(2);
      expect(engine.pending().length).toBe(3);
    });

    it('urgent nudges bypass rate limit', async () => {
      engine.setPreferences({ maxPerHour: 1 });

      engine.schedule({
        userId: 'web:owner',
        category: 'task_complete',
        content: 'fills limit',
        priority: 'normal',
        deliverAfter: 0,
      });
      engine.schedule({
        userId: 'web:owner',
        category: 'task_failed',
        content: 'urgent bypasses',
        priority: 'urgent',
        deliverAfter: 0,
      });

      await engine.flush();

      // Urgent goes first (priority sort), then normal fills the 1 slot
      expect(mockGw.sends.length).toBe(2);
      expect(mockGw.sends[0].message.content).toBe('urgent bypasses');
      expect(mockGw.sends[1].message.content).toBe('fills limit');
    });

    it('handles gateway delivery failure gracefully', async () => {
      const failGw: OutboundGateway = {
        register() {},
        unregister() {},
        async send(userId): Promise<OutboundDeliveryResult> {
          return { success: false, channel: 'web', userId, error: 'offline' };
        },
        async broadcast() {
          return [];
        },
        getRegisteredChannels() {
          return [];
        },
      };
      const failEngine = createNudgeEngine({ gateway: failGw });

      failEngine.schedule({
        userId: 'web:owner',
        category: 'task_complete',
        content: 'will fail',
        priority: 'normal',
        deliverAfter: 0,
      });

      await failEngine.flush();

      // Should stay in queue for retry
      expect(failEngine.pending().length).toBe(1);
    });

    it('sets correct source from category', async () => {
      const categories = [
        { category: 'task_complete' as const, expectedSource: 'background_task' },
        { category: 'reminder' as const, expectedSource: 'reminder' },
        { category: 'check_in' as const, expectedSource: 'pulse' },
        { category: 'agent_initiated' as const, expectedSource: 'agent' },
        { category: 'system' as const, expectedSource: 'system' },
      ];

      for (const { category } of categories) {
        engine.schedule({
          userId: 'web:owner',
          category,
          content: `test ${category}`,
          priority: 'normal',
          deliverAfter: 0,
        });
      }

      await engine.flush();

      for (let i = 0; i < categories.length; i++) {
        expect(mockGw.sends[i].message.source).toBe(categories[i].expectedSource);
      }
    });
  });

  // --- cancel -------------------------------------------------------------

  describe('cancel', () => {
    it('removes a pending nudge', () => {
      const id = engine.schedule({
        userId: 'web:owner',
        category: 'reminder',
        content: 'cancel me',
        priority: 'normal',
        deliverAfter: 0,
      });

      expect(engine.cancel(id)).toBe(true);
      expect(engine.pending().length).toBe(0);
    });

    it('returns false for unknown id', () => {
      expect(engine.cancel('nonexistent')).toBe(false);
    });
  });

  // --- preferences --------------------------------------------------------

  describe('preferences', () => {
    it('returns default preferences', () => {
      const prefs = engine.getPreferences();
      expect(prefs.enabled).toBe(true);
      expect(prefs.maxPerHour).toBe(5);
      expect(prefs.suppressedCategories).toEqual([]);
    });

    it('merges partial preference updates', () => {
      engine.setPreferences({ maxPerHour: 10, quietHoursStart: '22:00' });
      const prefs = engine.getPreferences();
      expect(prefs.maxPerHour).toBe(10);
      expect(prefs.quietHoursStart).toBe('22:00');
      expect(prefs.enabled).toBe(true); // unchanged
    });

    it('accepts initial preferences', () => {
      const custom = createNudgeEngine({
        gateway: mockGw.gateway,
        preferences: { maxPerHour: 3, enabled: false },
      });
      const prefs = custom.getPreferences();
      expect(prefs.maxPerHour).toBe(3);
      expect(prefs.enabled).toBe(false);
    });
  });

  // --- stop ---------------------------------------------------------------

  describe('stop', () => {
    it('clears urgent flush timer without error', () => {
      engine.schedule({
        userId: 'web:owner',
        category: 'task_failed',
        content: 'urgent',
        priority: 'urgent',
        deliverAfter: 0,
      });
      // stop should clear the auto-flush timer
      expect(() => engine.stop()).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Intercom Wiring
// ---------------------------------------------------------------------------

describe('wireNudgeToIntercom', () => {
  it('schedules nudge on task:completed event', () => {
    const mockGw = createMockGateway();
    const engine = createNudgeEngine({ gateway: mockGw.gateway });

    // Create a minimal intercom mock
    const handlers = new Map<string, Array<(event: unknown) => void>>();
    const intercom = {
      on(topic: string, handler: (event: unknown) => void) {
        if (!handlers.has(topic)) handlers.set(topic, []);
        handlers.get(topic)?.push(handler);
        return () => {
          const list = handlers.get(topic);
          if (list) {
            const idx = list.indexOf(handler);
            if (idx !== -1) list.splice(idx, 1);
          }
        };
      },
    };

    wireNudgeToIntercom(engine, intercom);

    // Simulate task:completed event
    const completedHandlers = handlers.get('task:completed') || [];
    for (const h of completedHandlers) {
      h({
        topic: 'task:completed',
        timestamp: Date.now(),
        userId: 'web:owner',
        data: { taskId: 'task-1', summary: 'Research done' },
      });
    }

    expect(engine.pending().length).toBe(1);
    expect(engine.pending()[0].category).toBe('task_complete');
    expect(engine.pending()[0].content).toContain('Research done');
  });

  it('schedules urgent nudge on task:failed event', () => {
    const mockGw = createMockGateway();
    const engine = createNudgeEngine({ gateway: mockGw.gateway });

    const handlers = new Map<string, Array<(event: unknown) => void>>();
    const intercom = {
      on(topic: string, handler: (event: unknown) => void) {
        if (!handlers.has(topic)) handlers.set(topic, []);
        handlers.get(topic)?.push(handler);
        return () => {};
      },
    };

    wireNudgeToIntercom(engine, intercom);

    const failedHandlers = handlers.get('task:failed') || [];
    for (const h of failedHandlers) {
      h({
        topic: 'task:failed',
        timestamp: Date.now(),
        userId: 'web:owner',
        data: { taskId: 'task-2', error: 'API timeout' },
      });
    }

    expect(engine.pending().length).toBe(1);
    expect(engine.pending()[0].priority).toBe('urgent');
    expect(engine.pending()[0].content).toContain('API timeout');
  });

  it('returns unsubscribe function', () => {
    const mockGw = createMockGateway();
    const engine = createNudgeEngine({ gateway: mockGw.gateway });

    let subCount = 0;
    const intercom = {
      on(_topic: string, _handler: unknown) {
        subCount++;
        return () => {
          subCount--;
        };
      },
    };

    const unsub = wireNudgeToIntercom(engine, intercom);
    expect(subCount).toBe(3); // task:completed, task:failed, agent:dismissed

    unsub();
    expect(subCount).toBe(0);
  });
});
