/**
 * Intercom — Lightweight Pub/Sub for Inter-Agent Communication
 *
 * Provides system-wide event notifications for:
 *   - Task lifecycle (queued, completed, failed)
 *   - Agent lifecycle (created, dismissed, revived)
 *   - Memory updates (updated, consolidated)
 *   - Blackboard activity (proposal, resolved)
 *
 * Features:
 *   - Topic-based subscriptions with unsubscribe callbacks
 *   - Wildcard subscriptions (listen to all events)
 *   - Bounded event history (ring buffer per topic)
 *   - Zero external dependencies
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntercomTopic =
  | 'task:queued'
  | 'task:completed'
  | 'task:failed'
  | 'agent:created'
  | 'agent:dismissed'
  | 'agent:revived'
  | 'memory:updated'
  | 'memory:consolidated'
  | 'blackboard:proposal'
  | 'blackboard:resolved'
  | 'nudge:scheduled'
  | 'nudge:delivered'
  | 'nudge:suppressed';

export interface IntercomMessage {
  topic: IntercomTopic;
  timestamp: number;
  userId: string;
  data: Record<string, unknown>;
}

export interface Intercom {
  /** Subscribe to a topic. Returns unsubscribe function. */
  on(topic: IntercomTopic, handler: (event: IntercomMessage) => void): () => void;
  /** Subscribe to all events (wildcard). Returns unsubscribe function. */
  onAny(handler: (event: IntercomMessage) => void): () => void;
  /** Emit an event to all subscribers. */
  emit(topic: IntercomTopic, userId: string, data?: Record<string, unknown>): void;
  /** Get recent events for a topic (last N). */
  recent(topic: IntercomTopic, limit?: number): IntercomMessage[];
  /** Get all recent events across all topics. */
  recentAll(limit?: number): IntercomMessage[];
  /** Clear all subscriptions and history. */
  clear(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HISTORY_LIMIT = 100;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createIntercom(historyLimit = DEFAULT_HISTORY_LIMIT): Intercom {
  /** Topic → handlers map */
  const handlers = new Map<IntercomTopic, Set<(event: IntercomMessage) => void>>();
  /** Wildcard handlers */
  const wildcardHandlers = new Set<(event: IntercomMessage) => void>();
  /** Topic → recent events (bounded ring buffer) */
  const history = new Map<IntercomTopic, IntercomMessage[]>();
  /** Global event history (all topics, in emission order) */
  const globalHistory: IntercomMessage[] = [];

  function getOrCreateHandlers(topic: IntercomTopic): Set<(event: IntercomMessage) => void> {
    let set = handlers.get(topic);
    if (!set) {
      set = new Set();
      handlers.set(topic, set);
    }
    return set;
  }

  function getOrCreateHistory(topic: IntercomTopic): IntercomMessage[] {
    let list = history.get(topic);
    if (!list) {
      list = [];
      history.set(topic, list);
    }
    return list;
  }

  return {
    on(topic: IntercomTopic, handler: (event: IntercomMessage) => void): () => void {
      const set = getOrCreateHandlers(topic);
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },

    onAny(handler: (event: IntercomMessage) => void): () => void {
      wildcardHandlers.add(handler);
      return () => {
        wildcardHandlers.delete(handler);
      };
    },

    emit(topic: IntercomTopic, userId: string, data: Record<string, unknown> = {}): void {
      const event: IntercomMessage = {
        topic,
        timestamp: Date.now(),
        userId,
        data,
      };

      // Store in per-topic history (ring buffer — drop oldest if over limit)
      const list = getOrCreateHistory(topic);
      list.push(event);
      if (list.length > historyLimit) {
        list.shift();
      }

      // Store in global history (for recentAll)
      globalHistory.push(event);
      if (globalHistory.length > historyLimit * 2) {
        globalHistory.splice(0, globalHistory.length - historyLimit);
      }

      // Notify topic-specific handlers
      const topicHandlers = handlers.get(topic);
      if (topicHandlers) {
        for (const handler of topicHandlers) {
          try {
            handler(event);
          } catch {
            // Swallow handler errors to prevent cascade failures
          }
        }
      }

      // Notify wildcard handlers
      for (const handler of wildcardHandlers) {
        try {
          handler(event);
        } catch {
          // Swallow handler errors
        }
      }
    },

    recent(topic: IntercomTopic, limit = 10): IntercomMessage[] {
      const list = history.get(topic);
      if (!list || list.length === 0) return [];
      return list.slice(-limit);
    },

    recentAll(limit = 10): IntercomMessage[] {
      // Return most recent events first (globalHistory is in emission order)
      const start = Math.max(0, globalHistory.length - limit);
      return globalHistory.slice(start).reverse();
    },

    clear(): void {
      handlers.clear();
      wildcardHandlers.clear();
      history.clear();
      globalHistory.length = 0;
    },
  };
}
