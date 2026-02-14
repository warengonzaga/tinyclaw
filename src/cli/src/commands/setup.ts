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
 * are hardcoded - once the agent has its initial "brain" it can configure
 * everything else by itself.
 *
 * Uses @clack/prompts for a beautiful, lightweight terminal experience.
 */

import * as p from '@clack/prompts';
import { createOllamaProvider } from '@tinyclaw/core';
import { SecretsManager, buildProviderKeyName } from '@tinyclaw/secrets';
import { ConfigManager } from '@tinyclaw/config';
import {
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
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

  // --- Security warning -----------------------------------------------

  p.note(
    theme.warn('Security warning - please read carefully.') + '\n\n' +
    'TinyClaw is an open-source AI agent that runs on your machine.\n' +
    'It can read files, execute code, and perform actions when tools are enabled.\n' +
    'A malicious or poorly crafted prompt could trick the agent into\n' +
    'performing unintended or harmful operations.\n\n' +
    theme.label('This software is provided "AS IS", without warranty of any kind.') + '\n' +
    'The authors and contributors are not liable for any damages, data loss,\n' +
    'or security incidents arising from its use. You assume all risks.\n\n' +
    theme.label('Recommended safety practices:') + '\n' +
    '  • Run in a sandboxed or isolated environment when possible.\n' +
    '  • Never expose TinyClaw to the public internet without access control.\n' +
    '  • Keep secrets and sensitive files out of the agent\'s reachable paths.\n' +
    '  • Review enabled tools and permissions regularly.\n' +
    '  • Use the strongest available model for any bot with tool access.\n' +
    '  • Keep TinyClaw up to date for the latest security patches.',
    'Security',
  );

  const accepted = await p.confirm({
    message: 'I understand the risks and want to proceed',
    initialValue: false,
  });

  if (p.isCancel(accepted) || !accepted) {
    p.outro(theme.dim('Setup cancelled - risk not accepted.'));
    await cleanup(secretsManager, configManager);
    process.exit(1);
  }

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
      p.outro(theme.dim('Setup cancelled - existing config unchanged.'));
      await cleanup(secretsManager, configManager);
      return;
    }
  }

  // --- Step 1: API key ------------------------------------------------

  p.note(
    `${theme.label('Ollama Cloud')} is the default provider that powers TinyClaw.\n` +
    'It\'s free to sign up and comes with a generous free tier,\n' +
    'so you can take your time exploring what TinyClaw can do.\n\n' +
    theme.label('How to get your API key:') + '\n' +
    `  1. Go to ${theme.label('https://ollama.com')} and create a free account.\n` +
    '  2. Navigate to your account settings → API keys.\n' +
    '  3. Generate a new key and paste it below.\n\n' +
    theme.dim('Shout-out to the Ollama team for their generosity, making it\n' +
    'possible for anyone to try TinyClaw at zero cost. Thank you! 🙏'),
    'Default Provider',
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

  // --- Step 2: Validate API key ---------------------------------------

  const verifySpinner = p.spinner();
  verifySpinner.start('Validating your API key');

  let keyValid = false;

  try {
    // Temporarily store the key so the provider can resolve it
    await secretsManager.store(buildProviderKeyName(DEFAULT_PROVIDER), apiKey.trim());

    const ollamaProvider = createOllamaProvider({
      secrets: secretsManager,
      model: DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL,
    });

    keyValid = await ollamaProvider.isAvailable();

    if (keyValid) {
      verifySpinner.stop(theme.success('API key is valid'));
    } else {
      verifySpinner.stop(theme.warn('Could not verify API key'));
      p.log.warn(
        'The provider is not reachable. Your key has been saved anyway.\n' +
        'You can re-run ' + theme.cmd('tinyclaw setup') + ' to reconfigure.'
      );
    }
  } catch (err) {
    verifySpinner.stop(theme.warn('Verification failed'));
    p.log.warn(
      'Could not validate the key, but it has been saved.\n' +
      'Error: ' + String(err)
    );
  }

  // --- Step 3: Default model confirmation -----------------------------

  p.note(
    `Your default built-in model is ${theme.label(DEFAULT_MODEL)}.\n\n` +
    'This model is always available as your fallback. If your primary\n' +
    'model is down or hits a rate limit, TinyClaw automatically falls\n' +
    'back to this one so you\'re never left without a brain.\n\n' +
    'You can switch the default model anytime by asking the AI agent\n' +
    'during a conversation (e.g. "switch to gpt-oss:120b-cloud").',
    'Default Model',
  );

  const understood = await p.confirm({
    message: 'Got it, let\'s continue',
    initialValue: true,
  });

  if (p.isCancel(understood) || !understood) {
    p.outro(theme.dim('Setup cancelled.'));
    await cleanup(secretsManager, configManager);
    return;
  }

  // --- Step 4: Persist ------------------------------------------------

  const persistSpinner = p.spinner();
  persistSpinner.start('Saving configuration');

  try {
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
