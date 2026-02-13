/**
 * Tests for @tinyclaw/queue — session queue with per-key serialization.
 */

import { describe, expect, test } from 'bun:test';
import { createSessionQueue } from '../src/index.js';

describe('createSessionQueue', () => {
  test('resolves a single enqueued task', async () => {
    const q = createSessionQueue();
    const result = await q.enqueue('user-1', () => Promise.resolve(42));
    expect(result).toBe(42);
  });

  test('serializes tasks for the same session key', async () => {
    const q = createSessionQueue();
    const order: number[] = [];

    const t1 = q.enqueue('user-1', async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
      return 1;
    });

    const t2 = q.enqueue('user-1', async () => {
      order.push(2);
      return 2;
    });

    await Promise.all([t1, t2]);
    expect(order).toEqual([1, 2]);
  });

  test('runs tasks for different keys in parallel', async () => {
    const q = createSessionQueue();
    const order: string[] = [];

    const t1 = q.enqueue('user-1', async () => {
      await new Promise((r) => setTimeout(r, 40));
      order.push('a-done');
    });

    const t2 = q.enqueue('user-2', async () => {
      order.push('b-done');
    });

    await Promise.all([t1, t2]);
    // user-2 should finish first since it has no delay
    expect(order).toEqual(['b-done', 'a-done']);
  });

  test('pending() returns correct count', async () => {
    const q = createSessionQueue();
    expect(q.pending('user-1')).toBe(0);

    let resolve1!: () => void;
    const blocker = new Promise<void>((r) => { resolve1 = r; });

    const t1 = q.enqueue('user-1', () => blocker);
    const t2 = q.enqueue('user-1', () => Promise.resolve());

    expect(q.pending('user-1')).toBe(2);

    resolve1();
    await Promise.all([t1, t2]);

    expect(q.pending('user-1')).toBe(0);
  });

  test('stop() rejects new tasks', async () => {
    const q = createSessionQueue();
    q.stop();

    await expect(
      q.enqueue('user-1', () => Promise.resolve('nope')),
    ).rejects.toThrow('Queue has been stopped');
  });

  test('stop() clears internal state', async () => {
    const q = createSessionQueue();

    let resolve1!: () => void;
    const blocker = new Promise<void>((r) => { resolve1 = r; });

    q.enqueue('user-1', () => blocker);
    expect(q.pending('user-1')).toBe(1);

    q.stop();
    expect(q.pending('user-1')).toBe(0);

    resolve1(); // clean up
  });

  test('error in one task does not block subsequent tasks', async () => {
    const q = createSessionQueue();

    const t1 = q.enqueue('user-1', () => Promise.reject(new Error('boom')));
    const t2 = q.enqueue('user-1', () => Promise.resolve('ok'));

    await expect(t1).rejects.toThrow('boom');
    expect(await t2).toBe('ok');
  });

  test('cleans up maps when session drains', async () => {
    const q = createSessionQueue();
    await q.enqueue('user-1', () => Promise.resolve());
    // After drain, pending should be 0 (maps cleaned)
    expect(q.pending('user-1')).toBe(0);
  });
});
