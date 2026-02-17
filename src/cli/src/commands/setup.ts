/**
 * Setup Command
 *
 * Interactive TUI wizard that walks the user through first-time
 * Tiny Claw configuration:
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

import { execSync } from 'child_process';
import * as p from '@clack/prompts';
import QRCode from 'qrcode';
import { createOllamaProvider } from '@tinyclaw/core';
import { SecretsManager, buildProviderKeyName } from '@tinyclaw/secrets';
import { ConfigManager } from '@tinyclaw/config';
import { parseSeed, generateRandomSeed, generateSoul } from '@tinyclaw/heartware';
import {
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  SECURITY_WARNING_TITLE,
  SECURITY_WARNING_BODY,
  SECURITY_LICENSE,
  SECURITY_WARRANTY,
  SECURITY_SAFETY_TITLE,
  SECURITY_SAFETY_PRACTICES,
  SECURITY_CONFIRM,
  defaultModelNote,
  TOTP_SETUP_TITLE,
  TOTP_SETUP_BODY,
  BACKUP_CODES_INTRO,
  BACKUP_CODES_HINT,
  RECOVERY_TOKEN_HINT,
  generateTotpSecret,
  createTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  generateRecoveryToken,
  sha256,
  BACKUP_CODES_COUNT,
} from '@tinyclaw/core';
import { setLogMode } from '@tinyclaw/logger';
import { showBanner } from '../ui/banner.js';
import { theme } from '../ui/theme.js';

/**
 * Copy text to the system clipboard.
 * Returns true on success, false if no supported clipboard tool is found.
 */
function copyToClipboard(text: string): boolean {
  try {
    const platform = process.platform;
    if (platform === 'win32') {
      execSync('clip', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    } else if (platform === 'darwin') {
      execSync('pbcopy', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    } else {
      // Linux — try xclip first, fall back to xsel
      try {
        execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      } catch {
        execSync('xsel --clipboard --input', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      }
    }
    return true;
  } catch {
    return false;
  }
}

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
  // Suppress debug/info noise during interactive setup
  setLogMode('error');

  showBanner();

  const secretsManager = await SecretsManager.create();
  const configManager = await ConfigManager.create();

  p.intro(theme.brand('Let\'s set up Tiny Claw'));

  // --- Security warning -----------------------------------------------

  p.note(
    theme.warn(SECURITY_WARNING_TITLE) + '\n\n' +
    SECURITY_WARNING_BODY + '\n\n' +
    theme.label(SECURITY_LICENSE) + '\n\n' +
    theme.label(SECURITY_WARRANTY) + '\n\n' +
    theme.label(SECURITY_SAFETY_TITLE) + '\n' +
    SECURITY_SAFETY_PRACTICES.map(item => `  • ${item}`).join('\n'),
    'Security',
  );

  const accepted = await p.confirm({
    message: SECURITY_CONFIRM,
    initialValue: false,
  });

  if (p.isCancel(accepted) || !accepted) {
    p.outro(theme.dim('Setup cancelled - risk not accepted.'));
    await cleanup(secretsManager, configManager);
    process.exit(1);
  }

  // --- Check existing configuration -----------------------------------

  const hasApiKey = await isAlreadyConfigured(secretsManager);
  const savedSeed = configManager.get('heartware.seed') as number | undefined;
  const hasSoulSeed = savedSeed !== undefined;
  const fullyConfigured = hasApiKey && hasSoulSeed;
  const partiallyConfigured = hasApiKey && !hasSoulSeed;

  if (fullyConfigured) {
    // Build existing config summary with soul info
    const soul = generateSoul(savedSeed!);
    const st = soul.traits;

    p.log.info(
      `Existing configuration found:\n` +
      `  Provider : ${theme.label('Ollama Cloud')}\n` +
      `  Model    : ${theme.label(DEFAULT_MODEL)}\n` +
      `  Base URL : ${theme.label(DEFAULT_BASE_URL)}\n` +
      `  API Key  : ${theme.dim('••••••••  (stored in secrets-engine)')}\n\n` +
      `  Soul seed:\n` +
      `  Seed     : ${theme.label(String(savedSeed))}\n` +
      `  Name     : ${theme.label(st.character.suggestedName)}\n` +
      `  Values   : ${theme.label(st.values.join(', '))}`
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

  if (partiallyConfigured) {
    p.log.warn(
      `Incomplete setup detected — API key is stored but no soul seed was set.\n` +
      `Resuming setup from the soul seed step.`
    );
  }

  // --- Steps 1-3: API key, validation, model (skip if partially configured) ---

  if (!partiallyConfigured) {

  // --- Step 1: API key ------------------------------------------------

  p.note(
    `${theme.label('Ollama Cloud')} is the default provider that powers Tiny Claw.\n` +
    'It\'s free to sign up and comes with a generous free tier,\n' +
    'so you can take your time exploring what Tiny Claw can do.\n\n' +
    theme.label('How to get your API key:') + '\n' +
    `  1. Go to ${theme.label('https://ollama.com')} and create a free account.\n` +
    '  2. Navigate to your account settings \u2192 API keys.\n' +
    '  3. Generate a new key and paste it below.\n\n' +
    theme.dim('Shout-out to the Ollama team for their generosity, making it\n' +
    'possible for anyone to try Tiny Claw at zero cost. Thank you! \ud83d\ude4f'),
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
    defaultModelNote(theme.label(DEFAULT_MODEL)),
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

  } // end skip for partial setup

  // --- Step 4: Soul seed ------------------------------------------------

  p.note(
    'Your Tiny Claw\'s personality is generated from a ' + theme.label('soul seed') + ',\n' +
    'just like Minecraft\'s world generation. The same seed always\n' +
    'produces the same personality \u2014 unique traits, quirks, and values.\n\n' +
    theme.label('Options:') + '\n' +
    '  \u2022 Enter a specific number to get a personality you can reproduce.\n' +
    '  \u2022 Leave blank to let Tiny Claw pick a random seed.\n\n' +
    theme.dim('Once set, the soul seed is permanent and cannot be changed.\n' +
    'Share your seed with others so they can create a companion just like yours!'),
    'Soul Seed',
  );

  const seedInput = await p.text({
    message: 'Enter a soul seed (leave blank for random)',
    placeholder: 'e.g. 8675309',
    validate: (value) => {
      if (!value || value.trim().length === 0) return; // blank is fine
      try {
        parseSeed(value.trim());
      } catch {
        return 'Seed must be a valid integer';
      }
    },
  });

  if (p.isCancel(seedInput)) {
    p.outro(theme.dim('Setup cancelled.'));
    await cleanup(secretsManager, configManager);
    return;
  }

  let soulSeed: number;
  if (seedInput && seedInput.trim().length > 0) {
    soulSeed = parseSeed(seedInput.trim());
  } else {
    soulSeed = generateRandomSeed();
  }

  // Preview loop — let user regenerate until happy
  let settled = false;
  while (!settled) {
    const preview = generateSoul(soulSeed);
    const t = preview.traits;

    p.log.info(
      `${theme.label('Seed')}     : ${soulSeed}\n` +
      `${theme.label('Name')}     : ${t.character.suggestedName}\n` +
      `${theme.label('Values')}   : ${t.values.join(', ')}`
    );

    const soulAction = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'keep', label: 'Keep this personality', hint: 'proceed with setup' },
        { value: 'regenerate', label: 'Regenerate', hint: 'roll a new random seed' },
        { value: 'custom', label: 'Enter a different seed', hint: 'type a specific number' },
      ],
    });

    if (p.isCancel(soulAction)) {
      p.outro(theme.dim('Setup cancelled.'));
      await cleanup(secretsManager, configManager);
      return;
    }

    if (soulAction === 'keep') {
      settled = true;
    } else if (soulAction === 'regenerate') {
      soulSeed = generateRandomSeed();
    } else if (soulAction === 'custom') {
      const newSeedInput = await p.text({
        message: 'Enter a soul seed',
        placeholder: 'e.g. 8675309',
        validate: (value) => {
          if (!value || value.trim().length === 0) return 'Please enter a number';
          try {
            parseSeed(value.trim());
          } catch {
            return 'Seed must be a valid integer';
          }
        },
      });

      if (p.isCancel(newSeedInput)) {
        p.outro(theme.dim('Setup cancelled.'));
        await cleanup(secretsManager, configManager);
        return;
      }

      soulSeed = parseSeed((newSeedInput as string).trim());
    }
  }

  // --- Step 5: TOTP setup ---------------------------------------------

  p.note(
    theme.label(TOTP_SETUP_TITLE) + '\n\n' +
    TOTP_SETUP_BODY + '\n\n' +
    'Two-factor authentication protects your Tiny Claw instance.\n' +
    'You\'ll need this to log in via the web dashboard.',
    'Two-Factor Authentication',
  );

  const totpSecret = generateTotpSecret();
  const totpUri = createTotpUri(totpSecret);

  // Render QR code in the terminal so users can scan with their authenticator app
  const qrText = await QRCode.toString(totpUri, { type: 'terminal', small: true });

  p.log.info(
    theme.label('Scan this QR code with your authenticator app:') + '\n\n' +
    qrText + '\n' +
    theme.label('Or enter the secret manually:') + '\n' +
    `  ${theme.cmd(totpSecret)}`
  );

  let totpVerified = false;
  while (!totpVerified) {
    const totpCode = await p.text({
      message: 'Enter the 6-digit code from your authenticator app',
      placeholder: '000000',
      validate: (value) => {
        if (!value || value.trim().length === 0) return 'Code is required';
        if (!/^\d{6}$/.test(value.trim())) return 'Code must be exactly 6 digits';
      },
    });

    if (p.isCancel(totpCode)) {
      p.outro(theme.dim('Setup cancelled.'));
      await cleanup(secretsManager, configManager);
      return;
    }

    // Use a spinner during async crypto verification to keep @clack's
    // state machine active (prevents the block() handler from intercepting
    // stdin events during the async gap).
    const verifySpinner = p.spinner();
    verifySpinner.start('Verifying TOTP code');

    try {
      const isValid = await verifyTotpCode(totpSecret, totpCode.trim());
      if (isValid) {
        totpVerified = true;
        verifySpinner.stop(theme.success('TOTP code verified'));
      } else {
        verifySpinner.stop(theme.warn('Invalid code'));
        p.log.warn('Make sure you entered the secret correctly and try again.');
      }
    } catch (err) {
      verifySpinner.stop(theme.error('Verification failed'));
      p.log.error(`TOTP verification error: ${String(err)}`);
      p.outro(theme.error('Setup failed. Please try again.'));
      await cleanup(secretsManager, configManager);
      process.exit(1);
    }
  }

  // --- Step 6: Generate backup codes & recovery token ------------------

  const backupCodes = generateBackupCodes(BACKUP_CODES_COUNT);
  const recoveryToken = generateRecoveryToken();

  // Break the long recovery token into readable chunks (40 chars per line)
  const tokenChunks = recoveryToken.match(/.{1,40}/g) || [recoveryToken];

  p.note(
    theme.warn(BACKUP_CODES_INTRO),
    'Recovery Information',
  );

  p.log.info(
    theme.label('Recovery Token:') + '\n' +
    tokenChunks.map(chunk => `  ${theme.cmd(chunk)}`).join('\n') + '\n\n' +
    theme.dim(RECOVERY_TOKEN_HINT)
  );

  p.log.info(
    theme.label('Backup Codes:') + '\n' +
    backupCodes.map((code, i) => `  ${String(i + 1).padStart(2, ' ')}. ${code}`).join('\n') + '\n\n' +
    theme.dim(BACKUP_CODES_HINT)
  );

  // Offer to copy recovery credentials to clipboard
  const copyMode = await p.select({
    message: 'How would you like to save your credentials?',
    options: [
      { value: 'all', label: 'Copy all at once', hint: 'recovery token + backup codes → clipboard' },
      { value: 'step', label: 'Copy one at a time', hint: 'recovery token first, then backup codes' },
    ],
  });

  if (p.isCancel(copyMode)) {
    p.outro(theme.dim('Setup cancelled — please save your codes before continuing.'));
    await cleanup(secretsManager, configManager);
    return;
  }

  if (copyMode === 'all') {
    const clipText =
      `Recovery Token:\n${recoveryToken}\n\n` +
      `Backup Codes:\n${backupCodes.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`;

    if (copyToClipboard(clipText)) {
      p.log.success('Copied to clipboard — paste it somewhere safe now!');
    } else {
      p.log.warn('Could not access clipboard. Please try again or restart setup.');
    }
  } else {
    // Step-by-step: recovery token first
    if (copyToClipboard(recoveryToken)) {
      p.log.success('Recovery token copied to clipboard.');
    } else {
      p.log.warn('Could not access clipboard.');
    }

    const copyCodesConfirm = await p.confirm({
      message: 'I\'ve saved the recovery token — copy backup codes next',
      initialValue: true,
    });

    // Handle cancellation or "no" — abort early
    if (p.isCancel(copyCodesConfirm) || !copyCodesConfirm) {
      p.outro(theme.dim('Setup cancelled — please save your codes before continuing.'));
      await cleanup(secretsManager, configManager);
      return;
    }

    // Now copy backup codes
    const codesText = backupCodes.map((c, i) => `${i + 1}. ${c}`).join('\n');
    if (copyToClipboard(codesText)) {
      p.log.success('Backup codes copied to clipboard — paste and save them now!');
    } else {
      p.log.warn('Could not access clipboard.');
    }
  }

  const savedCodes = await p.confirm({
    message: 'I stored my recovery token and backup codes',
    initialValue: false,
  });

  if (p.isCancel(savedCodes) || !savedCodes) {
    p.outro(theme.dim('Setup cancelled — please save your codes before continuing.'));
    await cleanup(secretsManager, configManager);
    return;
  }

  // --- Step 7: Persist ------------------------------------------------

  const persistSpinner = p.spinner();
  persistSpinner.start('Saving configuration');

  try {
    // Store provider config in config-engine (SQLite-backed)
    configManager.set('providers.starterBrain', {
      model: DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL,
      apiKeyRef: buildProviderKeyName(DEFAULT_PROVIDER),
    });

    // Store soul seed in config-engine
    configManager.set('heartware.seed', soulSeed);

    // Store owner authority — TOTP, backup codes, recovery token
    const ownerId = 'cli:owner';
    const backupCodeHashes = await Promise.all(backupCodes.map((code) => sha256(code)));
    const recoveryTokenHash = await sha256(recoveryToken);

    configManager.set('owner.ownerId', ownerId);
    configManager.set('owner.claimedAt', Date.now());
    await secretsManager.store('owner.totpSecret', totpSecret);
    configManager.set('owner.backupCodeHashes', backupCodeHashes);
    configManager.set('owner.backupCodesRemaining', backupCodeHashes.length);
    configManager.set('owner.recoveryTokenHash', recoveryTokenHash);
    configManager.set('owner.mfaConfiguredAt', Date.now());

    persistSpinner.stop(theme.success('Configuration saved'));
  } catch (err) {
    persistSpinner.stop(theme.error('Failed to save configuration'));
    p.log.error(String(err));
    p.outro(theme.error('Setup failed. Please try again.'));
    await cleanup(secretsManager, configManager);
    process.exit(1);
  }

  // --- Done -----------------------------------------------------------

  // Clear the terminal so sensitive data (TOTP secret, recovery token,
  // backup codes) is no longer visible in the scroll history.
  process.stdout.write('\x1Bc');

  showBanner();

  p.intro(theme.brand('Setup complete'));

  p.log.success(
    `${theme.label('Provider')}  : Ollama Cloud\n` +
    `${theme.label('Model')}     : ${DEFAULT_MODEL}\n` +
    `${theme.label('Base URL')}  : ${DEFAULT_BASE_URL}\n` +
    `${theme.label('API Key')}   : ${theme.dim('••••••••  (encrypted)')}\n` +
    `${theme.label('Soul Seed')} : ${soulSeed}`
  );

  p.log.info(
    theme.dim('Your recovery token, backup codes, and TOTP secret have been\n' +
    'cleared from the terminal for security. Make sure you saved them!')
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
