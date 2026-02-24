/**
 * Adaptive Memory Engine (v3)
 *
 * 3-layer memory system that learns what to remember and what to forget:
 *
 *   Layer 1: Episodic Memory — timestamped events with outcomes & importance scoring
 *   Layer 2: Semantic Index — FTS5 full-text search with BM25 ranking (built into bun:sqlite)
 *   Layer 3: Temporal Decay — Ebbinghaus forgetting curve + access frequency strengthening
 *
 * Scoring formula:
 *   relevance = (fts5_rank * 0.4) + (temporal_score * 0.3) + (importance * 0.3)
 *
 *   where:
 *     fts5_rank   = normalized SQLite FTS5 bm25() rank (0.0–1.0)
 *     temporal    = e^(-0.05 * days_since_last_access) * (1 + 0.02 * access_count)
 *     importance  = base_importance from event type, decayed over time
 *
 * Designed to replace raw key-value memory with zero external API dependencies.
 * Beats vector search (OpenAI embeddings) by combining FTS5 + temporal awareness
 * + importance scoring — all running 100% local, offline-capable.
 */

import type {
  Database,
  EpisodicEventType,
  EpisodicRecord,
  MemoryEngine,
  MemorySearchResult,
} from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default importance scores by event type (Ebbinghaus-inspired) */
const DEFAULT_IMPORTANCE: Record<EpisodicEventType, number> = {
  correction: 0.9,
  preference_learned: 0.8,
  fact_stored: 0.6,
  task_completed: 0.5,
  delegation_result: 0.5,
};

/** Maximum results from FTS5 search */
const FTS_MAX_RESULTS = 50;

/** Maximum results for context injection */
const CONTEXT_MAX_RESULTS = 10;

/** Milliseconds per day */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Temporal score using Ebbinghaus forgetting curve + access frequency bonus.
 * Returns 0.0–~1.0 (can exceed 1.0 with high access counts).
 *
 * Formula: e^(-0.05 * days_since_last_access) * (1 + 0.02 * access_count)
 */
function computeTemporalScore(lastAccessedAt: number, accessCount: number, now: number): number {
  const daysSinceAccess = Math.max(0, (now - lastAccessedAt) / MS_PER_DAY);
  const decay = Math.exp(-0.05 * daysSinceAccess);
  const accessBonus = 1 + 0.02 * accessCount;
  return Math.min(1.0, decay * accessBonus); // Clamp to 1.0
}

/**
 * Normalize FTS5 rank to 0.0–1.0.
 * FTS5 bm25() returns negative values where MORE negative = better match.
 * We normalize by taking abs(rank) and mapping to [0, 1].
 */
function normalizeFTSRank(rank: number, maxAbsRank: number): number {
  if (maxAbsRank === 0) return 0;
  // rank is negative in FTS5 — more negative = better match
  return Math.min(1.0, Math.abs(rank) / maxAbsRank);
}

/**
 * Sanitize a query string for FTS5 MATCH.
 * FTS5 has specific syntax requirements — we strip special chars.
 */
function sanitizeFTSQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .join(' OR ');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMemoryEngine(db: Database): MemoryEngine {
  return {
    recordEvent(
      userId: string,
      event: {
        type: EpisodicEventType;
        content: string;
        outcome?: string;
        importance?: number;
      },
    ): string {
      const id = crypto.randomUUID();
      const now = Date.now();
      const importance = event.importance ?? DEFAULT_IMPORTANCE[event.type] ?? 0.5;

      const record: EpisodicRecord = {
        id,
        userId,
        eventType: event.type,
        content: event.content,
        outcome: event.outcome ?? null,
        importance,
        accessCount: 0,
        createdAt: now,
        lastAccessedAt: now,
      };

      db.saveEpisodicEvent(record);
      return id;
    },

    search(userId: string, query: string, limit = 20): MemorySearchResult[] {
      const now = Date.now();
      const results: MemorySearchResult[] = [];

      // --- Layer 1: FTS5 search over episodic memory ---

      const ftsQuery = sanitizeFTSQuery(query);
      if (ftsQuery) {
        const ftsResults = db.searchEpisodicFTS(ftsQuery, userId, FTS_MAX_RESULTS);

        // Find max abs rank for normalization
        const maxAbsRank =
          ftsResults.length > 0 ? Math.max(...ftsResults.map((r) => Math.abs(r.rank))) : 1;

        for (const ftsRow of ftsResults) {
          const record = db.getEpisodicEvent(ftsRow.id);
          if (!record) continue;

          const ftsScore = normalizeFTSRank(ftsRow.rank, maxAbsRank);
          const temporalScore = computeTemporalScore(
            record.lastAccessedAt,
            record.accessCount,
            now,
          );
          const importanceScore = record.importance;

          // Combined score: FTS5 (0.4) + Temporal (0.3) + Importance (0.3)
          const relevanceScore = ftsScore * 0.4 + temporalScore * 0.3 + importanceScore * 0.3;

          results.push({
            id: record.id,
            content: record.content + (record.outcome ? ` → ${record.outcome}` : ''),
            relevanceScore,
            source: 'episodic',
          });
        }
      }

      // --- Layer 2: Include legacy key-value memory ---

      const kvMemory = db.getMemory(userId);
      const queryLower = query.toLowerCase();
      const queryTokens = queryLower.split(/\s+/).filter((w) => w.length > 1);

      for (const [key, value] of Object.entries(kvMemory)) {
        const combined = `${key} ${value}`.toLowerCase();

        // Simple keyword overlap for key-value (no FTS5 indexing for legacy data)
        let matchCount = 0;
        for (const token of queryTokens) {
          if (combined.includes(token)) matchCount++;
        }

        if (queryTokens.length === 0 || matchCount === 0) continue;

        const keywordScore = matchCount / queryTokens.length;

        results.push({
          id: `kv:${key}`,
          content: `${key}: ${value}`,
          relevanceScore: keywordScore * 0.5, // Lower weight for legacy KV
          source: 'key_value',
        });
      }

      // Sort by relevance (highest first) and limit
      results.sort((a, b) => b.relevanceScore - a.relevanceScore);
      return results.slice(0, limit);
    },

    consolidate(userId: string): { merged: number; pruned: number; decayed: number } {
      let merged = 0;
      let pruned = 0;
      let decayed = 0;

      // --- Step 1: Decay old memories ---
      // Reduce importance by 5% for entries not accessed in 7+ days
      decayed = db.decayEpisodicImportance(userId, 7, 0.95);

      // --- Step 2: Prune low-value memories ---
      // Delete entries with importance < 0.1 AND access_count == 0 AND older than 30 days
      pruned = db.pruneEpisodicEvents(userId, 0.1, 0, 30 * MS_PER_DAY);

      // --- Step 3: Merge duplicate/highly similar entries ---
      // Get recent events and check for content similarity
      const events = db.getEpisodicEvents(userId, 200);
      const toDelete: string[] = [];

      for (let i = 0; i < events.length; i++) {
        // Skip if already marked for deletion
        if (toDelete.includes(events[i].id)) continue;

        for (let j = i + 1; j < events.length; j++) {
          if (toDelete.includes(events[j].id)) continue;

          // Quick similarity check: if content is nearly identical
          if (
            events[i].eventType === events[j].eventType &&
            contentSimilarity(events[i].content, events[j].content) > 0.8
          ) {
            // Keep the newer one (events are sorted DESC by created_at)
            // The newer one (index i) is kept; older (index j) is merged
            const older = events[j];
            const newer = events[i];

            // Merge: bump importance of the newer entry
            const mergedImportance = Math.min(1.0, newer.importance + older.importance * 0.2);

            db.updateEpisodicEvent(newer.id, {
              importance: mergedImportance,
              accessCount: newer.accessCount + older.accessCount,
            });

            toDelete.push(older.id);
            merged++;
          }
        }
      }

      if (toDelete.length > 0) {
        db.deleteEpisodicEvents(toDelete);
      }

      return { merged, pruned, decayed };
    },

    getContextForAgent(userId: string, query?: string): string {
      const sections: string[] = [];

      // If we have a query, search for relevant memories
      if (query) {
        const results = this.search(userId, query, CONTEXT_MAX_RESULTS);
        if (results.length > 0) {
          sections.push('\n## Relevant Memories');
          for (const result of results) {
            const sourceLabel = result.source === 'episodic' ? '📝' : '🔑';
            sections.push(`${sourceLabel} ${result.content}`);
          }
        }
      }

      // Always include high-importance recent memories
      const recentEvents = db.getEpisodicEvents(userId, 5);
      const highImportance = recentEvents.filter((e) => e.importance >= 0.7);

      if (highImportance.length > 0) {
        sections.push('\n## Important Context');
        for (const event of highImportance) {
          const label =
            event.eventType === 'correction'
              ? '⚠️ Correction'
              : event.eventType === 'preference_learned'
                ? '⭐ Preference'
                : '📌 Note';
          sections.push(`${label}: ${event.content}`);
        }
      }

      // Include legacy key-value memory (backward compatible)
      const kvMemory = db.getMemory(userId);
      const kvEntries = Object.entries(kvMemory);

      if (kvEntries.length > 0) {
        sections.push('\n## Stored Facts');
        for (const [key, value] of kvEntries.slice(0, 10)) {
          sections.push(`- ${key}: ${value}`);
        }
      }

      return sections.length > 0 ? sections.join('\n') : '';
    },

    reinforce(memoryId: string): void {
      const record = db.getEpisodicEvent(memoryId);
      if (!record) return;

      db.updateEpisodicEvent(memoryId, {
        accessCount: record.accessCount + 1,
        lastAccessedAt: Date.now(),
      });
    },

    getEvent(id: string): EpisodicRecord | null {
      return db.getEpisodicEvent(id);
    },

    getEvents(userId: string, limit?: number): EpisodicRecord[] {
      return db.getEpisodicEvents(userId, limit);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Quick content similarity based on token overlap.
 * Returns 0.0–1.0. Used for merge detection during consolidation.
 */
function contentSimilarity(a: string, b: string): number {
  const tokensA = new Set(
    a
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const tokensB = new Set(
    b
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap++;
  }

  // Jaccard similarity
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : overlap / union;
}
