/**
 * Discord Pairing Tools
 *
 * Two tools that implement the Discord bot pairing flow:
 *
 * 1. discord_pair — Store the bot token and enable the plugin
 * 2. discord_unpair — Remove from enabled plugins and disable
 *
 * These tools are injected into the agent's tool list at boot so the agent
 * can invoke them conversationally when a user asks to connect Discord.
 */

import type { Tool, SecretsManagerInterface, ConfigManagerInterface } from '@tinyclaw/core';

/** Secret key for the Discord bot token. */
export const DISCORD_TOKEN_SECRET_KEY = 'channel.discord.token';
/** Config key for the enabled flag. */
export const DISCORD_ENABLED_CONFIG_KEY = 'channels.discord.enabled';
/** The plugin's package ID. */
export const DISCORD_PLUGIN_ID = '@tinyclaw/plugin-channel-discord';

export function createDiscordPairingTools(
  secrets: SecretsManagerInterface,
  configManager: ConfigManagerInterface,
): Tool[] {
  return [
    {
      name: 'discord_pair',
      description:
        'Pair TinyClaw with a Discord bot. ' +
        'Stores the bot token securely and enables the Discord channel plugin. ' +
        'After pairing, TinyClaw must be restarted for the bot to connect. ' +
        'To get a token: go to https://discord.com/developers/applications, ' +
        'create an application, add a Bot, copy the token, and enable ' +
        '"Message Content Intent" under Privileged Gateway Intents.',
      parameters: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description: 'Discord bot token',
          },
        },
        required: ['token'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const token = args.token as string;
        if (!token || token.trim() === '') {
          return 'Error: token must be a non-empty string.';
        }

        try {
          // 1. Store token in secrets engine
          await secrets.store(DISCORD_TOKEN_SECRET_KEY, token.trim());

          // 2. Enable channel in config
          configManager.set(DISCORD_ENABLED_CONFIG_KEY, true);
          configManager.set('channels.discord.tokenRef', DISCORD_TOKEN_SECRET_KEY);

          // 3. Add plugin to enabled list (deduplicated)
          const current = configManager.get<string[]>('plugins.enabled') ?? [];
          if (!current.includes(DISCORD_PLUGIN_ID)) {
            configManager.set('plugins.enabled', [...current, DISCORD_PLUGIN_ID]);
          }

          return (
            'Discord bot paired successfully! ' +
            'Token stored securely and plugin enabled. ' +
            'Please restart TinyClaw for the bot to connect. ' +
            'Make sure "Message Content Intent" is enabled in the Discord Developer Portal.'
          );
        } catch (err) {
          return `Error pairing Discord: ${(err as Error).message}`;
        }
      },
    },

    {
      name: 'discord_unpair',
      description:
        'Disconnect the Discord bot and disable the Discord channel plugin. ' +
        'The bot token is kept in secrets for safety. Requires a restart.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute(): Promise<string> {
        try {
          // Disable in config
          configManager.set(DISCORD_ENABLED_CONFIG_KEY, false);

          // Remove from plugins.enabled
          const current = configManager.get<string[]>('plugins.enabled') ?? [];
          configManager.set(
            'plugins.enabled',
            current.filter((id) => id !== DISCORD_PLUGIN_ID),
          );

          return (
            'Discord plugin disabled. ' +
            'Restart TinyClaw for the change to take effect. ' +
            'The bot token is still stored in secrets — use list_secrets to manage it.'
          );
        } catch (err) {
          return `Error unpairing Discord: ${(err as Error).message}`;
        }
      },
    },
  ];
}
