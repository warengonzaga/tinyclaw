/**
 * Heartware Audit Logging - Layer 3 Security
 *
 * Provides comprehensive audit logging for all heartware operations:
 * - Tamper-resistant append-only writes
 * - Stored outside agent-accessible directories
 * - Content hashing for integrity verification
 * - Non-blocking failures (logs to console if file write fails)
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { AuditLogEntry } from './types.js';
import type { ShieldDecision } from '@tinyclaw/types';

/**
 * Audit logger for heartware operations
 *
 * Security properties:
 * - Append-only writes (harder to tamper with)
 * - Stored outside heartware directory (agent can't access)
 * - Non-blocking (failures don't prevent operations)
 * - Includes content hashes for integrity verification
 */
export class AuditLogger {
  private auditLogPath: string;

  constructor(auditDir: string) {
    // Store audit logs OUTSIDE heartware directory
    // This prevents the agent from tampering with logs
    this.auditLogPath = join(auditDir, 'heartware-audit.log');

    // Ensure audit directory exists
    try {
      mkdirSync(auditDir, { recursive: true });
    } catch (err) {
      // Directory might already exist - this is fine
    }
  }

  /**
   * Log an operation with all details
   *
   * Non-blocking: If logging fails, error is logged to console
   * but the original operation is not blocked
   */
  log(entry: AuditLogEntry): void {
    const logLine = JSON.stringify({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString()
    }) + '\n';

    try {
      // Append-only write with explicit append flag
      // This makes tampering harder than with regular write
      appendFileSync(this.auditLogPath, logLine, {
        encoding: 'utf-8',
        flag: 'a' // Append mode
      });
    } catch (err) {
      // CRITICAL: Audit logging failure should not block operations
      // but should be visible for monitoring
      console.error('[AUDIT ERROR] Failed to write audit log:', err);
      console.error('[AUDIT ERROR] Entry:', entry);
    }
  }

  /**
   * Log a successful operation
   */
  logSuccess(
    userId: string,
    operation: AuditLogEntry['operation'],
    file: string,
    contentHash?: string,
    previousHash?: string
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      userId,
      operation,
      file,
      success: true,
      contentHash,
      previousHash
    });
  }

  /**
   * Log a failed operation with error details
   */
  logFailure(
    userId: string,
    operation: AuditLogEntry['operation'],
    file: string,
    error: Error
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      userId,
      operation,
      file,
      success: false,
      errorCode: (error as any).code,
      errorMessage: error.message
    });
  }

  /**
   * Log with custom metadata
   */
  logWithMetadata(
    userId: string,
    operation: AuditLogEntry['operation'],
    file: string,
    success: boolean,
    metadata: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      userId,
      operation,
      file,
      success,
      metadata
    });
  }

  /**
   * Get audit log path (for debugging/monitoring)
   */
  getAuditLogPath(): string {
    return this.auditLogPath;
  }

  /**
   * Log a shield enforcement event.
   *
   * Records the decision, the matched threat, and the outcome
   * (e.g. 'blocked', 'approved', 'denied', 'logged').
   *
   * Non-blocking: same semantics as other audit log methods.
   */
  logShieldEvent(
    decision: ShieldDecision,
    outcome: 'blocked' | 'approved' | 'denied' | 'logged',
    userId?: string,
  ): void {
    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      type: 'shield',
      action: decision.action,
      outcome,
      scope: decision.scope,
      threatId: decision.threatId,
      fingerprint: decision.fingerprint,
      matchedOn: decision.matchedOn,
      matchValue: decision.matchValue,
      reason: decision.reason,
      userId: userId ?? 'unknown',
    }) + '\n';

    try {
      appendFileSync(this.auditLogPath, logLine, {
        encoding: 'utf-8',
        flag: 'a',
      });
    } catch (err) {
      console.error('[AUDIT ERROR] Failed to write shield audit log:', err);
    }
  }
}

/**
 * Compute SHA-256 hash of content for integrity verification
 *
 * This hash can be used to:
 * - Verify file hasn't been tampered with
 * - Detect if content changed between operations
 * - Provide forensic trail for security incidents
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Compute hash of multiple strings (for combined verification)
 */
export function computeCombinedHash(...contents: string[]): string {
  const combined = contents.join('');
  return computeContentHash(combined);
}

/**
 * Verify content matches expected hash
 */
export function verifyContentHash(content: string, expectedHash: string): boolean {
  const actualHash = computeContentHash(content);
  return actualHash === expectedHash;
}
