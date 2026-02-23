/**
 * Delegation Store — Narrow Database Interface
 *
 * Defines only the persistence methods that the delegation subsystem needs.
 * Core's db.ts implements all of these as part of the broader Database interface,
 * so it satisfies DelegationStore without any changes.
 */

import type {
  BackgroundTask,
  BlackboardEntry,
  Message,
  RoleTemplate,
  SubAgentRecord,
  TaskMetricRecord,
} from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// DelegationStore — subset of Database used by delegation
// ---------------------------------------------------------------------------

export interface DelegationStore {
  // Sub-agents
  saveSubAgent(record: SubAgentRecord): void;
  getSubAgent(id: string): SubAgentRecord | null;
  getActiveSubAgents(userId: string): SubAgentRecord[];
  getAllSubAgents(userId: string, includeDeleted?: boolean): SubAgentRecord[];
  updateSubAgent(id: string, updates: Partial<SubAgentRecord>): void;
  deleteExpiredSubAgents(beforeTimestamp: number): number;
  archiveStaleSuspended?(inactiveBefore: number): number;

  // Role templates
  saveRoleTemplate(template: RoleTemplate): void;
  getRoleTemplate(id: string): RoleTemplate | null;
  getRoleTemplates(userId: string): RoleTemplate[];
  updateRoleTemplate(id: string, updates: Partial<RoleTemplate>): void;
  deleteRoleTemplate(id: string): void;

  // Background tasks
  saveBackgroundTask(record: BackgroundTask): void;
  updateBackgroundTask(
    id: string,
    status: string,
    result: string | null,
    completedAt: number | null,
  ): void;
  getUndeliveredTasks(userId: string): BackgroundTask[];
  getUserBackgroundTasks(userId: string): BackgroundTask[];
  getBackgroundTask(id: string): BackgroundTask | null;
  markTaskDelivered(id: string): void;
  getStaleBackgroundTasks(olderThanMs: number): BackgroundTask[];

  // Task metrics
  saveTaskMetric(record: TaskMetricRecord): void;
  getTaskMetrics(taskType: string, tier: string, limit?: number): TaskMetricRecord[];

  // Blackboard
  saveBlackboardEntry(entry: BlackboardEntry): void;
  getBlackboardEntry(id: string): BlackboardEntry | null;
  getBlackboardProposals(problemId: string): BlackboardEntry[];
  getActiveProblems(userId: string): BlackboardEntry[];
  resolveBlackboardProblem(problemId: string, synthesis: string): void;
  cleanupBlackboard(olderThanMs: number): number;

  // Messages (sub-agent conversation persistence)
  saveMessage(userId: string, role: string, content: string): void;
  getHistory(userId: string, limit?: number): Message[];
  deleteMessagesForUser(userId: string): void;
  getMemory(userId: string): Record<string, string>;
}

// ---------------------------------------------------------------------------
// Injectable service interfaces — minimal subsets of core's full interfaces
// ---------------------------------------------------------------------------

/** Subset of SessionQueue needed by delegation. */
export interface DelegationQueue {
  enqueue<T>(sessionKey: string, task: () => Promise<T>): Promise<T>;
}

/** Subset of Intercom needed by delegation (blackboard only). */
export interface DelegationIntercom {
  emit(topic: string, userId: string, data?: Record<string, unknown>): void;
}
