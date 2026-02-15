/**
 * Heartware Manager - Central Orchestration
 *
 * Coordinates all security layers for safe file operations:
 * - Layer 1 & 2: Path and content validation (sandbox)
 * - Layer 3: Audit logging
 * - Layer 4: Backup and rollback
 * - Layer 5: Rate limiting
 *
 * All operations go through these layers in the correct order
 */

import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { validatePath, validateContent, validateFileSize } from './sandbox.js';
import { AuditLogger, computeContentHash } from './audit.js';
import { RateLimiter } from './rate-limiter.js';
import { BackupManager } from './backup.js';
import { getTemplate } from './templates.js';
import { generateSoul, generateRandomSeed, parseSeed } from './soul-generator.js';
import { fetchCreatorMeta } from './meta.js';
import { logger } from '@tinyclaw/logger';
import type { HeartwareConfig, SearchResult } from './types.js';

/**
 * Heartware Manager
 *
 * Central coordinator for all heartware operations with full security stack.
 *
 * Security order:
 * - Read: Rate limit → Path validation → File read → Size validation → Audit
 * - Write: Rate limit → Path validation → Content validation → Backup → Write → Audit
 */
export class HeartwareManager {
  private config: HeartwareConfig;
  private auditLogger: AuditLogger;
  private rateLimiter: RateLimiter;
  private backupManager: BackupManager;

  constructor(config: HeartwareConfig) {
    this.config = config;
    this.auditLogger = new AuditLogger(config.auditDir);
    this.rateLimiter = new RateLimiter();
    this.backupManager = new BackupManager(config.baseDir);
  }

  /**
   * Initialize heartware directory structure
   *
   * Creates:
   * - Base heartware directory
   * - Memory subdirectory
   * - Backup directory (via BackupManager)
   * - Audit directory (via AuditLogger)
   * - Template files on first run
   * - Seed-based SOUL.md on first run
   */
  async initialize(): Promise<void> {
    try {
      // Create base directory
      await mkdir(this.config.baseDir, { recursive: true });

      // Create memory directory
      await mkdir(join(this.config.baseDir, 'memory'), { recursive: true });

      logger.info('Heartware initialized', { baseDir: this.config.baseDir }, { emoji: '✅' });

      // Check if first run (no IDENTITY.md)
      const identityPath = join(this.config.baseDir, 'IDENTITY.md');
      if (!existsSync(identityPath)) {
        // Create template files for first run
        await this.createTemplateFiles();

        // Generate soul from seed
        await this.generateSoulFromSeed();

        logger.info('First run detected - created template files and generated soul', undefined, { emoji: '📝' });
      }

      // Fetch/refresh creator metadata (non-blocking — uses cache when offline)
      this.fetchCreatorMetaBackground();
    } catch (err) {
      logger.error('Failed to initialize heartware:', err, { emoji: '❌' });
      throw err;
    }
  }

  /**
   * Read file with full security stack
   *
   * Security order:
   * 1. Rate limiting (fail fast)
   * 2. Path validation
   * 3. File read
   * 4. Size validation
   * 5. Audit logging
   */
  async read(filename: string): Promise<string> {
    try {
      // Layer 5: Rate limiting (FIRST - fail fast if over limit)
      this.rateLimiter.check(this.config.userId, 'read');

      // Layer 1: Path sandboxing
      const validation = validatePath(this.config.baseDir, filename);

      // Read file
      const content = await readFile(validation.resolved, 'utf-8');

      // Layer 2: File size validation
      validateFileSize(content.length, this.config.maxFileSize);

      // Layer 3: Audit logging (success)
      this.auditLogger.logSuccess(
        this.config.userId,
        'read',
        validation.relativePath
      );

      return content;
    } catch (err) {
      // Layer 3: Audit logging (failure)
      this.auditLogger.logFailure(
        this.config.userId,
        'read',
        filename,
        err as Error
      );
      throw err;
    }
  }

  /**
   * Write file with full security stack
   *
   * Security order:
   * 1. Rate limiting (fail fast)
   * 2. Path validation
   * 3. File size validation
   * 4. Content validation
   * 5. Backup (if file exists)
   * 6. Write file
   * 7. Audit logging
   *
   * This is the most security-critical operation
   */
  async write(filename: string, content: string): Promise<void> {
    try {
      // Layer 5: Rate limiting (FIRST - fail fast)
      this.rateLimiter.check(this.config.userId, 'write');

      // Layer 1: Path sandboxing (with write operation check)
      const validation = validatePath(this.config.baseDir, filename, 'write');
      validateFileSize(content.length, this.config.maxFileSize);

      // Layer 2: Content validation (CRITICAL - blocks suspicious content)
      const { warnings } = validateContent(content, filename);
      if (warnings.length > 0) {
        logger.warn('Content validation warnings:', { filename, warnings });
      }

      // Layer 4: Backup before write (if file exists)
      const backup = this.backupManager.backup(validation.resolved);
      const previousHash = backup?.contentHash;

      // Perform write
      await writeFile(validation.resolved, content, 'utf-8');

      // Compute new content hash
      const contentHash = computeContentHash(content);

      // Layer 3: Audit logging with hashes for integrity verification
      this.auditLogger.logSuccess(
        this.config.userId,
        'write',
        validation.relativePath,
        contentHash,
        previousHash
      );

      logger.info('Heartware file written', {
        file: validation.relativePath,
        size: content.length,
        backup: backup ? 'created' : 'none'
      }, { emoji: '✅' });
    } catch (err) {
      // Layer 3: Audit logging (failure)
      this.auditLogger.logFailure(
        this.config.userId,
        'write',
        filename,
        err as Error
      );
      throw err;
    }
  }

  /**
   * List all accessible heartware files
   *
   * Returns:
   * - All .md files in root directory
   * - All files in memory/ directory
   */
  async list(): Promise<string[]> {
    try {
      this.rateLimiter.check(this.config.userId, 'list');

      const files: string[] = [];

      // List root files (only .md files, skip hidden files)
      const rootFiles = await readdir(this.config.baseDir);
      files.push(...rootFiles.filter(f => f.endsWith('.md') && !f.startsWith('.')));

      // List memory directory
      const memoryDir = join(this.config.baseDir, 'memory');
      if (existsSync(memoryDir)) {
        const memoryFiles = await readdir(memoryDir);
        files.push(...memoryFiles.map(f => `memory/${f}`));
      }

      this.auditLogger.logSuccess(this.config.userId, 'list', 'heartware/');

      return files.sort();
    } catch (err) {
      this.auditLogger.logFailure(this.config.userId, 'list', 'heartware/', err as Error);
      throw err;
    }
  }

  /**
   * Search across all heartware files
   *
   * Performs case-insensitive full-text search
   * Returns matching lines from each file
   */
  async search(query: string): Promise<SearchResult[]> {
    try {
      this.rateLimiter.check(this.config.userId, 'search');

      const files = await this.list();
      const results: SearchResult[] = [];
      const queryLower = query.toLowerCase();

      for (const file of files) {
        try {
          const content = await this.read(file);
          const lines = content.split('\n');
          const matches = lines.filter(line =>
            line.toLowerCase().includes(queryLower)
          );

          if (matches.length > 0) {
            results.push({ file, matches });
          }
        } catch (err) {
          // Skip files that can't be read
          continue;
        }
      }

      this.auditLogger.logSuccess(
        this.config.userId,
        'search',
        'heartware/',
        undefined,
        undefined
      );

      return results;
    } catch (err) {
      this.auditLogger.logFailure(this.config.userId, 'search', query, err as Error);
      throw err;
    }
  }

  /**
   * Generate SOUL.md from a seed.
   * If config.seed is provided, uses that. Otherwise generates a random seed.
   * Writes both the SEED file and the generated SOUL.md.
   */
  private async generateSoulFromSeed(): Promise<void> {
    const seedPath = join(this.config.baseDir, 'SEED.txt');
    const soulPath = join(this.config.baseDir, 'SOUL.md');

    // Determine seed: config > existing SEED file > random
    let seed: number;

    if (this.config.seed !== undefined) {
      seed = parseSeed(this.config.seed);
    } else if (existsSync(seedPath)) {
      const raw = await readFile(seedPath, 'utf-8');
      seed = parseSeed(raw.trim());
    } else {
      seed = generateRandomSeed();
    }

    // Generate soul
    const result = generateSoul(seed);

    // Write SEED file (plain text, just the number)
    await writeFile(seedPath, String(result.seed), 'utf-8');

    // Write SOUL.md
    await writeFile(soulPath, result.content, 'utf-8');

    // Update IDENTITY.md defaults from soul character traits
    const identityPath = join(this.config.baseDir, 'IDENTITY.md');
    if (existsSync(identityPath)) {
      let identity = await readFile(identityPath, 'utf-8');
      identity = identity.replace(
        /\*\*Name:\*\*.*/,
        `**Name:** ${result.traits.character.suggestedName}`
      );
      identity = identity.replace(
        /\*\*Emoji:\*\*.*/,
        `**Emoji:** ${result.traits.character.signatureEmoji}`
      );
      identity = identity.replace(
        /\*\*Creature:\*\*.*/,
        `**Creature:** ${result.traits.character.creatureType}`
      );
      await writeFile(identityPath, identity, 'utf-8');
    }

    logger.info('Soul generated from seed', {
      seed: result.seed,
      name: result.traits.character.suggestedName,
      emoji: result.traits.character.signatureEmoji,
    }, { emoji: '🧬' });
  }

  /**
   * Read the stored soul seed.
   * Returns undefined if no seed file exists.
   */
  async getSeed(): Promise<number | undefined> {
    const seedPath = join(this.config.baseDir, 'SEED.txt');
    if (!existsSync(seedPath)) return undefined;

    try {
      const raw = await readFile(seedPath, 'utf-8');
      return parseSeed(raw.trim());
    } catch {
      return undefined;
    }
  }

  /**
   * Get base directory path
   */
  getBaseDir(): string {
    return this.config.baseDir;
  }

  /**
   * Fetch creator metadata in the background.
   * Non-blocking — failures are logged but don't prevent startup.
   */
  private fetchCreatorMetaBackground(): void {
    fetchCreatorMeta({
      url: this.config.metaUrl,
      baseDir: this.config.baseDir,
    }).catch((err) => {
      logger.warn('Creator meta fetch failed (non-critical)', { error: String(err) }, { emoji: '⚠️' });
    });
  }

  /**
   * Create template files for first run
   *
   * Creates all 8 heartware configuration files:
   * - IDENTITY.md
   * - SOUL.md
   * - FRIEND.md
   * - FRIENDS.md
   * - AGENTS.md
   * - TOOLS.md
   * - SHIELD.md
   * - MEMORY.md
   * - BOOTSTRAP.md
   */
  private async createTemplateFiles(): Promise<void> {
    const templateFiles = [
      'IDENTITY.md',
      'SOUL.md',
      'FRIEND.md',
      'FRIENDS.md',
      'AGENTS.md',
      'TOOLS.md',
      'SHIELD.md',
      'MEMORY.md',
      'BOOTSTRAP.md'
    ];

    for (const file of templateFiles) {
      const template = getTemplate(file);
      if (template) {
        const path = join(this.config.baseDir, file);
        if (!existsSync(path)) {
          await writeFile(path, template, 'utf-8');
        }
      }
    }
  }

  /**
   * Get heartware configuration (for debugging/monitoring)
   */
  getConfig(): HeartwareConfig {
    return { ...this.config };
  }

  /**
   * Get rate limiter (for testing/monitoring)
   */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /**
   * Get backup manager (for testing/monitoring)
   */
  getBackupManager(): BackupManager {
    return this.backupManager;
  }

  /**
   * Get audit logger (for testing/monitoring)
   */
  getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }
}
