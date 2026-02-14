import { describe, it, expect } from 'bun:test';
import {
  buildCodebook,
  compressText,
  decompressText,
  compressionStats,
} from '../src/dictionary.js';

describe('buildCodebook', () => {
  it('returns empty codebook for empty input', () => {
    expect(buildCodebook([])).toEqual({});
  });

  it('returns empty codebook when no phrases meet min frequency', () => {
    const cb = buildCodebook(['hello world', 'foo bar'], { minFreq: 10 });
    expect(Object.keys(cb).length).toBe(0);
  });

  it('builds codebook from repetitive text', () => {
    const text = [
      'the quick brown fox jumps over the lazy dog ' +
        'the quick brown fox jumps over the fence ' +
        'the quick brown fox jumps over the wall',
      'the quick brown fox jumps here and the quick brown fox jumps there',
    ];
    const cb = buildCodebook(text, { minFreq: 2 });
    expect(Object.keys(cb).length).toBeGreaterThan(0);
    // All codes should start with $
    for (const code of Object.keys(cb)) {
      expect(code.startsWith('$')).toBe(true);
    }
  });

  it('respects maxEntries', () => {
    const text = Array(10)
      .fill(
        'alpha bravo charlie delta echo foxtrot golf hotel india ' +
          'juliet kilo lima mike november oscar papa quebec romeo ' +
          'sierra tango uniform victor whiskey xray yankee zulu',
      )
      .join(' ');
    const cb = buildCodebook([text], { minFreq: 2, maxEntries: 3 });
    expect(Object.keys(cb).length).toBeLessThanOrEqual(3);
  });
});

describe('compressText / decompressText roundtrip', () => {
  it('roundtrips correctly', () => {
    const original = 'the quick brown fox jumps over the lazy dog';
    const codebook = { $AA: 'the quick brown fox' };
    const compressed = compressText(original, codebook);
    const decompressed = decompressText(compressed, codebook);
    expect(decompressed).toBe(original);
  });

  it('handles text with existing $ signs', () => {
    const original = 'price is $100 and the quick brown fox';
    const codebook = { $AA: 'the quick brown fox' };
    const compressed = compressText(original, codebook);
    expect(compressed).toContain('$AA');
    const decompressed = decompressText(compressed, codebook);
    expect(decompressed).toBe(original);
  });

  it('handles empty codebook', () => {
    const original = 'hello world';
    expect(compressText(original, {})).toBe(original);
    expect(decompressText(original, {})).toBe(original);
  });

  it('handles empty text', () => {
    expect(compressText('', { $AA: 'test' })).toBe('');
    expect(decompressText('', { $AA: 'test' })).toBe('');
  });

  it('applies longer phrases first to avoid partial matches', () => {
    const codebook = {
      $AA: 'quick brown',
      $AB: 'quick brown fox',
    };
    const original = 'the quick brown fox jumps';
    const compressed = compressText(original, codebook);
    // Should use $AB (longer phrase) not $AA
    expect(compressed).toContain('$AB');
  });
});

describe('compressionStats', () => {
  it('calculates stats correctly', () => {
    const original = 'the quick brown fox ' + 'the quick brown fox ' + 'the quick brown fox';
    const codebook = { $AA: 'the quick brown fox' };
    const stats = compressionStats(original, codebook);
    expect(stats.originalChars).toBe(original.length);
    expect(stats.compressedChars).toBeLessThan(original.length);
    expect(stats.grossReductionPct).toBeGreaterThan(0);
    expect(stats.codebookEntries).toBe(1);
    expect(stats.codesUsed).toBe(1);
  });

  it('returns zero reduction for empty text', () => {
    const stats = compressionStats('', { $AA: 'test' });
    expect(stats.grossReductionPct).toBe(0);
  });
});
