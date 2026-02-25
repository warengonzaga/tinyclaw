/**
 * Telegram Channel Plugin
 *
 * Minimal v1 scaffold.
 * - Provides pairing tools
 * - Exposes channel metadata and lifecycle hooks
 * - Runtime message transport is implemented in Milestone 4+
 */

import { logger } from '@tinyclaw/logger';
import type {
  ChannelPlugin,
  PluginRuntimeContext,
  Tool,
  SecretsManagerInterface,
  ConfigManagerInterface,
} from '@tinyclaw/types';
import {
  createTelegramPairingTools,
  TELEGRAM_ENABLED_CONFIG_KEY,
  TELEGRAM_TOKEN_SECRET_KEY,
} from './pairing.js';

const telegramPlugin: ChannelPlugin = {
  id: '@tinyclaw/plugin-channel-telegram',
  name: 'Telegram',
  description: 'Connect Tiny Claw to a Telegram bot',
  type: 'channel',
  version: '0.1.0',
  channelPrefix: 'telegram',

  getPairingTools(
    secrets: SecretsManagerInterface,
    configManager: ConfigManagerInterface,
  ): Tool[] {
    return createTelegramPairingTools(secrets, configManager);
  },

  async start(context: PluginRuntimeContext): Promise<void> {
    const isEnabled = context.configManager.get<boolean>(TELEGRAM_ENABLED_CONFIG_KEY);
    if (!isEnabled) {
      logger.info('Telegram plugin: not enabled — run pairing to enable');
      return;
    }

    const token = await context.secrets.retrieve(TELEGRAM_TOKEN_SECRET_KEY);
    if (!token) {
      logger.warn('Telegram plugin: enabled but no token found — re-pair to fix');
      return;
    }

    logger.info('Telegram plugin scaffold started (runtime transport pending next milestone)');
  },

  async stop(): Promise<void> {
    logger.info('Telegram plugin stopped');
  },
};

export default telegramPlugin;
