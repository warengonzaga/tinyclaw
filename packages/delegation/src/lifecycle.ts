/**
 * Lifecycle Manager
 *
 * Manages the full lifecycle of persistent sub-agents: creation, reuse,
 * performance tracking, suspension (soft-delete), revival, hard-delete,
 * and message persistence.
 */

import type { Message, SubAgentRecord } from '@tinyclaw/types';
import type { QueryTier } from '@tinyclaw/router';
import type { DelegationStore } from './store.js';
import type {
  LifecycleManager,
  OrientationContext,
} from './types.js';
import { formatOrientation } from './orientation.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max active sub-agents per user. */
const MAX_ACTIVE_PER_USER = 10;

/** Default soft-delete retention: 14 days. */
const DEFAULT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** Suspended agents transition to soft_deleted after 7 days of inactivity. */
const SUSPENDED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Max messages to load per sub-agent (oldest truncated). */
const MAX_SUB_AGENT_MESSAGES = 100;

/** Minimum keyword overlap ratio to consider a sub-agent reusable. */
const REUSE_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Keyword Matching
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'like',
  'through', 'after', 'over', 'between', 'out', 'up', 'that', 'this',
  'it', 'and', 'or', 'but', 'not', 'no', 'so', 'if', 'then', 'than',
  'too', 'very', 'just', 'also', 'more', 'some', 'any', 'each', 'all',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function keywordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let matches = 0;
  for (const word of a) {
    if (b.has(word)) matches++;
  }
  return matches / Math.min(a.size, b.size);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createLifecycleManager(db: DelegationStore): LifecycleManager {
  return {
    create(config) {
      const {
        userId,
        role,
        toolsGranted,
        tierPreference,
        templateId,
        orientation,
      } = config;

      // Enforce max active limit
      const active = db.getActiveSubAgents(userId);
      if (active.length >= MAX_ACTIVE_PER_USER) {
        throw new Error(
          `Maximum active sub-agents (${MAX_ACTIVE_PER_USER}) reached. Dismiss existing agents first.`,
        );
      }

      const now = Date.now();
      const id = crypto.randomUUID();

      // Build system prompt: orientation + role
      const orientationText = formatOrientation(orientation);
      const systemPrompt = `${orientationText}\n\n## Your Role\n${role}\n\nYou are a focused sub-agent. Complete the task efficiently and return a clear result.`;

      const record: SubAgentRecord = {
        id,
        userId,
        role,
        systemPrompt,
        toolsGranted,
        tierPreference: tierPreference ?? null,
        status: 'active',
        performanceScore: 0.5,
        totalTasks: 0,
        successfulTasks: 0,
        templateId: templateId ?? null,
        createdAt: now,
        lastActiveAt: now,
        deletedAt: null,
      };

      db.saveSubAgent(record);
      return record;
    },

    get(agentId) {
      return db.getSubAgent(agentId);
    },

    listActive(userId) {
      return db.getActiveSubAgents(userId);
    },

    findReusable(userId, role) {
      // Check active, suspended, and soft_deleted agents for reuse
      const all = db.getAllSubAgents(userId, true);
      const candidates = all.filter(a => a.status === 'active' || a.status === 'suspended' || a.status === 'soft_deleted');
      if (candidates.length === 0) return null;

      const requestTokens = tokenize(role);
      if (requestTokens.size === 0) return null;

      let bestMatch: SubAgentRecord | null = null;
      let bestScore = 0;

      for (const agent of candidates) {
        const agentTokens = tokenize(agent.role);
        const score = keywordOverlap(requestTokens, agentTokens);
        if (score > bestScore && score >= REUSE_THRESHOLD) {
          bestScore = score;
          bestMatch = agent;
        }
      }

      return bestMatch;
    },

    recordTaskResult(agentId, success) {
      const agent = db.getSubAgent(agentId);
      if (!agent) return;

      const totalTasks = agent.totalTasks + 1;
      const successfulTasks = agent.successfulTasks + (success ? 1 : 0);
      const performanceScore = successfulTasks / totalTasks;

      db.updateSubAgent(agentId, {
        totalTasks,
        successfulTasks,
        performanceScore,
        lastActiveAt: Date.now(),
      });
    },

    suspend(agentId) {
      db.updateSubAgent(agentId, {
        status: 'suspended',
        lastActiveAt: Date.now(),
      });
    },

    dismiss(agentId) {
      db.updateSubAgent(agentId, {
        status: 'soft_deleted',
        deletedAt: Date.now(),
      });
    },

    revive(agentId) {
      const agent = db.getSubAgent(agentId);
      if (!agent) return null;
      if (agent.status !== 'soft_deleted' && agent.status !== 'suspended') return null;

      db.updateSubAgent(agentId, {
        status: 'active',
        deletedAt: null,
        lastActiveAt: Date.now(),
      });

      return db.getSubAgent(agentId);
    },

    kill(agentId) {
      // Delete messages first, then the agent record
      db.deleteMessagesForUser(`subagent:${agentId}`);
      // Hard delete by setting a far-past deletedAt and running cleanup
      db.updateSubAgent(agentId, {
        status: 'soft_deleted',
        deletedAt: 0, // epoch — will be cleaned up immediately
      });
      db.deleteExpiredSubAgents(Date.now());
    },

    cleanup(retentionMs = DEFAULT_RETENTION_MS) {
      const cutoff = Date.now() - retentionMs;

      // Transition long-idle suspended agents to soft_deleted
      const suspendedCutoff = Date.now() - SUSPENDED_RETENTION_MS;
      db.archiveStaleSuspended?.(suspendedCutoff);

      // Delete expired soft_deleted agents
      const expired = db.deleteExpiredSubAgents(cutoff);

      return expired;
    },

    getMessages(agentId, limit) {
      const effectiveLimit = Math.min(limit ?? MAX_SUB_AGENT_MESSAGES, MAX_SUB_AGENT_MESSAGES);
      return db.getHistory(`subagent:${agentId}`, effectiveLimit);
    },

    saveMessage(agentId, role, content) {
      db.saveMessage(`subagent:${agentId}`, role, content);
    },
  };
}
