/**
 * Tests for the SecurityDatabase (security-db.ts).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecurityDatabase } from '../src/security-db';

describe('SecurityDatabase', () => {
  let db: SecurityDatabase;
  let dbPath: string;

  beforeEach(() => {
    const testDir = join(
      tmpdir(),
      `tinyclaw-security-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, 'security.db');
    db = new SecurityDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(dbPath, { force: true });
    } catch {}
    try {
      rmSync(dbPath + '-wal', { force: true });
    } catch {}
    try {
      rmSync(dbPath + '-shm', { force: true });
    } catch {}
  });

  // -----------------------------------------------------------------------
  // IP Blocking
  // -----------------------------------------------------------------------

  test('isBlocked returns false for unknown IP', () => {
    expect(db.isBlocked('1.2.3.4')).toBe(false);
  });

  test('blockIP and isBlocked', () => {
    db.blockIP('1.2.3.4', 'max_recovery_attempts', 10);
    expect(db.isBlocked('1.2.3.4')).toBe(true);
    expect(db.isBlocked('5.6.7.8')).toBe(false);
  });

  test('unblockIP removes the block', () => {
    db.blockIP('1.2.3.4', 'test', 5);
    expect(db.isBlocked('1.2.3.4')).toBe(true);
    db.unblockIP('1.2.3.4');
    expect(db.isBlocked('1.2.3.4')).toBe(false);
  });

  test('getBlockedIPs returns all blocked entries', () => {
    db.blockIP('1.1.1.1', 'reason1', 10);
    db.blockIP('2.2.2.2', 'reason2', 20);
    const blocked = db.getBlockedIPs();
    expect(blocked).toHaveLength(2);
    expect(blocked.map((r) => r.ip).sort()).toEqual(['1.1.1.1', '2.2.2.2']);
  });

  // -----------------------------------------------------------------------
  // Recovery Attempts
  // -----------------------------------------------------------------------

  test('getRecoveryAttempts returns null for unknown IP', () => {
    expect(db.getRecoveryAttempts('1.2.3.4')).toBeNull();
  });

  test('recordFailure increments counter', () => {
    const row1 = db.recordFailure('1.2.3.4');
    expect(row1.failed_attempts).toBe(1);

    const row2 = db.recordFailure('1.2.3.4');
    expect(row2.failed_attempts).toBe(2);

    const row3 = db.recordFailure('1.2.3.4');
    expect(row3.failed_attempts).toBe(3);
  });

  test('setLockout updates locked_until', () => {
    db.recordFailure('1.2.3.4');
    db.setLockout('1.2.3.4', Date.now() + 60_000);
    const row = db.getRecoveryAttempts('1.2.3.4');
    expect(row!.locked_until).toBeGreaterThan(Date.now());
  });

  test('resetAttempts clears the record', () => {
    db.recordFailure('1.2.3.4');
    db.recordFailure('1.2.3.4');
    db.resetAttempts('1.2.3.4');
    expect(db.getRecoveryAttempts('1.2.3.4')).toBeNull();
  });

  test('cleanStaleAttempts removes old entries', async () => {
    db.recordFailure('1.2.3.4');
    const row = db.getRecoveryAttempts('1.2.3.4');
    expect(row).not.toBeNull();

    // Wait briefly so last_attempt_at is in the past relative to a 1ms window
    await new Promise((r) => setTimeout(r, 50));

    // Clean with 1ms max age — entry is >50ms old now so it gets cleaned
    db.cleanStaleAttempts(1);
    expect(db.getRecoveryAttempts('1.2.3.4')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  test('data persists across database instances', () => {
    db.blockIP('10.0.0.1', 'test_persist', 5);
    db.recordFailure('10.0.0.2');
    db.recordFailure('10.0.0.2');
    db.close();

    // Re-open same database
    const db2 = new SecurityDatabase(dbPath);
    expect(db2.isBlocked('10.0.0.1')).toBe(true);
    expect(db2.getRecoveryAttempts('10.0.0.2')?.failed_attempts).toBe(2);
    db2.close();

    // Reassign for afterEach cleanup
    db = new SecurityDatabase(dbPath);
  });
});
