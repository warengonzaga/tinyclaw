import { describe, expect, it } from 'bun:test';
import type { CcpLevel } from '../src/ccp.js';
import { compressContext, compressContextWithStats } from '../src/ccp.js';

describe('compressContext', () => {
  const sampleText =
    'In addition, the application configuration environment has been set up ' +
    'with the infrastructure implementation for the documentation database. ' +
    'Furthermore, the Kubernetes deployment monitoring is working correctly.';

  it('returns compressed text at ultra level', () => {
    const result = compressContext(sampleText, 'ultra');
    expect(result.compressed.length).toBeLessThan(sampleText.length);
    expect(result.level).toBe('ultra');
    expect(result.instructions).toBeTruthy();
    // Should abbreviate common words
    expect(result.compressed).toContain('config');
    expect(result.compressed).not.toContain('configuration');
  });

  it('returns compressed text at medium level', () => {
    const result = compressContext(sampleText, 'medium');
    expect(result.compressed.length).toBeLessThan(sampleText.length);
    expect(result.level).toBe('medium');
    expect(result.instructions).toBeTruthy();
    expect(result.compressed).toContain('config');
  });

  it('returns compressed text at light level', () => {
    const result = compressContext(sampleText, 'light');
    expect(result.level).toBe('light');
    expect(result.instructions).toBeTruthy();
  });

  it('ultra is more aggressive than medium', () => {
    const ultra = compressContext(sampleText, 'ultra');
    const medium = compressContext(sampleText, 'medium');
    expect(ultra.compressed.length).toBeLessThanOrEqual(medium.compressed.length);
  });

  it('medium is more aggressive than light', () => {
    const medium = compressContext(sampleText, 'medium');
    const light = compressContext(sampleText, 'light');
    expect(medium.compressed.length).toBeLessThanOrEqual(light.compressed.length);
  });

  it('throws on invalid level', () => {
    expect(() => compressContext(sampleText, 'invalid' as CcpLevel)).toThrow();
  });

  it('handles empty text', () => {
    const result = compressContext('', 'ultra');
    expect(result.compressed).toBe('');
  });

  it('removes filler phrases in ultra mode', () => {
    const withFillers = 'In addition, we should deploy. Furthermore, tests pass.';
    const result = compressContext(withFillers, 'ultra');
    expect(result.compressed).not.toContain('In addition,');
    expect(result.compressed).not.toContain('Furthermore,');
  });

  it('abbreviates in ultra: and -> +, with -> w/, for -> 4', () => {
    const text = 'frontend and backend with caching for speed';
    const result = compressContext(text, 'ultra');
    expect(result.compressed).toContain('+');
    expect(result.compressed).toContain('w/');
    expect(result.compressed).toContain('4');
  });
});

describe('compressContextWithStats', () => {
  it('returns token statistics', () => {
    const text = 'The application environment configuration has been updated for production.';
    const result = compressContextWithStats(text, 'ultra');
    expect(result.originalTokens).toBeGreaterThan(0);
    expect(result.compressedTokens).toBeGreaterThanOrEqual(0);
    expect(result.instructionTokens).toBeGreaterThan(0);
    expect(result.netTokens).toBe(result.compressedTokens + result.instructionTokens);
    expect(result.reductionPct).toBeGreaterThanOrEqual(0);
    expect(typeof result.netReductionPct).toBe('number');
    // netReductionPct should be <= reductionPct since it includes instruction overhead
    expect(result.netReductionPct).toBeLessThanOrEqual(result.reductionPct);
  });

  it('shows reduction for verbose text', () => {
    const verbose =
      'In addition, the application configuration environment infrastructure ' +
      'implementation documentation database Kubernetes deployment monitoring ' +
      'has been set up and is working correctly with the production system.';
    const result = compressContextWithStats(verbose, 'ultra');
    expect(result.reductionPct).toBeGreaterThan(0);
  });

  it('returns 0 reduction for empty text', () => {
    const result = compressContextWithStats('', 'ultra');
    expect(result.reductionPct).toBe(0);
    expect(result.originalTokens).toBe(0);
  });
});
