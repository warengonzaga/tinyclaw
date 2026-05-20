import type { ConfigManagerInterface, SecretsManagerInterface, Tool } from '@tinyclaw/types';
import { buildChannelKeyName } from '@tinyclaw/types';

export const TELEGRAM_TOKEN_SECRET_KEY = buildChannelKeyName('telegram');
export const TELEGRAM_ENABLED_CONFIG_KEY = 'channels.telegram.enabled';
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
        'Create a bot with @BotFather, copy the token, then call tinyclaw_restart to connect it.',
      parameters: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description: 'Telegram bot token from BotFather',
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
            'The bot token is still stored in secrets.'
          );
        } catch (err) {
          return `Error unpairing Telegram: ${(err as Error).message}`;
        }
      },
    },
  ];
}
