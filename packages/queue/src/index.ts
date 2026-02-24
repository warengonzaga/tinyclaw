/**
 * Session Queue
 *
 * Per-session locking that serializes messages for the same userId
 * while allowing different users to run in parallel. Uses a
 * promise-chain pattern — no external dependencies needed.
 */

export interface SessionQueue {
  enqueue<T>(sessionKey: string, task: () => Promise<T>): Promise<T>;
  pending(sessionKey: string): number;
  stop(): void;
}

export function createSessionQueue(): SessionQueue {
  const chains = new Map<string, Promise<unknown>>();
  const counts = new Map<string, number>();
  let stopped = false;

  return {
    enqueue<T>(sessionKey: string, task: () => Promise<T>): Promise<T> {
      if (stopped) {
        return Promise.reject(new Error('Queue has been stopped'));
      }

      const current = chains.get(sessionKey) ?? Promise.resolve();
      const count = (counts.get(sessionKey) ?? 0) + 1;
      counts.set(sessionKey, count);

      const next = current
        .then(
          () => task(),
          () => task(),
        )
        .finally(() => {
          const remaining = (counts.get(sessionKey) ?? 1) - 1;
          if (remaining <= 0) {
            counts.delete(sessionKey);
            chains.delete(sessionKey);
          } else {
            counts.set(sessionKey, remaining);
          }
        });

      chains.set(sessionKey, next);
      return next as Promise<T>;
    },

    pending(sessionKey: string): number {
      return counts.get(sessionKey) ?? 0;
    },

    stop(): void {
      stopped = true;
      chains.clear();
      counts.clear();
    },
  };
}
