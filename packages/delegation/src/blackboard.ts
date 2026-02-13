/**
 * Blackboard — Shared Problem-Solving Space for Sub-Agents
 *
 * Implements the blackboard architectural pattern for collaborative
 * multi-agent problem solving:
 *
 *   1. Primary agent posts a problem
 *   2. Multiple sub-agents submit proposals (with confidence scores)
 *   3. Primary agent retrieves proposals sorted by confidence
 *   4. Primary agent synthesizes and resolves the problem
 *
 * Integrated with the Event Bus for real-time notifications:
 *   - 'blackboard:proposal' — emitted when a new proposal is added
 *   - 'blackboard:resolved' — emitted when a problem is resolved
 *
 * All state is persisted in the database for crash recovery.
 */

import type { BlackboardEntry } from '@tinyclaw/types';
import type { DelegationStore, DelegationEventBus } from './store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlackboardProblem {
  problemId: string;
  problem: string;
  proposalCount: number;
  status: 'open' | 'resolved';
}

export interface Blackboard {
  /** Post a problem for collaborative solving. Returns problemId. */
  postProblem(userId: string, problem: string): string;

  /** Submit a proposal from a sub-agent. */
  addProposal(
    problemId: string,
    agentId: string,
    agentRole: string,
    proposal: string,
    confidence: number,
  ): void;

  /** Get all proposals for a problem, sorted by confidence (highest first). */
  getProposals(problemId: string): BlackboardEntry[];

  /** Mark problem as resolved with a synthesis. */
  resolve(problemId: string, synthesis: string): void;

  /** Get active (open) problems for a user. */
  getActiveProblems(userId: string): BlackboardProblem[];

  /** Get a specific problem entry by its problemId. */
  getProblem(problemId: string): BlackboardEntry | null;

  /** Cleanup resolved problems older than N ms. Returns count cleaned. */
  cleanup(olderThanMs: number): number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBlackboard(db: DelegationStore, eventBus?: DelegationEventBus): Blackboard {
  return {
    postProblem(userId: string, problem: string): string {
      const problemId = crypto.randomUUID();
      const now = Date.now();

      // The root entry uses id === problemId for easy direct lookup
      const entry: BlackboardEntry = {
        id: problemId,
        userId,
        problemId,
        problemText: problem,
        agentId: null,
        agentRole: null,
        proposal: null,
        confidence: 0,
        synthesis: null,
        status: 'open',
        createdAt: now,
      };

      db.saveBlackboardEntry(entry);
      return problemId;
    },

    addProposal(
      problemId: string,
      agentId: string,
      agentRole: string,
      proposal: string,
      confidence: number,
    ): void {
      const entryId = crypto.randomUUID();
      const now = Date.now();

      // Look up the root problem entry to get userId
      const rootEntry = db.getBlackboardEntry(problemId);
      const userId = rootEntry?.userId ?? 'unknown';

      const entry: BlackboardEntry = {
        id: entryId,
        userId,
        problemId,
        problemText: null,
        agentId,
        agentRole,
        proposal,
        confidence: Math.max(0, Math.min(1, confidence)), // Clamp 0–1
        synthesis: null,
        status: 'open',
        createdAt: now,
      };

      db.saveBlackboardEntry(entry);

      // Emit event
      if (eventBus) {
        eventBus.emit('blackboard:proposal', userId, {
          problemId,
          agentId,
          agentRole,
          confidence,
        });
      }
    },

    getProposals(problemId: string): BlackboardEntry[] {
      return db.getBlackboardProposals(problemId);
    },

    resolve(problemId: string, synthesis: string): void {
      db.resolveBlackboardProblem(problemId, synthesis);

      // Emit event — look up userId from root entry
      if (eventBus) {
        const rootEntry = db.getBlackboardEntry(problemId);
        const userId = rootEntry?.userId ?? 'system';
        eventBus.emit('blackboard:resolved', userId, {
          problemId,
          synthesis: synthesis.slice(0, 200), // Truncate for event payload
        });
      }
    },

    getActiveProblems(userId: string): BlackboardProblem[] {
      const entries = db.getActiveProblems(userId);

      return entries.map((entry) => {
        const proposals = db.getBlackboardProposals(entry.problemId);
        return {
          problemId: entry.problemId,
          problem: entry.problemText || '',
          proposalCount: proposals.length,
          status: entry.status,
        };
      });
    },

    getProblem(problemId: string): BlackboardEntry | null {
      // Root entry has id === problemId (set in postProblem)
      return db.getBlackboardEntry(problemId);
    },

    cleanup(olderThanMs: number): number {
      return db.cleanupBlackboard(olderThanMs);
    },
  };
}
