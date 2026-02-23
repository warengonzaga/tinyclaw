import { describe, expect, it } from 'bun:test';
import { estimateTokens, truncateToTokenBudget } from '../src/tokens.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates English text at ~4 chars/token', () => {
    // "Hello world" = 11 chars → ~3 tokens
    const tokens = estimateTokens('Hello world');
    expect(tokens).toBeGreaterThanOrEqual(2);
    expect(tokens).toBeLessThanOrEqual(4);
  });

  it('estimates longer text reasonably', () => {
    const text = 'The quick brown fox jumps over the lazy dog'; // 43 chars
    const tokens = estimateTokens(text);
    // 43 / 4 ≈ 11 tokens
    expect(tokens).toBeGreaterThanOrEqual(8);
    expect(tokens).toBeLessThanOrEqual(15);
  });

  it('handles CJK characters at ~1.5 chars/token', () => {
    const cjkText = '你好世界'; // 4 CJK chars → ~3 tokens
    const tokens = estimateTokens(cjkText);
    expect(tokens).toBeGreaterThanOrEqual(2);
    expect(tokens).toBeLessThanOrEqual(4);
  });

  it('handles mixed content', () => {
    const mixed = 'Hello 你好'; // 6 ASCII + 2 CJK
    const tokens = estimateTokens(mixed);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('truncateToTokenBudget', () => {
  it('returns text unchanged if within budget', () => {
    const text = 'Hello';
    expect(truncateToTokenBudget(text, 100)).toBe(text);
  });

  it('truncates text that exceeds budget', () => {
    const text = 'a '.repeat(500); // ~1000 chars → ~250 tokens
    const result = truncateToTokenBudget(text, 10);
    expect(result.length).toBeLessThan(text.length);
    expect(estimateTokens(result)).toBeLessThanOrEqual(15); // some margin
  });

  it('cuts at word boundaries when possible', () => {
    const text = 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10';
    const result = truncateToTokenBudget(text, 5);
    // Should not cut in the middle of a word (no partial words)
    expect(result.length).toBeLessThan(text.length);
    // Each word in the result should be a complete word from the original
    const originalWords = text.trim().split(/\s+/);
    const resultWords = result.trim().split(/\s+/);
    for (const w of resultWords) {
      expect(originalWords.includes(w)).toBe(true);
    }
  });
});
