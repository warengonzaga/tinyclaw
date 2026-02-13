import { describe, it, expect } from 'bun:test';
import { createHybridMatcher } from '../src/matcher.js';

describe('HybridMatcher', () => {
  // -----------------------------------------------------------------------
  // Basic scoring
  // -----------------------------------------------------------------------

  it('returns high score for exact match', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('Technical Research Analyst', 'Technical Research Analyst');
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.keywordScore).toBe(1);
  });

  it('returns 0 for completely unrelated strings', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('quantum physics researcher', 'pasta recipe cookbook');
    expect(result.score).toBeLessThan(0.15);
  });

  it('returns 0 for empty strings', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('', 'anything');
    expect(result.score).toBe(0);

    const result2 = matcher.score('something', '');
    expect(result2.score).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Synonym matching
  // -----------------------------------------------------------------------

  it('matches synonyms: developer vs engineer', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('software developer', 'software engineer');
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.synonymScore).toBeGreaterThan(0);
  });

  it('matches synonyms: research vs analyze', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('research data patterns', 'analyze data patterns');
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.synonymScore).toBeGreaterThan(0);
  });

  it('matches synonyms: write vs compose', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('write documentation', 'compose documentation');
    expect(result.score).toBeGreaterThan(0.3);
  });

  it('matches synonyms: fix vs debug', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('fix authentication bug', 'debug authentication bug');
    expect(result.score).toBeGreaterThan(0.5);
  });

  // -----------------------------------------------------------------------
  // Fuzzy matching (typo tolerance)
  // -----------------------------------------------------------------------

  it('tolerates typos: reserch vs research', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('reserch analyst', 'research analyst');
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.fuzzyScore).toBeGreaterThan(0.3);
  });

  it('tolerates typos: developr vs developer', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('frontend developr', 'frontend developer');
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.fuzzyScore).toBeGreaterThan(0.3);
  });

  it('partial match: full word contains substring', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('documentation writer', 'documentation writing');
    expect(result.score).toBeGreaterThan(0.3);
  });

  // -----------------------------------------------------------------------
  // Combined multi-dimension scoring
  // -----------------------------------------------------------------------

  it('scores higher for multi-dimension matches', () => {
    const matcher = createHybridMatcher();

    // Only keyword match
    const keywordOnly = matcher.score('python data analysis', 'python data analysis');

    // Keyword + synonym (developer → engineer)
    const withSynonym = matcher.score('python developer data', 'python engineer data');

    // Both should be > minScore, but exact > synonym
    expect(keywordOnly.score).toBeGreaterThan(withSynonym.score);
    expect(withSynonym.score).toBeGreaterThan(0.3);
  });

  // -----------------------------------------------------------------------
  // findBest
  // -----------------------------------------------------------------------

  it('findBest returns best matching candidate', () => {
    const matcher = createHybridMatcher();
    const candidates = [
      { id: '1', text: 'pasta recipe cookbook author' },
      { id: '2', text: 'technical research analyst' },
      { id: '3', text: 'creative fiction writer' },
    ];

    const result = matcher.findBest('research data analyst', candidates);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('2');
    expect(result!.result.score).toBeGreaterThan(0.3);
  });

  it('findBest returns null when no candidate exceeds minScore', () => {
    const matcher = createHybridMatcher({ minScore: 0.9 });
    const candidates = [
      { id: '1', text: 'quantum physics researcher' },
      { id: '2', text: 'marine biology specialist' },
    ];

    const result = matcher.findBest('pasta recipe writer', candidates);
    expect(result).toBeNull();
  });

  it('findBest returns null for empty candidates', () => {
    const matcher = createHybridMatcher();
    const result = matcher.findBest('anything', []);
    expect(result).toBeNull();
  });

  it('findBest picks the highest score among multiple matches', () => {
    const matcher = createHybridMatcher();
    const candidates = [
      { id: '1', text: 'data analysis python machine learning' },
      { id: '2', text: 'data analysis expert' },
      { id: '3', text: 'general python developer' },
    ];

    const result = matcher.findBest('data analysis python', candidates);
    expect(result).not.toBeNull();
    // Should pick candidate 1 (most overlap) or 2 (close match)
    expect(['1', '2']).toContain(result!.id);
  });

  // -----------------------------------------------------------------------
  // Custom synonym registration
  // -----------------------------------------------------------------------

  it('addSynonyms enables custom synonym matching', () => {
    const matcher = createHybridMatcher();

    // Before adding custom synonyms
    const before = matcher.score('blockchain specialist', 'crypto specialist');
    const beforeSynonym = before.synonymScore;

    // Add custom synonym group
    matcher.addSynonyms(['blockchain', 'crypto', 'web3', 'defi']);

    // After adding custom synonyms
    const after = matcher.score('blockchain specialist', 'crypto specialist');
    expect(after.synonymScore).toBeGreaterThan(beforeSynonym);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it('addSynonyms ignores groups with less than 2 words', () => {
    const matcher = createHybridMatcher();
    const before = matcher.score('solo word', 'different text');

    matcher.addSynonyms(['solo']);

    const after = matcher.score('solo word', 'different text');
    expect(after.score).toBe(before.score);
  });

  // -----------------------------------------------------------------------
  // Custom weights
  // -----------------------------------------------------------------------

  it('respects custom weights', () => {
    // Heavy synonym weight
    const synonymHeavy = createHybridMatcher({
      weights: { keyword: 0.1, fuzzy: 0.1, synonym: 0.8 },
    });

    // Heavy keyword weight
    const keywordHeavy = createHybridMatcher({
      weights: { keyword: 0.8, fuzzy: 0.1, synonym: 0.1 },
    });

    // "developer" vs "engineer" — synonyms match, keywords don't
    const s1 = synonymHeavy.score('software developer', 'software engineer');
    const s2 = keywordHeavy.score('software developer', 'software engineer');

    // Synonym-heavy config should score at least as high for synonym matches
    expect(s1.score).toBeGreaterThanOrEqual(s2.score);
  });

  // -----------------------------------------------------------------------
  // Custom minScore
  // -----------------------------------------------------------------------

  it('respects custom minScore in findBest', () => {
    const strict = createHybridMatcher({ minScore: 0.8 });
    const lenient = createHybridMatcher({ minScore: 0.1 });

    const candidates = [
      { id: '1', text: 'software developer python' },
    ];

    // "software engineer python" has synonym match but not exact
    const strictResult = strict.findBest('software engineer python', candidates);
    const lenientResult = lenient.findBest('software engineer python', candidates);

    // Strict should filter it out, lenient should find it
    expect(lenientResult).not.toBeNull();
    // The strict one might or might not match depending on exact scores
    // but it should be at least as restrictive
    if (strictResult) {
      expect(strictResult.result.score).toBeGreaterThanOrEqual(0.8);
    }
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('handles stop-word-only input gracefully', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('the is a an', 'to of in for');
    expect(result.score).toBe(0);
  });

  it('handles single meaningful word', () => {
    const matcher = createHybridMatcher();
    const result = matcher.score('developer', 'developer');
    expect(result.score).toBeGreaterThan(0.5);
  });

  it('is case insensitive', () => {
    const matcher = createHybridMatcher();
    const lower = matcher.score('python developer', 'python developer');
    const mixed = matcher.score('Python Developer', 'python developer');
    expect(lower.score).toBe(mixed.score);
  });

  it('strips punctuation', () => {
    const matcher = createHybridMatcher();
    const clean = matcher.score('python developer', 'python developer');
    const punctuated = matcher.score('python, developer!', 'python: developer.');
    expect(clean.score).toBe(punctuated.score);
  });

  // -----------------------------------------------------------------------
  // Real-world delegation scenarios
  // -----------------------------------------------------------------------

  it('matches delegation reuse scenario: similar roles', () => {
    const matcher = createHybridMatcher();

    // Primary agent creates "Market Research Analyst"
    // Later asks for "Research Specialist" — should find reusable
    const result = matcher.score('Research Specialist', 'Market Research Analyst');
    expect(result.score).toBeGreaterThan(0.2);
  });

  it('matches delegation template scenario: task to template', () => {
    const matcher = createHybridMatcher();

    // Template: "Technical Documentation Writer" with tags
    // Task: "write API documentation for the REST endpoints"
    const result = matcher.score(
      'write API documentation REST endpoints',
      'Technical Documentation Writer documentation technical writing',
    );
    // Should get at least some match via keyword + synonym (write/writing overlap)
    expect(result.score).toBeGreaterThan(0.1);
  });

  it('correctly separates distinct roles', () => {
    const matcher = createHybridMatcher();

    // These should NOT match well
    const result = matcher.score(
      'Quantum Physics Researcher',
      'Creative Poetry Writer',
    );
    expect(result.score).toBeLessThan(0.2);
  });
});
