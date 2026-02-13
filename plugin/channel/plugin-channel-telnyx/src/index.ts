/**
 * Telnyx SMS/Voice Channel Plugin
 *
 * Connects Telnyx phone numbers to the TinyClaw agent for SMS and voice interactions.
 * Enables AI-powered text messaging and voice calls through Telnyx's telecom API.
 *
 * Features:
 *   - SMS: Send and receive text messages with the AI agent
 *   - Voice: AI-powered phone conversations using Telnyx Call Control
 *   - Multi-number support: Route different numbers to different agents
 *
 * Setup:
 *   1. Create a Telnyx account at https://telnyx.com
 *   2. Purchase a phone number or port an existing one
 *   3. Create an API key at https://portal.telnyx.com/#/app/api-keys
 *   4. Run TinyClaw and ask it to pair the Telnyx channel
 *   5. Provide the API key and phone number when prompted
 *   6. Configure webhook URL in Telnyx portal: https://your-server/telnyx/webhook
 *   7. Restart TinyClaw — the channel will connect automatically
 *
 * userId format: "telnyx:<phone-number>" (e.g., "telnyx:+15551234567")
 *   Uses phone number as user identifier for session continuity.
 */

import Telnyx from 'telnyx';
import { logger } from '@tinyclaw/core';
import type {
  ChannelPlugin,
  PluginRuntimeContext,
  Tool,
  SecretsManagerInterface,
  ConfigManagerInterface,
} from '@tinyclaw/core';
import {
  createTelnyxPairingTools,
  TELNYX_API_KEY_SECRET_KEY,
  TELNYX_PHONE_NUMBER_CONFIG_KEY,
  TELNYX_ENABLED_CONFIG_KEY,
} from './pairing.js';

let telnyxClient: Telnyx | null = null;
let webhookHandler: ((req: Request) => Promise<Response>) | null = null;

const telnyxPlugin: ChannelPlugin = {
  id: '@tinyclaw/plugin-channel-telnyx',
  name: 'Telnyx',
  description: 'Connect TinyClaw to Telnyx for SMS and voice AI interactions',
  type: 'channel',
  version: '0.1.0',

  getPairingTools(
    secrets: SecretsManagerInterface,
    configManager: ConfigManagerInterface,
  ): Tool[] {
    return createTelnyxPairingTools(secrets, configManager);
  },

  async start(context: PluginRuntimeContext): Promise<void> {
    const isEnabled = context.configManager.get<boolean>(TELNYX_ENABLED_CONFIG_KEY);
    if (!isEnabled) {
      logger.info('Telnyx plugin: not enabled — run pairing to enable');
      return;
    }

    const apiKey = await context.secrets.retrieve(TELNYX_API_KEY_SECRET_KEY);
    if (!apiKey) {
      logger.warn('Telnyx plugin: enabled but no API key found — re-pair to fix');
      return;
    }

    const phoneNumber = context.configManager.get<string>(TELNYX_PHONE_NUMBER_CONFIG_KEY);
    if (!phoneNumber) {
      logger.warn('Telnyx plugin: enabled but no phone number configured');
      return;
    }

    // Initialize Telnyx client
    telnyxClient = new Telnyx(apiKey);
    logger.info(`Telnyx client initialized for ${phoneNumber}`);

    // Create webhook handler for incoming messages
    webhookHandler = createWebhookHandler(telnyxClient, context, phoneNumber);

    logger.info('Telnyx channel ready — configure webhook in Telnyx portal');
    logger.info(`Webhook URL should POST to your server's /telnyx/webhook endpoint`);
  },

  async stop(): Promise<void> {
    telnyxClient = null;
    webhookHandler = null;
    logger.info('Telnyx channel disconnected');
  },
};

/**
 * Create a webhook handler for Telnyx callbacks.
 * Handles both SMS and Call Control webhooks.
 */
function createWebhookHandler(
  client: Telnyx,
  context: PluginRuntimeContext,
  phoneNumber: string,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const body = await req.json();
      const event = body.data;

      logger.debug('Telnyx webhook received:', event.event_type);

      switch (event.event_type) {
        case 'message.received':
          return await handleSmsReceived(client, context, event, phoneNumber);

        case 'call.initiated':
          return await handleCallInitiated(client, context, event, phoneNumber);

        default:
          logger.debug(`Telnyx event ignored: ${event.event_type}`);
          return new Response('OK', { status: 200 });
      }
    } catch (err) {
      logger.error('Telnyx webhook error:', err);
      return new Response('Error', { status: 500 });
    }
  };
}

/**
 * Handle incoming SMS message.
 */
async function handleSmsReceived(
  client: Telnyx,
  context: PluginRuntimeContext,
  event: any,
  toNumber: string,
): Promise<Response> {
  const from = event.payload.from.phone_number;
  const to = event.payload.to[0].phone_number;
  const text = event.payload.text;

  if (!text || text.trim() === '') {
    return new Response('OK', { status: 200 });
  }

  logger.info(`Telnyx SMS from ${from}: ${text.substring(0, 50)}...`);

  // Use phone number as user ID for session continuity
  const userId = `telnyx:${from}`;

  try {
    const response = await context.enqueue(userId, text);

    // Send response via SMS (chunk if needed for SMS 160 char limit)
    const chunks = splitSmsChunks(response, 150);
    for (const chunk of chunks) {
      await client.messages.create({
        from: toNumber,
        to: from,
        text: chunk,
      });
    }

    logger.info(`Telnyx SMS sent to ${from} (${chunks.length} message(s))`);
  } catch (err) {
    logger.error('Telnyx SMS processing error:', err);
    // Send error message to user
    await client.messages.create({
      from: toNumber,
      to: from,
      text: 'Sorry, I encountered an error. Please try again.',
    });
  }

  return new Response('OK', { status: 200 });
}

/**
 * Handle incoming voice call.
 * Uses Telnyx Call Control for AI-powered conversations.
 */
async function handleCallInitiated(
  client: Telnyx,
  context: PluginRuntimeContext,
  event: any,
  toNumber: string,
): Promise<Response> {
  const callControlId = event.payload.call_control_id;
  const from = event.payload.from;

  logger.info(`Telnyx call from ${from}, call_control_id: ${callControlId}`);

  try {
    // Answer the call
    const call = client.calls.retrieve(callControlId);
    await call.answer();

    // Use phone number as user ID
    const userId = `telnyx:${from}`;

    // Greet the caller
    const greeting = await context.enqueue(userId, 'User is calling. Briefly greet them and ask how you can help.');
    
    // Use Telnyx TTS to speak the greeting
    await call.speak({
      payload: greeting,
      voice: 'female',
      language: 'en-US',
    });

    logger.info(`Telnyx call answered from ${from}`);
  } catch (err) {
    logger.error('Telnyx call handling error:', err);
  }

  return new Response('OK', { status: 200 });
}

/**
 * Split text into SMS-sized chunks.
 * SMS has a 160 character limit per message.
 */
function splitSmsChunks(text: string, maxLength: number = 150): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a sentence boundary
    let splitAt = remaining.lastIndexOf('. ', maxLength);
    if (splitAt === -1) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt === -1) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  return chunks;
}

export default telnyxPlugin;
