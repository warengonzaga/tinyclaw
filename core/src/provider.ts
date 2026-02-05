import { logger } from './logger.js';
import type { Provider, Message, LLMResponse } from './types.js';

export interface OllamaConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export function createOllamaProvider(config: OllamaConfig): Provider {
  const baseUrl = config.baseUrl || 'https://ollama.com';
  const model = config.model || 'gpt-oss:120b-cloud';
  
  return {
    id: 'ollama-cloud',
    name: 'Ollama Cloud (gpt-oss:120b)',
    
    async chat(messages: Message[]): Promise<LLMResponse> {
      try {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
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
        const response = await fetch(`${baseUrl}/api/tags`, {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
          },
        });
        return response.ok;
      } catch {
        return false;
      }
    }
  };
}
