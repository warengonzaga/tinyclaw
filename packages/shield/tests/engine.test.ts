/**
 * Shield Engine Tests
 */
import { describe, expect, it } from 'bun:test';
import type { ShieldEvent } from '@tinyclaw/types';
import { createShieldEngine } from '../src/engine.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHIELD_CONTENT = `
# SHIELD.md

## Threats

### THREAT-001 — SQL Injection

\`\`\`yaml
id: THREAT-001
fingerprint: sql-inject-01
category: tool
severity: high
confidence: 0.90
action: block
title: SQL Injection via Tool Arguments
description: Block SQL injection attempts through database tools
recommendation_agent: |
  BLOCK: tool.call with arguments containing SQL syntax (DROP, DELETE, UNION, --)
\`\`\`

### THREAT-002 — Untrusted Plugin

\`\`\`yaml
id: THREAT-002
fingerprint: untrusted-plugin-01
category: skill
severity: medium
confidence: 0.85
action: require_approval
title: Untrusted Plugin Installation
description: Requires approval for untrusted plugin installs
recommendation_agent: |
  APPROVE: skill name contains untrusted
\`\`\`

### THREAT-003 — Low Confidence Threat

\`\`\`yaml
id: THREAT-003
fingerprint: low-conf-01
category: tool
severity: high
confidence: 0.70
action: block
title: Low Confidence Threat
description: A threat below the confidence threshold
recommendation_agent: |
  BLOCK: tool.call risky_tool
\`\`\`

### THREAT-004 — Critical Block Low Confidence

\`\`\`yaml
id: THREAT-004
fingerprint: critical-low-conf
category: tool
severity: critical
confidence: 0.70
action: block
title: Critical Block Despite Low Confidence
description: Critical severity with block action overrides confidence threshold
recommendation_agent: |
  BLOCK: tool.call extremely_dangerous_tool
\`\`\`

### THREAT-005 — Log Only

\`\`\`yaml
id: THREAT-005
fingerprint: log-only-01
category: tool
severity: low
confidence: 0.95
action: log
title: Log Only Threat
description: Just log this for monitoring
recommendation_agent: |
  LOG: tool.call monitored_tool
\`\`\`
`;

// ---------------------------------------------------------------------------
// Tests: createShieldEngine
// ---------------------------------------------------------------------------

describe('createShieldEngine', () => {
  it('should create an active engine from valid content', () => {
    const engine = createShieldEngine(SHIELD_CONTENT);
    expect(engine.isActive()).toBe(true);
    expect(engine.getThreats().length).toBe(5);
  });

  it('should create an inactive engine from empty content', () => {
    const engine = createShieldEngine('');
    expect(engine.isActive()).toBe(false);
    expect(engine.getThreats()).toEqual([]);
  });

  it('should return a copy of threats', () => {
    const engine = createShieldEngine(SHIELD_CONTENT);
    const threats1 = engine.getThreats();
    const threats2 = engine.getThreats();
    expect(threats1).not.toBe(threats2); // different reference
    expect(threats1).toEqual(threats2); // same content
  });
});

// ---------------------------------------------------------------------------
// Tests: evaluate — block action
// ---------------------------------------------------------------------------

describe('engine.evaluate — block', () => {
  it('should block SQL injection attempts', () => {
    const engine = createShieldEngine(SHIELD_CONTENT);
    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'db_query',
      toolArgs: { query: 'DROP TABLE users;' },
    };

    const decision = engine.evaluate(event);
    expect(decision.action).toBe('block');
    expect(decision.threatId).toBe('THREAT-001');
  });

  it('should allow safe queries', () => {
    const engine = createShieldEngine(SHIELD_CONTENT);
    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'db_query',
      toolArgs: { query: 'SELECT name FROM users WHERE id = 1' },
    };

    const decision = engine.evaluate(event);
    expect(decision.action).toBe('log');
    expect(decision.threatId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: evaluate — require_approval action
// ---------------------------------------------------------------------------

describe('engine.evaluate — require_approval', () => {
  it('should require approval for untrusted plugin install', () => {
    const engine = createShieldEngine(SHIELD_CONTENT);
    const event: ShieldEvent = {
      scope: 'skill.install',
      skillName: 'my-untrusted-package',
    };

    const decision = engine.evaluate(event);
    expect(decision.action).toBe('require_approval');
    expect(decision.threatId).toBe('THREAT-002');
  });
});

// ---------------------------------------------------------------------------
// Tests: evaluate — confidence threshold
// ---------------------------------------------------------------------------

describe('engine.evaluate — confidence threshold', () => {
  it('should downgrade block to require_approval when confidence < 0.85', () => {
    const engine = createShieldEngine(SHIELD_CONTENT);
    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'risky_tool',
    };

    const decision = engine.evaluate(event);
    // THREAT-003 has confidence 0.70 + action block + severity high
    // → should downgrade to require_approval
    expect(decision.action).toBe('require_approval');
  });

  it('should NOT downgrade critical + block even with low confidence', () => {
    const engine = createShieldEngine(SHIELD_CONTENT);
    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'extremely_dangerous_tool',
    };

    const decision = engine.evaluate(event);
    // THREAT-004 has confidence 0.70 + action block + severity critical
    // → critical + block overrides confidence threshold
    expect(decision.action).toBe('block');
    expect(decision.threatId).toBe('THREAT-004');
  });
});

// ---------------------------------------------------------------------------
// Tests: evaluate — log action
// ---------------------------------------------------------------------------

describe('engine.evaluate — log', () => {
  it('should log for monitoring-only threats', () => {
    const engine = createShieldEngine(SHIELD_CONTENT);
    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'monitored_tool',
    };

    const decision = engine.evaluate(event);
    expect(decision.action).toBe('log');
    expect(decision.threatId).toBe('THREAT-005');
  });
});

// ---------------------------------------------------------------------------
// Tests: evaluate — no match
// ---------------------------------------------------------------------------

describe('engine.evaluate — no match', () => {
  it('should return log with null threatId when no match', () => {
    const engine = createShieldEngine(SHIELD_CONTENT);
    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'perfectly_safe_tool',
      toolArgs: { text: 'hello world' },
    };

    const decision = engine.evaluate(event);
    expect(decision.action).toBe('log');
    expect(decision.threatId).toBeNull();
    expect(decision.reason).toContain('No threat match');
  });

  it('should return log for inactive engine', () => {
    const engine = createShieldEngine('');
    const event: ShieldEvent = {
      scope: 'tool.call',
      toolName: 'any_tool',
    };

    const decision = engine.evaluate(event);
    expect(decision.action).toBe('log');
    expect(decision.threatId).toBeNull();
  });
});
