import { describe, it, expect } from 'bun:test';
import {
  optimizeTokens,
  stripBoldItalic,
  stripTrivialBackticks,
  minimizeWhitespace,
  compactBullets,
  compressTableToKv,
} from '../src/optimizer.js';

describe('stripBoldItalic', () => {
  it('removes bold markers', () => {
    expect(stripBoldItalic('**bold text**')).toBe('bold text');
  });

  it('removes italic markers', () => {
    expect(stripBoldItalic('*italic text*')).toBe('italic text');
  });

  it('handles mixed formatting', () => {
    const result = stripBoldItalic('This is **bold** and *italic* text');
    expect(result).toBe('This is bold and italic text');
  });

  it('handles empty string', () => {
    expect(stripBoldItalic('')).toBe('');
  });

  it('preserves unformatted text', () => {
    expect(stripBoldItalic('plain text')).toBe('plain text');
  });
});

describe('stripTrivialBackticks', () => {
  it('removes backticks around simple words', () => {
    expect(stripTrivialBackticks('use `npm` to install')).toBe('use npm to install');
  });

  it('preserves backticks with spaces inside', () => {
    expect(stripTrivialBackticks('run `npm install`')).toBe('run `npm install`');
  });

  it('removes backticks around dotted names', () => {
    expect(stripTrivialBackticks('edit `config.json`')).toBe('edit config.json');
  });

  it('handles empty string', () => {
    expect(stripTrivialBackticks('')).toBe('');
  });
});

describe('minimizeWhitespace', () => {
  it('reduces multiple spaces to single', () => {
    expect(minimizeWhitespace('hello    world')).toBe('hello world');
  });

  it('caps leading indentation at 4 spaces', () => {
    const result = minimizeWhitespace('        deep indent');
    expect(result).toBe('    deep indent');
  });

  it('collapses 3+ newlines to 2', () => {
    const result = minimizeWhitespace('a\n\n\n\nb');
    expect(result).toBe('a\n\nb');
  });

  it('handles empty string', () => {
    expect(minimizeWhitespace('')).toBe('');
  });
});

describe('compactBullets', () => {
  it('strips bullet prefix from 3+ consecutive bullets', () => {
    const input = '- one\n- two\n- three';
    const result = compactBullets(input);
    expect(result).not.toContain('- one');
    expect(result).toContain('one');
    expect(result).toContain('two');
    expect(result).toContain('three');
  });

  it('keeps bullets for 1-2 items', () => {
    const input = '- one\n- two';
    const result = compactBullets(input);
    expect(result).toContain('- one');
    expect(result).toContain('- two');
  });

  it('handles empty string', () => {
    expect(compactBullets('')).toBe('');
  });
});

describe('compressTableToKv', () => {
  it('converts 2-column table to key:value', () => {
    const input = '| Key | Value |\n| --- | --- |\n| name | test |';
    const result = compressTableToKv(input);
    expect(result).toContain('name: test');
  });

  it('passes non-table text through', () => {
    const input = 'Regular text\nNo tables';
    expect(compressTableToKv(input)).toBe(input);
  });

  it('handles empty string', () => {
    expect(compressTableToKv('')).toBe('');
  });
});

describe('optimizeTokens', () => {
  it('applies non-aggressive optimizations by default', () => {
    const input = '你好，世界。  extra   spaces';
    const result = optimizeTokens(input);
    expect(result).toContain(',');
    expect(result).not.toContain('  extra   spaces');
  });

  it('applies aggressive optimizations when enabled', () => {
    const input = 'This is **bold** and `simple` text';
    const result = optimizeTokens(input, { aggressive: true });
    expect(result).not.toContain('**');
    expect(result).not.toContain('`');
  });

  it('handles empty string', () => {
    expect(optimizeTokens('')).toBe('');
  });
});
