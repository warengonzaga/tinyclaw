import { logger } from './logger.js';
import type { Provider, Message, LLMResponse } from './types.js';
import type { SecretsManager } from './secrets/manager.js';

export interface OllamaConfig {
  apiKey?: string;
  secrets?: SecretsManager;
  model?: string;
  baseUrl?: string;
}

/**
 * Create an Ollama provider.
 *
 * API key resolution: uses `config.apiKey` if given, otherwise resolves
 * `provider.ollama.apiKey` from the SecretsManager at call time.
 */
export function createOllamaProvider(config: OllamaConfig): Provider {
  const baseUrl = config.baseUrl || 'https://ollama.com';
  const model = config.model || 'gpt-oss:120b-cloud';
  
  return {
    id: 'ollama-cloud',
    name: 'Ollama Cloud (gpt-oss:120b)',
    
    async chat(messages: Message[]): Promise<LLMResponse> {
      try {
        // Resolve API key: explicit value or secrets-engine lookup
        const apiKey = config.apiKey ?? (await config.secrets?.resolveProviderKey('ollama'));
        if (!apiKey) {
          throw new Error(
            'No API key available for Ollama. ' +
            'Store one with: store_secret key="provider.ollama.apiKey" value="sk-..."'
          );
        }

        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
          }),
        });
        
        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Debug: log raw API response to understand its structure
        logger.debug('Raw API response:', JSON.stringify(data).slice(0, 500));
        
        // Try multiple response formats (different APIs structure responses differently)
        const content = 
          data.message?.content ||      // Ollama format
          data.choices?.[0]?.message?.content ||  // OpenAI format
          data.response ||              // Simple format
          data.content ||               // Direct content
          data.text ||                  // Text format
          '';
        
        return {
          type: 'text',
          content,
        };
      } catch (error) {
        logger.error('Ollama provider error:', error);
        throw error;
      }
    },
    
    async isAvailable(): Promise<boolean> {
      try {
        const apiKey = config.apiKey ?? (await config.secrets?.resolveProviderKey('ollama'));
        if (!apiKey) return false;

        const response = await fetch(`${baseUrl}/api/tags`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });
        return response.ok;
      } catch {
        return false;
      }
    }
  };
}
