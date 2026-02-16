/**
 * Delegation v2 Types
 *
 * All interfaces for the persistent sub-agent delegation system:
 * sub-agent records, role templates, background tasks, and orientation.
 */

import type { QueryTier } from '@tinyclaw/router';
import type { Provider, Tool, Message, LearningEngine } from '@tinyclaw/types';
import type { ProviderOrchestrator } from '@tinyclaw/router';
import type { DelegationStore, DelegationQueue } from './store.js';
import type { TimeoutEstimator } from './timeout-estimator.js';

// ---------------------------------------------------------------------------
// Sub-Agent State
// ---------------------------------------------------------------------------

export type SubAgentStatus = 'active' | 'suspended' | 'soft_deleted';

export interface SubAgentRecord {
  id: string;
  userId: string;
  role: string;
  systemPrompt: string;
  toolsGranted: string[];
  tierPreference: QueryTier | null;
  status: SubAgentStatus;
  performanceScore: number;
  totalTasks: number;
  successfulTasks: number;
  templateId: string | null;
  createdAt: number;
  lastActiveAt: number;
  deletedAt: number | null;
}

// ---------------------------------------------------------------------------
// Role Templates
// ---------------------------------------------------------------------------

export interface RoleTemplate {
  id: string;
  userId: string;
  name: string;
  roleDescription: string;
  defaultTools: string[];
  defaultTier: QueryTier | null;
  timesUsed: number;
  avgPerformance: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Background Tasks
// ---------------------------------------------------------------------------

export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'delivered';

export interface BackgroundTaskRecord {
  id: string;
  userId: string;
  agentId: string;
  taskDescription: string;
  status: BackgroundTaskStatus;
  result: string | null;
  startedAt: number;
  completedAt: number | null;
  deliveredAt: number | null;
}

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------

export interface OrientationContext {
  identity: string;
  preferences: string;
  memories: string;
  /** Ultra-compact conversation summary (L0 tier, ~200 tokens). */
  compactedContext?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DelegationV2Config {
  orchestrator: ProviderOrchestrator;
  allTools: Tool[];
  db: DelegationStore;
  heartwareContext: string;
  learning: LearningEngine;
  defaultSubAgentTools?: string[];
  /** Adaptive timeout estimator (v3). When provided, replaces fixed timeouts. */
  timeoutEstimator?: TimeoutEstimator;
  /** Returns the L0 compacted context for a user (if available). */
  getCompactedContext?: (userId: string) => string | null;
}

// ---------------------------------------------------------------------------
// Sub-Agent Runner (v2)
// ---------------------------------------------------------------------------

export interface SubAgentRunConfig {
  task: string;
  role: string;
  provider: Provider;
  tools: Tool[];
  orientation?: OrientationContext;
  existingMessages?: Message[];
  timeout?: number;
  /** Max iterations for the agent loop. */
  maxIterations?: number;
  /** Adaptive timeout estimator — enables live extension during execution. */
  timeoutEstimator?: TimeoutEstimator;
}

export interface SubAgentRunResult {
  success: boolean;
  response: string;
  iterations: number;
  providerId: string;
  messages: Message[];
}

// ---------------------------------------------------------------------------
// Lifecycle Manager
// ---------------------------------------------------------------------------

export interface LifecycleManager {
  create(config: {
    userId: string;
    role: string;
    toolsGranted: string[];
    tierPreference?: QueryTier;
    templateId?: string;
    orientation: OrientationContext;
  }): SubAgentRecord;

  get(agentId: string): SubAgentRecord | null;
  listActive(userId: string): SubAgentRecord[];
  findReusable(userId: string, role: string): SubAgentRecord | null;

  recordTaskResult(agentId: string, success: boolean): void;
  suspend(agentId: string): void;
  dismiss(agentId: string): void;
  revive(agentId: string): SubAgentRecord | null;
  kill(agentId: string): void;

  cleanup(retentionMs?: number): number;

  getMessages(agentId: string, limit?: number): Message[];
  saveMessage(agentId: string, role: string, content: string): void;
}

// ---------------------------------------------------------------------------
// Template Manager
// ---------------------------------------------------------------------------

export interface TemplateManager {
  create(config: {
    userId: string;
    name: string;
    roleDescription: string;
    defaultTools?: string[];
    defaultTier?: QueryTier;
    tags?: string[];
  }): RoleTemplate;

  findBestMatch(userId: string, taskDescription: string): RoleTemplate | null;
  update(
    templateId: string,
    updates: Partial<
      Pick<RoleTemplate, 'name' | 'roleDescription' | 'defaultTools' | 'defaultTier' | 'tags'>
    >,
  ): RoleTemplate | null;

  recordUsage(templateId: string, performanceScore: number): void;
  list(userId: string): RoleTemplate[];
  delete(templateId: string): void;
}

// ---------------------------------------------------------------------------
// Background Runner
// ---------------------------------------------------------------------------

export interface BackgroundRunner {
  start(config: {
    userId: string;
    agentId: string;
    task: string;
    provider: Provider;
    tools: Tool[];
    orientation: OrientationContext;
    existingMessages?: Message[];
    /** If a template was matched, pass its ID for usage tracking on completion. */
    templateId?: string;
    /** Extra info for auto-creating a template on success (role, tools, tier). */
    templateAutoCreate?: {
      role: string;
      defaultTools: string[];
      defaultTier?: string;
    };
  }): string;

  getUndelivered(userId: string): BackgroundTaskRecord[];
  /** Get all tasks for a user (running + completed + failed, not delivered). */
  getAll(userId: string): BackgroundTaskRecord[];
  markDelivered(taskId: string): void;
  getStatus(taskId: string): BackgroundTaskRecord | null;
  cancel(taskId: string): boolean;
  cancelAll(): void;
  cleanupStale(olderThanMs: number): number;
}

// ---------------------------------------------------------------------------
// Delegation Context (added to AgentContext)
// ---------------------------------------------------------------------------

export interface DelegationContext {
  lifecycle: LifecycleManager;
  templates: TemplateManager;
  background: BackgroundRunner;
}

// ---------------------------------------------------------------------------
// V1 compatibility types (re-exported from index.ts)
// ---------------------------------------------------------------------------

export interface SubAgentConfig {
  task: string;
  role: string;
  provider: Provider;
  tools: Tool[];
  timeout?: number;
}

export interface SubAgentResult {
  success: boolean;
  response: string;
  iterations: number;
  providerId: string;
}

export interface DelegationToolConfig {
  orchestrator: ProviderOrchestrator;
  allTools: Tool[];
  defaultSubAgentTools?: string[];
}
