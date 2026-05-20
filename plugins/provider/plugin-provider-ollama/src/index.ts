import type {
  ConfigManagerInterface,
  ProviderPlugin,
  SecretsManagerInterface,
  Tool,
} from '@tinyclaw/types';
import { createOllamaPairingTools } from './pairing.js';
import { createOllamaPluginProvider } from './provider.js';

const ollamaPlugin: ProviderPlugin = {
  id: '@tinyclaw/plugin-provider-ollama',
  name: 'Ollama',
  description: 'Local Ollama and custom Ollama Cloud models',
  type: 'provider',
  version: '2.0.0',

  async createProvider(secrets: SecretsManagerInterface, configManager: ConfigManagerInterface) {
    return createOllamaPluginProvider({
      secrets,
      mode: configManager.get<'local' | 'cloud'>('providers.ollama.mode') ?? 'local',
      model: configManager.get<string>('providers.ollama.model') ?? 'llama3.2:3b',
      baseUrl: configManager.get<string>('providers.ollama.baseUrl') ?? undefined,
    });
  },

  getPairingTools(secrets: SecretsManagerInterface, configManager: ConfigManagerInterface): Tool[] {
    return createOllamaPairingTools(secrets, configManager);
  },
};

export default ollamaPlugin;
