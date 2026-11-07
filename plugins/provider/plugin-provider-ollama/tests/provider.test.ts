import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createOllamaPluginProvider } from '../src/provider.js';

function createSecrets(apiKey: string | null = null) {
  return {
    async store() {},
    async check() {
      return apiKey !== null;
    },
    async retrieve() {
      return apiKey;
    },
    async list() {
      return [];
    },
    async resolveProviderKey() {
      return apiKey;
    },
    async close() {},
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('createOllamaPluginProvider', () => {
  test('uses local mode without auth header', async () => {
    const fetchMock = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      return Promise.resolve(
        new Response(JSON.stringify({ message: { content: 'hello local' } }), { status: 200 }),
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = createOllamaPluginProvider({
      secrets: createSecrets() as never,
      mode: 'local',
      model: 'llama3.2:3b',
    });

    const response = await provider.chat([{ role: 'user', content: 'hi' }]);

    expect(response).toEqual({ type: 'text', content: 'hello local' });
  });

  test('uses cloud mode with auth header', async () => {
    const fetchMock = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toEqual({
        Authorization: 'Bearer ollama-key',
        'Content-Type': 'application/json',
      });
      return Promise.resolve(
        new Response(JSON.stringify({ message: { content: 'hello cloud' } }), { status: 200 }),
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = createOllamaPluginProvider({
      secrets: createSecrets('ollama-key') as never,
      mode: 'cloud',
      model: 'qwen3:32b',
      baseUrl: 'https://ollama.com',
    });

    const response = await provider.chat([{ role: 'user', content: 'hi' }]);

    expect(response).toEqual({ type: 'text', content: 'hello cloud' });
  });
});
