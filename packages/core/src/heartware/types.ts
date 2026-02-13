/**
 * Heartware Type Definitions
 * Security-first type system for TinyClaw's self-configuration workspace
 */

/**
 * Heartware configuration
 */
export interface HeartwareConfig {
  /** Base directory for heartware files (e.g., ~/.tinyclaw/heartware/) */
  baseDir: string;

  /** User identifier for rate limiting and audit logging */
  userId: string;

  /** Audit log directory (stored outside heartware for security) */
  auditDir: string;

  /** Backup directory for file versions */
  backupDir: string;

  /** Maximum file size in bytes (default: 1MB) */
  maxFileSize?: number;
}

/**
 * Result of path validation (Layer 1 Security)
 */
export interface PathValidationResult {
  /** Whether the path passed validation */
  safe: boolean;

  /** Absolute resolved path */
  resolved: string;

  /** Relative path from heartware base directory */
  relativePath: string;
}

/**
 * Content validation result (Layer 2 Security)
 */
export interface ContentValidationResult {
  /** Whether content passed validation */
  safe: boolean;

  /** Warning messages (non-blocking issues) */
  warnings: string[];
}

/**
 * Content validation rule
 */
export interface ContentValidationRule {
  /** Regex pattern to detect */
  pattern: RegExp;

  /** Severity level */
  severity: 'block' | 'warn';

  /** Human-readable description */
  description: string;
}

/**
 * Audit log entry (Layer 3 Security)
 */
export interface AuditLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;

  /** User identifier */
  userId: string;

  /** Operation type */
  operation: 'read' | 'write' | 'delete' | 'list' | 'search';

  /** File path (relative to heartware directory) */
  file: string;

  /** Operation success status */
  success: boolean;

  /** SHA-256 hash of new content (write operations only) */
  contentHash?: string;

  /** SHA-256 hash of previous content (write operations only) */
  previousHash?: string;

  /** Error code if operation failed */
  errorCode?: string;

  /** Error message if operation failed */
  errorMessage?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Backup metadata (Layer 4 Security)
 */
export interface BackupMetadata {
  /** Original file name */
  originalFile: string;

  /** Full path to backup file */
  backupPath: string;

  /** ISO 8601 timestamp of backup */
  timestamp: string;

  /** SHA-256 hash of backed up content */
  contentHash: string;

  /** File size in bytes */
  size: number;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum number of operations */
  max: number;

  /** Time window in milliseconds */
  window: number;
}

/**
 * Allowed heartware file names (whitelist)
 */
export type AllowedFile =
  | 'IDENTITY.md'
  | 'SOUL.md'
  | 'USER.md'
  | 'AGENTS.md'
  | 'TOOLS.md'
  | 'MEMORY.md'
  | 'BOOTSTRAP.md';

/**
 * Security error codes
 */
export type SecurityErrorCode =
  | 'PATH_TRAVERSAL'
  | 'INVALID_FILE'
  | 'SUSPICIOUS_CONTENT'
  | 'RATE_LIMIT_EXCEEDED'
  | 'FILE_SIZE_EXCEEDED';

/**
 * Search result entry
 */
export interface SearchResult {
  /** File containing matches */
  file: string;

  /** Matching lines */
  matches: string[];
}
