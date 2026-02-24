/**
 * Provider Registry
 *
 * Manages all available LLM providers (built-in + plugins) and maps
 * query complexity tiers to the appropriate provider. Supports
 * tier-based fallback: if the assigned provider for a tier is missing,
 * falls down through lower tiers to the ultimate fallback (Ollama).
 */

import type { Provider } from '@tinyclaw/types';
import type { QueryTier } from './classifier.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Maps each query tier to a provider ID. */
export interface ProviderTierConfig {
  simple?: string;
  moderate?: string;
  complex?: string;
  reasoning?: string;
}

export interface ProviderRegistry {
  /** Register a provider instance. */
  register(provider: Provider): void;
  /** Look up a provider by ID. */
  get(providerId: string): Provider | undefined;
  /** List all registered provider IDs. */
  ids(): string[];
  /** Get the best provider for a tier, with automatic fallback. */
  getForTier(tier: QueryTier): Provider;
}

export interface ProviderRegistryConfig {
  /** Initial providers to register (built-in + plugins). */
  providers: Provider[];
  /** Tier-to-provider-ID mapping from user config. */
  tierMapping: ProviderTierConfig;
  /** Provider ID that is always available as ultimate fallback. */
  fallbackProviderId: string;
}

// ---------------------------------------------------------------------------
// Tier fallback order (most complex → simplest)
// ---------------------------------------------------------------------------

const TIER_FALLBACK_ORDER: QueryTier[] = ['reasoning', 'complex', 'moderate', 'simple'];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProviderRegistry(config: ProviderRegistryConfig): ProviderRegistry {
  const providers = new Map<string, Provider>();
  const { tierMapping, fallbackProviderId } = config;

  // Register initial providers
  for (const provider of config.providers) {
    providers.set(provider.id, provider);
  }

  function getFallback(): Provider {
    const fallback = providers.get(fallbackProviderId);
    if (!fallback) {
      throw new Error(
        `Fallback provider "${fallbackProviderId}" is not registered. ` +
          'This should never happen — the built-in Ollama provider must be registered.',
      );
    }
    return fallback;
  }

  return {
    register(provider: Provider): void {
      providers.set(provider.id, provider);
    },

    get(providerId: string): Provider | undefined {
      return providers.get(providerId);
    },

    ids(): string[] {
      return [...providers.keys()];
    },

    getForTier(tier: QueryTier): Provider {
      // 1. Try the exact tier mapping
      const directId = tierMapping[tier];
      if (directId) {
        const direct = providers.get(directId);
        if (direct) return direct;
      }

      // 2. Fall down through tiers (from the requested tier downward)
      const startIdx = TIER_FALLBACK_ORDER.indexOf(tier);
      for (let i = startIdx + 1; i < TIER_FALLBACK_ORDER.length; i++) {
        const fallbackTier = TIER_FALLBACK_ORDER[i];
        const fallbackId = tierMapping[fallbackTier];
        if (fallbackId) {
          const fallback = providers.get(fallbackId);
          if (fallback) return fallback;
        }
      }

      // 3. Ultimate fallback
      return getFallback();
    },
  };
}
