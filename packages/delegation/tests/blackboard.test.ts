import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createDatabase, createEventBus, type EventBus, type EventPayload } from '@tinyclaw/core';
import { createBlackboard, type Blackboard } from '../src/index.js';
import type { Database } from '@tinyclaw/types';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): { db: Database; path: string } {
  const path = join(tmpdir(), `tinyclaw-test-blackboard-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = createDatabase(path);
  return { db, path };
}

function cleanupDb(db: Database, path: string): void {
  try { db.close(); } catch { /* ignore */ }
  try { if (existsSync(path)) unlinkSync(path); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Blackboard', () => {
  let db: Database;
  let dbPath: string;
  let eventBus: EventBus;
  let blackboard: Blackboard;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    dbPath = result.path;
    eventBus = createEventBus();
    blackboard = createBlackboard(db, eventBus);
  });

  afterEach(() => {
    eventBus.clear();
    cleanupDb(db, dbPath);
  });

  // -----------------------------------------------------------------------
  // postProblem
  // -----------------------------------------------------------------------

  describe('postProblem', () => {
    it('creates a problem and returns its ID', () => {
      const problemId = blackboard.postProblem('user1', 'What is the best ML framework?');

      expect(problemId).toBeString();
      expect(problemId.length).toBeGreaterThan(0);
    });

    it('stored problem can be retrieved', () => {
      const problemId = blackboard.postProblem('user1', 'Which database is best for this use case?');

      const problem = blackboard.getProblem(problemId);
      expect(problem).not.toBeNull();
      expect(problem!.problemText).toBe('Which database is best for this use case?');
      expect(problem!.userId).toBe('user1');
      expect(problem!.status).toBe('open');
    });

    it('shows up in active problems', () => {
      blackboard.postProblem('user1', 'Problem 1');
      blackboard.postProblem('user1', 'Problem 2');

      const active = blackboard.getActiveProblems('user1');
      expect(active.length).toBe(2);
    });

    it('isolates problems by user', () => {
      blackboard.postProblem('user1', 'User1 problem');
      blackboard.postProblem('user2', 'User2 problem');

      const user1Active = blackboard.getActiveProblems('user1');
      const user2Active = blackboard.getActiveProblems('user2');

      expect(user1Active.length).toBe(1);
      expect(user2Active.length).toBe(1);
      expect(user1Active[0].problem).toBe('User1 problem');
      expect(user2Active[0].problem).toBe('User2 problem');
    });
  });

  // -----------------------------------------------------------------------
  // addProposal
  // -----------------------------------------------------------------------

  describe('addProposal', () => {
    it('adds a proposal to an existing problem', () => {
      const problemId = blackboard.postProblem('user1', 'Best framework?');

      blackboard.addProposal(problemId, 'agent1', 'ML Expert', 'Use TensorFlow', 0.8);

      const proposals = blackboard.getProposals(problemId);
      expect(proposals.length).toBe(1);
      expect(proposals[0].agentId).toBe('agent1');
      expect(proposals[0].agentRole).toBe('ML Expert');
      expect(proposals[0].proposal).toBe('Use TensorFlow');
      expect(proposals[0].confidence).toBe(0.8);
    });

    it('multiple agents can propose to the same problem', () => {
      const problemId = blackboard.postProblem('user1', 'Best framework?');

      blackboard.addProposal(problemId, 'agent1', 'ML Expert', 'Use TensorFlow', 0.8);
      blackboard.addProposal(problemId, 'agent2', 'Backend Dev', 'Use PyTorch', 0.7);
      blackboard.addProposal(problemId, 'agent3', 'Researcher', 'Use JAX', 0.6);

      const proposals = blackboard.getProposals(problemId);
      expect(proposals.length).toBe(3);
    });

    it('proposals are sorted by confidence (highest first)', () => {
      const problemId = blackboard.postProblem('user1', 'Best framework?');

      blackboard.addProposal(problemId, 'agent1', 'Low', 'Option A', 0.3);
      blackboard.addProposal(problemId, 'agent2', 'High', 'Option B', 0.9);
      blackboard.addProposal(problemId, 'agent3', 'Mid', 'Option C', 0.6);

      const proposals = blackboard.getProposals(problemId);
      expect(proposals[0].confidence).toBe(0.9);
      expect(proposals[1].confidence).toBe(0.6);
      expect(proposals[2].confidence).toBe(0.3);
    });

    it('clamps confidence to 0–1 range', () => {
      const problemId = blackboard.postProblem('user1', 'Test problem');

      blackboard.addProposal(problemId, 'agent1', 'Agent', 'Proposal', 1.5);
      blackboard.addProposal(problemId, 'agent2', 'Agent', 'Proposal', -0.5);

      const proposals = blackboard.getProposals(problemId);
      expect(proposals[0].confidence).toBe(1.0);
      expect(proposals[1].confidence).toBe(0.0);
    });

    it('emits blackboard:proposal event', () => {
      const received: EventPayload[] = [];
      eventBus.on('blackboard:proposal', (e) => received.push(e));

      const problemId = blackboard.postProblem('user1', 'Test');
      blackboard.addProposal(problemId, 'agent1', 'Expert', 'My proposal', 0.7);

      expect(received.length).toBe(1);
      expect(received[0].data.problemId).toBe(problemId);
      expect(received[0].data.agentId).toBe('agent1');
      expect(received[0].data.confidence).toBe(0.7);
      expect(received[0].userId).toBe('user1');
    });

    it('proposal count shows in active problems', () => {
      const problemId = blackboard.postProblem('user1', 'Test');

      blackboard.addProposal(problemId, 'agent1', 'A', 'P1', 0.5);
      blackboard.addProposal(problemId, 'agent2', 'B', 'P2', 0.6);

      const active = blackboard.getActiveProblems('user1');
      expect(active[0].proposalCount).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // resolve
  // -----------------------------------------------------------------------

  describe('resolve', () => {
    it('marks problem as resolved with synthesis', () => {
      const problemId = blackboard.postProblem('user1', 'Best approach?');

      blackboard.addProposal(problemId, 'agent1', 'A', 'Use X', 0.8);
      blackboard.addProposal(problemId, 'agent2', 'B', 'Use Y', 0.6);

      blackboard.resolve(problemId, 'After reviewing both proposals, X is the best approach.');

      // Should no longer appear in active problems
      const active = blackboard.getActiveProblems('user1');
      expect(active.length).toBe(0);
    });

    it('emits blackboard:resolved event', () => {
      const received: EventPayload[] = [];
      eventBus.on('blackboard:resolved', (e) => received.push(e));

      const problemId = blackboard.postProblem('user1', 'Test');
      blackboard.resolve(problemId, 'Resolved!');

      expect(received.length).toBe(1);
      expect(received[0].data.problemId).toBe(problemId);
      expect(received[0].data.synthesis).toBe('Resolved!');
    });

    it('resolved problems still have their proposals accessible', () => {
      const problemId = blackboard.postProblem('user1', 'Test');
      blackboard.addProposal(problemId, 'agent1', 'A', 'P1', 0.8);

      blackboard.resolve(problemId, 'Done');

      // Proposals should still be queryable
      const proposals = blackboard.getProposals(problemId);
      expect(proposals.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // getActiveProblems
  // -----------------------------------------------------------------------

  describe('getActiveProblems', () => {
    it('returns only open problems', () => {
      const p1 = blackboard.postProblem('user1', 'Open problem');
      const p2 = blackboard.postProblem('user1', 'Will be resolved');

      blackboard.resolve(p2, 'Done');

      const active = blackboard.getActiveProblems('user1');
      expect(active.length).toBe(1);
      expect(active[0].problemId).toBe(p1);
    });

    it('returns empty array when no problems exist', () => {
      const active = blackboard.getActiveProblems('user1');
      expect(active).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getProblem
  // -----------------------------------------------------------------------

  describe('getProblem', () => {
    it('returns null for non-existent problem', () => {
      const result = blackboard.getProblem('non-existent');
      expect(result).toBeNull();
    });

    it('returns the root entry with problem text', () => {
      const problemId = blackboard.postProblem('user1', 'My problem');
      const problem = blackboard.getProblem(problemId);

      expect(problem).not.toBeNull();
      expect(problem!.problemText).toBe('My problem');
    });
  });

  // -----------------------------------------------------------------------
  // cleanup
  // -----------------------------------------------------------------------

  describe('cleanup', () => {
    it('removes resolved problems older than threshold', () => {
      const p1 = blackboard.postProblem('user1', 'Old resolved');
      blackboard.resolve(p1, 'Done');

      // Cleanup with 0ms threshold (everything is "old")
      const cleaned = blackboard.cleanup(0);
      expect(cleaned).toBeGreaterThan(0);
    });

    it('does not remove open problems', () => {
      blackboard.postProblem('user1', 'Still open');

      const cleaned = blackboard.cleanup(0);
      expect(cleaned).toBe(0);

      const active = blackboard.getActiveProblems('user1');
      expect(active.length).toBe(1);
    });

    it('does not remove recent resolved problems', () => {
      const p1 = blackboard.postProblem('user1', 'Recently resolved');
      blackboard.resolve(p1, 'Done');

      // Cleanup with 1 hour threshold — problem was just created
      const cleaned = blackboard.cleanup(60 * 60 * 1000);
      expect(cleaned).toBe(0);
    });

    it('returns count of cleaned entries', () => {
      const p1 = blackboard.postProblem('user1', 'Problem 1');
      const p2 = blackboard.postProblem('user1', 'Problem 2');
      blackboard.resolve(p1, 'Done 1');
      blackboard.resolve(p2, 'Done 2');

      // Both resolved and cleanup threshold = 0
      const cleaned = blackboard.cleanup(0);
      // Should clean all resolved entries (root + any proposals)
      expect(cleaned).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Without event bus
  // -----------------------------------------------------------------------

  describe('without event bus', () => {
    it('works without event bus (no errors)', () => {
      const bbNoEvents = createBlackboard(db);

      const problemId = bbNoEvents.postProblem('user1', 'Test');
      bbNoEvents.addProposal(problemId, 'agent1', 'A', 'P1', 0.8);
      bbNoEvents.resolve(problemId, 'Done');

      // Should not throw
      expect(bbNoEvents.getActiveProblems('user1').length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Full collaboration flow
  // -----------------------------------------------------------------------

  describe('full collaboration flow', () => {
    it('end-to-end: post → propose → get sorted → resolve', () => {
      // 1. Primary agent posts a problem
      const problemId = blackboard.postProblem('user1', 'What is the best deployment strategy?');

      // 2. Multiple sub-agents propose solutions
      blackboard.addProposal(
        problemId, 'agent-devops', 'DevOps Engineer',
        'Use blue-green deployment with automatic rollback', 0.85,
      );
      blackboard.addProposal(
        problemId, 'agent-sre', 'SRE',
        'Use canary deployment with gradual rollout', 0.90,
      );
      blackboard.addProposal(
        problemId, 'agent-dev', 'Developer',
        'Use feature flags with percentage rollout', 0.70,
      );

      // 3. Get proposals sorted by confidence
      const proposals = blackboard.getProposals(problemId);
      expect(proposals.length).toBe(3);
      expect(proposals[0].agentRole).toBe('SRE'); // 0.90
      expect(proposals[1].agentRole).toBe('DevOps Engineer'); // 0.85
      expect(proposals[2].agentRole).toBe('Developer'); // 0.70

      // 4. Verify problem is active
      const active = blackboard.getActiveProblems('user1');
      expect(active.length).toBe(1);
      expect(active[0].proposalCount).toBe(3);

      // 5. Primary agent synthesizes and resolves
      blackboard.resolve(
        problemId,
        'Combining SRE and DevOps proposals: canary deployment with blue-green fallback',
      );

      // 6. Problem is now resolved
      const activeAfter = blackboard.getActiveProblems('user1');
      expect(activeAfter.length).toBe(0);

      // 7. Proposals are still accessible for reference
      const proposalsAfter = blackboard.getProposals(problemId);
      expect(proposalsAfter.length).toBe(3);
    });
  });
});
