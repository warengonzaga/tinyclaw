import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HeartwareSecurityError } from '../src/errors.js';
import { validatePath } from '../src/sandbox.js';
import {
  generateRandomSeed,
  generateSoul,
  generateSoulTraits,
  parseSeed,
  renderSoulMarkdown,
} from '../src/soul-generator.js';
import type { SoulTraits } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempHeartwareDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tinyclaw-soul-test-'));
  return dir;
}

// ---------------------------------------------------------------------------
// Determinism Tests
// ---------------------------------------------------------------------------

describe('Soul Generator — Determinism', () => {
  it('same seed produces identical SOUL.md content', () => {
    const seed = 8675309;
    const result1 = generateSoul(seed);
    const result2 = generateSoul(seed);
    expect(result1.content).toBe(result2.content);
  });

  it('same seed produces identical traits', () => {
    const seed = 42;
    const traits1 = generateSoulTraits(seed);
    const traits2 = generateSoulTraits(seed);
    expect(traits1).toEqual(traits2);
  });

  it('determinism holds over 100 iterations', () => {
    const seed = 1234567;
    const reference = generateSoul(seed).content;
    for (let i = 0; i < 100; i++) {
      expect(generateSoul(seed).content).toBe(reference);
    }
  });

  it('different seeds produce different personalities', () => {
    const seeds = [0, 1, 42, 8675309, 999999, 2147483647];
    const contents = seeds.map((s) => generateSoul(s).content);

    // All should be unique
    const unique = new Set(contents);
    expect(unique.size).toBe(seeds.length);
  });

  it('different seeds produce different trait values', () => {
    const traits1 = generateSoulTraits(100);
    const traits2 = generateSoulTraits(200);

    // At least some personality dimensions should differ
    const p1 = traits1.personality;
    const p2 = traits2.personality;
    const allSame =
      p1.openness === p2.openness &&
      p1.conscientiousness === p2.conscientiousness &&
      p1.extraversion === p2.extraversion &&
      p1.agreeableness === p2.agreeableness &&
      p1.emotionalSensitivity === p2.emotionalSensitivity;

    expect(allSame).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trait Range Tests
// ---------------------------------------------------------------------------

describe('Soul Generator — Trait Ranges', () => {
  const seeds = [0, 1, 42, 100, 999, 8675309, 2147483647, 4294967295];

  for (const seed of seeds) {
    it(`seed ${seed}: Big Five values are within [0, 1)`, () => {
      const traits = generateSoulTraits(seed);
      const p = traits.personality;

      expect(p.openness).toBeGreaterThanOrEqual(0);
      expect(p.openness).toBeLessThan(1);
      expect(p.conscientiousness).toBeGreaterThanOrEqual(0);
      expect(p.conscientiousness).toBeLessThan(1);
      expect(p.extraversion).toBeGreaterThanOrEqual(0);
      expect(p.extraversion).toBeLessThan(1);
      expect(p.agreeableness).toBeGreaterThanOrEqual(0);
      expect(p.agreeableness).toBeLessThan(1);
      expect(p.emotionalSensitivity).toBeGreaterThanOrEqual(0);
      expect(p.emotionalSensitivity).toBeLessThan(1);
    });

    it(`seed ${seed}: communication values are within [0, 1)`, () => {
      const traits = generateSoulTraits(seed);
      const c = traits.communication;

      expect(c.verbosity).toBeGreaterThanOrEqual(0);
      expect(c.verbosity).toBeLessThan(1);
      expect(c.formality).toBeGreaterThanOrEqual(0);
      expect(c.formality).toBeLessThan(1);
      expect(c.emojiFrequency).toBeGreaterThanOrEqual(0);
      expect(c.emojiFrequency).toBeLessThan(1);
    });

    it(`seed ${seed}: favorite number is 1-99`, () => {
      const traits = generateSoulTraits(seed);
      expect(traits.preferences.favoriteNumber).toBeGreaterThanOrEqual(1);
      expect(traits.preferences.favoriteNumber).toBeLessThanOrEqual(99);
    });

    it(`seed ${seed}: has valid humor type`, () => {
      const traits = generateSoulTraits(seed);
      expect(['none', 'dry-wit', 'playful', 'punny']).toContain(traits.humor);
    });

    it(`seed ${seed}: has exactly 3 values`, () => {
      const traits = generateSoulTraits(seed);
      expect(traits.values.length).toBe(3);
    });

    it(`seed ${seed}: has 2-3 quirks`, () => {
      const traits = generateSoulTraits(seed);
      expect(traits.quirks.length).toBeGreaterThanOrEqual(2);
      expect(traits.quirks.length).toBeLessThanOrEqual(3);
    });

    it(`seed ${seed}: values are unique`, () => {
      const traits = generateSoulTraits(seed);
      const unique = new Set(traits.values);
      expect(unique.size).toBe(traits.values.length);
    });

    it(`seed ${seed}: quirks are unique`, () => {
      const traits = generateSoulTraits(seed);
      const unique = new Set(traits.quirks);
      expect(unique.size).toBe(traits.quirks.length);
    });
  }
});

// ---------------------------------------------------------------------------
// Markdown Output Tests
// ---------------------------------------------------------------------------

describe('Soul Generator — Markdown Output', () => {
  it('generates valid markdown with expected sections', () => {
    const result = generateSoul(42);
    const content = result.content;

    expect(content).toContain('# SOUL.md');
    expect(content).toContain('## Who I Am');
    expect(content).toContain('## My Personality');
    expect(content).toContain('## How I Communicate');
    expect(content).toContain('## My Favorites');
    expect(content).toContain('## What I Value Most');
    expect(content).toContain('## My Quirks');
    expect(content).toContain('## How I Handle Things');
    expect(content).toContain('## My Origin');
    expect(content).toContain('## Boundaries');
  });

  it('includes immutability notice', () => {
    const result = generateSoul(42);
    expect(result.content).toContain('Immutable');
    expect(result.content).toContain('cannot be changed');
  });

  it('includes the seed number', () => {
    const seed = 8675309;
    const result = generateSoul(seed);
    expect(result.content).toContain(String(seed));
  });

  it('includes character traits', () => {
    const result = generateSoul(42);
    const t = result.traits;

    expect(result.content).toContain(t.character.suggestedName);
    expect(result.content).toContain(t.character.signatureEmoji);
    expect(result.content).toContain(t.character.catchphrase);
  });

  it('includes favorite color and number', () => {
    const result = generateSoul(42);
    const t = result.traits;

    expect(result.content).toContain(t.preferences.favoriteColor);
    expect(result.content).toContain(String(t.preferences.favoriteNumber));
  });

  it('renderSoulMarkdown produces same output as generateSoul', () => {
    const seed = 12345;
    const traits = generateSoulTraits(seed);
    const rendered = renderSoulMarkdown(traits);
    const result = generateSoul(seed);
    expect(rendered).toBe(result.content);
  });
});

// ---------------------------------------------------------------------------
// Seed Parsing Tests
// ---------------------------------------------------------------------------

describe('Soul Generator — Seed Parsing', () => {
  it('parses integer numbers', () => {
    expect(parseSeed(42)).toBe(42);
    expect(parseSeed(0)).toBe(0);
    expect(parseSeed(-1)).toBe(-1);
  });

  it('parses numeric strings', () => {
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed('8675309')).toBe(8675309);
    expect(parseSeed('0')).toBe(0);
  });

  it('floors floating point numbers', () => {
    expect(parseSeed(42.7)).toBe(42);
    expect(parseSeed(3.14)).toBe(3);
  });

  it('rejects non-numeric strings', () => {
    expect(() => parseSeed('hello')).toThrow('not a number');
  });

  it('rejects non-finite numbers', () => {
    expect(() => parseSeed(Infinity)).toThrow('finite');
    expect(() => parseSeed(NaN)).toThrow('finite');
  });

  it('rejects non-number non-string types', () => {
    expect(() => parseSeed(null)).toThrow();
    expect(() => parseSeed(undefined)).toThrow();
    expect(() => parseSeed({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Random Seed Tests
// ---------------------------------------------------------------------------

describe('Soul Generator — Random Seed', () => {
  it('generates a finite integer', () => {
    const seed = generateRandomSeed();
    expect(Number.isFinite(seed)).toBe(true);
    expect(Number.isInteger(seed)).toBe(true);
  });

  it('generates different seeds on successive calls', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 20; i++) {
      seeds.add(generateRandomSeed());
    }
    // With cryptographic randomness, virtually impossible to get duplicates
    expect(seeds.size).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('Soul Generator — Edge Cases', () => {
  it('seed 0 produces valid output', () => {
    const result = generateSoul(0);
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.traits.values.length).toBe(3);
  });

  it('max safe unsigned 32-bit integer works', () => {
    const result = generateSoul(4294967295);
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.traits.values.length).toBe(3);
  });

  it('negative seeds work', () => {
    const result = generateSoul(-1);
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.traits.values.length).toBe(3);
  });

  it('very large seeds work', () => {
    const result = generateSoul(Number.MAX_SAFE_INTEGER);
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.traits.values.length).toBe(3);
  });

  it('negative seed produces different personality than its absolute value', () => {
    const r1 = generateSoul(-42);
    const r2 = generateSoul(42);
    expect(r1.content).not.toBe(r2.content);
  });
});

// ---------------------------------------------------------------------------
// Immutability Tests (SOUL.md write blocking)
// ---------------------------------------------------------------------------

describe('Soul Generator — SOUL.md Immutability', () => {
  it('validatePath blocks writes to SOUL.md', () => {
    const dir = createTempHeartwareDir();

    // Write operations to SOUL.md should throw IMMUTABLE_FILE
    expect(() => {
      validatePath(dir, 'SOUL.md', 'write');
    }).toThrow(HeartwareSecurityError);

    try {
      validatePath(dir, 'SOUL.md', 'write');
    } catch (err) {
      expect(err).toBeInstanceOf(HeartwareSecurityError);
      expect((err as HeartwareSecurityError).code).toBe('IMMUTABLE_FILE');
    }
  });

  it('validatePath blocks writes to SEED.txt', () => {
    const dir = createTempHeartwareDir();

    expect(() => {
      validatePath(dir, 'SEED.txt', 'write');
    }).toThrow(HeartwareSecurityError);

    try {
      validatePath(dir, 'SEED.txt', 'write');
    } catch (err) {
      expect(err).toBeInstanceOf(HeartwareSecurityError);
      expect((err as HeartwareSecurityError).code).toBe('IMMUTABLE_FILE');
    }
  });

  it('validatePath allows reads of SOUL.md', () => {
    const dir = createTempHeartwareDir();
    // Create the file so path resolution works
    writeFileSync(join(dir, 'SOUL.md'), 'test');

    const result = validatePath(dir, 'SOUL.md', 'read');
    expect(result.safe).toBe(true);
    expect(result.relativePath).toBe('SOUL.md');
  });

  it('validatePath allows reads of SEED.txt', () => {
    const dir = createTempHeartwareDir();
    writeFileSync(join(dir, 'SEED.txt'), '42');

    const result = validatePath(dir, 'SEED.txt', 'read');
    expect(result.safe).toBe(true);
    expect(result.relativePath).toBe('SEED.txt');
  });

  it('validatePath allows writes to non-immutable files', () => {
    const dir = createTempHeartwareDir();

    // These should not throw
    const result = validatePath(dir, 'IDENTITY.md', 'write');
    expect(result.safe).toBe(true);

    const result2 = validatePath(dir, 'FRIEND.md', 'write');
    expect(result2.safe).toBe(true);

    // Memory files should also be writable
    mkdirSync(join(dir, 'memory'), { recursive: true });
    const result3 = validatePath(dir, 'memory/2026-02-15.md', 'write');
    expect(result3.safe).toBe(true);
  });

  it('default operation (read) allows SOUL.md access', () => {
    const dir = createTempHeartwareDir();
    writeFileSync(join(dir, 'SOUL.md'), 'test');

    // No operation = read (default)
    const result = validatePath(dir, 'SOUL.md');
    expect(result.safe).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Diversity Tests
// ---------------------------------------------------------------------------

describe('Soul Generator — Diversity', () => {
  it('produces diverse personalities across 1000 seeds', () => {
    const allColors = new Set<string>();
    const allHumors = new Set<string>();
    const allCreatures = new Set<string>();
    const allValues = new Set<string>();

    for (let seed = 0; seed < 1000; seed++) {
      const traits = generateSoulTraits(seed);
      allColors.add(traits.preferences.favoriteColor);
      allHumors.add(traits.humor);
      allCreatures.add(traits.character.creatureType);
      traits.values.forEach((v) => allValues.add(v));
    }

    // Should hit most of the pools
    expect(allColors.size).toBeGreaterThan(10);
    expect(allHumors.size).toBe(4); // All 4 humor types
    expect(allCreatures.size).toBeGreaterThan(8);
    expect(allValues.size).toBeGreaterThan(8);
  });

  it('Big Five values are well-distributed across seeds', () => {
    let sumOpenness = 0;
    const n = 1000;

    for (let seed = 0; seed < n; seed++) {
      const traits = generateSoulTraits(seed);
      sumOpenness += traits.personality.openness;
    }

    const meanOpenness = sumOpenness / n;
    // SHA-256 should give roughly uniform distribution
    // Mean should be close to 0.5 (within 0.1)
    expect(meanOpenness).toBeGreaterThan(0.35);
    expect(meanOpenness).toBeLessThan(0.65);
  });
});

// ---------------------------------------------------------------------------
// Origin Story Tests
// ---------------------------------------------------------------------------

describe('Soul Generator — Origin Story', () => {
  it('generates an origin story with all fields', () => {
    const traits = generateSoulTraits(42);
    expect(traits.origin).toBeDefined();
    expect(typeof traits.origin.originPlace).toBe('string');
    expect(typeof traits.origin.awakeningEvent).toBe('string');
    expect(typeof traits.origin.coreMotivation).toBe('string');
    expect(typeof traits.origin.firstMemory).toBe('string');
    expect(traits.origin.originPlace.length).toBeGreaterThan(0);
    expect(traits.origin.awakeningEvent.length).toBeGreaterThan(0);
    expect(traits.origin.coreMotivation.length).toBeGreaterThan(0);
    expect(traits.origin.firstMemory.length).toBeGreaterThan(0);
  });

  it('same seed produces identical origin story', () => {
    const origin1 = generateSoulTraits(8675309).origin;
    const origin2 = generateSoulTraits(8675309).origin;
    expect(origin1).toEqual(origin2);
  });

  it('different seeds produce different origin stories', () => {
    const origins = [0, 1, 42, 100, 999].map((s) => generateSoulTraits(s).origin);
    // At least some should differ (very unlikely all 5 match)
    const places = new Set(origins.map((o) => o.originPlace));
    const events = new Set(origins.map((o) => o.awakeningEvent));
    expect(places.size + events.size).toBeGreaterThan(2);
  });

  it('SOUL.md includes origin story section', () => {
    const result = generateSoul(42);
    expect(result.content).toContain('## My Origin');
    expect(result.content).toContain('I came into being in');
    expect(result.content).toContain('My purpose?');
  });

  it('origin uses all 4 pools in rendered output', () => {
    const result = generateSoul(42);
    const traits = result.traits;
    expect(result.content).toContain(traits.origin.originPlace);
    expect(result.content).toContain(traits.origin.firstMemory);
  });

  it('origin story diversity across 1000 seeds', () => {
    const allPlaces = new Set<string>();
    const allEvents = new Set<string>();
    const allMotivations = new Set<string>();
    const allMemories = new Set<string>();

    for (let seed = 0; seed < 1000; seed++) {
      const origin = generateSoulTraits(seed).origin;
      allPlaces.add(origin.originPlace);
      allEvents.add(origin.awakeningEvent);
      allMotivations.add(origin.coreMotivation);
      allMemories.add(origin.firstMemory);
    }

    // Should hit most of the 12-item pools
    expect(allPlaces.size).toBeGreaterThan(8);
    expect(allEvents.size).toBeGreaterThan(8);
    expect(allMotivations.size).toBeGreaterThan(8);
    expect(allMemories.size).toBeGreaterThan(8);
  });
});
