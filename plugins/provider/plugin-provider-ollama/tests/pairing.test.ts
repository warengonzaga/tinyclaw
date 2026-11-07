import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  OLLAMA_LOCAL_BASE_URL,
  OLLAMA_MODE_CONFIG_KEY,
  OLLAMA_MODEL_CONFIG_KEY,
  OLLAMA_PLUGIN_ID,
  OLLAMA_SECRET_KEY,
} from '../src/catalog.js';
import { createOllamaPairingTools } from '../src/pairing.js';

function createSecrets() {
  const stored = new Map<string, string>();

  return {
    stored,
    async store(key: string, value: string) {
      stored.set(key, value);
    },
    async check(key: string) {
      return stored.has(key);
    },
    async retrieve(key: string) {
      return stored.get(key) ?? null;
    },
    async list() {
      return [...stored.keys()];
    },
    async resolveProviderKey(providerName: string) {
      return stored.get(`provider.${providerName}.apiKey`) ?? null;
    },
    async close() {},
  };
}

function createConfig() {
  const data: Record<string, unknown> = {};

  return {
    data,
    get<T = unknown>(key: string) {
      return data[key] as T | undefined;
    },
    has(key: string) {
      return key in data;
    },
    set(keyOrObject: string | Record<string, unknown>, value?: unknown) {
      if (typeof keyOrObject === 'string') {
        data[keyOrObject] = value;
        return;
      }

      const providers = keyOrObject.providers as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (providers?.ollama) {
        for (const [entryKey, entryValue] of Object.entries(providers.ollama)) {
          data[`providers.ollama.${entryKey}`] = entryValue;
        }
      }
    },
    delete(key: string) {
      delete data[key];
    },
    reset() {},
    clear() {},
    store: {},
    size: 0,
    path: ':memory:',
    onDidChange: () => () => {},
    onDidAnyChange: () => () => {},
    close: () => {},
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('createOllamaPairingTools', () => {
  test('pairs local Ollama with discovered model and enables plugin', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ models: [{ name: 'llama3.2:3b' }, { name: 'mistral:7b' }] }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    const secrets = createSecrets();
    const config = createConfig();
    const pair = createOllamaPairingTools(secrets as never, config as never)[0];

    const result = await pair.execute({ mode: 'local' });

    expect(result).toContain('paired successfully');
    expect(config.data[OLLAMA_MODE_CONFIG_KEY]).toBe('local');
    expect(config.data[OLLAMA_MODEL_CONFIG_KEY]).toBe('llama3.2:3b');
    expect(config.data['providers.ollama.baseUrl']).toBe(OLLAMA_LOCAL_BASE_URL);
    expect(config.data['plugins.enabled']).toEqual([OLLAMA_PLUGIN_ID]);
  });

  test('pairs cloud Ollama and filters built-in cloud models from listing', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            models: [
              { name: 'kimi-k2.5:cloud' },
              { name: 'gpt-oss:120b-cloud' },
              { name: 'qwen3:32b' },
            ],
          }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    const secrets = createSecrets();
    const config = createConfig();
    const [pair, list] = createOllamaPairingTools(secrets as never, config as never);

    const pairResult = await pair.execute({ mode: 'cloud', apiKey: 'ollama-key' });
    const listResult = await list.execute({ mode: 'cloud' });

    expect(pairResult).toContain('qwen3:32b');
    expect(secrets.stored.get(OLLAMA_SECRET_KEY)).toBe('ollama-key');
    expect(listResult).toContain('qwen3:32b');
    expect(listResult).not.toContain('kimi-k2.5:cloud');
    expect(listResult).not.toContain('gpt-oss:120b-cloud');
  });

  test('pairs cloud Ollama without re-entering the API key when one is already stored', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            models: [{ name: 'qwen3:32b' }],
          }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    const secrets = createSecrets();
    await secrets.store(OLLAMA_SECRET_KEY, 'existing-ollama-key');
    const config = createConfig();
    const pair = createOllamaPairingTools(secrets as never, config as never)[0];

    const result = await pair.execute({ mode: 'cloud' });

    expect(result).toContain('qwen3:32b');
    expect(secrets.stored.get(OLLAMA_SECRET_KEY)).toBe('existing-ollama-key');
    expect(config.data[OLLAMA_MODE_CONFIG_KEY]).toBe('cloud');
  });

  test('updates the configured model after validation', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ models: [{ name: 'qwen3:32b' }, { name: 'gemma3:27b' }] }), {
          status: 200,
        }),
      ),
    ) as typeof fetch;

    const secrets = createSecrets();
    const config = createConfig();
    const tools = createOllamaPairingTools(secrets as never, config as never);
    await tools[0].execute({ mode: 'cloud', apiKey: 'ollama-key', model: 'qwen3:32b' });

    const result = await tools[2].execute({ mode: 'cloud', model: 'gemma3:27b' });

    expect(result).toContain('gemma3:27b');
    expect(config.data[OLLAMA_MODEL_CONFIG_KEY]).toBe('gemma3:27b');
  });

  test('removes plugin and resets tier mapping on unpair', async () => {
    const secrets = createSecrets();
    const config = createConfig();
    config.data['plugins.enabled'] = [OLLAMA_PLUGIN_ID, '@tinyclaw/plugin-provider-openai'];
    config.data['routing.tierMapping.complex'] = 'ollama';
    config.data['routing.tierMapping.reasoning'] = 'ollama';

    const result = await createOllamaPairingTools(secrets as never, config as never)[3].execute({});

    expect(result).toContain('Ollama provider disabled');
    expect(config.data['plugins.enabled']).toEqual(['@tinyclaw/plugin-provider-openai']);
    expect(config.data['routing.tierMapping.complex']).toBe('ollama-cloud');
    expect(config.data['routing.tierMapping.reasoning']).toBe('ollama-cloud');
  });
});
