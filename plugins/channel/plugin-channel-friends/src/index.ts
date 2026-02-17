/**
 * Friends Chat Channel Plugin
 *
 * A channel plugin that provides a web-based chat interface for friends.
 * Friends are invited by the owner via the AI agent, and each friend gets
 * a unique invite code to authenticate.
 *
 * Setup:
 *   1. Enable the plugin (add to plugins.enabled or ask the agent)
 *   2. Ask the AI agent to invite a friend: "invite my friend John to friends chat"
 *   3. Share the invite URL or code with your friend
 *   4. Friend opens the link → starts chatting via FRIENDS.md
 *
 * Architecture:
 *   - Runs its own HTTP server on a configurable port (default 3001)
 *   - Invite codes are single-use → consumed → session cookie
 *   - All friend messages route through `context.enqueue()` as `friend:<username>`
 *   - The plugin provides tools for invite management (owner-only)
 *
 * userId format: "friend:<username>"
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '@tinyclaw/logger';
import type {
  ChannelPlugin,
  PluginRuntimeContext,
  Tool,
  SecretsManagerInterface,
  ConfigManagerInterface,
} from '@tinyclaw/types';
import { InviteStore } from './store.js';
import {
  createFriendsTools,
  FRIENDS_ENABLED_CONFIG_KEY,
  FRIENDS_PORT_CONFIG_KEY,
  FRIENDS_PLUGIN_ID,
} from './tools.js';
import { createFriendsServer } from './server.js';

// Resolve the directory of this source file for static asset paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load the embedded chat HTML at boot time. */
function loadChatHtml(): string {
  const htmlPath = join(__dirname, 'chat.html');
  return readFileSync(htmlPath, 'utf-8');
}

let store: InviteStore | null = null;
let friendsServer: ReturnType<typeof createFriendsServer> | null = null;

const friendsPlugin: ChannelPlugin = {
  id: FRIENDS_PLUGIN_ID,
  name: 'Friends Chat',
  description: 'Invite-based web chat for friends — powered by FRIENDS.md',
  type: 'channel',
  version: '0.1.0',

  getPairingTools(
    _secrets: SecretsManagerInterface,
    configManager: ConfigManagerInterface,
  ): Tool[] {
    // Initialize the store early so pairing tools work before start()
    if (!store) {
      const dataDir = configManager.get<string>('dataDir') || '.';
      const dbPath = join(dataDir, 'data', 'friends.db');
      store = new InviteStore(dbPath);
    }

    return createFriendsTools(store, configManager);
  },

  async start(context: PluginRuntimeContext): Promise<void> {
    const isEnabled = context.configManager.get<boolean>(FRIENDS_ENABLED_CONFIG_KEY);
    if (!isEnabled) {
      logger.info('Friends chat plugin: not enabled — enable via config or ask the agent');
      return;
    }

    // Initialize store if not already done by getPairingTools
    if (!store) {
      const dataDir = context.configManager.get<string>('dataDir') || '.';
      const dbPath = join(dataDir, 'data', 'friends.db');
      store = new InviteStore(dbPath);
    }

    const port = context.configManager.get<number>(FRIENDS_PORT_CONFIG_KEY) || 3001;
    const host = process.env.HOST || context.configManager.get<string>('friends.host') || '127.0.0.1';
    const chatHtml = loadChatHtml();

    friendsServer = createFriendsServer({
      port,
      host,
      store,
      chatHtml,
      async onMessage(message: string, userId: string): Promise<string> {
        return context.enqueue(userId, message);
      },
      async onMessageStream(
        message: string,
        userId: string,
        send: (payload: unknown) => void,
      ): Promise<void> {
        // Use the streaming enqueue if available, otherwise fallback
        const response = await context.enqueue(userId, message);
        // If enqueue returned a string directly (non-streaming), send it as done
        if (response !== undefined && response !== null) {
          send({ type: 'text', content: response });
          send({ type: 'done' });
        }
      },
    });

    await friendsServer.start();
    logger.info(`Friends chat available at http://${host}:${port}/chat`);
  },

  async stop(): Promise<void> {
    if (friendsServer) {
      friendsServer.stop();
      friendsServer = null;
    }
    if (store) {
      store.close();
      store = null;
    }
    logger.info('Friends chat plugin stopped');
  },
};

export default friendsPlugin;
