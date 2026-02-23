import { describe, expect, it } from 'bun:test';
import { generateTiers } from '../src/tiers.js';
import { estimateTokens } from '../src/tokens.js';

describe('generateTiers', () => {
  const budgets = { l0: 200, l1: 1000, l2: 3000 };

  it('generates all three tiers', () => {
    const summary = [
      'User name: John.',
      'User preference: likes dark mode.',
      'Decision: use TypeScript for the project.',
      'Task: finish the login page by Friday.',
      'Note: discussed weather briefly.',
      'Topic: database migration strategy.',
    ].join('\n');

    const tiers = generateTiers(summary, budgets);
    expect(tiers.l2).toBeTruthy();
    expect(tiers.l1).toBeTruthy();
    expect(tiers.l0).toBeTruthy();
  });

  it('L2 contains the full summary', () => {
    const summary = 'User name: Alice. Decision: use Bun runtime.';
    const tiers = generateTiers(summary, budgets);
    expect(tiers.l2).toBe(summary);
  });

  it('L1 fits within its token budget', () => {
    // Create a summary that exceeds L1 budget
    const lines = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`Note: discussed topic number ${i} with various interesting details and context.`);
    }
    const summary = lines.join('\n');

    const tiers = generateTiers(summary, budgets);
    const l1Tokens = estimateTokens(tiers.l1);
    expect(l1Tokens).toBeLessThanOrEqual(budgets.l1);
  });

  it('L0 fits within its token budget', () => {
    const lines = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`Note: discussed topic number ${i} with various interesting details and context.`);
    }
    const summary = lines.join('\n');

    const tiers = generateTiers(summary, budgets);
    const l0Tokens = estimateTokens(tiers.l0);
    expect(l0Tokens).toBeLessThanOrEqual(budgets.l0);
  });

  it('prioritizes identity and decision lines over notes', () => {
    const summary = [
      'Note: the weather was nice.',
      'User name: Bob.',
      'Note: talked about lunch.',
      'Decision: deploy on Monday.',
      'Note: random filler text.',
    ].join('\n');

    // With a tight L0 budget, identity and decisions should be kept
    const tiers = generateTiers(summary, { l0: 50, l1: 100, l2: 3000 });

    // L0 should be non-empty and contain high-priority lines
    expect(tiers.l0.length).toBeGreaterThan(0);
    const hasIdentity =
      tiers.l0.includes('name') || tiers.l0.includes('decision') || tiers.l0.includes('Decision');
    expect(hasIdentity).toBe(true);
  });

  it('L2 >= L1 >= L0 in token count', () => {
    const lines = [];
    for (let i = 0; i < 50; i++) {
      lines.push(`User discussed topic ${i} about preferences and decisions.`);
    }
    const summary = lines.join('\n');

    const tiers = generateTiers(summary, budgets);
    const l0 = estimateTokens(tiers.l0);
    const l1 = estimateTokens(tiers.l1);
    const l2 = estimateTokens(tiers.l2);
    expect(l2).toBeGreaterThanOrEqual(l1);
    expect(l1).toBeGreaterThanOrEqual(l0);
  });

  it('handles empty summary', () => {
    const tiers = generateTiers('', budgets);
    expect(tiers.l2).toBe('');
    expect(tiers.l1).toBe('');
    expect(tiers.l0).toBe('');
  });
});
