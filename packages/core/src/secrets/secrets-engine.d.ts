/**
 * Type declarations for @wgtechlabs/secrets-engine
 *
 * The published package does not ship .d.ts files.
 * These declarations are derived from the source at:
 * https://github.com/wgtechlabs/secrets-engine
 */

declare module '@wgtechlabs/secrets-engine' {
  /** Storage location presets. */
  export type StorageLocation = 'home' | 'xdg';

  /** Options for SecretsEngine.open(). */
  export interface OpenOptions {
    /** Explicit absolute path to the storage directory. Highest priority. */
    readonly path?: string;
    /** Preset storage location. "xdg" resolves to XDG config dir. */
    readonly location?: StorageLocation;
  }

  /**
   * Secure, machine-bound secrets manager.
   *
   * AES-256-GCM encrypted, SQLite-backed, zero-friction.
   */
  export class SecretsEngine {
    private constructor();

    /**
     * Open or create a secrets store.
     *
     * Resolution priority:
     * 1. Explicit `path` option (highest)
     * 2. `location: "xdg"` → XDG config directory
     * 3. Home directory default → `~/.secrets-engine/`
     */
    static open(options?: OpenOptions): Promise<SecretsEngine>;

    /** Retrieve a decrypted secret value, or null if not found. */
    get(key: string): Promise<string | null>;

    /** Retrieve a decrypted secret, throwing KeyNotFoundError if missing. */
    getOrThrow(key: string): Promise<string>;

    /** Store an encrypted secret. */
    set(key: string, value: string): Promise<void>;

    /** Check if a key exists via HMAC lookup (no decryption). */
    has(key: string): Promise<boolean>;

    /** Remove a secret. Returns true if deleted, false if not found. */
    delete(key: string): Promise<boolean>;

    /** List key names, optionally filtered by glob (e.g. "openai.*"). */
    keys(pattern?: string): Promise<string[]>;

    /** Irreversibly delete the entire store, keyfile, and directory. */
    destroy(): Promise<void>;

    /** Close the database connection. Instance cannot be reused. */
    close(): Promise<void>;

    /** Number of secrets currently stored. */
    get size(): number;

    /** Absolute path to the storage directory. */
    get storagePath(): string;
  }

  /** Base error class for all SecretsEngine errors. */
  export abstract class SecretsEngineError extends Error {
    abstract readonly code: string;
  }

  /** Filesystem permissions too permissive. */
  export class SecurityError extends SecretsEngineError {
    readonly code: 'SECURITY_ERROR';
    readonly expectedPermission: string;
    readonly actualPermission: string;
    readonly path: string;
  }

  /** Database HMAC integrity check failed. */
  export class IntegrityError extends SecretsEngineError {
    readonly code: 'INTEGRITY_ERROR';
  }

  /** Requested key does not exist. */
  export class KeyNotFoundError extends SecretsEngineError {
    readonly code: 'KEY_NOT_FOUND';
  }

  /** Decryption of a stored entry failed. */
  export class DecryptionError extends SecretsEngineError {
    readonly code: 'DECRYPTION_ERROR';
    readonly keyHash?: string;
  }

  /** Storage directory or files cannot be initialized. */
  export class InitializationError extends SecretsEngineError {
    readonly code: 'INITIALIZATION_ERROR';
  }
}
