# Provider Plugin Development Guide

This guide documents how Tiny Claw provider plugins work so you can add support for any LLM backend. The existing **OpenAI** plugin is the reference implementation.

## What a Provider Plugin Does

A provider plugin connects an LLM backend (OpenAI, Anthropic, Google, Mistral, a local Ollama instance, etc.) to Tiny Claw's smart routing system.

At runtime it:

1. Creates a `Provider` object that wraps the LLM's chat completion API.
2. Exposes `chat(messages, tools)` to send conversations and receive responses.
3. Exposes `isAvailable()` so the routing system can check connectivity before dispatching.
4. Optionally provides pairing tools so users can configure the provider conversationally.

## Runtime Architecture

The startup flow is:

1. CLI loads plugin IDs from the `plugins.enabled` config array.
2. Plugin modules are imported dynamically by package name.
3. Pairing tools from provider (and channel) plugins are merged into the agent tool list.
4. For each enabled provider plugin, Tiny Claw calls `plugin.createProvider(secrets)` to obtain a `Provider` instance.
5. The routing system maps query complexity tiers (simple, moderate, complex, reasoning) to provider IDs.
6. At query time, the router selects the appropriate provider based on the tier mapping.

## Required Contract

Provider plugins must default-export an object that satisfies `ProviderPlugin` from `@tinyclaw/types`:

```ts
export interface ProviderPlugin extends PluginMeta {
  readonly type: 'provider';
  createProvider(secrets: SecretsManagerInterface): Promise<Provider>;
  getPairingTools?(
    secrets: SecretsManagerInterface,
    configManager: ConfigManagerInterface,
  ): Tool[];
}
```

The `Provider` interface returned by `createProvider`:

```ts
export interface Provider {
  id: string;
  name: string;
  chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;
  isAvailable(): Promise<boolean>;
}
```

Required fields on the plugin:

| Field | Description |
|-------|-------------|
| `id` | Package name, e.g. `@tinyclaw/plugin-provider-anthropic` |
| `name` | Human-readable label (e.g. `Anthropic`) |
| `description` | Short summary |
| `type` | Must be `'provider'` |
| `version` | SemVer string |
| `createProvider(secrets)` | Factory that returns a `Provider` instance |

Optional field:

| Field | Description |
|-------|-------------|
| `getPairingTools(secrets, configManager)` | Return tools that let the user pair/unpair this provider conversationally |

## Folder and Package Layout

Create your package inside:

```
plugins/provider/plugin-provider-<name>/
```

Suggested structure:

```text
plugins/provider/plugin-provider-<name>/
  package.json
  tsconfig.json
  src/
    index.ts          # default export of ProviderPlugin
    provider.ts       # Provider factory (chat, isAvailable)
    pairing.ts        # pair/unpair tool factories (optional)
  tests/
    provider.test.ts  # tests for the provider
    pairing.test.ts   # tests for pairing flow
```

Minimal `package.json`:

```json
{
  "name": "@tinyclaw/plugin-provider-<name>",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@tinyclaw/logger": "workspace:*",
    "@tinyclaw/types": "workspace:*"
  }
}
```

> **Note:** The root workspace already includes `plugins/provider/*` in its workspaces array. Use the package ID (not a file path) in `plugins.enabled`.

## Minimal Provider Plugin Template

```ts
// src/index.ts
import type {
  ProviderPlugin,
  SecretsManagerInterface,
  ConfigManagerInterface,
  Tool,
} from '@tinyclaw/types';
import { createMyProvider } from './provider.js';
import { createMyPairingTools } from './pairing.js';

const plugin: ProviderPlugin = {
  id: '@tinyclaw/plugin-provider-<name>',
  name: '<Name>',
  description: '<Name> provider plugin for Tiny Claw',
  type: 'provider',
  version: '0.1.0',

  async createProvider(secrets: SecretsManagerInterface) {
    return createMyProvider({ secrets });
  },

  getPairingTools(
    secrets: SecretsManagerInterface,
    configManager: ConfigManagerInterface,
  ): Tool[] {
    return createMyPairingTools(secrets, configManager);
  },
};

export default plugin;
```

## Provider Implementation

The `Provider` object returned by `createProvider` must implement two methods: `chat` and `isAvailable`.

```ts
// src/provider.ts
import { logger } from '@tinyclaw/logger';
import type {
  Provider,
  Message,
  LLMResponse,
  Tool,
  ToolCall,
  SecretsManagerInterface,
} from '@tinyclaw/types';

export interface MyProviderConfig {
  secrets: SecretsManagerInterface;
  model?: string;
  baseUrl?: string;
}

export function createMyProvider(config: MyProviderConfig): Provider {
  const model = config.model || 'default-model';

  return {
    id: '<name>',
    name: `<Name> (${model})`,

    async chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
      // 1. Resolve API key from secrets
      const apiKey = await config.secrets.resolveProviderKey('<name>');
      if (!apiKey) {
        throw new Error('No API key available for <Name>.');
      }

      // 2. Convert messages/tools to the provider's format
      // 3. Call the provider's API
      // 4. Parse the response

      // Text response
      return {
        type: 'text',
        content: 'Hello from <Name>!',
      };

      // Or tool calls response
      // return {
      //   type: 'tool_calls',
      //   content: undefined,
      //   toolCalls: [{ id: '...', name: '...', arguments: {...} }],
      // };
    },

    async isAvailable(): Promise<boolean> {
      try {
        const apiKey = await config.secrets.resolveProviderKey('<name>');
        return !!apiKey;
      } catch {
        return false;
      }
    },
  };
}
```

### Key implementation details

- **Message conversion:** Each LLM API has its own message format. Convert Tiny Claw's `Message[]` to the provider's format and back.
- **Tool/function calling:** If the provider supports tool calling, convert `Tool[]` to the provider's format and parse `ToolCall[]` from the response.
- **No SDK required:** The OpenAI reference plugin uses raw `fetch` with no external SDK dependency. You can use an SDK if you prefer, but keeping dependencies minimal is encouraged.
- **Error handling:** Log errors via `@tinyclaw/logger` and throw — the routing system handles fallback.

## Pairing Tools Pattern

Pairing tools allow conversational setup from inside Tiny Claw. The agent exposes them as callable tools so a user can say *"connect my OpenAI account"* and the agent handles the rest.

### Pair flow

1. `<name>_pair` tool validates user input (API key, model selection, etc.).
2. Store the API key via `secrets.store(key, value)`.
3. Set config values (model, base URL, etc.) via `configManager.set(key, value)`.
4. Add the plugin package ID to `plugins.enabled` if not already present.
5. Update tier mapping to route appropriate query tiers to this provider.
6. Return success text instructing the user to call `tinyclaw_restart`.

### Unpair flow

1. Remove the plugin ID from `plugins.enabled`.
2. Reset tier mapping entries that point to this provider back to the default.
3. Optionally remove the stored API key (or keep it for easy re-pairing).
4. Instruct the user to restart.

## Config and Secret Key Conventions

Follow the naming conventions used by existing plugins:

| Key | Pattern | Example |
|-----|---------|---------|
| Secret key | `provider.<name>.apiKey` | `provider.openai.apiKey` |
| Model config | `providers.<name>.model` | `providers.openai.model` |
| Tier mapping | `routing.tierMapping.<tier>` | `routing.tierMapping.complex` |
| Plugin package ID | `@tinyclaw/plugin-provider-<name>` | `@tinyclaw/plugin-provider-openai` |

### Tier mapping

Tiny Claw routes queries to providers based on complexity tiers:

| Tier | Description | Typical provider |
|------|-------------|------------------|
| `simple` | Quick factual answers | Local / cheap model |
| `moderate` | Multi-step reasoning | Mid-tier model |
| `complex` | Deep analysis, coding | High-capability model |
| `reasoning` | Advanced reasoning chains | Most capable model |

When pairing, update the tier mapping so the router sends appropriate queries to your provider:

```ts
configManager.set('routing.tierMapping.complex', '<name>');
configManager.set('routing.tierMapping.reasoning', '<name>');
```

## Enabling and Testing a New Provider Plugin

1. Install dependencies:

   ```bash
   bun install
   ```

2. Add your plugin package ID to config (choose one):

   - Via the agent tool: `config_set` for `plugins.enabled`
   - Or programmatically: `configManager.set('plugins.enabled', [...current, '@tinyclaw/plugin-provider-<name>'])`

3. Start Tiny Claw:

   ```bash
   bun start
   ```

4. Run your pairing tool (if implemented), then call `tinyclaw_restart`.
5. Confirm logs show the provider is available and tier mapping is updated.

## Existing Reference

| Plugin | Path | Description |
|--------|------|-------------|
| **OpenAI** | `plugins/provider/plugin-provider-openai/` | OpenAI GPT models via raw fetch (no SDK) |

Key files in the OpenAI plugin:

- `src/index.ts` — plugin entry point and `ProviderPlugin` export
- `src/provider.ts` — `Provider` factory with `chat` and `isAvailable`
- `src/pairing.ts` — pair/unpair tool definitions with tier mapping updates
