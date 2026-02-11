/**
 * Setup Command
 *
 * Interactive TUI wizard that walks the user through first-time
 * TinyClaw configuration:
 *   1. Provider selection (Ollama Cloud)
 *   2. API key entry (masked)
 *   3. Model selection
 *   4. Base URL configuration
 *   5. Persist to secrets-engine + config-engine
 *   6. Verify provider connectivity
 *
 * Uses @clack/prompts for a beautiful, lightweight terminal experience.
 */

import * as p from '@clack/prompts';
import {
  SecretsManager,
  ConfigManager,
  createOllamaProvider,
  buildProviderKeyName,
} from '@tinyclaw/core';
import { showBanner } from '../ui/banner.js';
import { theme } from '../ui/theme.js';

/**
 * Check if the user has already completed setup
 */
async function isAlreadyConfigured(
  secrets: SecretsManager
): Promise<boolean> {
  return await secrets.check(buildProviderKeyName('ollama'));
}

/**
 * Run the interactive setup wizard
 */
export async function setupCommand(): Promise<void> {
  showBanner();

  const secretsManager = await SecretsManager.create();
  const configManager = await ConfigManager.create();

  p.intro(theme.brand('Let\'s set up TinyClaw'));

  // --- Check existing configuration -----------------------------------

  const alreadyConfigured = await isAlreadyConfigured(secretsManager);

  if (alreadyConfigured) {
    const currentModel = configManager.get<string>('providers.starterBrain.model') ?? 'llama3.2:3b';
    const currentUrl = configManager.get<string>('providers.starterBrain.baseUrl') ?? 'https://ollama.com';

    p.log.info(
      `Existing configuration found:\n` +
      `  Provider : ${theme.label('Ollama Cloud')}\n` +
      `  Model    : ${theme.label(currentModel)}\n` +
      `  Base URL : ${theme.label(currentUrl)}\n` +
      `  API Key  : ${theme.dim('••••••••  (stored in secrets-engine)')}`
    );

    const reconfigure = await p.confirm({
      message: 'Do you want to reconfigure?',
      initialValue: false,
    });

    if (p.isCancel(reconfigure) || !reconfigure) {
      p.outro(theme.dim('Setup cancelled — existing config unchanged.'));
      cleanup(secretsManager, configManager);
      return;
    }
  }

  // --- Step 1: Provider selection -------------------------------------

  const provider = await p.select({
    message: 'Select your AI provider',
    options: [
      {
        value: 'ollama',
        label: 'Ollama Cloud',
        hint: 'default — works with Ollama Cloud API',
      },
    ],
  });

  if (p.isCancel(provider)) {
    p.outro(theme.dim('Setup cancelled.'));
    cleanup(secretsManager, configManager);
    return;
  }

  // --- Step 2: API key ------------------------------------------------

  const apiKey = await p.password({
    message: 'Enter your Ollama Cloud API key',
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'API key is required';
      }
    },
  });

  if (p.isCancel(apiKey)) {
    p.outro(theme.dim('Setup cancelled.'));
    cleanup(secretsManager, configManager);
    return;
  }

  // --- Step 3: Model selection ----------------------------------------

  const model = await p.select({
    message: 'Select the default model',
    options: [
      { value: 'llama3.2:3b', label: 'llama3.2:3b', hint: 'recommended — fast and capable' },
      { value: 'llama3.2:1b', label: 'llama3.2:1b', hint: 'lightweight — lower resource usage' },
      { value: 'gpt-oss:120b-cloud', label: 'gpt-oss:120b-cloud', hint: 'powerful — cloud-hosted' },
    ],
  });

  if (p.isCancel(model)) {
    p.outro(theme.dim('Setup cancelled.'));
    cleanup(secretsManager, configManager);
    return;
  }

  // --- Step 4: Base URL -----------------------------------------------

  const baseUrl = await p.text({
    message: 'Ollama Cloud base URL',
    placeholder: 'https://ollama.com',
    defaultValue: 'https://ollama.com',
    validate: (value) => {
      if (!value) return;
      try {
        new URL(value);
      } catch {
        return 'Please enter a valid URL';
      }
    },
  });

  if (p.isCancel(baseUrl)) {
    p.outro(theme.dim('Setup cancelled.'));
    cleanup(secretsManager, configManager);
    return;
  }

  const resolvedUrl = (baseUrl as string).trim() || 'https://ollama.com';

  // --- Step 5: Persist ------------------------------------------------

  const persistSpinner = p.spinner();
  persistSpinner.start('Saving configuration');

  try {
    // Store API key in secrets-engine (AES-256-GCM encrypted)
    await secretsManager.store(buildProviderKeyName('ollama'), apiKey.trim());

    // Store provider config in config-engine (SQLite-backed)
    configManager.set('providers.starterBrain', {
      model: model as string,
      baseUrl: resolvedUrl,
      apiKeyRef: buildProviderKeyName('ollama'),
    });

    persistSpinner.stop(theme.success('Configuration saved'));
  } catch (err) {
    persistSpinner.stop(theme.error('Failed to save configuration'));
    p.log.error(String(err));
    p.outro(theme.error('Setup failed. Please try again.'));
    cleanup(secretsManager, configManager);
    process.exit(1);
  }

  // --- Step 6: Verify -------------------------------------------------

  const verifySpinner = p.spinner();
  verifySpinner.start('Verifying provider connectivity');

  try {
    const ollamaProvider = createOllamaProvider({
      secrets: secretsManager,
      model: model as string,
      baseUrl: resolvedUrl,
    });

    const available = await ollamaProvider.isAvailable();

    if (available) {
      verifySpinner.stop(theme.success('Provider is reachable'));
    } else {
      verifySpinner.stop(theme.warn('Provider is not reachable'));
      p.log.warn(
        'Could not connect to the provider. Your API key has been saved.\n' +
        'You can re-run ' + theme.cmd('tinyclaw setup') + ' to reconfigure.'
      );
    }
  } catch (err) {
    verifySpinner.stop(theme.warn('Provider verification failed'));
    p.log.warn(
      'Verification failed, but your configuration has been saved.\n' +
      'Error: ' + String(err)
    );
  }

  // --- Done -----------------------------------------------------------

  p.log.success(
    `${theme.label('Provider')}  : Ollama Cloud\n` +
    `${theme.label('Model')}     : ${model}\n` +
    `${theme.label('Base URL')}  : ${resolvedUrl}\n` +
    `${theme.label('API Key')}   : ${theme.dim('••••••••  (encrypted)')}`
  );

  p.outro(
    theme.success('You\'re all set!') + ' Run ' + theme.cmd('tinyclaw start') + ' to begin.'
  );

  cleanup(secretsManager, configManager);
}

/**
 * Gracefully close manager connections
 */
function cleanup(secrets: SecretsManager, config: ConfigManager): void {
  try { config.close(); } catch { /* ignore */ }
  try { secrets.close(); } catch { /* ignore */ }
}
