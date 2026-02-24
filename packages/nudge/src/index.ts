/**
 * Nudge Engine — Proactive Notification System
 *
 * Queues, schedules, and delivers nudge notifications from the agent to users.
 * Respects user preferences: quiet hours, rate limiting, per-category opt-out.
 *
 * Architecture:
 *   Intercom events / Pulse jobs / Agent tools
 *     → nudgeEngine.schedule(nudge)
 *       → queue (in-memory, sorted by deliverAfter)
 *         → flush() checks preferences + quiet hours
 *           → gateway.send(userId, message)
 *             → SSE / Discord DM / Friends push
 *
 * The engine is passive — it doesn't run its own timer. Instead, it relies on:
 *   1. Intercom event handlers calling schedule() immediately
 *   2. A Pulse job calling flush() periodically (e.g. every 1m)
 *   3. Event-driven flush after each schedule() for urgent nudges
 */

import { logger } from '@tinyclaw/logger';
import type {
  Nudge,
  NudgeCategory,
  NudgeEngine,
  NudgePreferences,
  OutboundGateway,
  OutboundPriority,
  OutboundSource,
  Tool,
} from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PREFERENCES: NudgePreferences = {
  enabled: true,
  maxPerHour: 5,
  suppressedCategories: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a 24h time string ("HH:MM") into minutes since midnight.
 */
function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Check if the current time falls within quiet hours.
 * Handles overnight ranges (e.g. 22:00 → 08:00).
 */
function isQuietHours(start?: string, end?: string): boolean {
  if (!start || !end) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTime(start);
  const endMinutes = parseTime(end);

  if (startMinutes <= endMinutes) {
    // Same-day range (e.g. 09:00 → 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g. 22:00 → 08:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/**
 * Map nudge category to outbound message source.
 */
function categoryToSource(category: NudgeCategory): OutboundSource {
  switch (category) {
    case 'task_complete':
    case 'task_failed':
      return 'background_task';
    case 'reminder':
      return 'reminder';
    case 'check_in':
      return 'pulse';
    case 'insight':
    case 'agent_initiated':
      return 'agent';
    case 'companion':
      return 'agent';
    case 'system':
    case 'software_update':
      return 'system';
    default:
      return 'system';
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateNudgeEngineOptions {
  /** The outbound gateway for delivering nudges. */
  gateway: OutboundGateway;
  /** Initial user preferences (merged with defaults). */
  preferences?: Partial<NudgePreferences>;
}

/**
 * Create a nudge engine instance.
 *
 * @example
 * ```ts
 * const nudge = createNudgeEngine({ gateway });
 *
 * // Queue a nudge
 * nudge.schedule({
 *   userId: 'web:owner',
 *   category: 'task_complete',
 *   content: 'Your research task is done!',
 *   priority: 'normal',
 *   deliverAfter: 0,
 * });
 *
 * // Process pending nudges (called by Pulse job)
 * await nudge.flush();
 * ```
 */
export function createNudgeEngine(options: CreateNudgeEngineOptions): NudgeEngine {
  const { gateway } = options;

  /** User preferences (mutable). */
  let prefs: NudgePreferences = {
    ...DEFAULT_PREFERENCES,
    ...options.preferences,
  };

  /** Pending nudge queue (unsorted — sorted on flush). */
  const queue: Nudge[] = [];

  /** Delivery timestamps for rate limiting (sliding window). */
  const deliveryLog: number[] = [];

  /** Auto-flush timer for urgent nudges. */
  let urgentTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Clean up old entries from the delivery log.
   */
  function pruneDeliveryLog(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    while (deliveryLog.length > 0 && deliveryLog[0] < oneHourAgo) {
      deliveryLog.shift();
    }
  }

  /**
   * Check if we've hit the hourly rate limit.
   */
  function isRateLimited(): boolean {
    pruneDeliveryLog();
    return deliveryLog.length >= prefs.maxPerHour;
  }

  /**
   * Schedule an auto-flush for urgent nudges (debounced 500ms).
   */
  function scheduleUrgentFlush(): void {
    if (urgentTimer) return;
    urgentTimer = setTimeout(async () => {
      urgentTimer = null;
      try {
        await flush();
      } catch (err) {
        logger.error('Nudge: urgent flush failed', { error: String(err) });
      }
    }, 500);
  }

  /**
   * Process all pending nudges that are due for delivery.
   */
  async function flush(): Promise<void> {
    if (!prefs.enabled) {
      logger.debug('Nudge: engine disabled — skipping flush');
      return;
    }

    const now = Date.now();
    const quiet = isQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd);

    // Sort by priority (urgent first) then by creation time
    const priorityOrder: Record<OutboundPriority, number> = {
      urgent: 0,
      normal: 1,
      low: 2,
    };
    queue.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 1;
      const pb = priorityOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return a.createdAt - b.createdAt;
    });

    const toRemove: string[] = [];

    for (const nudge of queue) {
      if (nudge.delivered) {
        toRemove.push(nudge.id);
        continue;
      }

      // Not yet due
      if (nudge.deliverAfter > now) continue;

      // Category suppressed
      if (prefs.suppressedCategories.includes(nudge.category)) {
        logger.debug(`Nudge: suppressed (category: ${nudge.category})`, { id: nudge.id });
        nudge.delivered = true;
        toRemove.push(nudge.id);
        continue;
      }

      // Quiet hours — hold non-urgent nudges
      if (quiet && nudge.priority !== 'urgent') {
        logger.debug(`Nudge: deferred (quiet hours)`, { id: nudge.id });
        continue;
      }

      // Rate limit — hold unless urgent
      if (isRateLimited() && nudge.priority !== 'urgent') {
        logger.debug(`Nudge: deferred (rate limit)`, { id: nudge.id });
        continue;
      }

      // Deliver via gateway
      try {
        const result = await gateway.send(nudge.userId, {
          content: nudge.content,
          priority: nudge.priority,
          source: categoryToSource(nudge.category),
          metadata: {
            nudgeId: nudge.id,
            category: nudge.category,
            ...nudge.metadata,
          },
        });

        if (result.success) {
          nudge.delivered = true;
          toRemove.push(nudge.id);
          // Urgent nudges don't count toward the rate limit quota
          if (nudge.priority !== 'urgent') {
            deliveryLog.push(now);
          }
          logger.info(`Nudge: delivered`, {
            id: nudge.id,
            category: nudge.category,
            userId: nudge.userId,
          });
        } else {
          logger.warn(`Nudge: delivery failed`, {
            id: nudge.id,
            error: result.error,
          });
          // Leave in queue for retry on next flush
        }
      } catch (err) {
        logger.error(`Nudge: delivery error`, {
          id: nudge.id,
          error: String(err),
        });
      }
    }

    // Remove delivered/suppressed nudges
    for (const id of toRemove) {
      const idx = queue.findIndex((n) => n.id === id);
      if (idx !== -1) queue.splice(idx, 1);
    }
  }

  return {
    schedule(nudge) {
      const id = crypto.randomUUID();
      const entry: Nudge = {
        ...nudge,
        id,
        createdAt: Date.now(),
        delivered: false,
        deliverAfter: nudge.deliverAfter || 0,
      };

      queue.push(entry);
      logger.debug(`Nudge: scheduled`, {
        id,
        category: nudge.category,
        priority: nudge.priority,
        userId: nudge.userId,
      });

      // Auto-flush urgent nudges
      if (nudge.priority === 'urgent') {
        scheduleUrgentFlush();
      }

      return id;
    },

    flush,

    pending() {
      return queue.filter((n) => !n.delivered);
    },

    cancel(id) {
      const idx = queue.findIndex((n) => n.id === id);
      if (idx === -1) return false;
      queue.splice(idx, 1);
      logger.debug(`Nudge: cancelled`, { id });
      return true;
    },

    setPreferences(update) {
      prefs = { ...prefs, ...update };
      logger.info('Nudge: preferences updated', {
        enabled: prefs.enabled,
        maxPerHour: prefs.maxPerHour,
        quietHours: prefs.quietHoursStart
          ? `${prefs.quietHoursStart}–${prefs.quietHoursEnd}`
          : 'off',
      });
    },

    getPreferences() {
      return { ...prefs };
    },

    stop() {
      if (urgentTimer) {
        clearTimeout(urgentTimer);
        urgentTimer = null;
      }
      logger.info('Nudge: engine stopped');
    },
  };
}

// ---------------------------------------------------------------------------
// Intercom Wiring Helpers
// ---------------------------------------------------------------------------

/** Shape of intercom events consumed by the nudge wiring. */
interface IntercomEvent {
  userId: string;
  data: { summary?: string; error?: string; reason?: string; taskId?: string; agentId?: string };
}

/**
 * Wire the nudge engine to intercom events so that relevant system events
 * automatically generate nudges. Call this during boot after both the
 * nudge engine and intercom are initialized.
 *
 * @returns Unsubscribe function to tear down all listeners.
 */
export function wireNudgeToIntercom(
  nudgeEngine: NudgeEngine,
  intercom: { on(topic: string, handler: (event: unknown) => void): () => void },
): () => void {
  const unsubs: Array<() => void> = [];

  // Background task completed → nudge owner
  unsubs.push(
    intercom.on('task:completed', (raw) => {
      const event = raw as IntercomEvent;
      nudgeEngine.schedule({
        userId: event.userId,
        category: 'task_complete',
        content: event.data.summary
          ? `Background task completed: ${event.data.summary}`
          : 'A background task has completed.',
        priority: 'normal',
        deliverAfter: 0,
        metadata: {
          taskId: event.data.taskId,
          agentId: event.data.agentId,
        },
      });
    }),
  );

  // Background task failed → nudge owner (higher priority)
  unsubs.push(
    intercom.on('task:failed', (raw) => {
      const event = raw as IntercomEvent;
      nudgeEngine.schedule({
        userId: event.userId,
        category: 'task_failed',
        content: event.data.error
          ? `Background task failed: ${event.data.error}`
          : 'A background task has failed.',
        priority: 'urgent',
        deliverAfter: 0,
        metadata: {
          taskId: event.data.taskId,
          agentId: event.data.agentId,
        },
      });
    }),
  );

  // Sub-agent dismissed → low-priority info nudge
  unsubs.push(
    intercom.on('agent:dismissed', (raw) => {
      const event = raw as IntercomEvent;
      nudgeEngine.schedule({
        userId: event.userId,
        category: 'system',
        content: event.data.reason
          ? `Sub-agent dismissed: ${event.data.reason}`
          : 'A sub-agent has been dismissed.',
        priority: 'low',
        deliverAfter: 0,
        metadata: { agentId: event.data.agentId },
      });
    }),
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}

// ---------------------------------------------------------------------------
// Agent Tools
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: NudgeCategory[] = [
  'task_complete',
  'task_failed',
  'reminder',
  'check_in',
  'insight',
  'system',
  'software_update',
  'agent_initiated',
  'companion',
];

const VALID_PRIORITIES: OutboundPriority[] = ['urgent', 'normal', 'low'];

/**
 * Create agent tools for proactive nudge scheduling.
 *
 * Returns tools the agent can invoke during conversation to:
 *   - Send a proactive message (nudge) to a user
 *   - Schedule a delayed nudge (e.g. "remind in 30 minutes")
 *   - Check pending nudges
 */
export function createNudgeTools(nudgeEngine: NudgeEngine): Tool[] {
  const sendNudge: Tool = {
    name: 'send_nudge',
    description:
      'Send a proactive message (nudge) to a user. Use this when you want to reach out to a user without them asking first — for example, to share an insight, a reminder, or a check-in.',
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description:
            'Target user ID with channel prefix (e.g. "discord:12345", "friend:john", "web:default").',
        },
        content: {
          type: 'string',
          description: 'The message content to send to the user.',
        },
        category: {
          type: 'string',
          description:
            'Nudge category: reminder, check_in, insight, or agent_initiated. Defaults to agent_initiated.',
          enum: ['reminder', 'check_in', 'insight', 'agent_initiated'],
        },
        priority: {
          type: 'string',
          description: 'Priority level: urgent, normal, or low. Defaults to normal.',
          enum: ['urgent', 'normal', 'low'],
        },
        delayMinutes: {
          type: 'number',
          description:
            'Optional delay in minutes before delivering the nudge. 0 = deliver on next flush. Defaults to 0.',
        },
      },
      required: ['userId', 'content'],
    },
    async execute(args) {
      const userId = String(args.userId || '');
      const content = String(args.content || '');
      if (!userId) return 'Error: userId is required';
      if (!content) return 'Error: content is required';

      const rawCategory = String(args.category || 'agent_initiated');
      const category: NudgeCategory = VALID_CATEGORIES.includes(rawCategory as NudgeCategory)
        ? (rawCategory as NudgeCategory)
        : 'agent_initiated';

      const rawPriority = String(args.priority || 'normal');
      const priority: OutboundPriority = VALID_PRIORITIES.includes(rawPriority as OutboundPriority)
        ? (rawPriority as OutboundPriority)
        : 'normal';

      const delayMinutes = Number(args.delayMinutes) || 0;
      const deliverAfter = delayMinutes > 0 ? Date.now() + delayMinutes * 60_000 : 0;

      const id = nudgeEngine.schedule({
        userId,
        category,
        content,
        priority,
        deliverAfter,
      });

      if (delayMinutes > 0) {
        return `Nudge scheduled (id: ${id}). Will be delivered in ~${delayMinutes} minute(s), subject to user preferences.`;
      }
      return `Nudge queued (id: ${id}). Will be delivered on the next flush cycle, subject to user preferences.`;
    },
  };

  const checkPendingNudges: Tool = {
    name: 'check_pending_nudges',
    description:
      'Check how many nudges are currently pending delivery. Useful to avoid spamming the user.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute() {
      const pending = nudgeEngine.pending();
      if (pending.length === 0) {
        return 'No pending nudges.';
      }

      const summary = pending.map((n) => {
        const delay =
          n.deliverAfter > Date.now()
            ? ` (delayed until ${new Date(n.deliverAfter).toISOString()})`
            : '';
        return `- [${n.priority}] ${n.category} → ${n.userId}: "${n.content.slice(0, 60)}"${delay}`;
      });

      return `${pending.length} pending nudge(s):\n${summary.join('\n')}`;
    },
  };

  const cancelNudge: Tool = {
    name: 'cancel_nudge',
    description:
      'Cancel a pending nudge by its ID. Use when a nudge is no longer relevant before delivery.',
    parameters: {
      type: 'object',
      properties: {
        nudgeId: {
          type: 'string',
          description: 'The ID of the nudge to cancel (returned by send_nudge).',
        },
      },
      required: ['nudgeId'],
    },
    async execute(args) {
      const nudgeId = String(args.nudgeId || '');
      if (!nudgeId) return 'Error: nudgeId is required';

      const cancelled = nudgeEngine.cancel(nudgeId);
      return cancelled
        ? `Nudge ${nudgeId} cancelled successfully.`
        : `Nudge ${nudgeId} not found (may have already been delivered or expired).`;
    },
  };

  return [sendNudge, checkPendingNudges, cancelNudge];
}

// ---------------------------------------------------------------------------
// Companion Nudge System (re-exports)
// ---------------------------------------------------------------------------

export type { CompanionMood, CompanionNudgeOptions } from './companion.js';
export {
  createCompanionJobs,
  getCompanionTouchActivity,
} from './companion.js';
