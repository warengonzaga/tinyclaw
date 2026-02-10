/**
 * Secrets Module - Type Definitions
 *
 * Types for the TinyClaw secrets management system powered by
 * @wgtechlabs/secrets-engine. Provides encrypted, machine-bound
 * storage for API keys and other sensitive data.
 */

/**
 * Configuration for the SecretsManager
 */
export interface SecretsConfig {
  /** Explicit path to the secrets storage directory */
  readonly path?: string;
}

/**
 * Contract for the SecretsManager wrapper
 */
export interface SecretsManagerInterface {
  /** Store or overwrite a secret */
  store(key: string, value: string): Promise<void>;
  /** Check if a secret exists (no decryption) */
  check(key: string): Promise<boolean>;
  /** Retrieve a decrypted secret value, or null if missing */
  retrieve(key: string): Promise<string | null>;
  /** List secret key names matching an optional glob pattern */
  list(pattern?: string): Promise<string[]>;
  /** Convenience: resolve a provider API key by provider name */
  resolveProviderKey(providerName: string): Promise<string | null>;
  /** Close the underlying secrets engine */
  close(): void;
}

/**
 * Well-known key prefixes for structured secret storage.
 *
 * Provider API keys follow: `provider.<name>.apiKey`
 * Example: `provider.ollama.apiKey`, `provider.openai.apiKey`
 */
export const SECRET_KEY_PREFIXES = {
  provider: 'provider',
} as const;

/**
 * Build a provider API key following the naming convention
 */
export function buildProviderKeyName(providerName: string): string {
  return `${SECRET_KEY_PREFIXES.provider}.${providerName}.apiKey`;
}
