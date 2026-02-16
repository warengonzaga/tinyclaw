/**
 * Shield Public API
 *
 * Runtime SHIELD.md enforcement for Tiny Claw AI agents.
 * Parses the SHIELD.md threat feed and provides a deterministic decision
 * engine that evaluates events against active threats.
 *
 * @example
 * ```typescript
 * import { createShieldEngine } from '@tinyclaw/shield';
 *
 * const shield = createShieldEngine(shieldMdContent);
 *
 * const decision = shield.evaluate({
 *   scope: 'tool.call',
 *   toolName: 'execute_code',
 *   toolArgs: { code: 'process.exit()' },
 * });
 *
 * if (decision.action === 'block') {
 *   // Halt — do not execute
 * }
 * ```
 */

// Engine
export { createShieldEngine } from './engine.js';

// Parser
export { parseShieldContent, parseThreatBlock, parseAllThreats } from './parser.js';

// Matcher
export { matchEvent, parseDirectives } from './matcher.js';
export type { Directive, MatchResult } from './matcher.js';
