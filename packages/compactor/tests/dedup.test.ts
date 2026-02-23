import { describe, expect, it } from 'bun:test';
import type { Message } from '@tinyclaw/types';
import { computeShingles, deduplicateMessages, jaccardSimilarity } from '../src/dedup.js';

describe('computeShingles', () => {
  it('returns empty set for empty text', () => {
    const shingles = computeShingles('');
    expect(shingles.size).toBe(0);
  });

  it('returns empty set for text shorter than shingle size', () => {
    const shingles = computeShingles('hi there', 3);
    expect(shingles.size).toBe(0); // only 2 words, shingle size 3
  });

  it('creates shingles from sufficient text', () => {
    const shingles = computeShingles('the quick brown fox jumps', 3);
    expect(shingles.size).toBe(3); // [the quick brown], [quick brown fox], [brown fox jumps]
  });

  it('is case-insensitive', () => {
    const a = computeShingles('Hello World Again');
    const b = computeShingles('hello world again');
    expect(a.size).toBe(b.size);
    for (const s of a) {
      expect(b.has(s)).toBe(true);
    }
  });
});

describe('jaccardSimilarity', () => {
  it('returns 0 for empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it('returns 1 for identical sets', () => {
    const s = new Set(['a', 'b', 'c']);
    expect(jaccardSimilarity(s, s)).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    const a = new Set(['a', 'b']);
    const b = new Set(['c', 'd']);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('returns correct value for partial overlap', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    // intersection: {b, c} = 2, union: {a, b, c, d} = 4 → 0.5
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });
});

describe('deduplicateMessages', () => {
  function msg(role: 'user' | 'assistant', content: string): Message {
    return { role, content };
  }

  it('returns same messages if no duplicates', () => {
    const messages = [
      msg('user', 'What is TypeScript?'),
      msg('assistant', 'TypeScript is a programming language'),
      msg('user', 'How do I install Bun?'),
    ];

    const result = deduplicateMessages(messages, 0.6);
    expect(result.messages.length).toBe(3);
    expect(result.groupsRemoved).toBe(0);
  });

  it('removes near-duplicate messages', () => {
    const messages = [
      msg('user', 'The quick brown fox jumps over the lazy dog'),
      msg('assistant', 'Some response about foxes'),
      msg('user', 'The quick brown fox jumps over the lazy cat'), // very similar to first
    ];

    const result = deduplicateMessages(messages, 0.6);
    expect(result.messages.length).toBeLessThan(3);
    expect(result.groupsRemoved).toBeGreaterThan(0);
  });

  it('keeps the more recent message when deduplicating', () => {
    const messages = [
      msg('user', 'The quick brown fox jumps over the lazy dog and runs away'),
      msg('user', 'The quick brown fox jumps over the lazy dog and stays'),
    ];

    const result = deduplicateMessages(messages, 0.6);
    // Should keep the second (more recent) message
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].content).toContain('stays');
  });

  it('handles single message', () => {
    const messages = [msg('user', 'hello')];
    const result = deduplicateMessages(messages, 0.6);
    expect(result.messages.length).toBe(1);
    expect(result.groupsRemoved).toBe(0);
  });

  it('handles empty array', () => {
    const result = deduplicateMessages([], 0.6);
    expect(result.messages.length).toBe(0);
    expect(result.groupsRemoved).toBe(0);
  });
});
