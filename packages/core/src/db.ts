import { Database as BunDatabase } from 'bun:sqlite';
import { Database, Message } from './types.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export function createDatabase(path: string): Database {
  // Ensure directory exists
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (err) {
    // Directory might already exist
  }
  
  const db = new BunDatabase(path);
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_user_created ON messages(user_id, created_at);
    
    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, key)
    );
  `);
  
  const saveMessageStmt = db.prepare(`
    INSERT INTO messages (user_id, role, content, created_at)
    VALUES (?, ?, ?, ?)
  `);
  
  const getHistoryStmt = db.prepare(`
    SELECT role, content FROM messages
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  
  const saveMemoryStmt = db.prepare(`
    INSERT INTO memory (user_id, key, value, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  
  const getMemoryStmt = db.prepare(`
    SELECT key, value FROM memory
    WHERE user_id = ?
  `);

  return {
    saveMessage(userId: string, role: string, content: string): void {
      saveMessageStmt.run(userId, role, content, Date.now());
    },
    
    getHistory(userId: string, limit: number = 50): Message[] {
      const rows = getHistoryStmt.all(userId, limit) as Array<{role: string, content: string}>;
      return rows.reverse().map(row => ({
        role: row.role as Message['role'],
        content: row.content
      }));
    },
    
    saveMemory(userId: string, key: string, value: string): void {
      const now = Date.now();
      saveMemoryStmt.run(userId, key, value, now, now);
    },
    
    getMemory(userId: string): Record<string, string> {
      const rows = getMemoryStmt.all(userId) as Array<{key: string, value: string}>;
      const memory: Record<string, string> = {};
      for (const row of rows) {
        memory[row.key] = row.value;
      }
      return memory;
    },
    
    close(): void {
      db.close();
    }
  };
}
