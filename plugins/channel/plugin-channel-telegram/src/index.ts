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
  createTelegramPairingTools,
  TELEGRAM_ENABLED_CONFIG_KEY,
  TELEGRAM_TOKEN_SECRET_KEY,
} from './pairing.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const TELEGRAM_MESSAGE_LIMIT = 4000;
const TELEGRAM_POLL_TIMEOUT_SECONDS = 30;
const TELEGRAM_RETRY_DELAY_MS = 3000;

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

let pollAbortController: AbortController | null = null;
let pollingTask: Promise<void> | null = null;
let botToken: string | null = null;
const privateChatRoutes = new Map<string, number>();

const telegramPlugin: ChannelPlugin = {
  id: '@tinyclaw/plugin-channel-telegram',
  name: 'Telegram',
  description: 'Connect Tiny Claw to a Telegram bot',
  type: 'channel',
  version: '2.0.0',
  channelPrefix: 'telegram',

  getPairingTools(secrets: SecretsManagerInterface, configManager: ConfigManagerInterface): Tool[] {
    return createTelegramPairingTools(secrets, configManager);
  },

  async start(context: PluginRuntimeContext): Promise<void> {
    if (pollingTask) {
      logger.warn('Telegram plugin: polling is already active');
      return;
    }

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

    const me = await telegramApi<TelegramUser>(token, 'getMe');

    botToken = token;
    pollAbortController = new AbortController();
    pollingTask = pollForUpdates(
      context,
      token,
      me.username ?? null,
      pollAbortController.signal,
    ).catch((err) => {
      if (!isAbortError(err)) {
        logger.error('Telegram plugin: polling stopped unexpectedly', err);
      }
    });

    const botLabel = me.username ? `@${me.username}` : me.first_name;
    logger.info(`Telegram bot connected: ${botLabel}`);
  },

  async sendToUser(userId: string, message: OutboundMessage): Promise<void> {
    if (!botToken) {
      throw new Error('Telegram bot is not connected');
    }

    const telegramUserId = parseTelegramUserId(userId);
    const chatId = privateChatRoutes.get(userId) ?? telegramUserId;
    await sendTelegramText(botToken, chatId, message.content);
    logger.info(`Telegram: sent outbound message to ${userId}`);
  },

  async stop(): Promise<void> {
    const task = pollingTask;
    const controller = pollAbortController;

    pollingTask = null;
    pollAbortController = null;
    botToken = null;
    privateChatRoutes.clear();

    if (controller) {
      controller.abort();
    }

    if (task) {
      await task.catch(() => {});
      logger.info('Telegram bot disconnected');
    }
  },
};

async function pollForUpdates(
  context: PluginRuntimeContext,
  token: string,
  username: string | null,
  signal: AbortSignal,
): Promise<void> {
  let offset = 0;

  while (!signal.aborted) {
    try {
      const updates = await telegramApi<TelegramUpdate[]>(
        token,
        'getUpdates',
        {
          offset,
          timeout: TELEGRAM_POLL_TIMEOUT_SECONDS,
          allowed_updates: ['message'],
        },
        signal,
      );

      for (const update of updates) {
        offset = update.update_id + 1;
        if (!update.message) continue;
        await handleIncomingMessage(context, token, update.message, username);
      }
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }

      logger.error('Telegram plugin: failed to poll updates', err);
      await waitForRetry(signal);
    }
  }
}

async function handleIncomingMessage(
  context: PluginRuntimeContext,
  token: string,
  message: TelegramMessage,
  username: string | null,
): Promise<void> {
  if (!message.from || message.from.is_bot) {
    return;
  }

  const rawText = getTelegramMessageText(message);
  if (!shouldHandleTelegramMessage(message, rawText, username)) {
    return;
  }

  const content = normalizeTelegramText(rawText, username);
  if (!content) {
    return;
  }

  const userId = `telegram:${message.from.id}`;

  if (message.chat.type === 'private') {
    privateChatRoutes.set(userId, message.chat.id);
  }

  try {
    const response = await context.enqueue(userId, content);
    await sendTelegramText(token, message.chat.id, response, message.message_id);
  } catch (err) {
    logger.error('Telegram plugin: error handling message', err);
    try {
      await sendTelegramText(
        token,
        message.chat.id,
        'Sorry, I ran into an error. Please try again.',
        message.message_id,
      );
    } catch {
      // Ignore secondary delivery failures.
    }
  }
}

async function sendTelegramText(
  token: string,
  chatId: number,
  text: string,
  replyToMessageId?: number,
): Promise<void> {
  const chunks = splitIntoChunks(text, TELEGRAM_MESSAGE_LIMIT);

  for (const [index, chunk] of chunks.entries()) {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: chunk,
    };

    if (replyToMessageId && index === 0) {
      payload.reply_to_message_id = replyToMessageId;
    }

    await telegramApi(token, 'sendMessage', payload);
  }
}

async function telegramApi<T>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
    signal,
  });

  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!data.ok) {
    throw new Error(data.description || `Telegram API ${method} failed`);
  }

  return data.result;
}

async function waitForRetry(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, TELEGRAM_RETRY_DELAY_MS);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function getTelegramMessageText(message: TelegramMessage): string {
  return (message.text ?? message.caption ?? '').trim();
}

export function shouldHandleTelegramMessage(
  message: Pick<TelegramMessage, 'chat'>,
  text: string,
  username: string | null,
): boolean {
  if (!text) {
    return false;
  }

  if (message.chat.type === 'private') {
    return true;
  }

  if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
    if (!username) {
      return false;
    }
    return createMentionPattern(username).test(text);
  }

  return false;
}

export function normalizeTelegramText(text: string, username: string | null): string {
  let normalized = text.trim();
  if (username) {
    normalized = normalized
      .replace(createMentionPattern(username), ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return normalized;
}

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

function createMentionPattern(username: string): RegExp {
  return new RegExp(`@${escapeRegExp(username)}\\b`, 'gi');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTelegramUserId(userId: string): number {
  const numericPart = userId.replace(/^telegram:/, '');
  const parsed = Number(numericPart);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid Telegram userId: ${userId}`);
  }

  return parsed;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export default telegramPlugin;
