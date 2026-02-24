/**
 * Heartware Public API
 *
 * Tiny Claw's self-configuration workspace with security-first architecture.
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

// Security components (for advanced usage/testing)
export { AuditLogger, computeContentHash, verifyContentHash } from './audit.js';
export { BackupManager } from './backup.js';
// Errors
export {
  HeartwareSecurityError,
  isHeartwareSecurityError,
  isSecurityErrorCode,
} from './errors.js';
export {
  loadHeartwareContext,
  loadMemoryByDate,
  loadMemoryRange,
  loadShieldContent,
} from './loader.js';
// Core exports
export { HeartwareManager } from './manager.js';
export type { MetaFetchOptions } from './meta.js';
// Creator Meta
export {
  DEFAULT_META_URL,
  fetchCreatorMeta,
  loadCachedCreatorMeta,
  META_CACHE_FILE,
} from './meta.js';
export { RateLimiter } from './rate-limiter.js';
export {
  getAllowedFiles,
  getImmutableFiles,
  getMemoryFilePattern,
  isAllowedFile,
  isImmutableFile,
  validateContent,
  validateFileSize,
  validatePath,
} from './sandbox.js';
// Soul Generator
export {
  generateRandomSeed,
  generateSoul,
  generateSoulTraits,
  parseSeed,
  renderSoulMarkdown,
} from './soul-generator.js';

// Templates
export { getAllTemplates, getTemplate, hasTemplate } from './templates.js';
export { createHeartwareTools } from './tools.js';

// Types
export type {
  AllowedFile,
  AuditLogEntry,
  BackupMetadata,
  // Soul types
  BigFiveTraits,
  CharacterFlavor,
  CommunicationStyle,
  ContentValidationResult,
  ContentValidationRule,
  HeartwareConfig,
  HumorType,
  InteractionStyle,
  OriginStory,
  PathValidationResult,
  RateLimitConfig,
  SearchResult,
  SecurityErrorCode,
  SoulGenerationResult,
  SoulPreferences,
  SoulTraits,
} from './types.js';
