/**
 * Seed Command
 *
 * Displays the current soul seed for this Tiny Claw instance.
 * The seed deterministically generates the agent's personality.
 *
 * Usage:
 *   tinyclaw seed          Show key soul traits
 */

import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { generateSoul, parseSeed } from '@tinyclaw/heartware';
import { theme } from '../ui/theme.js';

/**
 * Show the current soul seed and generated personality summary.
 */
export async function seedCommand(): Promise<void> {
  const dataDir = process.env.TINYCLAW_DATA_DIR || join(homedir(), '.tinyclaw');
  const seedPath = join(dataDir, 'heartware', 'SEED.txt');

  if (!existsSync(seedPath)) {
    console.log();
    console.log(theme.error('  ✖ No soul seed found.'));
    console.log();
    console.log(`    Run ${theme.cmd('tinyclaw setup')} to initialize your Tiny Claw.`);
    console.log();
    return;
  }

  try {
    const raw = await readFile(seedPath, 'utf-8');
    const seed = parseSeed(raw.trim());
    const result = generateSoul(seed);
    const t = result.traits;

    console.log();
    console.log(`  🧬 ${theme.label('Soul Seed')}: ${seed}`);
    console.log();
    console.log(`  ${theme.label('Character')}`);
    console.log(`    Name      : ${t.character.suggestedName} ${t.character.signatureEmoji}`);
    console.log(`    Creature  : ${t.character.creatureType}`);
    console.log(`    Catchphrase: "${t.character.catchphrase}"`);
    console.log();
    console.log(`  ${theme.label('Personality (Big Five)')}`);
    console.log(`    Openness          : ${bar(t.personality.openness)} ${(t.personality.openness * 100).toFixed(0)}%`);
    console.log(`    Conscientiousness : ${bar(t.personality.conscientiousness)} ${(t.personality.conscientiousness * 100).toFixed(0)}%`);
    console.log(`    Extraversion      : ${bar(t.personality.extraversion)} ${(t.personality.extraversion * 100).toFixed(0)}%`);
    console.log(`    Agreeableness     : ${bar(t.personality.agreeableness)} ${(t.personality.agreeableness * 100).toFixed(0)}%`);
    console.log(`    Emot. Sensitivity : ${bar(t.personality.emotionalSensitivity)} ${(t.personality.emotionalSensitivity * 100).toFixed(0)}%`);
    console.log();
    console.log(`  ${theme.label('Communication')}`);
    console.log(`    Verbosity  : ${bar(t.communication.verbosity)} ${(t.communication.verbosity * 100).toFixed(0)}%`);
    console.log(`    Formality  : ${bar(t.communication.formality)} ${(t.communication.formality * 100).toFixed(0)}%`);
    console.log(`    Emoji      : ${bar(t.communication.emojiFrequency)} ${(t.communication.emojiFrequency * 100).toFixed(0)}%`);
    console.log(`    Humor      : ${t.humor}`);
    console.log();
    console.log(`  ${theme.label('Favorites')}`);
    console.log(`    Color   : ${t.preferences.favoriteColor}`);
    console.log(`    Number  : ${t.preferences.favoriteNumber}`);
    console.log(`    Season  : ${t.preferences.favoriteSeason}`);
    console.log(`    Time    : ${t.preferences.favoriteTimeOfDay}`);
    console.log(`    Greeting: "${t.preferences.greetingStyle}"`);
    console.log();
    console.log(`  ${theme.label('Values')}: ${t.values.join(', ')}`);
    console.log(`  ${theme.label('Quirks')}: ${t.quirks.length} behavioral patterns`);
    console.log();
    console.log(theme.dim('  This soul is immutable — the same seed always produces the same personality.'));
    console.log(theme.dim('  Share your seed with others so they can create a companion just like yours!'));
    console.log();
  } catch (err) {
    console.log();
    console.log(theme.error(`  ✖ Failed to read soul seed: ${(err as Error).message}`));
    console.log();
  }
}

/**
 * Render a simple bar chart for a 0.0-1.0 value.
 */
function bar(value: number, width: number = 20): string {
  const filled = Math.round(value * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
