/**
 * Provider Orchestrator
 *
 * Routes incoming messages to the most appropriate LLM provider based on
 * query complexity classification. Uses an 8-dimension weighted scorer
 * to determine tier (simple/moderate/complex/reasoning), then resolves
 * the provider via the ProviderRegistry's tier mapping.
 *
 * The built-in Ollama provider is always the ultimate fallback — it handles
 * self-configuration tasks and steps in when other providers are unavailable.
 */

import { logger } from '@tinyclaw/logger';
import type { Provider } from '@tinyclaw/types';
import {
  classifyQuery,
  type ClassificationResult,
  type QueryTier,
} from './classifier.js';
import {
  createProviderRegistry,
  type ProviderRegistry,
  type ProviderTierConfig,
} from './provider-registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  /** Built-in provider (Ollama) — always available as fallback. */
  defaultProvider: Provider;
  /** Additional providers (from plugins). */
  providers?: Provider[];
  /** Tier-to-provider mapping from config. */
  tierMapping?: ProviderTierConfig;
}

export interface RouteResult {
  /** The selected provider for this message. */
  provider: Provider;
  /** Classification details (tier, score, confidence, signals). */
  classification: ClassificationResult;
}

export interface HealthRouteResult extends RouteResult {
  /** True if the primary provider was unavailable and we fell back. */
  failedOver: boolean;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class ProviderOrchestrator {
  private defaultProvider: Provider;
  private registry: ProviderRegistry;

  constructor(config: OrchestratorConfig) {
    this.defaultProvider = config.defaultProvider;

    // Build the list of all providers
    const allProviders = [config.defaultProvider, ...(config.providers ?? [])];

    // Default tier mapping: everything routes to the built-in provider
    const tierMapping: ProviderTierConfig = config.tierMapping ?? {
      simple: config.defaultProvider.id,
      moderate: config.defaultProvider.id,
      complex: config.defaultProvider.id,
      reasoning: config.defaultProvider.id,
    };

    this.registry = createProviderRegistry({
      providers: allProviders,
      tierMapping,
      fallbackProviderId: config.defaultProvider.id,
    });
  }

  /**
   * Classify a message and resolve the provider for its tier.
   * Does NOT check provider health — use `routeWithHealth` for that.
   */
  route(message: string): RouteResult {
    const classification = classifyQuery(message);
    const provider = this.registry.getForTier(classification.tier);
    return { provider, classification };
  }

  /**
   * Classify a message, resolve the provider, and verify it's available.
   * Falls back through tiers and ultimately to the default provider.
   */
  async routeWithHealth(message: string): Promise<HealthRouteResult> {
    const classification = classifyQuery(message);
    const primary = this.registry.getForTier(classification.tier);

    // Check if the primary provider is available
    try {
      const available = await primary.isAvailable();
      if (available) {
        return { provider: primary, classification, failedOver: false };
      }
    } catch {
      // isAvailable threw — treat as unavailable
    }

    logger.warn(
      `Provider "${primary.name}" unavailable for tier "${classification.tier}", attempting fallback`,
    );

    // Try falling through tiers
    const tierOrder: QueryTier[] = ['reasoning', 'complex', 'moderate', 'simple'];
    const startIdx = tierOrder.indexOf(classification.tier);

    for (let i = startIdx + 1; i < tierOrder.length; i++) {
      const fallback = this.registry.getForTier(tierOrder[i]);
      // Skip if it's the same provider we already tried
      if (fallback.id === primary.id) continue;

      try {
        const available = await fallback.isAvailable();
        if (available) {
          logger.info(
            `Fell back to "${fallback.name}" for tier "${classification.tier}"`,
          );
          return { provider: fallback, classification, failedOver: true };
        }
      } catch {
        // Continue to next fallback
      }
    }

    // Ultimate fallback: built-in Ollama
    if (this.defaultProvider.id !== primary.id) {
      logger.info(
        `All providers unavailable, falling back to default "${this.defaultProvider.name}"`,
      );
      return { provider: this.defaultProvider, classification, failedOver: true };
    }

    // Even the default provider is unavailable — return it anyway,
    // the agentLoop will surface the error naturally
    logger.error('All providers unavailable including default');
    return { provider: this.defaultProvider, classification, failedOver: true };
  }

  /** Get the provider registry for direct access. */
  getRegistry(): ProviderRegistry {
    return this.registry;
  }

  /** Get the built-in fallback provider (Ollama) directly. */
  getDefaultProvider(): Provider {
    return this.defaultProvider;
  }

  // -------------------------------------------------------------------------
  // Backward-compatible API (deprecated — use route/routeWithHealth instead)
  // -------------------------------------------------------------------------

  /**
   * @deprecated Use `routeWithHealth()` instead.
   * Selects the default provider after verifying availability.
   */
  async selectActiveProvider(): Promise<Provider> {
    const available = await this.defaultProvider.isAvailable();
    if (!available) {
      throw new Error(
        'Default provider (Ollama Cloud) is not available. Please check your API key.',
      );
    }
    logger.info(`Using default provider: ${this.defaultProvider.name}`);
    return this.defaultProvider;
  }

  /**
   * @deprecated Use `route()` instead.
   * Returns the default provider.
   */
  getActiveProvider(): Provider {
    return this.defaultProvider;
  }
}
