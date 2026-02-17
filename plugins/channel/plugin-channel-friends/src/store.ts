/**
 * Friends Invite Store
 *
 * Manages invite codes, friend sessions, and friend user records.
 * Uses a SQLite database (via Bun's built-in `bun:sqlite`) stored
 * in the Tiny Claw data directory.
 *
 * Each friend has:
 *   - username: permanent identifier, set by owner
 *   - nickname: display name, changeable by the friend
 *   - inviteCode: single-use, consumed on first use → sets session cookie
 *   - sessionToken: long-lived browser auth after invite is redeemed
 */

import { Database } from 'bun:sqlite';
import { logger } from '@tinyclaw/logger';

export interface FriendUser {
  username: string;
  nickname: string;
  inviteCode: string | null;
  sessionToken: string | null;
  createdAt: number;
  lastSeen: number;
}

/**
 * Generate a short, URL-safe invite code.
 * 8 chars from a base-62 alphabet — ~47 bits of entropy.
 */
export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Generate a cryptographic session token.
 * 32 hex chars — 128 bits of entropy.
 */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class InviteStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS friends (
        username      TEXT PRIMARY KEY,
        nickname      TEXT NOT NULL,
        invite_code   TEXT UNIQUE,
        session_token TEXT UNIQUE,
        created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        last_seen     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
    `);
    logger.info('Friends invite store ready');
  }

  /** Create a new friend with a fresh invite code. */
  createFriend(username: string, nickname?: string): FriendUser {
    const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    if (this.exists(sanitized)) {
      throw new Error(`A friend with username "${sanitized}" already exists`);
    }

    const displayName = nickname || username;
    const inviteCode = generateInviteCode();
    const now = Date.now();

    this.db.run(
      `INSERT INTO friends (username, nickname, invite_code, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?)`,
      [sanitized, displayName, inviteCode, now, now],
    );

    return {
      username: sanitized,
      nickname: displayName,
      inviteCode,
      sessionToken: null,
      createdAt: now,
      lastSeen: now,
    };
  }

  /** Look up a friend by username. */
  getFriend(username: string): FriendUser | null {
    const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const row = this.db
      .query(
        `SELECT username, nickname, invite_code, session_token, created_at, last_seen
         FROM friends WHERE username = ?`,
      )
      .get(sanitized) as Record<string, unknown> | null;

    if (!row) return null;
    return this.rowToFriend(row);
  }

  /** Look up a friend by their invite code. */
  getByInviteCode(code: string): FriendUser | null {
    const row = this.db
      .query(
        `SELECT username, nickname, invite_code, session_token, created_at, last_seen
         FROM friends WHERE invite_code = ?`,
      )
      .get(code) as Record<string, unknown> | null;

    if (!row) return null;
    return this.rowToFriend(row);
  }

  /** Look up a friend by their session token. */
  getBySessionToken(token: string): FriendUser | null {
    if (!token) return null;
    const row = this.db
      .query(
        `SELECT username, nickname, invite_code, session_token, created_at, last_seen
         FROM friends WHERE session_token = ?`,
      )
      .get(token) as Record<string, unknown> | null;

    if (!row) return null;
    return this.rowToFriend(row);
  }

  /**
   * Redeem an invite code — consumes the code and sets a session token.
   * Returns the session token on success, null if code is invalid.
   */
  redeemInvite(code: string): { sessionToken: string; friend: FriendUser } | null {
    const sessionToken = generateSessionToken();
    const now = Date.now();

    // Atomic: consume the invite code and set the session token in one statement
    const row = this.db
      .query(
        `UPDATE friends SET invite_code = NULL, session_token = ?, last_seen = ?
         WHERE invite_code = ? RETURNING username, nickname, invite_code, session_token, created_at, last_seen`,
      )
      .get(sessionToken, now, code) as Record<string, unknown> | null;

    if (!row) return null;

    return {
      sessionToken,
      friend: this.rowToFriend(row),
    };
  }

  /** Regenerate an invite code for an existing friend (invalidates old session). */
  regenerateInvite(username: string): string | null {
    const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const friend = this.getFriend(sanitized);
    if (!friend) return null;

    const newCode = generateInviteCode();

    // New code, clear session so they must re-authenticate
    this.db.run(
      `UPDATE friends SET invite_code = ?, session_token = NULL WHERE username = ?`,
      [newCode, sanitized],
    );

    return newCode;
  }

  /** Update a friend's nickname. */
  updateNickname(username: string, newNickname: string): boolean {
    const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const result = this.db.run(
      `UPDATE friends SET nickname = ? WHERE username = ?`,
      [newNickname, sanitized],
    );
    return result.changes > 0;
  }

  /** Touch last_seen timestamp. */
  touchLastSeen(username: string): void {
    const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    this.db.run(
      `UPDATE friends SET last_seen = ? WHERE username = ?`,
      [Date.now(), sanitized],
    );
  }

  /** Revoke a friend's access — clears session and invite code. */
  revokeFriend(username: string): boolean {
    const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const result = this.db.run(
      `UPDATE friends SET invite_code = NULL, session_token = NULL WHERE username = ?`,
      [sanitized],
    );
    return result.changes > 0;
  }

  /** List all friends. */
  listFriends(): FriendUser[] {
    const rows = this.db
      .query(
        `SELECT username, nickname, invite_code, session_token, created_at, last_seen
         FROM friends ORDER BY created_at ASC`,
      )
      .all() as Record<string, unknown>[];

    return rows.map((row) => this.rowToFriend(row));
  }

  /** Check if a username already exists. */
  exists(username: string): boolean {
    const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const row = this.db
      .query(`SELECT 1 FROM friends WHERE username = ?`)
      .get(sanitized);
    return row !== null;
  }

  private rowToFriend(row: Record<string, unknown>): FriendUser {
    return {
      username: row.username as string,
      nickname: row.nickname as string,
      inviteCode: (row.invite_code as string) || null,
      sessionToken: (row.session_token as string) || null,
      createdAt: row.created_at as number,
      lastSeen: row.last_seen as number,
    };
  }

  close(): void {
    this.db.close();
  }
}
