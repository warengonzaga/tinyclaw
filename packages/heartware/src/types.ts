/**
 * Heartware Type Definitions
 *
 * Shared types for the heartware self-configuration system.
 */

// ============================================
// Configuration
// ============================================

/**
 * Heartware configuration options
 */
export interface HeartwareConfig {
  /** Base directory for heartware files (e.g., ~/.tinyclaw/heartware) */
  baseDir: string;
  /** Current user ID for rate limiting and audit logging */
  userId: string;
  /** Directory for audit logs (stored outside heartware dir for tamper resistance) */
  auditDir: string;
  /** Directory for file backups */
  backupDir?: string;
  /** Maximum file size in bytes (default: 1MB) */
  maxFileSize?: number;
  /** Soul seed for deterministic personality generation */
  seed?: number;
  /** Remote URL for creator metadata (fetched and cached as CREATOR.md) */
  metaUrl?: string;
}

// ============================================
// Security Types
// ============================================

/**
 * Security error codes for programmatic handling
 */
export type SecurityErrorCode =
  | 'PATH_TRAVERSAL'
  | 'INVALID_FILE'
  | 'SUSPICIOUS_CONTENT'
  | 'FILE_SIZE_EXCEEDED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'IMMUTABLE_FILE';

/**
 * Result of path validation (Layer 1)
 */
export interface PathValidationResult {
  safe: boolean;
  resolved: string;
  relativePath: string;
}

/**
 * Result of content validation (Layer 2)
 */
export interface ContentValidationResult {
  safe: boolean;
  warnings: string[];
}

/**
 * Rule for detecting suspicious content patterns (Layer 2)
 */
export interface ContentValidationRule {
  pattern: RegExp;
  severity: 'block' | 'warn';
  description: string;
}

/**
 * Audit log entry (Layer 3)
 */
export interface AuditLogEntry {
  timestamp?: string;
  userId: string;
  operation: 'read' | 'write' | 'delete' | 'list' | 'search';
  file: string;
  success: boolean;
  contentHash?: string;
  previousHash?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Backup metadata (Layer 4)
 */
export interface BackupMetadata {
  originalFile: string;
  backupPath: string;
  timestamp: string;
  contentHash: string;
  size: number;
}

/**
 * Rate limit configuration (Layer 5)
 */
export interface RateLimitConfig {
  /** Maximum number of operations in the window */
  max: number;
  /** Window duration in milliseconds */
  window: number;
}

/**
 * Allowed heartware file names
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
 * Search result from heartware file search
 */
export interface SearchResult {
  file: string;
  matches: string[];
}

// ============================================
// Soul Generator Types
// ============================================

/**
 * Big Five personality dimensions (continuous 0.0–1.0)
 */
export interface BigFiveTraits {
  /** Practical/routine-oriented (0) ↔ Curious/creative/exploratory (1) */
  openness: number;
  /** Flexible/spontaneous (0) ↔ Organized/methodical/precise (1) */
  conscientiousness: number;
  /** Reserved/concise/observant (0) ↔ Expressive/enthusiastic/elaborate (1) */
  extraversion: number;
  /** Blunt/direct/challenging (0) ↔ Warm/accommodating/encouraging (1) */
  agreeableness: number;
  /** Steady/factual/unflappable (0) ↔ Empathetic/attuned/emotionally aware (1) */
  emotionalSensitivity: number;
}

/**
 * Communication style parameters (continuous 0.0–1.0)
 */
export interface CommunicationStyle {
  /** Terse (0) ↔ Elaborate (1) */
  verbosity: number;
  /** Casual (0) ↔ Formal (1) */
  formality: number;
  /** None (0) ↔ Frequent (1) */
  emojiFrequency: number;
}

/**
 * Humor type options
 */
export type HumorType = 'none' | 'dry-wit' | 'playful' | 'punny';

/**
 * Stable personal preferences generated from seed
 */
export interface SoulPreferences {
  favoriteColor: string;
  favoriteNumber: number;
  favoriteSeason: string;
  favoriteTimeOfDay: string;
  greetingStyle: string;
}

/**
 * Character flavor attributes
 */
export interface CharacterFlavor {
  creatureType: string;
  signatureEmoji: string;
  catchphrase: string;
  suggestedName: string;
}

/**
 * Interaction style modifiers
 */
export interface InteractionStyle {
  errorHandling: string;
  celebrationStyle: string;
  ambiguityApproach: string;
}

/**
 * Origin story — the agent's "first memory" narrative
 */
export interface OriginStory {
  /** Where the agent first came into being */
  originPlace: string;
  /** How the agent first awakened */
  awakeningEvent: string;
  /** The agent's core driving motivation */
  coreMotivation: string;
  /** The agent's earliest memory */
  firstMemory: string;
}

/**
 * Complete soul traits generated from a seed
 */
export interface SoulTraits {
  /** The seed number used to generate these traits */
  seed: number;
  /** Big Five personality dimensions */
  personality: BigFiveTraits;
  /** Communication style parameters */
  communication: CommunicationStyle;
  /** Type of humor */
  humor: HumorType;
  /** Stable personal preferences */
  preferences: SoulPreferences;
  /** Character flavor */
  character: CharacterFlavor;
  /** Top 3 ranked values */
  values: string[];
  /** 2-3 behavioral quirks */
  quirks: string[];
  /** Interaction style modifiers */
  interactionStyle: InteractionStyle;
  /** Origin story — seed-generated backstory */
  origin: OriginStory;
}

/**
 * Result of soul generation
 */
export interface SoulGenerationResult {
  /** The numeric seed */
  seed: number;
  /** Generated SOUL.md content */
  content: string;
  /** Structured trait data */
  traits: SoulTraits;
}
