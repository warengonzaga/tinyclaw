/**
 * Discord Channel Plugin
 *
 * Connects a Discord bot to the Tiny Claw agent.
 * Responds to Direct Messages and @mentions in guild channels.
 *
 * Setup:
 *   1. Create a Discord bot at https://discord.com/developers/applications
 *   2. Enable: Message Content Intent (under Privileged Gateway Intents)
 *   3. Run Tiny Claw and ask it to pair the Discord channel
 *   4. Provide the bot token when prompted
 *   5. Agent auto-restarts — the bot will connect automatically
 *
 * userId format: "discord:<discord-user-id>"
 *   Prefixed to prevent collisions with web UI user IDs.
 */

import { logger } from '@tinyclaw/logger';
import type {
  ChannelPlugin,
  ConfigManagerInterface,
  OutboundMessage,
  PluginRuntimeContext,
  SecretsManagerInterface,
  Tool,
} from '@tinyclaw/types';
import {
  Client,
  type Message as DiscordMessage,
  Events,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import {
  createDiscordPairingTools,
  DISCORD_ENABLED_CONFIG_KEY,
  DISCORD_TOKEN_SECRET_KEY,
} from './pairing.js';

let client: Client | null = null;

export interface DiscordRuntimeStatus {
  enabled: boolean;
  state: 'idle' | 'disabled' | 'starting' | 'connected' | 'error' | 'stopped';
  readyTag: string | null;
  lastError: string | null;
}

const runtimeStatus: DiscordRuntimeStatus = {
  enabled: false,
  state: 'idle',
  readyTag: null,
  lastError: null,
};

export function getDiscordRuntimeStatus(): DiscordRuntimeStatus {
  return { ...runtimeStatus };
}

const discordPlugin: ChannelPlugin = {
  id: '@tinyclaw/plugin-channel-discord',
  name: 'Discord',
  description: 'Connect Tiny Claw to a Discord bot',
  type: 'channel',
  version: '0.1.0',
  channelPrefix: 'discord',

  getPairingTools(secrets: SecretsManagerInterface, configManager: ConfigManagerInterface): Tool[] {
    return createDiscordPairingTools(secrets, configManager);
  },

  async start(context: PluginRuntimeContext): Promise<void> {
    const isEnabled = context.configManager.get<boolean>(DISCORD_ENABLED_CONFIG_KEY);
    runtimeStatus.enabled = Boolean(isEnabled);

    if (!isEnabled) {
      runtimeStatus.state = 'disabled';
      runtimeStatus.readyTag = null;
      runtimeStatus.lastError = null;
      logger.info('Discord plugin: not enabled — run pairing to enable');
      return;
    }

    const token = await context.secrets.retrieve(DISCORD_TOKEN_SECRET_KEY);
    if (!token) {
      runtimeStatus.state = 'error';
      runtimeStatus.readyTag = null;
      runtimeStatus.lastError = 'Discord bot token not found in secrets';
      logger.warn('Discord plugin: enabled but no token found — re-pair to fix');
      return;
    }

    runtimeStatus.state = 'starting';
    runtimeStatus.readyTag = null;
    runtimeStatus.lastError = null;

    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });

    client.once(Events.ClientReady, (readyClient) => {
      runtimeStatus.state = 'connected';
      runtimeStatus.readyTag = readyClient.user.tag;
      runtimeStatus.lastError = null;
      logger.info(`Discord bot ready: ${readyClient.user.tag}`);
    });

    client.on(Events.Error, (error) => {
      runtimeStatus.state = 'error';
      runtimeStatus.readyTag = null;
      runtimeStatus.lastError = error.message;
      logger.error('Discord plugin: client error', error);
    });

    client.on(Events.MessageCreate, async (msg: DiscordMessage) => {
      // Ignore messages from bots (including self)
      if (msg.author.bot) return;

      const isDM = msg.channel.isDMBased();
      const isMention = client?.user ? msg.mentions.users.has(client.user.id) : false;

      // Only respond to DMs or @mentions
      if (!isDM && !isMention) return;

      // Strip @mention tokens from guild messages
      const rawContent = msg.content.replace(/<@!?[\d]+>/g, '').trim();

      if (!rawContent) return;

      // Prefix userId to isolate Discord sessions from web UI sessions
      const userId = `discord:${msg.author.id}`;

      try {
        if ('sendTyping' in msg.channel) {
          await msg.channel.sendTyping();
        }

        const response = await context.enqueue(userId, rawContent);

        // Discord has a 2000-character message limit
        if (response.length <= 2000) {
          await msg.reply(response);
        } else {
          const chunks = splitIntoChunks(response, 1900);
          for (const chunk of chunks) {
            if ('send' in msg.channel) {
              await msg.channel.send(chunk);
            }
          }
        }
      } catch (err) {
        logger.error('Discord plugin: error handling message', err);
        try {
          await msg.reply('Sorry, I ran into an error. Please try again.');
        } catch {
          // If replying also fails, just log it
        }
      }
    });

    try {
      await client.login(token);
      logger.info('Discord bot connected');
    } catch (error) {
      runtimeStatus.state = 'error';
      runtimeStatus.readyTag = null;
      runtimeStatus.lastError = error instanceof Error ? error.message : String(error);
      if (client) {
        client.destroy();
        client = null;
      }
      throw error;
    }
  },

  async sendToUser(userId: string, message: OutboundMessage): Promise<void> {
    if (!client) {
      throw new Error('Discord client is not connected');
    }

    // Parse the Discord user ID from the prefixed format "discord:<id>"
    const discordId = userId.replace(/^discord:/, '');
    if (!discordId) {
      throw new Error(`Invalid Discord userId: ${userId}`);
    }

    try {
      const user = await client.users.fetch(discordId);
      const text = message.content;

      if (text.length <= 2000) {
        await user.send(text);
      } else {
        const chunks = splitIntoChunks(text, 1900);
        for (const chunk of chunks) {
          await user.send(chunk);
        }
      }

      logger.info(`Discord: sent outbound message to ${userId}`);
    } catch (err) {
      logger.error(`Discord: failed to send to ${userId}`, err);
      throw err;
    }
  },

  async stop(): Promise<void> {
    if (client) {
      client.destroy();
      client = null;
      logger.info('Discord bot disconnected');
    }

    runtimeStatus.state = runtimeStatus.enabled ? 'stopped' : 'disabled';
    runtimeStatus.readyTag = null;
  },
};

/** Split a string into chunks without cutting words at boundaries. */
export function splitIntoChunks(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt === -1) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

export default discordPlugin;
