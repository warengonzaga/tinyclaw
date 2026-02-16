/**
 * Persistent security database for TinyClaw Web UI.
 *
 * Stores blocked IPs and recovery attempt tracking in a SQLite database
 * so that rate-limit / block state survives server restarts.
 *
 * Uses `bun:sqlite` — the same engine used by @tinyclaw/core for agent.db.
 */

import { Database as BunDatabase } from 'bun:sqlite'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlockedIPRow {
  ip: string
  blocked_at: number
  reason: string
  failed_attempts: number
}

export interface RecoveryAttemptRow {
  ip: string
  failed_attempts: number
  locked_until: number
  last_attempt_at: number
}

// ---------------------------------------------------------------------------
// Security Database
// ---------------------------------------------------------------------------

export class SecurityDatabase {
  private db: BunDatabase

  constructor(dbPath: string) {
    // Ensure directory exists
    try {
      mkdirSync(dirname(dbPath), { recursive: true })
    } catch {
      // Directory might already exist
    }

    this.db = new BunDatabase(dbPath)

    // Enable WAL mode for better concurrent-read performance
    this.db.exec('PRAGMA journal_mode = WAL')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_ips (
        ip TEXT PRIMARY KEY,
        blocked_at INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT 'max_recovery_attempts',
        failed_attempts INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS recovery_attempts (
        ip TEXT PRIMARY KEY,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER NOT NULL DEFAULT 0
      );
    `)
  }

  // -----------------------------------------------------------------------
  // Blocked IPs
  // -----------------------------------------------------------------------

  /** Check if an IP is permanently blocked. */
  isBlocked(ip: string): boolean {
    const row = this.db
      .query('SELECT 1 FROM blocked_ips WHERE ip = ?')
      .get(ip)
    return row !== null
  }

  /** Permanently block an IP address. */
  blockIP(ip: string, reason: string, failedAttempts: number): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO blocked_ips (ip, blocked_at, reason, failed_attempts)
         VALUES (?, ?, ?, ?)`
      )
      .run(ip, Date.now(), reason, failedAttempts)
  }

  /** Unblock an IP address (admin operation). */
  unblockIP(ip: string): void {
    this.db.query('DELETE FROM blocked_ips WHERE ip = ?').run(ip)
  }

  /** Get all blocked IPs. */
  getBlockedIPs(): BlockedIPRow[] {
    return this.db
      .query('SELECT ip, blocked_at, reason, failed_attempts FROM blocked_ips ORDER BY blocked_at DESC')
      .all() as BlockedIPRow[]
  }

  // -----------------------------------------------------------------------
  // Recovery Attempts
  // -----------------------------------------------------------------------

  /** Get the current recovery attempt record for an IP. */
  getRecoveryAttempts(ip: string): RecoveryAttemptRow | null {
    return (
      this.db
        .query('SELECT ip, failed_attempts, locked_until, last_attempt_at FROM recovery_attempts WHERE ip = ?')
        .get(ip) as RecoveryAttemptRow | null
    )
  }

  /** Record a failed recovery attempt for an IP. Returns the updated row. */
  recordFailure(ip: string): RecoveryAttemptRow {
    const now = Date.now()
    this.db
      .query(
        `INSERT INTO recovery_attempts (ip, failed_attempts, locked_until, last_attempt_at)
         VALUES (?, 1, 0, ?)
         ON CONFLICT(ip) DO UPDATE SET
           failed_attempts = failed_attempts + 1,
           last_attempt_at = ?`
      )
      .run(ip, now, now)

    return this.getRecoveryAttempts(ip)!
  }

  /** Set a lockout timestamp for an IP. */
  setLockout(ip: string, lockedUntil: number): void {
    this.db
      .query('UPDATE recovery_attempts SET locked_until = ? WHERE ip = ?')
      .run(lockedUntil, ip)
  }

  /** Reset recovery attempts on success. */
  resetAttempts(ip: string): void {
    this.db.query('DELETE FROM recovery_attempts WHERE ip = ?').run(ip)
  }

  /** Clean up stale attempt records older than the given age (ms). */
  cleanStaleAttempts(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs
    this.db
      .query('DELETE FROM recovery_attempts WHERE last_attempt_at < ? AND locked_until < ?')
      .run(cutoff, Date.now())
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Close the database connection. */
  close(): void {
    try {
      this.db.close()
    } catch {
      // Already closed or never opened
    }
  }
}
