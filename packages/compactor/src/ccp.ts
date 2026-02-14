/**
 * Compressed Context Protocol (CCP)
 *
 * Standalone utility for compressing text using abbreviation levels.
 * Three levels: ultra, medium, light — each with progressively less
 * aggressive transformations.
 *
 * This is a standalone utility, NOT part of the automatic compaction
 * pipeline. Callers invoke it explicitly when they want to reduce
 * token cost for expensive model calls.
 *
 * Ported from claw-compactor's compressed_context.py. Savings: 20-60%.
 *
 * Usage:
 *   import { compressContext } from '@tinyclaw/compactor';
 *   const result = compressContext(text, 'medium');
 *   // result.compressed — the compressed text
 *   // result.instructions — decompression hint for the model
 */

import { estimateTokens } from './tokens.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CcpLevel = 'ultra' | 'medium' | 'light';

export interface CcpResult {
  /** The compressed text. */
  compressed: string;
  /** Decompression instructions to prepend to system prompt. */
  instructions: string;
  /** The compression level used. */
  level: CcpLevel;
}

export interface CcpResultWithStats extends CcpResult {
  /** Token count of original text. */
  originalTokens: number;
  /** Token count of compressed text. */
  compressedTokens: number;
  /** Token count of decompression instructions. */
  instructionTokens: number;
  /** Net tokens (compressed + instructions). */
  netTokens: number;
  /** Reduction percentage (based on compressed vs original). */
  reductionPct: number;
}

// ---------------------------------------------------------------------------
// Decompression instructions (prepended to system/context)
// ---------------------------------------------------------------------------

const DECOMPRESS_INSTRUCTIONS: Record<CcpLevel, string> = {
  ultra:
    'Compressed notation: key:val=attribute, loc:X+Y=locations, ' +
    'Ny+=N+ years, slash-separated=alternatives. ' +
    'Expand naturally when responding.',
  medium:
    'Text uses abbreviated notation: key:value pairs, ' +
    'condensed lists, minimal punctuation. Read as natural language.',
  light: 'Text is lightly condensed. Read normally.',
};

// ---------------------------------------------------------------------------
// Abbreviation maps
// ---------------------------------------------------------------------------

/** Ultra-mode abbreviations (aggressive). */
const ULTRA_ABBREVS: Record<string, string> = {
  experience: 'exp',
  management: 'mgmt',
  development: 'dev',
  approximately: '~',
  application: 'app',
  applications: 'apps',
  configuration: 'config',
  information: 'info',
  environment: 'env',
  infrastructure: 'infra',
  architecture: 'arch',
  implementation: 'impl',
  performance: 'perf',
  operations: 'ops',
  production: 'prod',
  repository: 'repo',
  repositories: 'repos',
  documentation: 'docs',
  communication: 'comms',
  organization: 'org',
  technology: 'tech',
  technologies: 'tech',
  authentication: 'auth',
  authorization: 'authz',
  database: 'db',
  kubernetes: 'k8s',
  continuous: 'cont',
  integration: 'integ',
  deployment: 'deploy',
  monitoring: 'mon',
  notification: 'notif',
  requirements: 'reqs',
  specification: 'spec',
  administrator: 'admin',
  description: 'desc',
  transaction: 'tx',
  transactions: 'txs',
  engineering: 'eng',
};

/** Medium-mode abbreviations (moderate). */
const MEDIUM_ABBREVS: Record<string, string> = {
  configuration: 'config',
  application: 'app',
  environment: 'env',
  infrastructure: 'infra',
  implementation: 'impl',
  documentation: 'docs',
  database: 'db',
  kubernetes: 'k8s',
};

/** Filler phrases to remove. */
const FILLERS = [
  'In addition,',
  'Furthermore,',
  'Moreover,',
  'Additionally,',
  'It is worth noting that',
  'It should be noted that',
  'As a matter of fact,',
  'In fact,',
  'Actually,',
  'Basically,',
  'Essentially,',
  'In other words,',
  'That being said,',
  'Having said that,',
  'At the end of the day,',
  'When it comes to',
  'In terms of',
  'With regard to',
  'With respect to',
  'As mentioned earlier,',
  'As previously stated,',
  'It is important to note that',
  'Please note that',
  'In conclusion,',
  'To summarize,',
  'To sum up,',
];

// ---------------------------------------------------------------------------
// Compression functions
// ---------------------------------------------------------------------------

function replaceWord(text: string, word: string, replacement: string): string {
  return text.replace(new RegExp(`\\b${word}\\b`, 'gi'), replacement);
}

function compressUltra(text: string): string {
  if (!text) return '';
  let result = text;

  // Remove fillers
  for (const filler of FILLERS) {
    result = result.replaceAll(filler, '');
  }

  // Apply abbreviations
  for (const [word, abbrev] of Object.entries(ULTRA_ABBREVS)) {
    result = replaceWord(result, word, abbrev);
  }

  // Remove articles and common short fillers
  result = replaceWord(result, 'the', '');
  result = replaceWord(result, 'a', '');
  result = replaceWord(result, 'an', '');
  result = replaceWord(result, 'is', '');
  result = replaceWord(result, 'are', '');
  result = replaceWord(result, 'was', '');
  result = replaceWord(result, 'were', '');
  result = replaceWord(result, 'has', '');
  result = replaceWord(result, 'have', '');
  result = replaceWord(result, 'had', '');
  result = replaceWord(result, 'been', '');
  result = replaceWord(result, 'being', '');

  // Shorthand replacements
  result = replaceWord(result, 'and', '+');
  result = replaceWord(result, 'with', 'w/');
  result = replaceWord(result, 'for', '4');

  // Clean up spacing
  result = result.replace(/  +/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.replace(/^\s+/gm, '');

  return result.trim();
}

function compressMedium(text: string): string {
  if (!text) return '';
  let result = text;

  // Apply medium abbreviations only
  for (const [word, abbrev] of Object.entries(MEDIUM_ABBREVS)) {
    result = replaceWord(result, word, abbrev);
  }

  // Remove only the most common fillers
  for (const filler of FILLERS.slice(0, 5)) {
    result = result.replaceAll(filler, '');
  }

  // Clean up
  result = result.replace(/  +/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

function compressLight(text: string): string {
  if (!text) return '';
  let result = text;
  result = result.replace(/  +/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compress text at the specified CCP level.
 *
 * @param text - The text to compress.
 * @param level - Compression level: 'ultra', 'medium', or 'light'.
 * @returns Compressed text and decompression instructions.
 */
export function compressContext(text: string, level: CcpLevel = 'medium'): CcpResult {
  const compressors: Record<CcpLevel, (t: string) => string> = {
    ultra: compressUltra,
    medium: compressMedium,
    light: compressLight,
  };

  const compressor = compressors[level];
  if (!compressor) {
    throw new Error(`Invalid CCP level: ${level}. Use: ultra, medium, light`);
  }

  return {
    compressed: compressor(text),
    instructions: DECOMPRESS_INSTRUCTIONS[level],
    level,
  };
}

/**
 * Compress text and return statistics.
 *
 * @param text - The text to compress.
 * @param level - Compression level: 'ultra', 'medium', or 'light'.
 * @returns Compressed text, instructions, and token statistics.
 */
export function compressContextWithStats(
  text: string,
  level: CcpLevel = 'medium',
): CcpResultWithStats {
  const result = compressContext(text, level);
  const originalTokens = estimateTokens(text);
  const compressedTokens = estimateTokens(result.compressed);
  const instructionTokens = estimateTokens(result.instructions);
  const netTokens = compressedTokens + instructionTokens;
  const reductionPct =
    originalTokens > 0
      ? Math.round(((originalTokens - compressedTokens) / originalTokens) * 1000) / 10
      : 0;

  return {
    ...result,
    originalTokens,
    compressedTokens,
    instructionTokens,
    netTokens,
    reductionPct,
  };
}
