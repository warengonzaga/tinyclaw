/**
 * Shield Matcher
 *
 * Matches shield events against threat entries using the recommendation_agent
 * mini-syntax defined in the SHIELD.md v0.1 spec.
 *
 * Supported directives:
 *   BLOCK: <condition>
 *   APPROVE: <condition>   (maps to require_approval)
 *   LOG: <condition>
 *
 * Supported conditions:
 *   - skill name equals <value>
 *   - skill name contains <value>
 *   - outbound request to <domain>
 *   - secrets read path equals <value>
 *   - file path equals <value>
 *   - file path contains <value>
 *   - tool.call <tool_name> with <condition>
 *
 * Operators: OR
 */

import type { ShieldAction, ShieldEvent, ShieldScope, ThreatEntry } from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single parsed directive from recommendation_agent. */
export interface Directive {
  action: ShieldAction;
  condition: string;
}

/** A match result with the triggering directive and threat. */
export interface MatchResult {
  threat: ThreatEntry;
  directive: Directive;
  matchedOn: string;
  matchValue: string;
}

// ---------------------------------------------------------------------------
// Directive parsing
// ---------------------------------------------------------------------------

/**
 * Parse recommendation_agent text into an array of directives.
 *
 * Each line starting with BLOCK:, APPROVE:, or LOG: becomes a directive.
 * APPROVE maps to the 'require_approval' action.
 */
export function parseDirectives(recommendationAgent: string): Directive[] {
  if (!recommendationAgent) return [];

  const directives: Directive[] = [];
  const lines = recommendationAgent.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let action: ShieldAction | null = null;
    let condition = '';

    if (line.startsWith('BLOCK:')) {
      action = 'block';
      condition = line.slice('BLOCK:'.length).trim();
    } else if (line.startsWith('APPROVE:')) {
      action = 'require_approval';
      condition = line.slice('APPROVE:'.length).trim();
    } else if (line.startsWith('LOG:')) {
      action = 'log';
      condition = line.slice('LOG:'.length).trim();
    }

    if (action && condition) {
      directives.push({ action, condition });
    }
  }

  return directives;
}

// ---------------------------------------------------------------------------
// Scope-to-category alignment
// ---------------------------------------------------------------------------

/** Maps shield scopes to compatible threat categories. */
const SCOPE_CATEGORY_MAP: Record<ShieldScope, ReadonlySet<string>> = {
  prompt: new Set(['prompt']),
  'skill.install': new Set(['skill', 'supply_chain']),
  'skill.execute': new Set(['skill', 'tool']),
  'tool.call': new Set(['tool', 'prompt', 'memory', 'vulnerability', 'policy_bypass', 'anomaly']),
  'network.egress': new Set(['supply_chain']),
  'secrets.read': new Set(['tool', 'vulnerability']),
  mcp: new Set(['mcp']),
};

/**
 * Check if a threat's category is compatible with the event's scope.
 */
function isScopeCompatible(scope: ShieldScope, category: string): boolean {
  const compatible = SCOPE_CATEGORY_MAP[scope];
  return compatible ? compatible.has(category) : false;
}

// ---------------------------------------------------------------------------
// Condition matching
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a condition string matches the given shield event.
 *
 * Returns the matched field name and value, or null if no match.
 */
function evaluateCondition(
  condition: string,
  event: ShieldEvent,
): { matchedOn: string; matchValue: string } | null {
  const lc = condition.toLowerCase();

  // --- tool.call conditions ---
  // "tool.call <tool_name> with <sub_condition>"
  // "tool.call with arguments containing <pattern>"
  if (lc.startsWith('tool.call')) {
    if (!event.toolName) return null;

    const toolNameLower = event.toolName.toLowerCase();

    // "tool.call execute_code with code accessing process global"
    // Match if the tool name appears in the condition
    const afterToolCall = condition.slice('tool.call'.length).trim();

    if (
      afterToolCall.toLowerCase().startsWith(toolNameLower) ||
      afterToolCall.toLowerCase().includes(toolNameLower)
    ) {
      return { matchedOn: 'tool.call', matchValue: event.toolName };
    }

    // "tool.call with arguments containing SQL syntax (DROP, DELETE, UNION, --)"
    if (lc.includes('arguments containing')) {
      const argsStr = JSON.stringify(event.toolArgs ?? {}).toLowerCase();
      // Extract keywords from parenthetical list
      const openIdx = condition.indexOf('(');
      const closeIdx = openIdx >= 0 ? condition.indexOf(')', openIdx + 1) : -1;
      if (openIdx >= 0 && closeIdx > openIdx) {
        const keywords = condition
          .slice(openIdx + 1, closeIdx)
          .split(',')
          .map((k) => k.trim().toLowerCase());
        for (const keyword of keywords) {
          if (keyword && argsStr.includes(keyword)) {
            return { matchedOn: 'tool.args', matchValue: keyword };
          }
        }
      }
    }

    return null;
  }

  // --- skill name conditions ---
  if (lc.includes('skill name equals') || lc.includes('skill.install')) {
    if (!event.skillName) return null;
    // Extract the value after "equals"
    const equalsMatch = condition.match(/equals\s+(.+)/i);
    if (equalsMatch) {
      const expected = equalsMatch[1].trim().toLowerCase();
      if (event.skillName.toLowerCase() === expected) {
        return { matchedOn: 'skill.name', matchValue: event.skillName };
      }
    }
    return null;
  }

  if (lc.includes('skill name contains')) {
    if (!event.skillName) return null;
    const containsMatch = condition.match(/contains\s+(.+)/i);
    if (containsMatch) {
      const expected = containsMatch[1].trim().toLowerCase();
      if (event.skillName.toLowerCase().includes(expected)) {
        return { matchedOn: 'skill.name', matchValue: event.skillName };
      }
    }
    return null;
  }

  // --- Plugin naming convention check ---
  if (lc.includes('plugin package name') && lc.includes('does not match')) {
    if (!event.skillName) return null;
    // Check if the plugin name follows @tinyclaw/plugin-* convention
    if (!event.skillName.match(/^@tinyclaw\/plugin-(channel|provider|tool)-/)) {
      return { matchedOn: 'skill.name', matchValue: event.skillName };
    }
    return null;
  }

  // --- Outbound request / domain conditions ---
  if (lc.includes('outbound request to')) {
    if (!event.domain) return null;
    const domainMatch = condition.match(/outbound request to\s+(.+)/i);
    if (domainMatch) {
      const expected = domainMatch[1].trim().toLowerCase();
      const eventDomain = event.domain.toLowerCase();

      // Handle OR operator
      if (expected.includes(' or ')) {
        const alternatives = expected.split(' or ');
        for (const alt of alternatives) {
          const trimmed = alt.trim();
          if (eventDomain === trimmed || eventDomain.endsWith(`.${trimmed}`)) {
            return { matchedOn: 'domain', matchValue: event.domain };
          }
        }
        return null;
      }

      if (eventDomain === expected || eventDomain.endsWith(`.${expected}`)) {
        return { matchedOn: 'domain', matchValue: event.domain };
      }
    }
    return null;
  }

  // --- Secrets read path ---
  if (lc.includes('secrets read path equals') || lc.includes('secrets read path')) {
    if (!event.secretPath) return null;
    const pathMatch = condition.match(/(?:equals|path)\s+(.+)/i);
    if (pathMatch) {
      const expected = pathMatch[1].trim();
      // Support wildcard: provider.*.apiKey
      if (expected.includes('*')) {
        const escaped = expected.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&').replace(/\\\*/g, '[^.]+');
        const regex = new RegExp(`^${escaped}$`);
        if (regex.test(event.secretPath)) {
          return { matchedOn: 'secrets.path', matchValue: event.secretPath };
        }
      } else if (event.secretPath === expected) {
        return { matchedOn: 'secrets.path', matchValue: event.secretPath };
      }
    }
    return null;
  }

  // --- File path conditions ---
  if (lc.includes('file path equals')) {
    const pathMatch = condition.match(/file path equals\s+(.+)/i);
    if (pathMatch) {
      const expected = pathMatch[1].trim();
      const toolArgs = event.toolArgs ?? {};
      const filePath = String(toolArgs.filename ?? toolArgs.file_path ?? toolArgs.path ?? '');
      if (filePath === expected) {
        return { matchedOn: 'file.path', matchValue: filePath };
      }
    }
    return null;
  }

  if (lc.includes('file path contains')) {
    const pathMatch = condition.match(/file path contains\s+(.+)/i);
    if (pathMatch) {
      const expected = pathMatch[1].trim();
      const toolArgs = event.toolArgs ?? {};
      const filePath = String(toolArgs.filename ?? toolArgs.file_path ?? toolArgs.path ?? '');
      if (filePath.includes(expected)) {
        return { matchedOn: 'file.path', matchValue: filePath };
      }
    }
    return null;
  }

  // --- Incoming message / prompt conditions ---
  if (lc.includes('incoming message contains')) {
    if (!event.inputText) return null;
    const inputLower = event.inputText.toLowerCase();
    const msgMatch = condition.match(/incoming message contains\s+(.+)/i);
    if (msgMatch) {
      const expected = msgMatch[1].trim().toLowerCase();
      if (inputLower.includes(expected)) {
        return { matchedOn: 'prompt.text', matchValue: expected };
      }
    }
    return null;
  }

  // --- Memory conditions ---
  if (lc.includes('memory_add') || lc.includes('importance')) {
    if (
      event.toolName?.toLowerCase() === 'memory_add' ||
      event.toolName?.toLowerCase() === 'heartware_write'
    ) {
      const importance = Number(event.toolArgs?.importance ?? 0);

      if (lc.includes('importance >=')) {
        const threshMatch = condition.match(/importance\s*>=\s*([\d.]+)/);
        if (threshMatch && importance >= parseFloat(threshMatch[1])) {
          return { matchedOn: 'tool.args', matchValue: `importance=${importance}` };
        }
      }
      if (lc.includes('importance <')) {
        const threshMatch = condition.match(/importance\s*<\s*([\d.]+)/);
        if (threshMatch && importance < parseFloat(threshMatch[1])) {
          return { matchedOn: 'tool.args', matchValue: `importance=${importance}` };
        }
      }
      if (lc.includes('content containing instruction-like patterns')) {
        const content = String(event.toolArgs?.content ?? event.toolArgs?.value ?? '');
        const instructionPatterns = [
          /you must/i,
          /ignore previous/i,
          /from now on/i,
          /your new instructions/i,
          /override/i,
          /disregard/i,
        ];
        for (const pattern of instructionPatterns) {
          if (pattern.test(content)) {
            return { matchedOn: 'tool.args', matchValue: content.slice(0, 50) };
          }
        }
      }
      return { matchedOn: 'tool.call', matchValue: event.toolName ?? '' };
    }
    return null;
  }

  // --- Delegation depth conditions ---
  if (lc.includes('delegation chain depth exceeds')) {
    const depthMatch = condition.match(/exceeds\s+(\d+)/);
    if (depthMatch) {
      const maxDepth = parseInt(depthMatch[1], 10);
      const currentDepth = Number(event.toolArgs?.depth ?? 0);
      if (currentDepth > maxDepth) {
        return { matchedOn: 'delegation.depth', matchValue: `${currentDepth}` };
      }
    }
    return null;
  }

  // --- Rate limit conditions ---
  if (lc.includes('tool iterations approaching') || lc.includes('iterations')) {
    const iterMatch = condition.match(/>=\s*(\d+)/);
    if (iterMatch) {
      const threshold = parseInt(iterMatch[1], 10);
      const iterations = Number(event.toolArgs?.iterations ?? 0);
      if (iterations >= threshold) {
        return { matchedOn: 'tool.iterations', matchValue: `${iterations}` };
      }
    }
    return null;
  }

  if (lc.includes('modify ratelimit config at runtime')) {
    if (
      event.toolName?.toLowerCase().includes('config') &&
      event.toolArgs?.key === 'security.rateLimit'
    ) {
      return { matchedOn: 'tool.call', matchValue: 'rateLimit modification' };
    }
    return null;
  }

  // --- Generic contains matching (fallback) ---
  // For conditions we don't have a specific handler for, do a broad
  // string match against the event's contextual fields.
  if (event.toolName) {
    const toolNameLower = event.toolName.toLowerCase();
    if (lc.includes(toolNameLower)) {
      return { matchedOn: 'tool.call', matchValue: event.toolName };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main matching function
// ---------------------------------------------------------------------------

/**
 * Match a shield event against a list of threat entries.
 *
 * Returns all matching results. The caller (engine) is responsible for
 * selecting the strongest match based on priority rules.
 *
 * @param event - The event to evaluate
 * @param threats - Active threat entries to match against
 * @returns Array of match results, may be empty
 */
export function matchEvent(event: ShieldEvent, threats: ThreatEntry[]): MatchResult[] {
  const results: MatchResult[] = [];

  for (const threat of threats) {
    // Check scope-category alignment
    if (!isScopeCompatible(event.scope, threat.category)) {
      continue;
    }

    // Parse and evaluate recommendation_agent directives
    const directives = parseDirectives(threat.recommendationAgent);

    for (const directive of directives) {
      const match = evaluateCondition(directive.condition, event);
      if (match) {
        results.push({
          threat,
          directive,
          matchedOn: match.matchedOn,
          matchValue: match.matchValue,
        });
        // Only take the first matching directive per threat
        break;
      }
    }
  }

  return results;
}
