/**
 * Tests for the Web UI server (server.ts).
 *
 * Spins up actual Bun servers on random ports to test
 * HTTP routes, streaming, static file serving, and error handling.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWebUI } from '../src/server.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick a random high port to avoid collisions. */
function randomPort(): number {
  return 10_000 + Math.floor(Math.random() * 50_000);
}

/** Fetch JSON from a running server. */
async function fetchJSON(port: number, path: string, init?: RequestInit) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

// ---------------------------------------------------------------------------
// /api/health
// ---------------------------------------------------------------------------

describe('GET /api/health', () => {
  let ui: ReturnType<typeof createWebUI>;
  let port: number;

  beforeEach(async () => {
    port = randomPort();
    ui = createWebUI({
      port,
      onMessage: async () => 'ok',
      onMessageStream: async () => {},
    });
    await ui.start();
  });

  afterEach(async () => {
    await ui.stop();
  });

  test('returns 200 with { ok: true } and startedAt timestamp', async () => {
    const { status, body } = await fetchJSON(port, '/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.startedAt).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// /api/chat — non-streaming
// ---------------------------------------------------------------------------

describe('POST /api/chat (non-streaming)', () => {
  let ui: ReturnType<typeof createWebUI>;
  let port: number;
  let lastMessage: string;
  let lastUserId: string;

  beforeEach(async () => {
    port = randomPort();
    lastMessage = '';
    lastUserId = '';
    ui = createWebUI({
      port,
      onMessage: async (msg, userId) => {
        lastMessage = msg;
        lastUserId = userId;
        return `echo: ${msg}`;
      },
      onMessageStream: async () => {},
    });
    await ui.start();
  });

  afterEach(async () => {
    await ui.stop();
  });

  test('returns assistant response as JSON', async () => {
    const { status, body } = await fetchJSON(port, '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(status).toBe(200);
    expect(body.content).toBe('echo: hello');
    expect(lastMessage).toBe('hello');
  });

  test('forwards userId from request body', async () => {
    await fetchJSON(port, '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', userId: 'test-user' }),
    });
    expect(lastUserId).toBe('test-user');
  });

  test('defaults userId to "default-user"', async () => {
    await fetchJSON(port, '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    expect(lastUserId).toBe('default-user');
  });

  test('returns 400 when message is missing', async () => {
    const { status, body } = await fetchJSON(port, '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body.error).toBe('Message is required');
  });

  test('returns 400 when message is empty string', async () => {
    const { status, body } = await fetchJSON(port, '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    expect(status).toBe(400);
    expect(body.error).toBe('Message is required');
  });

  test('returns 400 for invalid JSON body', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON');
  });
});

// ---------------------------------------------------------------------------
// /api/chat — streaming (SSE)
// ---------------------------------------------------------------------------

describe('POST /api/chat (streaming)', () => {
  let ui: ReturnType<typeof createWebUI>;
  let port: number;

  afterEach(async () => {
    await ui.stop();
  });

  test('streams SSE events and ends with done', async () => {
    port = randomPort();
    ui = createWebUI({
      port,
      onMessage: async () => 'fallback',
      onMessageStream: async (_msg, _userId, send) => {
        send({ type: 'text', content: 'Hello ' });
        send({ type: 'text', content: 'world' });
        send({ type: 'done' });
      },
    });
    await ui.start();

    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', stream: true }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const text = await res.text();
    expect(text).toContain('data:');
    expect(text).toContain('"type":"text"');
    expect(text).toContain('"type":"done"');
  });

  test('handles streaming errors gracefully', async () => {
    port = randomPort();
    ui = createWebUI({
      port,
      onMessage: async () => 'fallback',
      onMessageStream: async (_msg, _userId, _send) => {
        throw new Error('Stream broke');
      },
    });
    await ui.start();

    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', stream: true }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain('Stream broke');
  });

  test('sends string payloads as-is', async () => {
    port = randomPort();
    ui = createWebUI({
      port,
      onMessage: async () => 'fallback',
      onMessageStream: async (_msg, _userId, send) => {
        send('raw text chunk');
        send({ type: 'done' });
      },
    });
    await ui.start();

    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', stream: true }),
    });

    const text = await res.text();
    expect(text).toContain('data: raw text chunk');
  });
});

// ---------------------------------------------------------------------------
// Static routes & SPA fallback
// ---------------------------------------------------------------------------

describe('static file serving', () => {
  let ui: ReturnType<typeof createWebUI>;
  let port: number;

  afterEach(async () => {
    await ui.stop();
  });

  test('/ returns 200 with HTML content', async () => {
    port = randomPort();
    ui = createWebUI({
      port,
      onMessage: async () => 'ok',
      onMessageStream: async () => {},
    });
    await ui.start();

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // Should serve either the dist index.html or the dev notice
    expect(html).toContain('Tiny Claw');
  });

  test('/index.html returns same content as /', async () => {
    port = randomPort();
    ui = createWebUI({
      port,
      onMessage: async () => 'ok',
      onMessageStream: async () => {},
    });
    await ui.start();

    const root = await fetch(`http://127.0.0.1:${port}/`);
    const index = await fetch(`http://127.0.0.1:${port}/index.html`);
    expect(root.status).toBe(200);
    expect(index.status).toBe(200);
    const rootHtml = await root.text();
    const indexHtml = await index.text();
    expect(rootHtml).toBe(indexHtml);
  });

  test('/api/health is not affected by static routes', async () => {
    port = randomPort();
    ui = createWebUI({
      port,
      onMessage: async () => 'ok',
      onMessageStream: async () => {},
    });
    await ui.start();

    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

describe('server lifecycle', () => {
  test('start() is idempotent', async () => {
    const port = randomPort();
    const ui = createWebUI({
      port,
      onMessage: async () => 'ok',
      onMessageStream: async () => {},
    });

    await ui.start();
    await ui.start(); // should not throw

    const { status } = await fetchJSON(port, '/api/health');
    expect(status).toBe(200);

    await ui.stop();
  });

  test('stop() is idempotent', async () => {
    const port = randomPort();
    const ui = createWebUI({
      port,
      onMessage: async () => 'ok',
      onMessageStream: async () => {},
    });

    await ui.start();
    await ui.stop();
    await ui.stop(); // should not throw
  });

  test('getPort() returns configured port', () => {
    const port = randomPort();
    const ui = createWebUI({
      port,
      onMessage: async () => 'ok',
      onMessageStream: async () => {},
    });

    expect(ui.getPort()).toBe(port);
  });

  test('getPort() returns actual port after start', async () => {
    const port = randomPort();
    const ui = createWebUI({
      port,
      onMessage: async () => 'ok',
      onMessageStream: async () => {},
    });

    await ui.start();
    expect(ui.getPort()).toBe(port);
    await ui.stop();
  });
});
