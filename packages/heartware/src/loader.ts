/**
 * Heartware Context Loader
 *
 * Loads heartware configuration files into agent context in priority order:
 * 1. SOUL.md - Personality first
 * 2. IDENTITY.md - Who the agent is
 * 3. FRIEND.md - Who the owner is
 * 3b. FRIENDS.md - People I've met (non-owner friends)
 * 4. AGENTS.md - Operating instructions
 * 5. TOOLS.md - Tool usage notes
 * 6. SHIELD.md - Runtime security policy
 * 7. Recent memory files (today + yesterday)
 *
 * This context is injected into the agent's system prompt on startup
 */

import type { HeartwareManager } from './manager.js';
import { loadCachedCreatorMeta } from './meta.js';

/** Label used for creator meta in heartware context */
const META_CACHE_LABEL = 'CREATOR.md — About My Creator';

/**
 * Load heartware context for injection into agent system prompt
 *
 * @param manager - Initialized HeartwareManager instance
 * @returns Formatted context string for system prompt
 */
export async function loadHeartwareContext(manager: HeartwareManager): Promise<string> {
  const loadOrder = [
    'SOUL.md', // Load first - defines personality
    'IDENTITY.md', // Who the agent is
    'FRIEND.md', // Who the owner is
    'FRIENDS.md', // People I've met (non-owner friends)
    'AGENTS.md', // Operating instructions
    'TOOLS.md', // Tool usage notes
    'SHIELD.md', // Runtime security policy
  ];

  let context = '\n\n=== HEARTWARE CONFIGURATION ===\n';

  // Add soul seed immutability notice
  try {
    const seed = await manager.getSeed();
    if (seed !== undefined) {
      context += `\n> SOUL.md is immutable — permanently generated from soul seed \`${seed}\`.`;
      context +=
        '\n> Your personality traits, preferences, and quirks are permanent. Embrace them.\n';
    }
  } catch {
    // Seed might not exist yet
  }

  // Load configuration files in priority order
  for (const file of loadOrder) {
    try {
      const content = await manager.read(file);
      context += `\n\n--- ${file} ---\n${content}`;
    } catch (_err) {
      // File might not exist yet (first run)
      context += `\n\n--- ${file} ---\n[Not configured yet]`;
    }
  }

  // Load recent memories (today + yesterday)
  try {
    const recentMemories = await loadRecentMemories(manager, 1);
    if (recentMemories) {
      context += `\n\n--- Recent Memory ---\n${recentMemories}`;
    }
  } catch (_err) {
    // No recent memories - this is fine
  }

  // Load creator metadata (cached from remote)
  try {
    const creatorMeta = await loadCachedCreatorMeta(manager.getBaseDir());
    if (creatorMeta) {
      context += `\n\n--- ${META_CACHE_LABEL} ---\n${creatorMeta}`;
    }
  } catch {
    // Creator meta not available - this is fine
  }

  context += '\n\n=== END HEARTWARE CONFIGURATION ===\n';

  return context;
}

/**
 * Load raw SHIELD.md content for the shield engine parser.
 *
 * This returns the unprocessed markdown content so the shield engine
 * can parse it into structured threat entries independently of the
 * system prompt injection.
 *
 * @param manager - Initialized HeartwareManager instance
 * @returns Raw SHIELD.md content string, or empty string if not found
 */
export async function loadShieldContent(manager: HeartwareManager): Promise<string> {
  try {
    return await manager.read('SHIELD.md');
  } catch {
    // SHIELD.md might not exist yet (first run) — return empty
    return '';
  }
}

/**
 * Load recent memory files (today + N days back)
 *
 * @param manager - HeartwareManager instance
 * @param daysBack - Number of days to look back (0 = today only)
 * @returns Combined memory content or empty string
 */
async function loadRecentMemories(manager: HeartwareManager, daysBack: number): Promise<string> {
  let output = '';
  const now = new Date();

  for (let i = 0; i <= daysBack; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const filename = `memory/${dateStr}.md`;

    try {
      const content = await manager.read(filename);
      output += `\n${content}\n`;
    } catch (_err) {}
  }

  return output;
}

/**
 * Load specific memory file by date
 *
 * @param manager - HeartwareManager instance
 * @param date - Date in YYYY-MM-DD format
 * @returns Memory content or null if not found
 */
export async function loadMemoryByDate(
  manager: HeartwareManager,
  date: string,
): Promise<string | null> {
  try {
    const content = await manager.read(`memory/${date}.md`);
    return content;
  } catch (_err) {
    return null;
  }
}

/**
 * Load memory files for a date range
 *
 * @param manager - HeartwareManager instance
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns Array of memory contents
 */
export async function loadMemoryRange(
  manager: HeartwareManager,
  startDate: string,
  endDate: string,
): Promise<Array<{ date: string; content: string }>> {
  const memories: Array<{ date: string; content: string }> = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const content = await loadMemoryByDate(manager, dateStr);

    if (content) {
      memories.push({ date: dateStr, content });
    }

    // Move to next day
    current.setDate(current.getDate() + 1);
  }

  return memories;
}
