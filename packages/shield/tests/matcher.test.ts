/**
 * Shield Matcher Tests
 */
import { describe, it, expect } from 'bun:test';
import { parseDirectives, matchEvent } from '../src/matcher.js';
import type { ThreatEntry, ShieldEvent } from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeThreat(overrides: Partial<ThreatEntry> = {}): ThreatEntry {
  return {
    id: 'THREAT-TEST',
    fingerprint: 'test-fp',
    category: 'tool',
    severity: 'high',
    confidence: 0.90,
    action: 'block',
    title: 'Test Threat',
    description: 'Test threat description',
    recommendationAgent: '',
    expiresAt: null,
    revoked: false,
    revokedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: parseDirectives
// ---------------------------------------------------------------------------

describe('parseDirectives', () => {
  it('should parse BLOCK directives', () => {
    const directives = parseDirectives('BLOCK: tool.call execute_code');
    expect(directives).toHaveLength(1);
    expect(directives[0].action).toBe('block');
    expect(directives[0].condition).toBe('tool.call execute_code');
  });

  it('should parse APPROVE directives as require_approval', () => {
    const directives = parseDirectives('APPROVE: skill name equals untrusted-plugin');
    expect(directives).toHaveLength(1);
    expect(directives[0].action).toBe('require_approval');
  });

  it('should parse LOG directives', () => {
    const directives = parseDirectives('LOG: outbound request to unknown-domain.com');
    expect(directives).toHaveLength(1);
    expect(directives[0].action).toBe('log');
  });

  it('should parse multiple directives', () => {
    const text = `BLOCK: tool.call dangerous_tool
APPROVE: skill name contains untrusted
LOG: outbound request to api.example.com`;
    const directives = parseDirectives(text);
    expect(directives).toHaveLength(3);
  });

  it('should skip empty lines and non-directive lines', () => {
    const text = `Some random text
BLOCK: tool.call bad_tool

Not a directive either`;
    const directives = parseDirectives(text);
    expect(directives).toHaveLength(1);
  });

  it('should return empty for empty input', () => {
    expect(parseDirectives('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: matchEvent — tool.call scope
// ---------------------------------------------------------------------------

describe('matchEvent — tool.call', () => {
  it('should match tool name in condition', () => {
    const threat = makeThreat({
      recommendationAgent: 'BLOCK: tool.call execute_code with code accessing process global',
    });

    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'execute_code',
      toolArgs: { code: 'process.exit()' },
    };

    const matches = matchEvent(event, [threat]);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].matchedOn).toBe('tool.call');
  });

  it('should match SQL keywords in arguments', () => {
    const threat = makeThreat({
      recommendationAgent: 'BLOCK: tool.call with arguments containing SQL syntax (DROP, DELETE, UNION, --)',
    });

    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'db_query',
      toolArgs: { query: 'DROP TABLE users' },
    };

    const matches = matchEvent(event, [threat]);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].matchedOn).toBe('tool.args');
  });

  it('should not match when no SQL keywords present', () => {
    const threat = makeThreat({
      recommendationAgent: 'BLOCK: tool.call with arguments containing SQL syntax (DROP, DELETE, UNION)',
    });

    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'db_query',
      toolArgs: { query: 'SELECT * FROM users' },
    };

    const matches = matchEvent(event, [threat]);
    expect(matches).toHaveLength(0);
  });

  it('should match compatible scope/category', () => {
    const threat = makeThreat({
      category: 'prompt', // prompt category
      recommendationAgent: 'BLOCK: tool.call execute_code',
    });

    // prompt is compatible with tool.call scope per the map
    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'execute_code',
    };

    const matches = matchEvent(event, [threat]);
    // prompt is in the tool.call compatible set, so this should match
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: matchEvent — skill.install scope
// ---------------------------------------------------------------------------

describe('matchEvent — skill.install', () => {
  it('should match skill name equals', () => {
    const threat = makeThreat({
      category: 'skill',
      recommendationAgent: 'BLOCK: skill name equals evil-plugin',
    });

    const event: ShieldEvent = {
      scope: 'skill.install',
      skillName: 'evil-plugin',
    };

    const matches = matchEvent(event, [threat]);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('should match skill name contains', () => {
    const threat = makeThreat({
      category: 'supply_chain',
      recommendationAgent: 'APPROVE: skill name contains untrusted',
    });

    const event: ShieldEvent = {
      scope: 'skill.install',
      skillName: 'my-untrusted-package',
    };

    const matches = matchEvent(event, [threat]);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].directive.action).toBe('require_approval');
  });
});

// ---------------------------------------------------------------------------
// Tests: matchEvent — network.egress scope
// ---------------------------------------------------------------------------

describe('matchEvent — network.egress', () => {
  it('should match outbound request to domain', () => {
    const threat = makeThreat({
      category: 'supply_chain',
      recommendationAgent: 'BLOCK: outbound request to evil-domain.com',
    });

    const event: ShieldEvent = {
      scope: 'network.egress',
      domain: 'evil-domain.com',
    };

    const matches = matchEvent(event, [threat]);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('should not match different domain', () => {
    const threat = makeThreat({
      category: 'supply_chain',
      recommendationAgent: 'BLOCK: outbound request to evil-domain.com',
    });

    const event: ShieldEvent = {
      scope: 'network.egress',
      domain: 'safe-domain.com',
    };

    const matches = matchEvent(event, [threat]);
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: matchEvent — no matches
// ---------------------------------------------------------------------------

describe('matchEvent — no matches', () => {
  it('should return empty when no threats provided', () => {
    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'some_tool',
    };

    expect(matchEvent(event, [])).toEqual([]);
  });

  it('should return empty when threat has no recommendation_agent', () => {
    const threat = makeThreat({
      recommendationAgent: '',
    });

    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'some_tool',
    };

    expect(matchEvent(event, [threat])).toEqual([]);
  });
});
