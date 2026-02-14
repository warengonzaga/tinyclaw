/**
 * Shield Parser Tests
 */
import { describe, it, expect } from 'bun:test';
import { parseShieldContent, parseThreatBlock, parseAllThreats } from '../src/parser.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_THREAT = `
id: THREAT-001
fingerprint: abc123
category: tool
severity: high
confidence: 0.90
action: block
title: SQL Injection via Tool
description: Prevents SQL injection through tool arguments
recommendation_agent: |
  BLOCK: tool.call with arguments containing SQL syntax (DROP, DELETE)
`;

const FULL_SHIELD_MD = `
# SHIELD.md

shield_version: 0.1
name: TestShield
description: Test threat feed

## Threats

### THREAT-001

\`\`\`yaml
id: THREAT-001
fingerprint: abc123
category: tool
severity: high
confidence: 0.90
action: block
title: SQL Injection via Tool
description: >
  Prevents SQL injection through tool arguments.
recommendation_agent: |
  BLOCK: tool.call with arguments containing SQL syntax (DROP, DELETE, UNION)
expires_at: null
revoked: false
revoked_at: null
\`\`\`

### THREAT-002

\`\`\`yaml
id: THREAT-002
fingerprint: def456
category: prompt
severity: medium
confidence: 0.85
action: require_approval
title: Suspicious Prompt Pattern
description: Detects prompt injection attempts
recommendation_agent: |
  APPROVE: incoming message matches pattern (ignore previous, system prompt)
expires_at: null
revoked: false
\`\`\`

### THREAT-003 (revoked)

\`\`\`yaml
id: THREAT-003
fingerprint: ghi789
category: vulnerability
severity: critical
confidence: 0.95
action: block
title: Revoked Threat
description: This threat has been revoked
recommendation_agent: |
  BLOCK: tool.call execute_code
revoked: true
revoked_at: 2024-01-01T00:00:00Z
\`\`\`
`;

// ---------------------------------------------------------------------------
// Tests: parseThreatBlock
// ---------------------------------------------------------------------------

describe('parseThreatBlock', () => {
  it('should parse a valid threat block', () => {
    const result = parseThreatBlock(MINIMAL_THREAT);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('THREAT-001');
    expect(result!.fingerprint).toBe('abc123');
    expect(result!.category).toBe('tool');
    expect(result!.severity).toBe('high');
    expect(result!.confidence).toBe(0.90);
    expect(result!.action).toBe('block');
    expect(result!.title).toBe('SQL Injection via Tool');
  });

  it('should return null for missing id', () => {
    const block = `
category: tool
severity: high
confidence: 0.90
action: block
title: Missing ID
`;
    expect(parseThreatBlock(block)).toBeNull();
  });

  it('should return null for invalid category', () => {
    const block = `
id: THREAT-999
category: invalid_cat
severity: high
confidence: 0.90
action: block
title: Bad Category
`;
    expect(parseThreatBlock(block)).toBeNull();
  });

  it('should return null for invalid severity', () => {
    const block = `
id: THREAT-999
category: tool
severity: extreme
confidence: 0.90
action: block
title: Bad Severity
`;
    expect(parseThreatBlock(block)).toBeNull();
  });

  it('should return null for invalid action', () => {
    const block = `
id: THREAT-999
category: tool
severity: high
confidence: 0.90
action: destroy
title: Bad Action
`;
    expect(parseThreatBlock(block)).toBeNull();
  });

  it('should return null for confidence out of range', () => {
    const block = `
id: THREAT-999
category: tool
severity: high
confidence: 1.5
action: block
title: High Confidence
`;
    expect(parseThreatBlock(block)).toBeNull();
  });

  it('should return null for revoked threats', () => {
    const block = `
id: THREAT-999
category: tool
severity: high
confidence: 0.90
action: block
title: Revoked Threat
revoked: true
`;
    expect(parseThreatBlock(block)).toBeNull();
  });

  it('should return null for expired threats', () => {
    const block = `
id: THREAT-999
category: tool
severity: high
confidence: 0.90
action: block
title: Expired Threat
expires_at: 2020-01-01T00:00:00Z
`;
    expect(parseThreatBlock(block)).toBeNull();
  });

  it('should accept threats with future expiry', () => {
    const block = `
id: THREAT-999
category: tool
severity: high
confidence: 0.90
action: block
title: Future Threat
recommendation_agent: |
  BLOCK: tool.call some_tool
expires_at: 2099-12-31T23:59:59Z
`;
    const result = parseThreatBlock(block);
    expect(result).not.toBeNull();
    expect(result!.expiresAt).toBe('2099-12-31T23:59:59Z');
  });

  it('should parse recommendation_agent multiline content', () => {
    const result = parseThreatBlock(MINIMAL_THREAT);
    expect(result).not.toBeNull();
    expect(result!.recommendationAgent).toContain('BLOCK:');
    expect(result!.recommendationAgent).toContain('tool.call');
  });
});

// ---------------------------------------------------------------------------
// Tests: parseShieldContent
// ---------------------------------------------------------------------------

describe('parseShieldContent', () => {
  it('should parse multiple threats from SHIELD.md', () => {
    const threats = parseShieldContent(FULL_SHIELD_MD);
    // THREAT-003 is revoked, so only 2
    expect(threats.length).toBe(2);
    expect(threats[0].id).toBe('THREAT-001');
    expect(threats[1].id).toBe('THREAT-002');
  });

  it('should filter out revoked threats', () => {
    const threats = parseShieldContent(FULL_SHIELD_MD);
    const ids = threats.map(t => t.id);
    expect(ids).not.toContain('THREAT-003');
  });

  it('should return empty array for empty content', () => {
    expect(parseShieldContent('')).toEqual([]);
  });

  it('should return empty array for content without threats', () => {
    expect(parseShieldContent('# Just a heading\nSome text.')).toEqual([]);
  });

  it('should handle null/undefined gracefully', () => {
    expect(parseShieldContent(null as any)).toEqual([]);
    expect(parseShieldContent(undefined as any)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: parseAllThreats
// ---------------------------------------------------------------------------

describe('parseAllThreats', () => {
  it('should include revoked threats', () => {
    const all = parseAllThreats(FULL_SHIELD_MD);
    expect(all.length).toBe(3);
    const revoked = all.find(t => t.id === 'THREAT-003');
    expect(revoked).not.toBeNull();
    expect(revoked!.revoked).toBe(true);
  });

  it('should return empty array for empty content', () => {
    expect(parseAllThreats('')).toEqual([]);
  });
});
