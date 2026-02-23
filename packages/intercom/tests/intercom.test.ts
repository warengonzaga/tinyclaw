import { describe, expect, it } from 'bun:test';
import { createIntercom, type IntercomMessage, type IntercomTopic } from '../src/index.js';

describe('Intercom', () => {
  // -----------------------------------------------------------------------
  // Basic subscribe + emit
  // -----------------------------------------------------------------------

  it('calls handler when event is emitted on subscribed topic', () => {
    const intercom = createIntercom();
    const received: IntercomMessage[] = [];

    intercom.on('task:completed', (event) => received.push(event));
    intercom.emit('task:completed', 'user1', { taskId: '123' });

    expect(received.length).toBe(1);
    expect(received[0].topic).toBe('task:completed');
    expect(received[0].userId).toBe('user1');
    expect(received[0].data.taskId).toBe('123');
  });

  it('does not call handler for different topics', () => {
    const intercom = createIntercom();
    const received: IntercomMessage[] = [];

    intercom.on('task:completed', (event) => received.push(event));
    intercom.emit('task:failed', 'user1', { taskId: '123' });

    expect(received.length).toBe(0);
  });

  it('supports multiple handlers on same topic', () => {
    const intercom = createIntercom();
    let count = 0;

    intercom.on('agent:created', () => count++);
    intercom.on('agent:created', () => count++);
    intercom.on('agent:created', () => count++);

    intercom.emit('agent:created', 'user1');

    expect(count).toBe(3);
  });

  it('supports multiple topics', () => {
    const intercom = createIntercom();
    const topics: IntercomTopic[] = [];

    intercom.on('task:queued', (e) => topics.push(e.topic));
    intercom.on('task:completed', (e) => topics.push(e.topic));
    intercom.on('task:failed', (e) => topics.push(e.topic));

    intercom.emit('task:queued', 'user1');
    intercom.emit('task:completed', 'user1');
    intercom.emit('task:failed', 'user1');

    expect(topics).toEqual(['task:queued', 'task:completed', 'task:failed']);
  });

  // -----------------------------------------------------------------------
  // Unsubscribe
  // -----------------------------------------------------------------------

  it('unsubscribe stops handler from being called', () => {
    const intercom = createIntercom();
    let count = 0;

    const unsub = intercom.on('task:completed', () => count++);

    intercom.emit('task:completed', 'user1');
    expect(count).toBe(1);

    unsub();

    intercom.emit('task:completed', 'user1');
    expect(count).toBe(1); // Still 1, not called again
  });

  it('unsubscribe only affects the specific handler', () => {
    const intercom = createIntercom();
    let countA = 0;
    let countB = 0;

    const unsubA = intercom.on('task:completed', () => countA++);
    intercom.on('task:completed', () => countB++);

    intercom.emit('task:completed', 'user1');
    expect(countA).toBe(1);
    expect(countB).toBe(1);

    unsubA();

    intercom.emit('task:completed', 'user1');
    expect(countA).toBe(1); // Unsubscribed
    expect(countB).toBe(2); // Still active
  });

  // -----------------------------------------------------------------------
  // Wildcard (onAny)
  // -----------------------------------------------------------------------

  it('onAny receives events from all topics', () => {
    const intercom = createIntercom();
    const received: IntercomTopic[] = [];

    intercom.onAny((event) => received.push(event.topic));

    intercom.emit('task:completed', 'user1');
    intercom.emit('agent:created', 'user1');
    intercom.emit('memory:updated', 'user1');

    expect(received).toEqual(['task:completed', 'agent:created', 'memory:updated']);
  });

  it('onAny unsubscribe works', () => {
    const intercom = createIntercom();
    let count = 0;

    const unsub = intercom.onAny(() => count++);

    intercom.emit('task:completed', 'user1');
    expect(count).toBe(1);

    unsub();

    intercom.emit('task:completed', 'user1');
    expect(count).toBe(1);
  });

  it('both topic and wildcard handlers are called', () => {
    const intercom = createIntercom();
    let topicCount = 0;
    let wildcardCount = 0;

    intercom.on('task:completed', () => topicCount++);
    intercom.onAny(() => wildcardCount++);

    intercom.emit('task:completed', 'user1');

    expect(topicCount).toBe(1);
    expect(wildcardCount).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Event history (recent)
  // -----------------------------------------------------------------------

  it('recent returns last N events for a topic', () => {
    const intercom = createIntercom();

    intercom.emit('task:completed', 'user1', { id: '1' });
    intercom.emit('task:completed', 'user1', { id: '2' });
    intercom.emit('task:completed', 'user1', { id: '3' });

    const recent = intercom.recent('task:completed', 2);
    expect(recent.length).toBe(2);
    expect(recent[0].data.id).toBe('2');
    expect(recent[1].data.id).toBe('3');
  });

  it('recent returns empty array for topic with no events', () => {
    const intercom = createIntercom();
    const recent = intercom.recent('task:completed');
    expect(recent).toEqual([]);
  });

  it('history is bounded by historyLimit', () => {
    const intercom = createIntercom(3); // Only keep 3 events per topic

    intercom.emit('task:completed', 'user1', { id: '1' });
    intercom.emit('task:completed', 'user1', { id: '2' });
    intercom.emit('task:completed', 'user1', { id: '3' });
    intercom.emit('task:completed', 'user1', { id: '4' });
    intercom.emit('task:completed', 'user1', { id: '5' });

    const recent = intercom.recent('task:completed', 10);
    expect(recent.length).toBe(3);
    expect(recent[0].data.id).toBe('3'); // Oldest kept
    expect(recent[2].data.id).toBe('5'); // Newest
  });

  // -----------------------------------------------------------------------
  // recentAll
  // -----------------------------------------------------------------------

  it('recentAll returns events across all topics sorted by timestamp', () => {
    const intercom = createIntercom();

    intercom.emit('task:completed', 'user1', { id: '1' });
    intercom.emit('agent:created', 'user1', { id: '2' });
    intercom.emit('memory:updated', 'user1', { id: '3' });

    const recent = intercom.recentAll(10);
    expect(recent.length).toBe(3);
    // Most recent first
    expect(recent[0].data.id).toBe('3');
    expect(recent[2].data.id).toBe('1');
  });

  // -----------------------------------------------------------------------
  // Event payload
  // -----------------------------------------------------------------------

  it('event payload includes timestamp', () => {
    const intercom = createIntercom();
    let received: IntercomMessage | null = null;

    intercom.on('task:completed', (event) => {
      received = event;
    });

    const before = Date.now();
    intercom.emit('task:completed', 'user1');
    const after = Date.now();

    expect(received).not.toBeNull();
    expect(received!.timestamp).toBeGreaterThanOrEqual(before);
    expect(received!.timestamp).toBeLessThanOrEqual(after);
  });

  it('emit with no data defaults to empty object', () => {
    const intercom = createIntercom();
    let received: IntercomMessage | null = null;

    intercom.on('task:completed', (event) => {
      received = event;
    });
    intercom.emit('task:completed', 'user1');

    expect(received!.data).toEqual({});
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('swallows handler errors without affecting other handlers', () => {
    const intercom = createIntercom();
    let count = 0;

    intercom.on('task:completed', () => {
      throw new Error('boom');
    });
    intercom.on('task:completed', () => count++);

    // Should not throw
    intercom.emit('task:completed', 'user1');
    expect(count).toBe(1); // Second handler still called
  });

  it('swallows wildcard handler errors', () => {
    const intercom = createIntercom();
    let count = 0;

    intercom.onAny(() => {
      throw new Error('boom');
    });
    intercom.on('task:completed', () => count++);

    intercom.emit('task:completed', 'user1');
    expect(count).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Clear
  // -----------------------------------------------------------------------

  it('clear removes all subscriptions and history', () => {
    const intercom = createIntercom();
    let count = 0;

    intercom.on('task:completed', () => count++);
    intercom.onAny(() => count++);
    intercom.emit('task:completed', 'user1');

    expect(count).toBe(2);

    // Verify history exists before clear
    expect(intercom.recent('task:completed').length).toBe(1);

    intercom.clear();

    // History should be empty after clear
    expect(intercom.recent('task:completed')).toEqual([]);

    // Emit after clear — no handlers should fire
    intercom.emit('task:completed', 'user1');
    expect(count).toBe(2); // No more handlers

    // New emit still records to history (emit always stores events)
    expect(intercom.recent('task:completed').length).toBe(1);
  });
});
