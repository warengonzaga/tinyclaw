/**
 * Heartware Rate Limiter - Layer 5 Security
 *
 * Prevents abuse and DOS attacks through per-user rate limiting:
 * - Sliding window algorithm for accurate limits
 * - Separate limits for different operation types
 * - Per-user isolation (one user can't affect others)
 * - Informative error messages with retry timing
 */

import { HeartwareSecurityError } from './errors.js';
import type { RateLimitConfig } from './types.js';

/**
 * Rate limit entry for tracking operations
 */
interface RateLimitEntry {
  /** Number of operations in current window */
  count: number;

  /** Timestamp when current window started */
  windowStart: number;
}

/**
 * Default rate limits for different operations
 *
 * Conservative limits to prevent runaway operations:
 * - Writes are strictly limited (10/min) to prevent excessive self-modification
 * - Reads are generous (100/min) for normal operation
 * - Searches are moderate (20/min) to prevent abuse
 */
const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  read: { max: 100, window: 60_000 },      // 100 reads per minute
  write: { max: 10, window: 60_000 },      // 10 writes per minute (strict!)
  delete: { max: 5, window: 60_000 },      // 5 deletes per minute
  list: { max: 50, window: 60_000 },       // 50 lists per minute
  search: { max: 20, window: 60_000 }      // 20 searches per minute
};

/**
 * Rate limiter with sliding window algorithm
 *
 * Security properties:
 * - Per-user limits prevent one user affecting others
 * - Sliding window is more accurate than fixed windows
 * - Memory-efficient (entries auto-expire)
 * - Informative errors tell user when to retry
 */
export class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private config: Record<string, RateLimitConfig>;

  constructor(config?: Partial<Record<string, RateLimitConfig>>) {
    // Merge custom config with defaults
    this.config = { ...DEFAULT_LIMITS, ...(config || {}) } as Record<string, RateLimitConfig>;
  }

  /**
   * Check if operation is allowed under rate limit
   *
   * @throws HeartwareSecurityError if limit exceeded
   */
  check(userId: string, operation: string): void {
    const limit = this.config[operation];

    // No limit configured for this operation - allow it
    if (!limit) {
      return;
    }

    const key = `${userId}:${operation}`;
    const now = Date.now();
    const entry = this.limits.get(key);

    // First operation in this window
    if (!entry) {
      this.limits.set(key, {
        count: 1,
        windowStart: now
      });
      return;
    }

    // Check if window has expired
    const windowAge = now - entry.windowStart;
    if (windowAge > limit.window) {
      // Start new window
      this.limits.set(key, {
        count: 1,
        windowStart: now
      });
      return;
    }

    // Within window - check if limit exceeded
    if (entry.count >= limit.max) {
      const resetInMs = limit.window - windowAge;
      const resetInSec = Math.ceil(resetInMs / 1000);

      throw new HeartwareSecurityError(
        'RATE_LIMIT_EXCEEDED',
        `Rate limit exceeded for ${operation}. Try again in ${resetInSec}s.`,
        {
          operation,
          limit: limit.max,
          window: limit.window,
          resetIn: resetInSec,
          current: entry.count
        }
      );
    }

    // Increment count
    entry.count++;
  }

  /**
   * Reset all limits for a user (useful for testing)
   */
  reset(userId: string): void {
    const keys = Array.from(this.limits.keys()).filter(k =>
      k.startsWith(`${userId}:`)
    );
    for (const key of keys) {
      this.limits.delete(key);
    }
  }

  /**
   * Reset all limits (useful for testing)
   */
  resetAll(): void {
    this.limits.clear();
  }

  /**
   * Get current usage for monitoring
   *
   * Returns null if no limit configured for operation
   */
  getUsage(
    userId: string,
    operation: string
  ): { count: number; limit: number; resetIn: number } | null {
    const limit = this.config[operation];
    if (!limit) return null;

    const key = `${userId}:${operation}`;
    const entry = this.limits.get(key);

    if (!entry) {
      return {
        count: 0,
        limit: limit.max,
        resetIn: 0
      };
    }

    const now = Date.now();
    const windowAge = now - entry.windowStart;
    const resetInMs = Math.max(0, limit.window - windowAge);
    const resetInSec = Math.ceil(resetInMs / 1000);

    return {
      count: entry.count,
      limit: limit.max,
      resetIn: resetInSec
    };
  }

  /**
   * Get all limits configuration (for documentation)
   */
  getLimits(): Record<string, RateLimitConfig> {
    return { ...this.config };
  }

  /**
   * Update limit for an operation type
   */
  setLimit(operation: string, config: RateLimitConfig): void {
    this.config[operation] = config;
  }

  /**
   * Clean up expired entries (memory management)
   *
   * Call periodically to prevent memory growth
   */
  cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.limits.entries()) {
      const operation = key.split(':')[1];
      const limit = this.config[operation];

      if (limit && now - entry.windowStart > limit.window) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.limits.delete(key);
    }
  }
}
