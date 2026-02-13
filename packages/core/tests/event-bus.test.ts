import { describe, it, expect } from 'bun:test';
import { createEventBus, type EventPayload, type EventTopic } from '../src/event-bus.js';

describe('EventBus', () => {
  // -----------------------------------------------------------------------
  // Basic subscribe + emit
  // -----------------------------------------------------------------------

  it('calls handler when event is emitted on subscribed topic', () => {
    const bus = createEventBus();
    const received: EventPayload[] = [];

    bus.on('task:completed', (event) => received.push(event));
    bus.emit('task:completed', 'user1', { taskId: '123' });

    expect(received.length).toBe(1);
    expect(received[0].topic).toBe('task:completed');
    expect(received[0].userId).toBe('user1');
    expect(received[0].data.taskId).toBe('123');
  });

  it('does not call handler for different topics', () => {
    const bus = createEventBus();
    const received: EventPayload[] = [];

    bus.on('task:completed', (event) => received.push(event));
    bus.emit('task:failed', 'user1', { taskId: '123' });

    expect(received.length).toBe(0);
  });

  it('supports multiple handlers on same topic', () => {
    const bus = createEventBus();
    let count = 0;

    bus.on('agent:created', () => count++);
    bus.on('agent:created', () => count++);
    bus.on('agent:created', () => count++);

    bus.emit('agent:created', 'user1');

    expect(count).toBe(3);
  });

  it('supports multiple topics', () => {
    const bus = createEventBus();
    const topics: EventTopic[] = [];

    bus.on('task:queued', (e) => topics.push(e.topic));
    bus.on('task:completed', (e) => topics.push(e.topic));
    bus.on('task:failed', (e) => topics.push(e.topic));

    bus.emit('task:queued', 'user1');
    bus.emit('task:completed', 'user1');
    bus.emit('task:failed', 'user1');

    expect(topics).toEqual(['task:queued', 'task:completed', 'task:failed']);
  });

  // -----------------------------------------------------------------------
  // Unsubscribe
  // -----------------------------------------------------------------------

  it('unsubscribe stops handler from being called', () => {
    const bus = createEventBus();
    let count = 0;

    const unsub = bus.on('task:completed', () => count++);

    bus.emit('task:completed', 'user1');
    expect(count).toBe(1);

    unsub();

    bus.emit('task:completed', 'user1');
    expect(count).toBe(1); // Still 1, not called again
  });

  it('unsubscribe only affects the specific handler', () => {
    const bus = createEventBus();
    let countA = 0;
    let countB = 0;

    const unsubA = bus.on('task:completed', () => countA++);
    bus.on('task:completed', () => countB++);

    bus.emit('task:completed', 'user1');
    expect(countA).toBe(1);
    expect(countB).toBe(1);

    unsubA();

    bus.emit('task:completed', 'user1');
    expect(countA).toBe(1); // Unsubscribed
    expect(countB).toBe(2); // Still active
  });

  // -----------------------------------------------------------------------
  // Wildcard (onAny)
  // -----------------------------------------------------------------------

  it('onAny receives events from all topics', () => {
    const bus = createEventBus();
    const received: EventTopic[] = [];

    bus.onAny((event) => received.push(event.topic));

    bus.emit('task:completed', 'user1');
    bus.emit('agent:created', 'user1');
    bus.emit('memory:updated', 'user1');

    expect(received).toEqual(['task:completed', 'agent:created', 'memory:updated']);
  });

  it('onAny unsubscribe works', () => {
    const bus = createEventBus();
    let count = 0;

    const unsub = bus.onAny(() => count++);

    bus.emit('task:completed', 'user1');
    expect(count).toBe(1);

    unsub();

    bus.emit('task:completed', 'user1');
    expect(count).toBe(1);
  });

  it('both topic and wildcard handlers are called', () => {
    const bus = createEventBus();
    let topicCount = 0;
    let wildcardCount = 0;

    bus.on('task:completed', () => topicCount++);
    bus.onAny(() => wildcardCount++);

    bus.emit('task:completed', 'user1');

    expect(topicCount).toBe(1);
    expect(wildcardCount).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Event history (recent)
  // -----------------------------------------------------------------------

  it('recent returns last N events for a topic', () => {
    const bus = createEventBus();

    bus.emit('task:completed', 'user1', { id: '1' });
    bus.emit('task:completed', 'user1', { id: '2' });
    bus.emit('task:completed', 'user1', { id: '3' });

    const recent = bus.recent('task:completed', 2);
    expect(recent.length).toBe(2);
    expect(recent[0].data.id).toBe('2');
    expect(recent[1].data.id).toBe('3');
  });

  it('recent returns empty array for topic with no events', () => {
    const bus = createEventBus();
    const recent = bus.recent('task:completed');
    expect(recent).toEqual([]);
  });

  it('history is bounded by historyLimit', () => {
    const bus = createEventBus(3); // Only keep 3 events per topic

    bus.emit('task:completed', 'user1', { id: '1' });
    bus.emit('task:completed', 'user1', { id: '2' });
    bus.emit('task:completed', 'user1', { id: '3' });
    bus.emit('task:completed', 'user1', { id: '4' });
    bus.emit('task:completed', 'user1', { id: '5' });

    const recent = bus.recent('task:completed', 10);
    expect(recent.length).toBe(3);
    expect(recent[0].data.id).toBe('3'); // Oldest kept
    expect(recent[2].data.id).toBe('5'); // Newest
  });

  // -----------------------------------------------------------------------
  // recentAll
  // -----------------------------------------------------------------------

  it('recentAll returns events across all topics sorted by timestamp', () => {
    const bus = createEventBus();

    bus.emit('task:completed', 'user1', { id: '1' });
    bus.emit('agent:created', 'user1', { id: '2' });
    bus.emit('memory:updated', 'user1', { id: '3' });

    const recent = bus.recentAll(10);
    expect(recent.length).toBe(3);
    // Most recent first
    expect(recent[0].data.id).toBe('3');
    expect(recent[2].data.id).toBe('1');
  });

  // -----------------------------------------------------------------------
  // Event payload
  // -----------------------------------------------------------------------

  it('event payload includes timestamp', () => {
    const bus = createEventBus();
    let received: EventPayload | null = null;

    bus.on('task:completed', (event) => { received = event; });

    const before = Date.now();
    bus.emit('task:completed', 'user1');
    const after = Date.now();

    expect(received).not.toBeNull();
    expect(received!.timestamp).toBeGreaterThanOrEqual(before);
    expect(received!.timestamp).toBeLessThanOrEqual(after);
  });

  it('emit with no data defaults to empty object', () => {
    const bus = createEventBus();
    let received: EventPayload | null = null;

    bus.on('task:completed', (event) => { received = event; });
    bus.emit('task:completed', 'user1');

    expect(received!.data).toEqual({});
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('swallows handler errors without affecting other handlers', () => {
    const bus = createEventBus();
    let count = 0;

    bus.on('task:completed', () => { throw new Error('boom'); });
    bus.on('task:completed', () => count++);

    // Should not throw
    bus.emit('task:completed', 'user1');
    expect(count).toBe(1); // Second handler still called
  });

  it('swallows wildcard handler errors', () => {
    const bus = createEventBus();
    let count = 0;

    bus.onAny(() => { throw new Error('boom'); });
    bus.on('task:completed', () => count++);

    bus.emit('task:completed', 'user1');
    expect(count).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Clear
  // -----------------------------------------------------------------------

  it('clear removes all subscriptions and history', () => {
    const bus = createEventBus();
    let count = 0;

    bus.on('task:completed', () => count++);
    bus.onAny(() => count++);
    bus.emit('task:completed', 'user1');

    expect(count).toBe(2);

    // Verify history exists before clear
    expect(bus.recent('task:completed').length).toBe(1);

    bus.clear();

    // History should be empty after clear
    expect(bus.recent('task:completed')).toEqual([]);

    // Emit after clear — no handlers should fire
    bus.emit('task:completed', 'user1');
    expect(count).toBe(2); // No more handlers

    // New emit still records to history (emit always stores events)
    expect(bus.recent('task:completed').length).toBe(1);
  });
});
