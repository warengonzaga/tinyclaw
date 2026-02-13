/**
 * Telnyx Pairing Tools
 *
 * Two tools that implement the Telnyx channel pairing flow:
 *
 * 1. telnyx_pair — Store the API key and phone number, enable the plugin
 * 2. telnyx_unpair — Remove from enabled plugins and disable
 *
 * These tools are injected into the agent's tool list at boot so the agent
 * can invoke them conversationally when a user asks to connect Telnyx.
 */

import type { Tool, SecretsManagerInterface, ConfigManagerInterface } from '@tinyclaw/core';

/** Secret key for the Telnyx API key. */
export const TELNYX_API_KEY_SECRET_KEY = 'channel.telnyx.apiKey';
/** Config key for the phone number. */
export const TELNYX_PHONE_NUMBER_CONFIG_KEY = 'channels.telnyx.phoneNumber';
/** Config key for the enabled flag. */
export const TELNYX_ENABLED_CONFIG_KEY = 'channels.telnyx.enabled';
/** The plugin's package ID. */
export const TELNYX_PLUGIN_ID = '@tinyclaw/plugin-channel-telnyx';

export function createTelnyxPairingTools(
  secrets: SecretsManagerInterface,
  configManager: ConfigManagerInterface,
): Tool[] {
  return [
    {
      name: 'telnyx_pair',
      description:
        'Pair TinyClaw with Telnyx for SMS and voice AI. ' +
        'Stores the API key securely and enables the Telnyx channel plugin. ' +
        'After pairing, configure the webhook URL in the Telnyx portal and restart TinyClaw. ' +
        'To get started: go to https://telnyx.com, create an account, purchase a phone number, ' +
        'and generate an API key at https://portal.telnyx.com/#/app/api-keys',
      parameters: {
        type: 'object',
        properties: {
          apiKey: {
            type: 'string',
            description: 'Telnyx API key (starts with KEY...)',
          },
          phoneNumber: {
            type: 'string',
            description: 'Telnyx phone number in E.164 format (e.g., +15551234567)',
          },
        },
        required: ['apiKey', 'phoneNumber'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const apiKey = args.apiKey as string;
        const phoneNumber = args.phoneNumber as string;

        if (!apiKey || apiKey.trim() === '') {
          return 'Error: API key must be a non-empty string.';
        }

        if (!phoneNumber || !phoneNumber.match(/^\+[1-9]\d{6,14}$/)) {
          return 'Error: Phone number must be in E.164 format (e.g., +15551234567).';
        }

        try {
          // 1. Store API key in secrets engine
          await secrets.store(TELNYX_API_KEY_SECRET_KEY, apiKey.trim());

          // 2. Configure phone number and enable channel
          configManager.set(TELNYX_PHONE_NUMBER_CONFIG_KEY, phoneNumber);
          configManager.set(TELNYX_ENABLED_CONFIG_KEY, true);
          configManager.set('channels.telnyx.apiKeyRef', TELNYX_API_KEY_SECRET_KEY);

          // 3. Add plugin to enabled list (deduplicated)
          const current = configManager.get<string[]>('plugins.enabled') ?? [];
          if (!current.includes(TELNYX_PLUGIN_ID)) {
            configManager.set('plugins.enabled', [...current, TELNYX_PLUGIN_ID]);
          }

          return (
            'Telnyx paired successfully! ' +
            `Phone number ${phoneNumber} configured. ` +
            'API key stored securely and plugin enabled.\n\n' +
            'Next steps:\n' +
            '1. In the Telnyx portal, go to your phone number settings\n' +
            '2. Set the webhook URL to: https://your-server/telnyx/webhook\n' +
            '3. Restart TinyClaw for the channel to connect\n\n' +
            'Users can now SMS or call this number to chat with TinyClaw!'
          );
        } catch (err) {
          return `Error pairing Telnyx: ${(err as Error).message}`;
        }
      },
    },

    {
      name: 'telnyx_unpair',
      description:
        'Disconnect the Telnyx channel and disable the plugin. ' +
        'The API key is kept in secrets for safety. Requires a restart.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute(): Promise<string> {
        try {
          // Disable in config
          configManager.set(TELNYX_ENABLED_CONFIG_KEY, false);

          // Remove from plugins.enabled
          const current = configManager.get<string[]>('plugins.enabled') ?? [];
          configManager.set(
            'plugins.enabled',
            current.filter((id) => id !== TELNYX_PLUGIN_ID),
          );

          return (
            'Telnyx plugin disabled. ' +
            'Restart TinyClaw for the change to take effect. ' +
            'The API key is still stored in secrets — use list_secrets to manage it.'
          );
        } catch (err) {
          return `Error unpairing Telnyx: ${(err as Error).message}`;
        }
      },
    },

    {
      name: 'telnyx_send_sms',
      description:
        'Send an SMS message through the paired Telnyx phone number. ' +
        'Use this to proactively reach out to users via text message.',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'Destination phone number in E.164 format (e.g., +15551234567)',
          },
          message: {
            type: 'string',
            description: 'Message text to send (will be chunked if over 150 chars)',
          },
        },
        required: ['to', 'message'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const to = args.to as string;
        const message = args.message as string;

        if (!to || !to.match(/^\+[1-9]\d{6,14}$/)) {
          return 'Error: Destination must be a phone number in E.164 format.';
        }

        if (!message || message.trim() === '') {
          return 'Error: Message cannot be empty.';
        }

        const isEnabled = configManager.get<boolean>(TELNYX_ENABLED_CONFIG_KEY);
        if (!isEnabled) {
          return 'Error: Telnyx channel is not enabled. Pair it first with telnyx_pair.';
        }

        const phoneNumber = configManager.get<string>(TELNYX_PHONE_NUMBER_CONFIG_KEY);
        const apiKey = await secrets.retrieve(TELNYX_API_KEY_SECRET_KEY);

        if (!phoneNumber || !apiKey) {
          return 'Error: Telnyx not fully configured. Re-pair with telnyx_pair.';
        }

        try {
          // Dynamic import to avoid loading telnyx when not needed
          const Telnyx = (await import('telnyx')).default;
          const client = new Telnyx(apiKey);

          // Split into SMS chunks and send
          const chunks = message.match(/.{1,150}(\s|$)/g) || [message];
          for (const chunk of chunks) {
            await client.messages.create({
              from: phoneNumber,
              to: to,
              text: chunk.trim(),
            });
          }

          return `SMS sent successfully to ${to} (${chunks.length} message(s))`;
        } catch (err) {
          return `Error sending SMS: ${(err as Error).message}`;
        }
      },
    },
  ];
}
