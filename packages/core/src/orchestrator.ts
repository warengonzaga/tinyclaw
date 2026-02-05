import { logger } from './logger.js';
import type { Provider } from './types.js';

export interface OrchestratorConfig {
  defaultProvider: Provider;
  providers?: Provider[];
  preferredProviderId?: string;
}

export class ProviderOrchestrator {
  private defaultProvider: Provider;
  private providers: Map<string, Provider>;
  private preferredProviderId?: string;
  private activeProvider: Provider;

  constructor(config: OrchestratorConfig) {
    this.defaultProvider = config.defaultProvider;
    this.providers = new Map();
    this.preferredProviderId = config.preferredProviderId;
    
    // Register default provider
    this.providers.set(this.defaultProvider.id, this.defaultProvider);
    
    // Register additional providers
    if (config.providers) {
      for (const provider of config.providers) {
        this.providers.set(provider.id, provider);
      }
    }
    
    this.activeProvider = this.defaultProvider;
  }

  async selectActiveProvider(): Promise<Provider> {
    // If preferred provider is set, try to use it
    if (this.preferredProviderId) {
      const preferredProvider = this.providers.get(this.preferredProviderId);
      
      if (preferredProvider) {
        const available = await preferredProvider.isAvailable();
        
        if (available) {
          logger.info(`Using preferred provider: ${preferredProvider.name}`);
          this.activeProvider = preferredProvider;
          return this.activeProvider;
        } else {
          logger.warn(`Preferred provider ${preferredProvider.name} is offline, switching to default`);
        }
      }
    }
    
    // Fallback to default provider
    const defaultAvailable = await this.defaultProvider.isAvailable();
    
    if (!defaultAvailable) {
      throw new Error('Default provider (Ollama Cloud) is not available. Please check your API key.');
    }
    
    logger.info(`Using default provider: ${this.defaultProvider.name}`);
    this.activeProvider = this.defaultProvider;
    return this.activeProvider;
  }

  getActiveProvider(): Provider {
    return this.activeProvider;
  }

  async switchProvider(providerId: string): Promise<boolean> {
    const provider = this.providers.get(providerId);
    
    if (!provider) {
      logger.error(`Provider ${providerId} not found`);
      return false;
    }
    
    const available = await provider.isAvailable();
    
    if (available) {
      this.activeProvider = provider;
      logger.info(`Switched to provider: ${provider.name}`);
      return true;
    } else {
      logger.warn(`Provider ${provider.name} is not available, staying with ${this.activeProvider.name}`);
      return false;
    }
  }
}
