/**
 * Purge Command
 *
 * Wipes all persisted TinyClaw state for a fresh install:
 *   - ~/.tinyclaw/ (config DB, agent DB, learning, heartware, audit)
 *   - Optionally ~/.secrets-engine/ when --force is used
 *
 * Safety: requires the user to type "goodbye <soul name> my tinyclaw friend" to confirm.
 *
 * Flags:
 *   --force   Also delete the secrets store (~/.secrets-engine/)
 *   --fresh   Re-run the setup wizard after purging
 *
 * Uses @clack/prompts for interactive confirmation.
 */

import { join } from 'path';
import { homedir } from 'os';
import { rm, access, readFile } from 'fs/promises';
import * as p from '@clack/prompts';
import { showBanner } from '../ui/banner.js';
import { theme } from '../ui/theme.js';
import { setLogMode } from '@tinyclaw/logger';
import { parseSeed, generateSoul } from '@tinyclaw/heartware';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function resolveDataDir(): string {
  return process.env.TINYCLAW_DATA_DIR || join(homedir(), '.tinyclaw');
}

function resolveSecretsDir(): string {
  return process.env.TINYCLAW_SECRETS_DIR || join(homedir(), '.secrets-engine');
}

/**
 * Check if a directory exists
 */
async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to read the soul name from the SEED.txt file.
 * Returns the suggested name if found, null otherwise.
 */
async function getSoulName(dataDir: string): Promise<string | null> {
  try {
    const seedPath = join(dataDir, 'heartware', 'SEED.txt');
    const raw = await readFile(seedPath, 'utf-8');
    const seed = parseSeed(raw.trim());
    const result = generateSoul(seed);
    return result.traits.character.suggestedName;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Purge flags
// ---------------------------------------------------------------------------

interface PurgeFlags {
  force: boolean;
  fresh: boolean;
  yes: boolean;
}

function parseFlags(args: string[]): PurgeFlags {
  return {
    force: args.includes('--force'),
    fresh: args.includes('--fresh'),
    yes: args.includes('--yes') || args.includes('-y'),
  };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * Run the purge command — wipe all TinyClaw data for a fresh install.
 */
export async function purgeCommand(args: string[] = []): Promise<void> {
  setLogMode('error');
  showBanner();

  const flags = parseFlags(args);
  const dataDir = resolveDataDir();
  const secretsDir = resolveSecretsDir();

  // --- Check if there's anything to purge -----------------------------

  const dataExists = await dirExists(dataDir);
  const secretsExist = await dirExists(secretsDir);

  if (!dataExists && (!flags.force || !secretsExist)) {
    p.intro(theme.brand('Purge'));
    p.log.info('Nothing to purge — TinyClaw hasn\'t been set up yet.');
    p.outro(
      'Run ' + theme.cmd('tinyclaw setup') + ' to get started.'
    );
    return;
  }

  // --- Show what will be deleted --------------------------------------

  p.intro(theme.brand('Purge — fresh install'));

  const targets: string[] = [];

  if (dataExists) {
    targets.push(`  ${theme.label('Data directory')}     ${theme.dim(dataDir)}`);
    targets.push(`    • config.db        ${theme.dim('(configuration database)')}`);
    targets.push(`    • agent.db         ${theme.dim('(messages, memory, sub-agents, metrics)')}`);
    targets.push(`    • learning/        ${theme.dim('(learned patterns)')}`);
    targets.push(`    • heartware/       ${theme.dim('(identity files + backups)')}`);
    targets.push(`    • audit/           ${theme.dim('(audit logs)')}`);
  }

  if (flags.force) {
    if (secretsExist) {
      targets.push('');
      targets.push(`  ${theme.label('Secrets store')}      ${theme.dim(secretsDir)}`);
      targets.push(`    • Encrypted API keys and tokens`);
    } else {
      targets.push('');
      targets.push(`  ${theme.dim('Secrets store not found — skipping')}`);
    }
  } else {
    targets.push('');
    targets.push(`  ${theme.dim('Secrets store')}       ${theme.dim('preserved (use --force to include)')}`);
  }

  p.log.warn(
    theme.error('This will permanently delete the following data:\n\n') +
    targets.join('\n')
  );

  // --- Type-to-confirm ------------------------------------------------

  // Build dynamic confirmation phrase using soul name
  const soulName = await getSoulName(dataDir);
  const confirmPhrase = soulName
    ? `goodbye ${soulName.toLowerCase()} my tinyclaw friend`
    : 'goodbye my tinyclaw friend';

  if (flags.yes) {
    p.log.info(theme.dim('Skipping confirmation (--yes)'));
  } else {
    const confirmation = await p.text({
      message: `Type ${theme.label(confirmPhrase)} to confirm purge`,
      placeholder: confirmPhrase,
      validate: (value) => {
        if (!value || value.trim().toLowerCase() !== confirmPhrase) {
          return `Type "${confirmPhrase}" to confirm, or press Ctrl+C to cancel`;
        }
      },
    });

    if (p.isCancel(confirmation)) {
      p.outro(theme.dim('Purge cancelled — nothing was deleted.'));
      return;
    }
  }

  // --- Purge ----------------------------------------------------------

  const purgeSpinner = p.spinner();
  purgeSpinner.start('Purging TinyClaw data');

  const deleted: string[] = [];
  const errors: string[] = [];

  // Delete data directory
  if (dataExists) {
    try {
      await rm(dataDir, { recursive: true, force: true });
      deleted.push('Data directory');
    } catch (err) {
      errors.push(`Data directory: ${String(err)}`);
    }
  }

  // Delete secrets (only with --force)
  if (flags.force && secretsExist) {
    try {
      await rm(secretsDir, { recursive: true, force: true });
      deleted.push('Secrets store');
    } catch (err) {
      errors.push(`Secrets store: ${String(err)}`);
    }
  }

  // --- Results --------------------------------------------------------

  if (errors.length > 0) {
    purgeSpinner.stop(theme.warn('Purge completed with errors'));
    for (const error of errors) {
      p.log.error(error);
    }
  } else {
    purgeSpinner.stop(theme.success('Purge complete'));
  }

  // Summary
  const summary: string[] = [];

  for (const item of deleted) {
    summary.push(`  ${theme.success('✓')} ${item} deleted`);
  }

  if (!flags.force && secretsExist) {
    summary.push(`  ${theme.dim('○')} Secrets store preserved`);
  }

  if (flags.force && deleted.includes('Secrets store')) {
    summary.push('');
    summary.push(
      theme.warn('  ⚠ Secrets were deleted — you\'ll need a new API key during setup.')
    );
  }

  p.log.info(summary.join('\n'));

  // --- Fresh mode: re-run setup ---------------------------------------

  if (flags.fresh) {
    p.log.step('Launching setup wizard...\n');
    const { setupCommand } = await import('./setup.js');
    await setupCommand();
    return;
  }

  p.outro(
    theme.success('Done!') + ' Run ' + theme.cmd('tinyclaw setup') + ' to reconfigure.'
  );
}
