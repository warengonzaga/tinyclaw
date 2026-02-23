/**
 * Heartware Custom Error Types
 * Security-focused error handling for heartware operations
 */

import type { SecurityErrorCode } from './types.js';

/**
 * Custom error class for heartware security violations
 *
 * Design principles:
 * - Clear error codes for programmatic handling
 * - Detailed error messages for debugging
 * - Additional details without leaking sensitive paths
 * - Stack traces preserved for diagnostics
 */
export class HeartwareSecurityError extends Error {
  /**
   * Error code for programmatic handling
   */
  public readonly code: SecurityErrorCode;

  /**
   * Additional context (sanitized to avoid leaking sensitive info)
   */
  public readonly details?: Record<string, unknown>;

  constructor(code: SecurityErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HeartwareSecurityError';
    this.code = code;
    this.details = details;

    // Maintain proper stack trace for V8 engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HeartwareSecurityError);
    }
  }

  /**
   * Convert error to JSON for logging (excludes sensitive details)
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      // Only include non-sensitive details
      details: this.sanitizeDetails(this.details),
    };
  }

  /**
   * Sanitize details to prevent leaking absolute paths or sensitive info
   */
  private sanitizeDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!details) return undefined;

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(details)) {
      // Skip absolute paths
      if (key.includes('Path') && typeof value === 'string' && value.includes(':\\')) {
        continue;
      }
      sanitized[key] = value;
    }

    return sanitized;
  }
}

/**
 * Check if an error is a HeartwareSecurityError
 */
export function isHeartwareSecurityError(error: unknown): error is HeartwareSecurityError {
  return error instanceof HeartwareSecurityError;
}

/**
 * Check if an error is a specific security error code
 */
export function isSecurityErrorCode(error: unknown, code: SecurityErrorCode): boolean {
  return isHeartwareSecurityError(error) && error.code === code;
}
