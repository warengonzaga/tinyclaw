/**
 * Heartware Backup System - Layer 4 Security
 *
 * Provides automatic backup and rollback functionality:
 * - Auto-backup before every write operation
 * - Timestamped versions for point-in-time recovery
 * - Automatic cleanup to prevent disk exhaustion
 * - Content hashing for integrity verification
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { computeContentHash } from './audit.js';
import type { BackupMetadata } from './types.js';

/**
 * Backup manager for heartware files
 *
 * Security properties:
 * - Every write is preceded by backup
 * - Timestamped versions enable point-in-time recovery
 * - Automatic cleanup prevents disk exhaustion
 * - Content hashes for integrity verification
 */
export class BackupManager {
  private backupDir: string;
  private maxBackups: number;

  constructor(heartwareDir: string, maxBackups: number = 50) {
    this.backupDir = join(heartwareDir, '.backups');
    this.maxBackups = maxBackups;

    // Create backup directory if it doesn't exist
    try {
      mkdirSync(this.backupDir, { recursive: true });
    } catch (_err) {
      // Directory might already exist - this is fine
    }
  }

  /**
   * Create backup of file before modification
   *
   * Returns backup metadata for audit logging, or null if file doesn't exist
   * (no backup needed for new files)
   */
  backup(filePath: string): BackupMetadata | null {
    // File doesn't exist yet - no backup needed
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      // Generate timestamped backup filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = basename(filePath);
      const backupFilename = `${filename}.${timestamp}.bak`;
      const backupPath = join(this.backupDir, backupFilename);

      // Read original content for hash
      const content = readFileSync(filePath, 'utf-8');
      const contentHash = computeContentHash(content);
      const stats = statSync(filePath);

      // Copy file to backup location
      copyFileSync(filePath, backupPath);

      // Cleanup old backups for this file
      this.cleanupOldBackups(filename);

      return {
        originalFile: filename,
        backupPath,
        timestamp,
        contentHash,
        size: stats.size,
      };
    } catch (err) {
      // Log error but don't block the operation
      console.error(`[BACKUP ERROR] Failed to backup ${filePath}:`, err);
      return null;
    }
  }

  /**
   * List all backups for a specific file, sorted by timestamp (newest first)
   */
  listBackups(filename: string): string[] {
    try {
      const files = readdirSync(this.backupDir);
      return files
        .filter((f) => f.startsWith(`${filename}.`) && f.endsWith('.bak'))
        .sort()
        .reverse(); // Most recent first
    } catch (_err) {
      return [];
    }
  }

  /**
   * Get backup metadata for a specific backup file
   */
  getBackupMetadata(backupFilename: string): BackupMetadata | null {
    try {
      const backupPath = join(this.backupDir, backupFilename);

      if (!existsSync(backupPath)) {
        return null;
      }

      const content = readFileSync(backupPath, 'utf-8');
      const stats = statSync(backupPath);

      // Extract timestamp from filename (format: filename.YYYY-MM-DDTHH-MM-SS-mmmZ.bak)
      const parts = backupFilename.split('.');
      const timestamp = parts[parts.length - 2]; // Second to last part

      return {
        originalFile: parts.slice(0, -2).join('.'), // Remove timestamp and .bak
        backupPath,
        timestamp,
        contentHash: computeContentHash(content),
        size: stats.size,
      };
    } catch (err) {
      console.error(`[BACKUP ERROR] Failed to get metadata for ${backupFilename}:`, err);
      return null;
    }
  }

  /**
   * Restore file content from a backup
   *
   * Returns the content from the backup file (caller is responsible for writing it)
   */
  restore(filename: string, backupFilename?: string): string {
    const backups = this.listBackups(filename);

    if (backups.length === 0) {
      throw new Error(`No backups found for ${filename}`);
    }

    // Use specified backup or most recent
    const toRestore = backupFilename || backups[0];
    const backupPath = join(this.backupDir, toRestore);

    if (!existsSync(backupPath)) {
      throw new Error(`Backup not found: ${toRestore}`);
    }

    // Read and return backup content
    return readFileSync(backupPath, 'utf-8');
  }

  /**
   * Clean up old backups, keeping only maxBackups most recent versions
   *
   * Called automatically after each backup to prevent disk exhaustion
   */
  private cleanupOldBackups(filename: string): void {
    const backups = this.listBackups(filename);

    // Not enough backups to clean up
    if (backups.length <= this.maxBackups) {
      return;
    }

    // Delete oldest backups
    const toDelete = backups.slice(this.maxBackups);
    for (const backup of toDelete) {
      try {
        unlinkSync(join(this.backupDir, backup));
      } catch (err) {
        console.error(`[BACKUP ERROR] Failed to delete old backup ${backup}:`, err);
      }
    }
  }

  /**
   * Get total number of backups for a file
   */
  getBackupCount(filename: string): number {
    return this.listBackups(filename).length;
  }

  /**
   * Get total size of all backups (in bytes)
   */
  getTotalBackupSize(): number {
    try {
      const files = readdirSync(this.backupDir);
      let totalSize = 0;

      for (const file of files) {
        const filePath = join(this.backupDir, file);
        const stats = statSync(filePath);
        totalSize += stats.size;
      }

      return totalSize;
    } catch (_err) {
      return 0;
    }
  }

  /**
   * Delete all backups for a specific file
   */
  deleteAllBackups(filename: string): number {
    const backups = this.listBackups(filename);
    let deleted = 0;

    for (const backup of backups) {
      try {
        unlinkSync(join(this.backupDir, backup));
        deleted++;
      } catch (err) {
        console.error(`[BACKUP ERROR] Failed to delete backup ${backup}:`, err);
      }
    }

    return deleted;
  }

  /**
   * Get backup directory path (for debugging/monitoring)
   */
  getBackupDir(): string {
    return this.backupDir;
  }
}
