/**
 * Orientation System
 *
 * Builds shared-knowledge context for sub-agents from the primary agent's
 * heartware, learned preferences, and memories. This is the "freelancer
 * orientation packet" — giving sub-agents context before they start work.
 */

import type { LearningEngine } from '@tinyclaw/types';
import type { DelegationStore } from './store.js';
import type { OrientationContext } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IDENTITY_CHARS = 1600;
const MAX_PREFERENCES_CHARS = 800;
const MAX_MEMORIES_CHARS = 800;
const MAX_COMPACTED_CONTEXT_CHARS = 800;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build orientation context from the primary agent's knowledge systems.
 *
 * - identity: Extracted from heartwareContext (SOUL, IDENTITY, USER)
 * - preferences: From learning engine (preferences + corrections)
 * - memories: From DB memory table (key-value pairs)
 */
export function buildOrientationContext(config: {
  heartwareContext: string;
  learning: LearningEngine;
  db: DelegationStore;
  userId: string;
  getCompactedContext?: (userId: string) => string | null;
}): OrientationContext {
  const { heartwareContext, learning, db, userId, getCompactedContext } = config;

  // 1. Identity — truncate heartware context to keep prompt lean
  const identity = heartwareContext ? truncate(heartwareContext, MAX_IDENTITY_CHARS) : '';

  // 2. Preferences — from learning engine
  const learnedContext = learning.getContext();
  let preferences = '';
  if (learnedContext.preferences) {
    preferences += learnedContext.preferences;
  }
  if (learnedContext.recentCorrections) {
    if (preferences) preferences += '\n';
    preferences += learnedContext.recentCorrections;
  }
  preferences = truncate(preferences, MAX_PREFERENCES_CHARS);

  // 3. Memories — from DB key-value store
  const memoryMap = db.getMemory(userId);
  const memoryEntries = Object.entries(memoryMap);
  let memories = '';
  if (memoryEntries.length > 0) {
    memories = memoryEntries.map(([key, value]) => `- ${key}: ${value}`).join('\n');
    memories = truncate(memories, MAX_MEMORIES_CHARS);
  }

  // 4. Compacted conversation context (L0 tier, ~200 tokens)
  const rawCompactedContext = getCompactedContext?.(userId) ?? undefined;
  const compactedContext = rawCompactedContext
    ? truncate(rawCompactedContext, MAX_COMPACTED_CONTEXT_CHARS)
    : undefined;

  return { identity, preferences, memories, compactedContext };
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Format orientation context into a prompt section for sub-agents.
 */
export function formatOrientation(ctx: OrientationContext): string {
  const sections: string[] = [];

  sections.push('=== ORIENTATION ===');

  if (ctx.identity) {
    sections.push('## Identity & Personality');
    sections.push(ctx.identity);
  }

  if (ctx.preferences) {
    sections.push('## User Preferences');
    sections.push(ctx.preferences);
  }

  if (ctx.memories) {
    sections.push('## Key Memories');
    sections.push(ctx.memories);
  }

  if (ctx.compactedContext) {
    sections.push('## Conversation Context');
    sections.push(ctx.compactedContext);
  }

  sections.push('=== END ORIENTATION ===');

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}
