# Channel Plugin Development Guide

This guide documents how Tiny Claw channel plugins work so you can build your own. Two reference implementations ship with the repo: **Discord** (external platform integration) and **Friends** (built-in web chat).

## What a Channel Plugin Does

A channel plugin connects an external messaging platform (Discord, Telegram, Slack, etc.) — or any custom interface — to the Tiny Claw agent.

At runtime it:

1. Starts a client connection to the external platform.
2. Receives inbound platform messages.
3. Converts each incoming message to a Tiny Claw `userId` + text payload.
4. Sends the payload into the agent loop via `context.enqueue(userId, message)`.
5. Sends the agent's response back to the platform.

## Runtime Architecture

The startup flow is:

1. CLI loads plugin IDs from the `plugins.enabled` config array.
2. Plugin modules are imported dynamically by package name.
3. Pairing tools from channel (and provider) plugins are merged into the agent tool list.
4. Tiny Claw creates a `PluginRuntimeContext` containing `enqueue`, `secrets`, `configManager`, and `agentContext`.
5. Each channel plugin is started via `channel.start(pluginRuntimeContext)`.
6. On shutdown, Tiny Claw calls `channel.stop()`.

## Required Contract

Channel plugins must default-export an object that satisfies `ChannelPlugin` from `@tinyclaw/types`:

```ts
export interface ChannelPlugin extends PluginMeta {
  readonly type: 'channel';
  start(context: PluginRuntimeContext): Promise<void>;
  stop(): Promise<void>;
  getPairingTools?(
    secrets: SecretsManagerInterface,
    configManager: ConfigManagerInterface,
  ): Tool[];
}
```

Required fields:

| Field | Description |
|-------|-------------|
| `id` | Package name, e.g. `@tinyclaw/plugin-channel-telegram` |
| `name` | Human-readable label |
| `description` | Short summary |
| `type` | Must be `'channel'` |
| `version` | SemVer string |
| `start(context)` | Connect to the platform and begin listening |
| `stop()` | Disconnect and clean up resources |

Optional field:

| Field | Description |
|-------|-------------|
| `getPairingTools(secrets, configManager)` | Return tools that let the user pair/unpair this channel conversationally |

## Folder and Package Layout

Create your package inside:

```
plugins/channel/plugin-channel-<name>/
```

Suggested structure:

```text
plugins/channel/plugin-channel-<name>/
  package.json
  tsconfig.json
  src/
    index.ts          # default export of ChannelPlugin
    pairing.ts        # pair/unpair tool factories (optional)
  tests/
    pairing.test.ts   # tests for pairing flow
```

Minimal `package.json`:

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

> **Note:** The root workspace already includes `plugins/channel/*` in its workspaces array. Use the package ID (not a file path) in `plugins.enabled`.

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
    // 1. Resolve token/settings from context.secrets + context.configManager
    // 2. Connect to platform SDK
    // 3. On inbound message:
    //    const response = await context.enqueue(userId, text);
    // 4. Send response back to the channel
  },

  async stop(): Promise<void> {
    // Disconnect SDK clients and clean up
  },
};

export default plugin;
```

## Pairing Tools Pattern

Pairing tools allow conversational setup from inside Tiny Claw. The agent exposes them as callable tools so a user can say *"connect my Discord bot"* and the agent handles the rest.

### Pair flow

1. `<name>_pair` tool validates user input (token, webhook URL, etc.).
2. Store the secret via `secrets.store(key, value)`.
3. Set config flags via `configManager.set(key, value)`.
4. Add the plugin package ID to `plugins.enabled` if not already present.
5. Return success text instructing the user to call `tinyclaw_restart`.

### Unpair flow

1. Disable the channel config flag.
2. Remove the plugin ID from `plugins.enabled`.
3. Optionally remove the stored secret (or keep it for easy re-pairing).
4. Instruct the user to restart.

## Config and Secret Key Conventions

Follow the naming conventions used by existing plugins:

| Key | Pattern | Example |
|-----|---------|---------|
| Secret key | `channel.<name>.token` | `channel.discord.token` |
| Enabled flag | `channels.<name>.enabled` | `channels.discord.enabled` |
| Token reference | `channels.<name>.tokenRef` | `channels.discord.tokenRef` |
| Plugin package ID | `@tinyclaw/plugin-channel-<name>` | `@tinyclaw/plugin-channel-discord` |

## Message Handling Guidelines

When implementing `start(context)`:

1. **Ignore bot/self messages** to prevent infinite loops.
2. **Define clear trigger rules** — DM only, @mention only, specific prefix, etc.
3. **Normalize inbound content** — strip mentions, trim whitespace.
4. **Use a namespaced user ID** to avoid cross-channel collisions:
   - Format: `<platform>:<platform-user-id>` (e.g. `discord:123456789`)
5. **Handle platform limits** — message max length, rate limits, file attachments.
6. **Return user-friendly fallback text** on errors.

## Enabling and Testing a New Channel Plugin

1. Install dependencies:

   ```bash
   bun install
   ```

2. Add your plugin package ID to config (choose one):

   - Via the agent tool: `config_set` for `plugins.enabled`
   - Or programmatically: `configManager.set('plugins.enabled', [...current, '@tinyclaw/plugin-channel-<name>'])`

3. Start Tiny Claw:

   ```bash
   bun start
   ```

4. Run your pairing tool (if implemented), then call `tinyclaw_restart`.
5. Confirm logs show `Channel plugin started: <Name>`.

## Existing References

| Plugin | Path | Description |
|--------|------|-------------|
| **Discord** | `plugins/channel/plugin-channel-discord/` | External platform integration via discord.js |
| **Friends** | `plugins/channel/plugin-channel-friends/` | Built-in invite-based web chat channel |

Key files in the Discord plugin:

- `src/index.ts` — channel runtime (`start` / `stop` lifecycle)
- `src/pairing.ts` — pair/unpair tool definitions
- `tests/pairing.test.ts` — pairing flow tests
