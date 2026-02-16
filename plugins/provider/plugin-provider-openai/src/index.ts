/**
 * @tinyclaw/plugin-provider-openai
 *
 * OpenAI provider plugin for Tiny Claw. Adds GPT-4.1, GPT-4o, and other
 * OpenAI models as a provider option. Routes via the smart provider
 * routing system based on query complexity tiers.
 *
 * Pairing flow:
 *   1. Plugin is added to `plugins.enabled` (manually or via set_config)
 *   2. On next boot, pairing tools (`openai_pair`, `openai_unpair`) appear
 *   3. User provides API key via `openai_pair` → stored securely, tier mapping updated
 *   4. Agent calls `tinyclaw_restart` → supervisor respawns with new configuration
 */

import type {
  ProviderPlugin,
  SecretsManagerInterface,
  ConfigManagerInterface,
  Tool,
} from '@tinyclaw/types';
import { createOpenAIProvider } from './provider.js';
import { createOpenAIPairingTools } from './pairing.js';

const openaiPlugin: ProviderPlugin = {
  id: '@tinyclaw/plugin-provider-openai',
  name: 'OpenAI',
  description: 'OpenAI GPT models (GPT-4.1, GPT-4o, etc.)',
  type: 'provider',
  version: '0.1.0',

  async createProvider(secrets: SecretsManagerInterface) {
    return createOpenAIProvider({ secrets });
  },

  getPairingTools(
    secrets: SecretsManagerInterface,
    configManager: ConfigManagerInterface,
  ): Tool[] {
    return createOpenAIPairingTools(secrets, configManager);
  },
};

export default openaiPlugin;
