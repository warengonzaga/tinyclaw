/**
 * Shield Engine
 *
 * The core decision engine that evaluates shield events against parsed
 * threat entries and returns deterministic decisions following the
 * SHIELD.md v0.1 specification.
 *
 * Decision rules:
 * 1. Match event against active threats using matcher
 * 2. Apply confidence threshold (>= 0.85 enforceable, < 0.85 → require_approval)
 * 3. If multiple threats match, strongest action wins: block > require_approval > log
 * 4. If no match: action = log (default safe behavior)
 */

import { logger } from '@tinyclaw/logger';
import type {
  ShieldAction,
  ShieldDecision,
  ShieldEngine,
  ShieldEvent,
  ThreatEntry,
} from '@tinyclaw/types';
import { matchEvent } from './matcher.js';
import { parseShieldContent } from './parser.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Confidence threshold per SHIELD.md v0.1 spec. */
const CONFIDENCE_THRESHOLD = 0.85;

/** Action priority: higher number = stronger action. */
const ACTION_PRIORITY: Record<ShieldAction, number> = {
  log: 0,
  require_approval: 1,
  block: 2,
};

// ---------------------------------------------------------------------------
// Default decision (no match)
// ---------------------------------------------------------------------------

function defaultDecision(scope: ShieldEvent['scope']): ShieldDecision {
  return {
    action: 'log',
    scope,
    threatId: null,
    fingerprint: null,
    matchedOn: null,
    matchValue: null,
    reason: 'No threat match — proceeding normally',
  };
}

// ---------------------------------------------------------------------------
// Engine implementation
// ---------------------------------------------------------------------------

/**
 * Create a shield engine from raw SHIELD.md content.
 *
 * Parses the content once at creation time and reuses the parsed threats
 * for all subsequent evaluations.
 *
 * @param content - Raw SHIELD.md markdown content
 * @returns ShieldEngine instance
 */
export function createShieldEngine(content: string): ShieldEngine {
  const threats = parseShieldContent(content);

  logger.info('Shield engine initialized', {
    activeThreats: threats.length,
    threatIds: threats.map((t) => t.id),
  });

  return {
    evaluate(event: ShieldEvent): ShieldDecision {
      if (threats.length === 0) {
        return defaultDecision(event.scope);
      }

      const matches = matchEvent(event, threats);

      if (matches.length === 0) {
        return defaultDecision(event.scope);
      }

      // Resolve the strongest action across all matches.
      // For each match, apply confidence threshold adjustments first.
      let strongestAction: ShieldAction = 'log';
      let strongestMatch = matches[0];

      for (const match of matches) {
        let effectiveAction = match.directive.action;

        // Confidence threshold per spec:
        // >= 0.85: enforceable at declared action level
        // < 0.85: default to require_approval, unless severity is
        //         critical AND action is block.
        if (match.threat.confidence < CONFIDENCE_THRESHOLD) {
          if (!(match.threat.severity === 'critical' && effectiveAction === 'block')) {
            effectiveAction = 'require_approval';
          }
        }

        if (ACTION_PRIORITY[effectiveAction] > ACTION_PRIORITY[strongestAction]) {
          strongestAction = effectiveAction;
          strongestMatch = match;
        }
      }

      // Apply the same confidence adjustment to the final winning match
      let finalAction = strongestMatch.directive.action;
      if (strongestMatch.threat.confidence < CONFIDENCE_THRESHOLD) {
        if (!(strongestMatch.threat.severity === 'critical' && finalAction === 'block')) {
          finalAction = 'require_approval';
        }
      }
      // Use the strongest resolved action (may differ from winning match's
      // adjusted action if multiple matches contributed)
      if (ACTION_PRIORITY[strongestAction] > ACTION_PRIORITY[finalAction]) {
        finalAction = strongestAction;
      }

      const decision: ShieldDecision = {
        action: finalAction,
        scope: event.scope,
        threatId: strongestMatch.threat.id,
        fingerprint: strongestMatch.threat.fingerprint,
        matchedOn: strongestMatch.matchedOn,
        matchValue: strongestMatch.matchValue,
        reason: `${strongestMatch.threat.title} (${strongestMatch.threat.severity}, confidence: ${strongestMatch.threat.confidence})`,
      };

      logger.info('Shield decision', {
        action: decision.action,
        threatId: decision.threatId,
        matchedOn: decision.matchedOn,
        matchValue: decision.matchValue,
      });

      return decision;
    },

    isActive(): boolean {
      return threats.length > 0;
    },

    getThreats(): ThreatEntry[] {
      return [...threats];
    },
  };
}
