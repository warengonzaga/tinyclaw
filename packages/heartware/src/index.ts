/**
 * Heartware Public API
 *
 * TinyClaw's self-configuration workspace with security-first architecture.
 *
 * @example
 * ```typescript
 * import { HeartwareManager, createHeartwareTools, loadHeartwareContext } from '@tinyclaw/core';
 *
 * // Initialize heartware
 * const config: HeartwareConfig = {
 *   baseDir: join(dataDir, 'heartware'),
 *   userId: 'user-123',
 *   auditDir: join(dataDir, 'audit'),
 *   backupDir: join(dataDir, 'heartware', '.backups')
 * };
 *
 * const manager = new HeartwareManager(config);
 * await manager.initialize();
 *
 * // Load context for agent
 * const context = await loadHeartwareContext(manager);
 *
 * // Create tools
 * const tools = createHeartwareTools(manager);
 * ```
 */

// Core exports
export { HeartwareManager } from './manager.js';
export { createHeartwareTools } from './tools.js';
export { loadHeartwareContext, loadMemoryByDate, loadMemoryRange } from './loader.js';

// Security components (for advanced usage/testing)
export { AuditLogger, computeContentHash, verifyContentHash } from './audit.js';
export { BackupManager } from './backup.js';
export { RateLimiter } from './rate-limiter.js';
export {
  validatePath,
  validateContent,
  validateFileSize,
  isAllowedFile,
  getAllowedFiles,
  getMemoryFilePattern
} from './sandbox.js';

// Templates
export { getTemplate, hasTemplate, getAllTemplates } from './templates.js';

// Errors
export {
  HeartwareSecurityError,
  isHeartwareSecurityError,
  isSecurityErrorCode
} from './errors.js';

// Types
export type {
  HeartwareConfig,
  PathValidationResult,
  ContentValidationResult,
  ContentValidationRule,
  AuditLogEntry,
  BackupMetadata,
  RateLimitConfig,
  AllowedFile,
  SecurityErrorCode,
  SearchResult
} from './types.js';
