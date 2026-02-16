# Channel Plugin Development Guide

This guide documents how Tiny Claw channel plugins work, using the existing Discord plugin as the reference implementation.

## What a Channel Plugin Does

A channel plugin connects an external messaging platform (Discord, Telegram, Slack, etc.) to Tiny Claw.

At runtime it:

1. Starts a client connection to the external platform.
2. Receives inbound platform messages.
3. Converts each incoming message to a Tiny Claw `userId` + text payload.
4. Sends the payload into the agent loop via `context.enqueue(userId, message)`.
5. Sends the agent response back to the platform.

## Runtime Architecture (Current Codebase)

The startup flow is:

1. CLI loads plugin IDs from `plugins.enabled`.
2. Plugin modules are imported dynamically by package name.
3. Pairing tools from channel/provider plugins are merged into the agent tool list.
4. Tiny Claw creates `PluginRuntimeContext`.
5. Each channel plugin is started with `channel.start(pluginRuntimeContext)`.
6. On shutdown, Tiny Claw calls `channel.stop()`.

## Required Contract

Channel plugins must export a default object that satisfies `ChannelPlugin` from `@tinyclaw/types`.

Required fields:

- `id` (must match package name convention)
- `name`
- `description`
- `type: 'channel'`
- `version`
- `start(context)`
- `stop()`

Optional field:

- `getPairingTools(secrets, configManager)`

## Folder and Package Layout

Create your package inside:

`plugins/channel/plugin-channel-<name>/`

Suggested structure:

```text
plugins/channel/plugin-channel-<name>/
  package.json
  tsconfig.json
  src/
    index.ts
    pairing.ts
```

Minimal `package.json` pattern:

```json
{
  "name": "@tinyclaw/plugin-channel-<name>",
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

Notes:

- Root workspace already includes `plugins/channel/*` in workspaces.
- Use package IDs (not file paths) in `plugins.enabled`.

## Minimal Channel Plugin Template

```ts
import type {
  ChannelPlugin,
  PluginRuntimeContext,
  Tool,
  SecretsManagerInterface,
  ConfigManagerInterface,
} from '@tinyclaw/types';

function createPairingTools(
  secrets: SecretsManagerInterface,
  configManager: ConfigManagerInterface,
): Tool[] {
  return [];
}

const plugin: ChannelPlugin = {
  id: '@tinyclaw/plugin-channel-<name>',
  name: '<Name>',
  description: '<Platform> channel plugin for Tiny Claw',
  type: 'channel',
  version: '0.1.0',

  getPairingTools(
    secrets: SecretsManagerInterface,
    configManager: ConfigManagerInterface,
  ): Tool[] {
    return createPairingTools(secrets, configManager);
  },

  async start(context: PluginRuntimeContext): Promise<void> {
    // 1) Resolve token/settings from context.secrets + context.configManager
    // 2) Connect to platform SDK
    // 3) On inbound message:
    //    const response = await context.enqueue(userId, text)
    // 4) Send response back to channel
  },

  async stop(): Promise<void> {
    // Disconnect SDK clients and clean up
  },
};

export default plugin;
```

## Pairing Tools Pattern

Pairing tools allow conversational setup from inside Tiny Claw.

Common flow:

1. `*_pair` tool validates user input (token, webhook, etc.).
2. Store secrets in secrets engine (`secrets.store(...)`).
3. Set config flags and references (`configManager.set(...)`).
4. Add plugin package ID to `plugins.enabled` if missing.
5. Return success text instructing to run `tinyclaw_restart`.

Unpair flow:

1. Disable channel config.
2. Remove plugin ID from `plugins.enabled`.
3. Keep or remove secret, depending on intended UX.
4. Instruct restart.

## Recommended Config + Secret Key Conventions

Follow existing naming conventions from `@tinyclaw/types` and current plugins:

- Secret key: `channel.<name>.token`
- Enabled flag: `channels.<name>.enabled`
- Token reference: `channels.<name>.tokenRef`
- Plugin package id: `@tinyclaw/plugin-channel-<name>`

## Message Handling Guidelines

When implementing `start(context)`:

1. Ignore bot/self messages to prevent loops.
2. Define clear trigger rules (DM only, mention only, etc.).
3. Normalize inbound content (strip mentions, trim whitespace).
4. Use a stable user ID namespace to avoid cross-channel collisions:
   - Example: `discord:<platform-user-id>`
5. Gracefully handle platform limits (message max length, rate limits).
6. Return user-friendly fallback text on failures.

## Enabling and Testing a New Channel Plugin

1. Install dependencies:

```bash
bun install
```

1. Add your plugin package ID to config:

- via agent tool: `config_set` for `plugins.enabled`
- or direct config manager usage in code/tests

1. Start Tiny Claw:

```bash
bun start
```

1. Run your pairing tool (if implemented), then restart using `tinyclaw_restart`.
1. Confirm logs show `Channel plugin started: <Name>`.

## Existing Reference

Use this package as the implementation reference:

- `plugins/channel/plugin-channel-discord`

Key files:

- `src/index.ts` (channel runtime)
- `src/pairing.ts` (pair/unpair tools)
