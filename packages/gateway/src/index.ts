/**
 * Outbound Gateway — Proactive Message Routing
 *
 * Routes outbound messages from the agent system to users across channels.
 * Each channel plugin registers a sender with a userId prefix (e.g. 'discord',
 * 'friend', 'web'). When a message is sent, the gateway resolves the prefix
 * from the userId and dispatches to the correct channel.
 *
 * Architecture:
 *   Pulse/Intercom/Agent
 *     → gateway.send(userId, message)
 *       → resolve prefix from userId
 *         → channelSender.send(userId, message)
 *           → Discord DM / Web SSE / Friends push / etc.
 *
 * Features:
 *   - Prefix-based channel routing
 *   - Broadcast to all registered channels
 *   - Graceful handling of unregistered channels
 *   - Delivery result tracking
 *   - Zero external dependencies
 */

import { logger } from '@tinyclaw/logger';
import type {
  ChannelSender,
  OutboundDeliveryResult,
  OutboundGateway,
  OutboundMessage,
} from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an outbound gateway instance.
 *
 * @returns A fully functional OutboundGateway ready for channel registration.
 *
 * @example
 * ```ts
 * const gateway = createGateway();
 *
 * // Register channels during boot
 * gateway.register('web', webSender);
 * gateway.register('discord', discordSender);
 *
 * // Send a proactive message
 * await gateway.send('web:owner', {
 *   content: 'Your background task is complete!',
 *   priority: 'normal',
 *   source: 'background_task',
 * });
 * ```
 */
export function createGateway(): OutboundGateway {
  /** prefix → ChannelSender registry */
  const senders = new Map<string, ChannelSender>();

  /**
   * Extract the channel prefix from a userId.
   * userId format: "prefix:identifier" (e.g. "discord:123456", "web:owner")
   */
  function resolvePrefix(userId: string): string | null {
    const colonIndex = userId.indexOf(':');
    if (colonIndex === -1) return null;
    return userId.slice(0, colonIndex);
  }

  return {
    register(prefix: string, sender: ChannelSender): void {
      if (senders.has(prefix)) {
        logger.warn(`Gateway: overwriting sender for prefix "${prefix}"`, {
          previous: senders.get(prefix)?.name,
          new: sender.name,
        });
      }
      senders.set(prefix, sender);
      logger.info(`Gateway: registered channel "${sender.name}" for prefix "${prefix}"`);
    },

    unregister(prefix: string): void {
      const sender = senders.get(prefix);
      if (sender) {
        senders.delete(prefix);
        logger.info(`Gateway: unregistered channel "${sender.name}" for prefix "${prefix}"`);
      }
    },

    async send(userId: string, message: OutboundMessage): Promise<OutboundDeliveryResult> {
      const prefix = resolvePrefix(userId);

      if (!prefix) {
        logger.warn('Gateway: cannot resolve channel prefix from userId', { userId });
        return {
          success: false,
          channel: 'unknown',
          userId,
          error: `Invalid userId format — expected "prefix:id", got "${userId}"`,
        };
      }

      const sender = senders.get(prefix);

      if (!sender) {
        logger.warn(`Gateway: no channel registered for prefix "${prefix}"`, { userId });
        return {
          success: false,
          channel: prefix,
          userId,
          error: `No channel registered for prefix "${prefix}"`,
        };
      }

      try {
        await sender.send(userId, message);
        logger.debug(`Gateway: delivered to ${sender.name}`, {
          userId,
          source: message.source,
          priority: message.priority,
        });
        return {
          success: true,
          channel: prefix,
          userId,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Gateway: delivery failed for ${sender.name}`, {
          userId,
          error: errorMsg,
        });
        return {
          success: false,
          channel: prefix,
          userId,
          error: errorMsg,
        };
      }
    },

    async broadcast(message: OutboundMessage): Promise<OutboundDeliveryResult[]> {
      const results: OutboundDeliveryResult[] = [];

      for (const [prefix, sender] of senders) {
        if (!sender.broadcast) {
          logger.debug(`Gateway: channel "${sender.name}" does not support broadcast — skipping`);
          continue;
        }

        try {
          await sender.broadcast(message);
          results.push({
            success: true,
            channel: prefix,
            userId: `${prefix}:*`,
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error(`Gateway: broadcast failed for ${sender.name}`, {
            error: errorMsg,
          });
          results.push({
            success: false,
            channel: prefix,
            userId: `${prefix}:*`,
            error: errorMsg,
          });
        }
      }

      return results;
    },

    getRegisteredChannels(): string[] {
      return Array.from(senders.keys());
    },
  };
}
