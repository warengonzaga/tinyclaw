/**
 * Shield Parser
 *
 * Parses SHIELD.md markdown content into structured ThreatEntry objects.
 * Extracts YAML-like threat blocks from markdown sections and validates
 * required fields.
 *
 * The parser handles the SHIELD.md v0.1 format:
 * - YAML frontmatter (name, description, version)
 * - Threat blocks inside ### THREAT-XXX sections with fenced code blocks
 * - recommendation_agent multi-line strings
 */

import type { ShieldAction, ThreatCategory, ThreatEntry, ThreatSeverity } from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'prompt',
  'tool',
  'mcp',
  'memory',
  'supply_chain',
  'vulnerability',
  'fraud',
  'policy_bypass',
  'anomaly',
  'skill',
  'other',
]);

const VALID_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high', 'medium', 'low']);

const VALID_ACTIONS: ReadonlySet<string> = new Set(['block', 'require_approval', 'log']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a single-line YAML-like field value from a block of text.
 * Handles values with and without quotes.
 */
function extractField(block: string, field: string): string | null {
  // Match "field: value" or "field: 'value'" or 'field: "value"'
  const regex = new RegExp(`^${field}:\\s*(.+)$`, 'm');
  const match = block.match(regex);
  if (!match) return null;

  let value = match[1].trim();

  // Strip surrounding quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value;
}

/**
 * Extract a multi-line YAML-like field value (uses | or > syntax).
 * Falls back to reading until the next field or end of block.
 */
function extractMultilineField(block: string, field: string): string {
  // Match "field: |" or "field: >" followed by indented lines
  const pipeRegex = new RegExp(`^${field}:\\s*[|>]\\s*$`, 'm');
  const pipeMatch = pipeRegex.exec(block);

  if (pipeMatch) {
    const startIdx = pipeMatch.index + pipeMatch[0].length;
    const rest = block.slice(startIdx);
    const lines: string[] = [];

    for (const line of rest.split('\n')) {
      // Multi-line block ends at a non-indented line or end of content
      if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
        break;
      }
      lines.push(line);
    }

    return lines.join('\n').trim();
  }

  // Fallback: single-line value
  const value = extractField(block, field);
  return value ?? '';
}

/**
 * Extract a multi-line description field that uses YAML > syntax.
 */
function extractDescription(block: string): string {
  return extractMultilineField(block, 'description');
}

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

/**
 * Parse SHIELD.md content into an array of ThreatEntry objects.
 *
 * Only returns valid, non-revoked, non-expired threats.
 *
 * @param content - Raw SHIELD.md markdown content
 * @returns Array of parsed and validated threat entries
 */
export function parseShieldContent(content: string): ThreatEntry[] {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const threats: ThreatEntry[] = [];

  // Find all fenced code blocks that contain threat definitions.
  // Threat blocks are identified by having an "id: THREAT-" field.
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match = codeBlockRegex.exec(content);

  while (match !== null) {
    const block = match[0];

    // Strip the opening/closing fences
    const inner = block
      .replace(/^```\w*\s*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    // Only process blocks that look like threat definitions
    if (!inner.includes('id: THREAT-')) {
      match = codeBlockRegex.exec(content);
      continue;
    }

    const entry = parseThreatBlock(inner);
    if (entry) {
      threats.push(entry);
    }
    match = codeBlockRegex.exec(content);
  }

  return threats;
}

/**
 * Parse a single threat block into a ThreatEntry.
 *
 * @param block - Raw text content of the threat block (without fences)
 * @returns Parsed ThreatEntry or null if invalid
 */
export function parseThreatBlock(block: string): ThreatEntry | null {
  const id = extractField(block, 'id');
  if (!id) return null;

  const fingerprint = extractField(block, 'fingerprint') ?? '';
  const category = extractField(block, 'category') ?? '';
  const severity = extractField(block, 'severity') ?? '';
  const confidence = parseFloat(extractField(block, 'confidence') ?? '0');
  const action = extractField(block, 'action') ?? '';
  const title = extractField(block, 'title') ?? '';
  const description = extractDescription(block);
  const recommendationAgent = extractMultilineField(block, 'recommendation_agent');
  const expiresAt = extractField(block, 'expires_at');
  const revoked = extractField(block, 'revoked');
  const revokedAt = extractField(block, 'revoked_at');

  // Validate required fields
  if (!VALID_CATEGORIES.has(category)) return null;
  if (!VALID_SEVERITIES.has(severity)) return null;
  if (!VALID_ACTIONS.has(action)) return null;
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) return null;

  // Filter out revoked threats
  if (revoked === 'true') return null;

  // Filter out expired threats (enforce ISO 8601 format)
  if (expiresAt && expiresAt !== 'null') {
    if (
      !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(expiresAt)
    ) {
      return null; // Reject non-ISO date strings
    }
    const expiryDate = new Date(expiresAt);
    if (!Number.isNaN(expiryDate.getTime()) && expiryDate.getTime() < Date.now()) {
      return null;
    }
  }

  return {
    id,
    fingerprint,
    category: category as ThreatCategory,
    severity: severity as ThreatSeverity,
    confidence,
    action: action as ShieldAction,
    title,
    description,
    recommendationAgent,
    expiresAt: expiresAt === 'null' || !expiresAt ? null : expiresAt,
    revoked: false,
    revokedAt: revokedAt === 'null' || !revokedAt ? null : revokedAt,
  };
}

/**
 * Parse all threats including revoked/expired (for debugging/audit).
 *
 * @param content - Raw SHIELD.md markdown content
 * @returns Array of all parsed threat entries (no filtering)
 */
export function parseAllThreats(content: string): ThreatEntry[] {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const threats: ThreatEntry[] = [];
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match = codeBlockRegex.exec(content);

  while (match !== null) {
    const block = match[0];
    const inner = block
      .replace(/^```\w*\s*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    if (!inner.includes('id: THREAT-')) {
      match = codeBlockRegex.exec(content);
      continue;
    }

    const entry = parseThreatBlockRaw(inner);
    if (entry) threats.push(entry);
    match = codeBlockRegex.exec(content);
  }

  return threats;
}

/**
 * Parse a threat block without revocation/expiry filtering.
 */
function parseThreatBlockRaw(block: string): ThreatEntry | null {
  const id = extractField(block, 'id');
  if (!id) return null;

  const fingerprint = extractField(block, 'fingerprint') ?? '';
  const category = extractField(block, 'category') ?? '';
  const severity = extractField(block, 'severity') ?? '';
  const confidence = parseFloat(extractField(block, 'confidence') ?? '0');
  const action = extractField(block, 'action') ?? '';
  const title = extractField(block, 'title') ?? '';
  const description = extractDescription(block);
  const recommendationAgent = extractMultilineField(block, 'recommendation_agent');
  const expiresAt = extractField(block, 'expires_at');
  const revoked = extractField(block, 'revoked');
  const revokedAt = extractField(block, 'revoked_at');

  if (!VALID_CATEGORIES.has(category)) return null;
  if (!VALID_SEVERITIES.has(severity)) return null;
  if (!VALID_ACTIONS.has(action)) return null;
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) return null;

  return {
    id,
    fingerprint,
    category: category as ThreatCategory,
    severity: severity as ThreatSeverity,
    confidence,
    action: action as ShieldAction,
    title,
    description,
    recommendationAgent,
    expiresAt: expiresAt === 'null' || !expiresAt ? null : expiresAt,
    revoked: revoked === 'true',
    revokedAt: revokedAt === 'null' || !revokedAt ? null : revokedAt,
  };
}
