/**
 * Telegram Pairing Tools
 *
 * Two tools that implement the Telegram bot pairing flow:
 *
 * 1. telegram_pair — Store the bot token and enable the plugin
 * 2. telegram_unpair — Remove from enabled plugins and disable
 *
 * These tools are injected into the agent's tool list at boot so the agent
 * can invoke them conversationally when a user asks to connect Telegram.
 */

import type { Tool, SecretsManagerInterface, ConfigManagerInterface } from '@tinyclaw/types';
import { buildChannelKeyName } from '@tinyclaw/types';

/** Secret key for the Telegram bot token. */
export const TELEGRAM_TOKEN_SECRET_KEY = buildChannelKeyName('telegram');
/** Config key for the enabled flag. */
export const TELEGRAM_ENABLED_CONFIG_KEY = 'channels.telegram.enabled';
/** The plugin's package ID. */
export const TELEGRAM_PLUGIN_ID = '@tinyclaw/plugin-channel-telegram';

export function createTelegramPairingTools(
  secrets: SecretsManagerInterface,
  configManager: ConfigManagerInterface,
): Tool[] {
  return [
    {
      name: 'telegram_pair',
      description:
        'Pair Tiny Claw with a Telegram bot. ' +
        'Stores the bot token securely and enables the Telegram channel plugin. ' +
        'After pairing, call tinyclaw_restart to connect the bot. ' +
        'To get a token, use Telegram BotFather and create a new bot.',
      parameters: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description: 'Telegram bot token',
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
          await secrets.store(TELEGRAM_TOKEN_SECRET_KEY, token.trim());

          configManager.set(TELEGRAM_ENABLED_CONFIG_KEY, true);
          configManager.set('channels.telegram.tokenRef', TELEGRAM_TOKEN_SECRET_KEY);

          const current = configManager.get<string[]>('plugins.enabled') ?? [];
          if (!current.includes(TELEGRAM_PLUGIN_ID)) {
            configManager.set('plugins.enabled', [...current, TELEGRAM_PLUGIN_ID]);
          }

          return (
            'Telegram bot paired successfully! ' +
            'Token stored securely and plugin enabled. ' +
            'Use the tinyclaw_restart tool now to connect the bot.'
          );
        } catch (err) {
          return `Error pairing Telegram: ${(err as Error).message}`;
        }
      },
    },
    {
      name: 'telegram_unpair',
      description:
        'Disconnect the Telegram bot and disable the Telegram channel plugin. ' +
        'The bot token is kept in secrets for safety. Call tinyclaw_restart after.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute(): Promise<string> {
        try {
          configManager.set(TELEGRAM_ENABLED_CONFIG_KEY, false);

          const current = configManager.get<string[]>('plugins.enabled') ?? [];
          configManager.set(
            'plugins.enabled',
            current.filter((id) => id !== TELEGRAM_PLUGIN_ID),
          );

          return (
            'Telegram plugin disabled. ' +
            'Use the tinyclaw_restart tool now to apply the changes. ' +
            'The bot token is still stored in secrets — use list_secrets to manage it.'
          );
        } catch (err) {
          return `Error unpairing Telegram: ${(err as Error).message}`;
        }
      },
    },
  ];
}
