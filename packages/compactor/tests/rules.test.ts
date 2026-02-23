import { describe, expect, it } from 'bun:test';
import {
  collapseWhitespace,
  compressMarkdownTable,
  deduplicateLines,
  mergeShortBullets,
  mergeSimilarBullets,
  normalizeCjkPunctuation,
  preCompress,
  removeDecorativeLines,
  removeEmptySections,
  stripEmoji,
} from '../src/rules.js';

describe('stripEmoji', () => {
  it('removes emoji from text', () => {
    expect(stripEmoji('Hello 👋 world 🌍')).toBe('Hello world');
  });

  it('preserves text without emoji', () => {
    expect(stripEmoji('Hello world')).toBe('Hello world');
  });

  it('handles empty string', () => {
    expect(stripEmoji('')).toBe('');
  });

  it('handles text that is only emoji', () => {
    const result = stripEmoji('🎉🎊🎈');
    expect(result).toBe('');
  });
});

describe('deduplicateLines', () => {
  it('removes exact duplicate lines', () => {
    const input = 'line1\nline2\nline1\nline3';
    expect(deduplicateLines(input)).toBe('line1\nline2\nline3');
  });

  it('preserves empty lines for structure', () => {
    const input = 'line1\n\nline2\n\nline3';
    expect(deduplicateLines(input)).toBe('line1\n\nline2\n\nline3');
  });

  it('keeps first occurrence', () => {
    const input = 'first\nsecond\nfirst\nthird\nsecond';
    expect(deduplicateLines(input)).toBe('first\nsecond\nthird');
  });

  it('handles single line', () => {
    expect(deduplicateLines('hello')).toBe('hello');
  });
});

describe('collapseWhitespace', () => {
  it('collapses multiple blank lines into one', () => {
    const input = 'line1\n\n\n\nline2';
    expect(collapseWhitespace(input)).toBe('line1\n\nline2');
  });

  it('trims trailing whitespace from lines', () => {
    const input = 'hello   \nworld  ';
    expect(collapseWhitespace(input)).toBe('hello\nworld');
  });

  it('preserves single blank lines', () => {
    const input = 'line1\n\nline2';
    expect(collapseWhitespace(input)).toBe('line1\n\nline2');
  });
});

describe('removeDecorativeLines', () => {
  it('removes "---" separator lines', () => {
    const input = 'line1\n---\nline2';
    expect(removeDecorativeLines(input)).toBe('line1\nline2');
  });

  it('removes "===" separator lines', () => {
    const input = 'line1\n===\nline2';
    expect(removeDecorativeLines(input)).toBe('line1\nline2');
  });

  it('removes "***" separator lines', () => {
    const input = 'line1\n***\nline2';
    expect(removeDecorativeLines(input)).toBe('line1\nline2');
  });

  it('preserves content with dashes in context', () => {
    const input = 'my-variable = 42';
    expect(removeDecorativeLines(input)).toBe('my-variable = 42');
  });
});

describe('preCompress', () => {
  it('applies all rules by default', () => {
    const input = 'Hello 👋\nHello 👋\n\n\n\nworld\n---\nend';
    const result = preCompress(input, {
      stripEmoji: true,
      removeDuplicateLines: true,
    });
    expect(result).not.toContain('👋');
    // Duplicate line removed, emoji stripped, separator removed
    expect(result).toContain('Hello');
    expect(result).toContain('world');
    expect(result).toContain('end');
    expect(result).not.toContain('---');
  });

  it('respects stripEmoji=false', () => {
    const result = preCompress('Hello 👋', {
      stripEmoji: false,
      removeDuplicateLines: true,
    });
    expect(result).toContain('👋');
  });

  it('respects removeDuplicateLines=false', () => {
    const input = 'dup\ndup';
    const result = preCompress(input, {
      stripEmoji: true,
      removeDuplicateLines: false,
    });
    expect(result).toBe('dup\ndup');
  });
});

// ---------------------------------------------------------------------------
// New rules
// ---------------------------------------------------------------------------

describe('normalizeCjkPunctuation', () => {
  it('converts Chinese fullwidth punctuation to ASCII', () => {
    expect(normalizeCjkPunctuation('你好，世界。')).toBe('你好,世界.');
  });

  it('converts em-dash pair to --', () => {
    expect(normalizeCjkPunctuation('test——value')).toBe('test--value');
  });

  it('converts fullwidth brackets', () => {
    expect(normalizeCjkPunctuation('【重要】')).toBe('[重要]');
  });

  it('handles empty string', () => {
    expect(normalizeCjkPunctuation('')).toBe('');
  });

  it('preserves ASCII text unchanged', () => {
    expect(normalizeCjkPunctuation('Hello, world.')).toBe('Hello, world.');
  });
});

describe('removeEmptySections', () => {
  it('removes sections with no body', () => {
    const input = '## Empty\n\n## Has Content\nSome text here';
    const result = removeEmptySections(input);
    expect(result).not.toContain('## Empty');
    expect(result).toContain('## Has Content');
    expect(result).toContain('Some text here');
  });

  it('keeps sections that have children', () => {
    const input = '## Parent\n### Child\nContent under child';
    const result = removeEmptySections(input);
    expect(result).toContain('## Parent');
    expect(result).toContain('### Child');
  });

  it('handles empty string', () => {
    expect(removeEmptySections('')).toBe('');
  });

  it('preserves text with no sections', () => {
    expect(removeEmptySections('Just plain text')).toContain('Just plain text');
  });
});

describe('compressMarkdownTable', () => {
  it('compresses 2-column table to key:value', () => {
    const input = '| Name | Value |\n| --- | --- |\n| foo | bar |\n| baz | qux |';
    const result = compressMarkdownTable(input);
    expect(result).toContain('- foo: bar');
    expect(result).toContain('- baz: qux');
    expect(result).not.toContain('| --- |');
  });

  it('compresses multi-column table to compact format', () => {
    const input = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
    const result = compressMarkdownTable(input);
    expect(result).toContain('B=2');
    expect(result).toContain('C=3');
  });

  it('handles empty string', () => {
    expect(compressMarkdownTable('')).toBe('');
  });

  it('passes non-table text through', () => {
    const input = 'Just text\nNo tables here';
    expect(compressMarkdownTable(input)).toBe(input);
  });
});

describe('mergeSimilarBullets', () => {
  it('merges bullets with high similarity', () => {
    const input =
      '- The quick brown fox jumps over the lazy dog\n- The quick brown fox jumps over the lazy cat';
    const result = mergeSimilarBullets(input, 0.7);
    const lines = result.split('\n').filter((l) => l.trim());
    expect(lines.length).toBe(1); // One was merged
  });

  it('keeps distinct bullets', () => {
    const input = '- Install dependencies\n- Run the tests\n- Deploy to prod';
    const result = mergeSimilarBullets(input);
    expect(result).toContain('Install dependencies');
    expect(result).toContain('Run the tests');
    expect(result).toContain('Deploy to prod');
  });

  it('handles empty string', () => {
    expect(mergeSimilarBullets('')).toBe('');
  });
});

describe('mergeShortBullets', () => {
  it('combines 3+ short bullets into comma-separated', () => {
    const input = '- one\n- two\n- three\n- four';
    const result = mergeShortBullets(input);
    expect(result).toContain('one, two, three, four');
  });

  it('keeps 1-2 short bullets as-is', () => {
    const input = '- one\n- two';
    const result = mergeShortBullets(input);
    expect(result).toContain('- one');
    expect(result).toContain('- two');
  });

  it('does not merge long bullets', () => {
    const input =
      '- this is a long bullet point\n- another long bullet point here\n- a third long bullet with many words';
    const result = mergeShortBullets(input);
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('- this is a long bullet point');
    expect(lines[1]).toBe('- another long bullet point here');
    expect(lines[2]).toBe('- a third long bullet with many words');
  });

  it('skips empty bullet content', () => {
    const input = '- \n- one\n- two\n- three';
    const result = mergeShortBullets(input);
    expect(result).toContain('- ');
    expect(result).toContain('one, two, three');
  });

  it('handles empty string', () => {
    expect(mergeShortBullets('')).toBe('');
  });
});
