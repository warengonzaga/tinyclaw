/**
 * Event Bus — Lightweight Pub/Sub for Inter-Agent Communication
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

export type EventTopic =
  | 'task:queued'
  | 'task:completed'
  | 'task:failed'
  | 'agent:created'
  | 'agent:dismissed'
  | 'agent:revived'
  | 'memory:updated'
  | 'memory:consolidated'
  | 'blackboard:proposal'
  | 'blackboard:resolved';

export interface EventPayload {
  topic: EventTopic;
  timestamp: number;
  userId: string;
  data: Record<string, unknown>;
}

export interface EventBus {
  /** Subscribe to a topic. Returns unsubscribe function. */
  on(topic: EventTopic, handler: (event: EventPayload) => void): () => void;
  /** Subscribe to all events (wildcard). Returns unsubscribe function. */
  onAny(handler: (event: EventPayload) => void): () => void;
  /** Emit an event to all subscribers. */
  emit(topic: EventTopic, userId: string, data?: Record<string, unknown>): void;
  /** Get recent events for a topic (last N). */
  recent(topic: EventTopic, limit?: number): EventPayload[];
  /** Get all recent events across all topics. */
  recentAll(limit?: number): EventPayload[];
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

export function createEventBus(historyLimit = DEFAULT_HISTORY_LIMIT): EventBus {
  /** Topic → handlers map */
  const handlers = new Map<EventTopic, Set<(event: EventPayload) => void>>();
  /** Wildcard handlers */
  const wildcardHandlers = new Set<(event: EventPayload) => void>();
  /** Topic → recent events (bounded ring buffer) */
  const history = new Map<EventTopic, EventPayload[]>();
  /** Global event history (all topics, in emission order) */
  const globalHistory: EventPayload[] = [];
  /** Monotonic sequence counter for stable ordering when timestamps collide */
  let sequence = 0;

  function getOrCreateHandlers(topic: EventTopic): Set<(event: EventPayload) => void> {
    let set = handlers.get(topic);
    if (!set) {
      set = new Set();
      handlers.set(topic, set);
    }
    return set;
  }

  function getOrCreateHistory(topic: EventTopic): EventPayload[] {
    let list = history.get(topic);
    if (!list) {
      list = [];
      history.set(topic, list);
    }
    return list;
  }

  return {
    on(topic: EventTopic, handler: (event: EventPayload) => void): () => void {
      const set = getOrCreateHandlers(topic);
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },

    onAny(handler: (event: EventPayload) => void): () => void {
      wildcardHandlers.add(handler);
      return () => {
        wildcardHandlers.delete(handler);
      };
    },

    emit(topic: EventTopic, userId: string, data: Record<string, unknown> = {}): void {
      const event: EventPayload = {
        topic,
        timestamp: Date.now(),
        userId,
        data,
      };
      const seq = sequence++;

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

    recent(topic: EventTopic, limit = 10): EventPayload[] {
      const list = history.get(topic);
      if (!list || list.length === 0) return [];
      return list.slice(-limit);
    },

    recentAll(limit = 10): EventPayload[] {
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
