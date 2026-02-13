/**
 * Setup Command
 *
 * Interactive TUI wizard that walks the user through first-time
 * TinyClaw configuration:
 *   1. API key entry (masked)
 *   2. Persist to secrets-engine + config-engine
 *   3. Verify provider connectivity
 *
 * Ollama Cloud is the default (and only) provider. The model and base URL
 * are hardcoded — once the agent has its initial "brain" it can configure
 * everything else by itself.
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

// ---------------------------------------------------------------------------
// Hardcoded defaults — Ollama Cloud is the starter brain
// ---------------------------------------------------------------------------
const DEFAULT_PROVIDER = 'ollama';
const DEFAULT_MODEL = 'gpt-oss:120b-cloud';
const DEFAULT_BASE_URL = 'https://ollama.com';

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
    p.log.info(
      `Existing configuration found:\n` +
      `  Provider : ${theme.label('Ollama Cloud')}\n` +
      `  Model    : ${theme.label(DEFAULT_MODEL)}\n` +
      `  Base URL : ${theme.label(DEFAULT_BASE_URL)}\n` +
      `  API Key  : ${theme.dim('••••••••  (stored in secrets-engine)')}`
    );

    const reconfigure = await p.confirm({
      message: 'Do you want to reconfigure?',
      initialValue: false,
    });

    if (p.isCancel(reconfigure) || !reconfigure) {
      p.outro(theme.dim('Setup cancelled — existing config unchanged.'));
      await cleanup(secretsManager, configManager);
      return;
    }
  }

  // --- Step 1: API key ------------------------------------------------

  p.log.info(
    `Ollama Cloud will be your starter brain.\n` +
    `  Model    : ${theme.label(DEFAULT_MODEL)}\n` +
    `  Base URL : ${theme.label(DEFAULT_BASE_URL)}\n\n` +
    `Create a free account at ${theme.label('https://ollama.com')} to get your API key.`
  );

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
    await cleanup(secretsManager, configManager);
    return;
  }

  // --- Step 5: Persist ------------------------------------------------

  const persistSpinner = p.spinner();
  persistSpinner.start('Saving configuration');

  try {
    // Store API key in secrets-engine (AES-256-GCM encrypted)
    await secretsManager.store(buildProviderKeyName(DEFAULT_PROVIDER), apiKey.trim());

    // Store provider config in config-engine (SQLite-backed)
    configManager.set('providers.starterBrain', {
      model: DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL,
      apiKeyRef: buildProviderKeyName(DEFAULT_PROVIDER),
    });

    persistSpinner.stop(theme.success('Configuration saved'));
  } catch (err) {
    persistSpinner.stop(theme.error('Failed to save configuration'));
    p.log.error(String(err));
    p.outro(theme.error('Setup failed. Please try again.'));
    await cleanup(secretsManager, configManager);
    process.exit(1);
  }

  // --- Step 6: Verify -------------------------------------------------

  const verifySpinner = p.spinner();
  verifySpinner.start('Verifying provider connectivity');

  try {
    const ollamaProvider = createOllamaProvider({
      secrets: secretsManager,
      model: DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL,
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
    `${theme.label('Model')}     : ${DEFAULT_MODEL}\n` +
    `${theme.label('Base URL')}  : ${DEFAULT_BASE_URL}\n` +
    `${theme.label('API Key')}   : ${theme.dim('••••••••  (encrypted)')}`
  );

  p.outro(
    theme.success('You\'re all set!') + ' Run ' + theme.cmd('tinyclaw start') + ' to begin.'
  );

  await cleanup(secretsManager, configManager);
}

/**
 * Gracefully close manager connections
 */
async function cleanup(secrets: SecretsManager, config: ConfigManager): Promise<void> {
  try { config.close(); } catch { /* ignore */ }
  try { await secrets.close(); } catch { /* ignore */ }
}
