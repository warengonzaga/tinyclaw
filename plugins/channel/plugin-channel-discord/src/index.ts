/**
 * Discord Channel Plugin
 *
 * Connects a Discord bot to the TinyClaw agent.
 * Responds to Direct Messages and @mentions in guild channels.
 *
 * Setup:
 *   1. Create a Discord bot at https://discord.com/developers/applications
 *   2. Enable: Message Content Intent (under Privileged Gateway Intents)
 *   3. Run TinyClaw and ask it to pair the Discord channel
 *   4. Provide the bot token when prompted
 *   5. Restart TinyClaw — the bot will connect automatically
 *
 * userId format: "discord:<discord-user-id>"
 *   Prefixed to prevent collisions with web UI user IDs.
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type Message as DiscordMessage,
} from 'discord.js';
import { logger } from '@tinyclaw/logger';
import type {
  ChannelPlugin,
  PluginRuntimeContext,
  Tool,
  SecretsManagerInterface,
  ConfigManagerInterface,
} from '@tinyclaw/types';
import {
  createDiscordPairingTools,
  DISCORD_TOKEN_SECRET_KEY,
  DISCORD_ENABLED_CONFIG_KEY,
} from './pairing.js';

let client: Client | null = null;

const discordPlugin: ChannelPlugin = {
  id: '@tinyclaw/plugin-channel-discord',
  name: 'Discord',
  description: 'Connect TinyClaw to a Discord bot',
  type: 'channel',
  version: '0.1.0',

  getPairingTools(
    secrets: SecretsManagerInterface,
    configManager: ConfigManagerInterface,
  ): Tool[] {
    return createDiscordPairingTools(secrets, configManager);
  },

  async start(context: PluginRuntimeContext): Promise<void> {
    const isEnabled = context.configManager.get<boolean>(DISCORD_ENABLED_CONFIG_KEY);
    if (!isEnabled) {
      logger.info('Discord plugin: not enabled — run pairing to enable');
      return;
    }

    const token = await context.secrets.retrieve(DISCORD_TOKEN_SECRET_KEY);
    if (!token) {
      logger.warn('Discord plugin: enabled but no token found — re-pair to fix');
      return;
    }

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
      logger.info(`Discord bot ready: ${readyClient.user.tag}`);
    });

    client.on(Events.MessageCreate, async (msg: DiscordMessage) => {
      // Ignore messages from bots (including self)
      if (msg.author.bot) return;

      const isDM = msg.channel.isDMBased();
      const isMention = client?.user
        ? msg.mentions.users.has(client.user.id)
        : false;

      // Only respond to DMs or @mentions
      if (!isDM && !isMention) return;

      // Strip @mention tokens from guild messages
      const rawContent = msg.content
        .replace(/<@!?[\d]+>/g, '')
        .trim();

      if (!rawContent) return;

      // Prefix userId to isolate Discord sessions from web UI sessions
      const userId = `discord:${msg.author.id}`;

      try {
        await msg.channel.sendTyping();

        const response = await context.enqueue(userId, rawContent);

        // Discord has a 2000-character message limit
        if (response.length <= 2000) {
          await msg.reply(response);
        } else {
          const chunks = splitIntoChunks(response, 1900);
          for (const chunk of chunks) {
            await msg.channel.send(chunk);
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

    await client.login(token);
    logger.info('Discord bot connected');
  },

  async stop(): Promise<void> {
    if (client) {
      client.destroy();
      client = null;
      logger.info('Discord bot disconnected');
    }
  },
};

/** Split a string into chunks without cutting words at boundaries. */
function splitIntoChunks(text: string, maxLength: number): string[] {
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
