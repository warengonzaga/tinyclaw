/**
 * Message Deduplication
 *
 * Near-duplicate detection via shingle hashing + Jaccard similarity.
 * Inspired by claw-compactor's dedup module and the existing
 * contentSimilarity() in @tinyclaw/memory.
 *
 * Applied at the message level before LLM summarization to remove
 * repetitive content from the compaction input.
 */

import type { Message } from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Shingle Hashing
// ---------------------------------------------------------------------------

/**
 * Extract word-level n-gram shingles from text.
 * Uses word-level shingles for better semantic comparison.
 */
export function computeShingles(text: string, shingleSize: number = 3): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - shingleSize; i++) {
    shingles.add(words.slice(i, i + shingleSize).join(' '));
  }

  return shingles;
}

/**
 * Compute Jaccard similarity between two shingle sets.
 * Returns 0.0 (no overlap) to 1.0 (identical).
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;

  for (const shingle of smaller) {
    if (larger.has(shingle)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Message Deduplication
// ---------------------------------------------------------------------------

interface ShingledMessage {
  index: number;
  message: Message;
  shingles: Set<string>;
}

/**
 * Remove near-duplicate messages based on shingle similarity.
 *
 * When two messages exceed the similarity threshold, the earlier one
 * is dropped (keeping the more recent/complete version).
 *
 * Returns the deduplicated messages and the count of groups removed.
 */
export function deduplicateMessages(
  messages: Message[],
  similarityThreshold: number = 0.6,
): { messages: Message[]; groupsRemoved: number } {
  if (messages.length <= 1) {
    return { messages, groupsRemoved: 0 };
  }

  // Pre-compute shingles for all messages
  const shingled: ShingledMessage[] = messages.map((message, index) => ({
    index,
    message,
    shingles: computeShingles(message.content ?? ''),
  }));

  // Mark duplicates (earlier message in each similar pair is dropped)
  const dropped = new Set<number>();
  let groupsRemoved = 0;

  for (let i = 0; i < shingled.length; i++) {
    if (dropped.has(i)) continue;

    let foundDuplicate = false;
    for (let j = i + 1; j < shingled.length; j++) {
      if (dropped.has(j)) continue;

      const similarity = jaccardSimilarity(shingled[i].shingles, shingled[j].shingles);
      if (similarity >= similarityThreshold) {
        // Drop the earlier (less recent) message
        dropped.add(i);
        // Count one group per first duplicate detected (not per message)
        if (!foundDuplicate) {
          groupsRemoved++;
          foundDuplicate = true;
        }
        break; // This message is already marked, move on
      }
    }
  }

  const result = shingled
    .filter((s) => !dropped.has(s.index))
    .map((s) => s.message);

  return { messages: result, groupsRemoved };
}
