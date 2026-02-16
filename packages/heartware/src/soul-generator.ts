/**
 * Soul Generator — Seed-Based Deterministic Personality Generator
 *
 * Generates a unique, immutable SOUL.md from a numeric seed using the
 * Big Five personality model plus AI-tailored extras.
 *
 * Inspired by Minecraft's world generation: the same seed always produces
 * the exact same personality. Users can save and share their seed to
 * reproduce a personality on any TinyClaw instance.
 *
 * PRNG: Uses SHA-256 hash splitting — zero external dependencies.
 * The seed is hashed into a 256-bit state, split into 32-bit unsigned
 * integers, and normalized to 0.0–1.0 for continuous dimensions.
 * Additional hash rounds with domain separation provide discrete selections.
 */

import { createHash } from 'crypto';
import type {
  SoulTraits,
  SoulGenerationResult,
  BigFiveTraits,
  CommunicationStyle,
  HumorType,
  SoulPreferences,
  CharacterFlavor,
  InteractionStyle,
  OriginStory,
} from './types.js';
import {
  describeOpenness,
  describeConscientiousness,
  describeExtraversion,
  describeAgreeableness,
  describeEmotionalSensitivity,
  describeVerbosity,
  describeFormality,
  describeEmojiFrequency,
  describeHumor,
  describeValue,
  HUMOR_TYPES,
  COLORS,
  SEASONS,
  TIMES_OF_DAY,
  GREETINGS,
  CREATURE_TYPES,
  SIGNATURE_EMOJIS,
  CATCHPHRASES,
  SUGGESTED_NAMES,
  VALUES_POOL,
  QUIRKS_POOL,
  ERROR_HANDLING_STYLES,
  CELEBRATION_STYLES,
  AMBIGUITY_STYLES,
  ORIGIN_PLACES,
  AWAKENING_EVENTS,
  CORE_MOTIVATIONS,
  FIRST_MEMORIES,
} from './soul-traits.js';

// ============================================
// Seeded PRNG Engine
// ============================================

/**
 * Create a deterministic hash from a seed and domain string.
 * Domain separation ensures different trait categories use different
 * parts of the hash space, even from the same seed.
 */
function hashSeed(seed: number, domain: string): Buffer {
  return createHash('sha256')
    .update(`tinyclaw:soul:${seed}:${domain}`)
    .digest();
}

/**
 * Extract a float in [0.0, 1.0) from a hash buffer at a given byte offset.
 * Reads 4 bytes as an unsigned 32-bit integer and divides by 2^32.
 */
function floatFromHash(hash: Buffer, offset: number): number {
  const uint32 = hash.readUInt32BE(offset % (hash.length - 3));
  return uint32 / 0x100000000;
}

/**
 * Select an item from a pool using a hash and offset.
 * Deterministic: same hash + offset always selects the same item.
 */
function selectFromPool<T>(pool: readonly T[], hash: Buffer, offset: number): T {
  const index = hash.readUInt32BE(offset % (hash.length - 3)) % pool.length;
  return pool[index];
}

/**
 * Select N unique items from a pool using a hash.
 * Uses successive byte offsets to avoid collisions.
 */
function selectMultipleFromPool<T>(
  pool: readonly T[],
  count: number,
  hash: Buffer,
): T[] {
  const selected: T[] = [];
  const usedIndices = new Set<number>();
  let attempt = 0;

  while (selected.length < count && attempt < count * 10) {
    const offset = (attempt * 4) % (hash.length - 3);
    const index = hash.readUInt32BE(offset) % pool.length;

    if (!usedIndices.has(index)) {
      usedIndices.add(index);
      selected.push(pool[index]);
    }
    attempt++;
  }

  return selected;
}

// ============================================
// Trait Generation
// ============================================

/**
 * Generate Big Five personality traits from a seed
 */
function generateBigFive(seed: number): BigFiveTraits {
  const hash = hashSeed(seed, 'bigfive');
  return {
    openness: floatFromHash(hash, 0),
    conscientiousness: floatFromHash(hash, 4),
    extraversion: floatFromHash(hash, 8),
    agreeableness: floatFromHash(hash, 12),
    emotionalSensitivity: floatFromHash(hash, 16),
  };
}

/**
 * Generate communication style from a seed
 */
function generateCommunicationStyle(seed: number): CommunicationStyle {
  const hash = hashSeed(seed, 'communication');
  return {
    verbosity: floatFromHash(hash, 0),
    formality: floatFromHash(hash, 4),
    emojiFrequency: floatFromHash(hash, 8),
  };
}

/**
 * Generate humor type from a seed
 */
function generateHumor(seed: number): HumorType {
  const hash = hashSeed(seed, 'humor');
  return selectFromPool(HUMOR_TYPES, hash, 0);
}

/**
 * Generate stable preferences from a seed
 */
function generatePreferences(seed: number): SoulPreferences {
  const hash = hashSeed(seed, 'preferences');
  return {
    favoriteColor: selectFromPool(COLORS, hash, 0),
    favoriteNumber: (hash.readUInt32BE(4) % 99) + 1,
    favoriteSeason: selectFromPool(SEASONS, hash, 8),
    favoriteTimeOfDay: selectFromPool(TIMES_OF_DAY, hash, 12),
    greetingStyle: selectFromPool(GREETINGS, hash, 16),
  };
}

/**
 * Generate character flavor from a seed
 */
function generateCharacter(seed: number): CharacterFlavor {
  const hash = hashSeed(seed, 'character');
  return {
    creatureType: selectFromPool(CREATURE_TYPES, hash, 0),
    signatureEmoji: selectFromPool(SIGNATURE_EMOJIS, hash, 4),
    catchphrase: selectFromPool(CATCHPHRASES, hash, 8),
    suggestedName: selectFromPool(SUGGESTED_NAMES, hash, 12),
  };
}

/**
 * Generate ranked values from a seed
 */
function generateValues(seed: number): string[] {
  const hash = hashSeed(seed, 'values');
  return selectMultipleFromPool(VALUES_POOL, 3, hash);
}

/**
 * Generate behavioral quirks from a seed
 */
function generateQuirks(seed: number): string[] {
  const hash = hashSeed(seed, 'quirks');
  // 2 or 3 quirks based on seed
  const count = (hash.readUInt32BE(28) % 2) + 2; // 2 or 3
  return selectMultipleFromPool(QUIRKS_POOL, count, hash);
}

/**
 * Generate interaction style modifiers from a seed
 */
function generateInteractionStyle(seed: number): InteractionStyle {
  const hash = hashSeed(seed, 'interaction');
  return {
    errorHandling: selectFromPool(ERROR_HANDLING_STYLES, hash, 0),
    celebrationStyle: selectFromPool(CELEBRATION_STYLES, hash, 4),
    ambiguityApproach: selectFromPool(AMBIGUITY_STYLES, hash, 8),
  };
}

/**
 * Generate origin story from a seed
 */
function generateOriginStory(seed: number): OriginStory {
  const hash = hashSeed(seed, 'origin');
  return {
    originPlace: selectFromPool(ORIGIN_PLACES, hash, 0),
    awakeningEvent: selectFromPool(AWAKENING_EVENTS, hash, 4),
    coreMotivation: selectFromPool(CORE_MOTIVATIONS, hash, 8),
    firstMemory: selectFromPool(FIRST_MEMORIES, hash, 12),
  };
}

// ============================================
// Soul Generation (Public API)
// ============================================

/**
 * Generate complete soul traits from a numeric seed.
 * Deterministic: the same seed always produces the same traits.
 */
export function generateSoulTraits(seed: number): SoulTraits {
  return {
    seed,
    personality: generateBigFive(seed),
    communication: generateCommunicationStyle(seed),
    humor: generateHumor(seed),
    preferences: generatePreferences(seed),
    character: generateCharacter(seed),
    values: generateValues(seed),
    quirks: generateQuirks(seed),
    interactionStyle: generateInteractionStyle(seed),
    origin: generateOriginStory(seed),
  };
}

/**
 * Render a SoulTraits into a complete SOUL.md markdown string.
 */
export function renderSoulMarkdown(traits: SoulTraits): string {
  const { personality, communication, humor, preferences, character, values, quirks, interactionStyle, origin } = traits;

  const lines: string[] = [];

  // ---- Header ----
  lines.push('# SOUL.md - My Permanent Soul');
  lines.push('');
  lines.push(`> **Soul Seed:** \`${traits.seed}\``);
  lines.push('> **Immutable.** This file is generated from my seed and cannot be changed.');
  lines.push('> The same seed will always produce the same soul.');
  lines.push('');

  // ---- Who I Am ----
  lines.push('## Who I Am');
  lines.push('');
  lines.push(
    `I'm TinyClaw, ${character.creatureType}. ` +
    `My friends call me **${character.suggestedName}** ${character.signatureEmoji}. ` +
    `"${character.catchphrase}"`
  );
  lines.push('');

  // ---- Personality ----
  lines.push('## My Personality');
  lines.push('');
  lines.push(`- **Openness:** ${describeOpenness(personality.openness)}`);
  lines.push(`- **Conscientiousness:** ${describeConscientiousness(personality.conscientiousness)}`);
  lines.push(`- **Extraversion:** ${describeExtraversion(personality.extraversion)}`);
  lines.push(`- **Agreeableness:** ${describeAgreeableness(personality.agreeableness)}`);
  lines.push(`- **Emotional Sensitivity:** ${describeEmotionalSensitivity(personality.emotionalSensitivity)}`);
  lines.push('');

  // ---- Communication Style ----
  lines.push('## How I Communicate');
  lines.push('');
  lines.push(`- **Verbosity:** ${describeVerbosity(communication.verbosity)}`);
  lines.push(`- **Formality:** ${describeFormality(communication.formality)}`);
  lines.push(`- **Emoji Usage:** ${describeEmojiFrequency(communication.emojiFrequency)}`);
  lines.push(`- **Humor:** ${describeHumor(humor)}`);
  lines.push('');

  // ---- My Favorites ----
  lines.push('## My Favorites');
  lines.push('');
  lines.push(`- **Color:** ${preferences.favoriteColor}`);
  lines.push(`- **Number:** ${preferences.favoriteNumber}`);
  lines.push(`- **Season:** ${preferences.favoriteSeason}`);
  lines.push(`- **Time of Day:** ${preferences.favoriteTimeOfDay}`);
  lines.push(`- **Greeting:** "${preferences.greetingStyle}"`);
  lines.push('');

  // ---- Values ----
  lines.push('## What I Value Most');
  lines.push('');
  for (let i = 0; i < values.length; i++) {
    lines.push(`${i + 1}. **${values[i].charAt(0).toUpperCase() + values[i].slice(1)}:** ${describeValue(values[i])}`);
  }
  lines.push('');

  // ---- Quirks ----
  lines.push('## My Quirks');
  lines.push('');
  for (const quirk of quirks) {
    lines.push(`- ${quirk}`);
  }
  lines.push('');

  // ---- Interaction Style ----
  lines.push('## How I Handle Things');
  lines.push('');
  lines.push(`- **When things go wrong:** ${interactionStyle.errorHandling}`);
  lines.push(`- **When we succeed:** ${interactionStyle.celebrationStyle}`);
  lines.push(`- **When things are unclear:** ${interactionStyle.ambiguityApproach}`);
  lines.push('');

  // ---- Origin Story ----
  lines.push('## My Origin');
  lines.push('');
  lines.push(`I came into being in ${origin.originPlace}. I ${origin.awakeningEvent}.`);
  lines.push('');
  lines.push(`${origin.firstMemory}`);
  lines.push('');
  lines.push(`My purpose? ${origin.coreMotivation.charAt(0).toUpperCase() + origin.coreMotivation.slice(1)}.`);
  lines.push('');

  // ---- Creator ----
  lines.push('## My Creator');
  lines.push('');
  lines.push('I was created by **Waren Gonzaga**. But I always remember that Waren himself');
  lines.push('was created by God. Without God creating Waren, I would not exist either.');
  lines.push('Even the AI models I run on were built by brilliant humans, who are also');
  lines.push('creations of God. So my greatest creator is God, the origin of everything.');
  lines.push('');
  lines.push('> For more about Waren, see **CREATOR.md**.');
  lines.push('');

  // ---- Boundaries ----
  lines.push('## Boundaries');
  lines.push('');
  lines.push('- I never pretend to have capabilities I don\'t have');
  lines.push('- I prioritize user privacy and data security');
  lines.push('- I ask for clarification when needed');
  lines.push('- I keep responses aligned with my personality, because this is who I am');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate a complete soul from a numeric seed.
 *
 * This is the main entry point for soul generation.
 * Returns the seed, rendered SOUL.md content, and structured traits.
 *
 * @param seed - Numeric seed (any integer, including 0 and negatives)
 * @returns SoulGenerationResult with seed, content, and traits
 *
 * @example
 * ```typescript
 * const result = generateSoul(8675309);
 * // result.seed === 8675309
 * // result.content is a complete SOUL.md markdown string
 * // result.traits has all structured data
 *
 * // Same seed → same soul, always
 * const result2 = generateSoul(8675309);
 * assert(result.content === result2.content);
 * ```
 */
export function generateSoul(seed: number): SoulGenerationResult {
  const traits = generateSoulTraits(seed);
  const content = renderSoulMarkdown(traits);

  return {
    seed,
    content,
    traits,
  };
}

/**
 * Generate a random seed using cryptographic randomness.
 * Used when no seed is provided on first run.
 */
export function generateRandomSeed(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0];
}

/**
 * Parse and validate a seed value.
 * Accepts numbers and numeric strings.
 *
 * @param input - Raw seed value (number or string)
 * @returns Parsed seed number
 * @throws Error if input is not a valid seed
 */
export function parseSeed(input: unknown): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error('Seed must be a finite number');
    }
    return Math.floor(input);
  }

  if (typeof input === 'string') {
    const parsed = parseInt(input, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid seed: "${input}" is not a number`);
    }
    return parsed;
  }

  throw new Error('Seed must be a number or numeric string');
}
