/**
 * Delegation v2 Types
 *
 * All interfaces for the persistent sub-agent delegation system:
 * sub-agent records, role templates, background tasks, and orientation.
 */

import type { QueryTier } from '../router/classifier.js';
import type { Provider, Tool, Message, LearningEngine, Database } from '../types.js';
import type { ProviderOrchestrator } from '../router/orchestrator.js';

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
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DelegationV2Config {
  orchestrator: ProviderOrchestrator;
  allTools: Tool[];
  db: Database;
  heartwareContext: string;
  learning: LearningEngine;
  defaultSubAgentTools?: string[];
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
  }): string;

  getUndelivered(userId: string): BackgroundTaskRecord[];
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
