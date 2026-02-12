// Core type definitions for TinyClaw

import type { SecretsManagerInterface } from './secrets/types.js';
import type { ConfigManagerInterface } from './config/types.js';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  type: 'text' | 'tool_calls';
  content?: string;
  toolCalls?: ToolCall[];
}

export interface StreamEvent {
  type: 'text' | 'tool_start' | 'tool_result' | 'done' | 'error';
  content?: string;
  tool?: string;
  result?: string;
  error?: string;
}

export type StreamCallback = (event: StreamEvent) => void;

export interface Provider {
  id: string;
  name: string;
  chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;
  isAvailable(): Promise<boolean>;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface AgentContext {
  db: Database;
  provider: Provider;
  learning: LearningEngine;
  tools: Tool[];
  heartwareContext?: string; // Optional heartware configuration context
  secrets?: SecretsManagerInterface; // Optional secrets manager for API key storage
  configManager?: ConfigManagerInterface; // Optional config manager for persistent settings
  /** Delegation v2 subsystems (lifecycle, templates, background runner). */
  delegation?: {
    lifecycle: unknown;
    templates: unknown;
    background: {
      getUndelivered(userId: string): BackgroundTask[];
      markDelivered(taskId: string): void;
      cancelAll(): void;
      cleanupStale(olderThanMs: number): number;
    };
  };
}

export interface Database {
  // Messages
  saveMessage(userId: string, role: string, content: string): void;
  getHistory(userId: string, limit?: number): Message[];
  getMessageCount(userId: string): number;
  deleteMessagesBefore(userId: string, beforeTimestamp: number): void;
  deleteMessagesForUser(userId: string): void;

  // Compactions
  saveCompaction(userId: string, summary: string, replacedBefore: number): void;
  getLatestCompaction(userId: string): CompactionRecord | null;

  // Memory (key-value)
  saveMemory(userId: string, key: string, value: string): void;
  getMemory(userId: string): Record<string, string>;

  // Sub-agents
  saveSubAgent(record: SubAgentRecord): void;
  getSubAgent(id: string): SubAgentRecord | null;
  getActiveSubAgents(userId: string): SubAgentRecord[];
  getAllSubAgents(userId: string, includeDeleted?: boolean): SubAgentRecord[];
  updateSubAgent(id: string, updates: Partial<SubAgentRecord>): void;
  deleteExpiredSubAgents(beforeTimestamp: number): number;

  // Role templates
  saveRoleTemplate(template: RoleTemplate): void;
  getRoleTemplate(id: string): RoleTemplate | null;
  getRoleTemplates(userId: string): RoleTemplate[];
  updateRoleTemplate(id: string, updates: Partial<RoleTemplate>): void;
  deleteRoleTemplate(id: string): void;

  // Background tasks
  saveBackgroundTask(record: BackgroundTask): void;
  updateBackgroundTask(id: string, status: string, result: string | null, completedAt: number | null): void;
  getUndeliveredTasks(userId: string): BackgroundTask[];
  getBackgroundTask(id: string): BackgroundTask | null;
  markTaskDelivered(id: string): void;
  getStaleBackgroundTasks(olderThanMs: number): BackgroundTask[];

  close(): void;
}

// Sub-agent record (persisted)
export interface SubAgentRecord {
  id: string;
  userId: string;
  role: string;
  systemPrompt: string;
  toolsGranted: string[];
  tierPreference: string | null;
  status: 'active' | 'suspended' | 'soft_deleted';
  performanceScore: number;
  totalTasks: number;
  successfulTasks: number;
  templateId: string | null;
  createdAt: number;
  lastActiveAt: number;
  deletedAt: number | null;
}

// Role template (persisted)
export interface RoleTemplate {
  id: string;
  userId: string;
  name: string;
  roleDescription: string;
  defaultTools: string[];
  defaultTier: string | null;
  timesUsed: number;
  avgPerformance: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

// Background task (persisted)
export interface BackgroundTask {
  id: string;
  userId: string;
  agentId: string;
  taskDescription: string;
  status: 'running' | 'completed' | 'failed' | 'delivered';
  result: string | null;
  startedAt: number;
  completedAt: number | null;
  deliveredAt: number | null;
}

export interface CompactionRecord {
  id: number;
  userId: string;
  summary: string;
  replacedBefore: number;
  createdAt: number;
}

export interface LearningEngine {
  analyze(userMessage: string, assistantMessage: string, history: Message[]): void;
  getContext(): LearnedContext;
  injectIntoPrompt(basePrompt: string, context: LearnedContext): string;
}

export interface LearnedContext {
  preferences: string;
  patterns: string;
  recentCorrections: string;
}

export interface CronJob {
  id: string;
  schedule: string; // cron expression or interval like '30m', '1h', '24h'
  handler: () => Promise<void>;
  lastRun?: number;
}

export interface TinyClawConfig {
  dataDir?: string;
  provider?: Provider;
  tools?: Tool[];
  secrets?: {
    /** Explicit path to secrets storage directory (defaults to ~/.secrets-engine/) */
    path?: string;
  };
  config?: {
    /** Override the config storage directory (defaults to ~/.tinyclaw/data/) */
    cwd?: string;
  };
}

// ---------------------------------------------------------------------------
// Plugin System
// ---------------------------------------------------------------------------

/** Common metadata shared by all plugin types. */
export interface PluginMeta {
  /** npm package name, e.g. "@tinyclaw/plugin-channel-discord" */
  readonly id: string;
  /** Human-readable name, e.g. "Discord" */
  readonly name: string;
  /** Short description shown at startup */
  readonly description: string;
  /** Plugin type discriminant */
  readonly type: 'channel' | 'provider' | 'tools';
  /** Plugin semver */
  readonly version: string;
}

/**
 * A channel plugin connects an external messaging platform to the agent loop.
 *
 * Lifecycle:
 *   1. `getPairingTools()` — called during boot to merge pairing tools
 *   2. `start(context)` — called after agentContext is built
 *   3. The plugin drives messages into the agent via `context.enqueue`
 *   4. `stop()` — called during graceful shutdown
 */
export interface ChannelPlugin extends PluginMeta {
  readonly type: 'channel';
  /** Boot the channel. */
  start(context: PluginRuntimeContext): Promise<void>;
  /** Tear down — disconnect from platform, flush any pending state. */
  stop(): Promise<void>;
  /**
   * Return pairing tools that the agent can invoke to configure this channel.
   * These tools are merged into AgentContext.tools before the agent loop starts.
   */
  getPairingTools?(
    secrets: SecretsManagerInterface,
    configManager: ConfigManagerInterface,
  ): Tool[];
}

/** A provider plugin registers an additional LLM provider. */
export interface ProviderPlugin extends PluginMeta {
  readonly type: 'provider';
  /** Create and return an initialized Provider instance. */
  createProvider(secrets: SecretsManagerInterface): Promise<Provider>;
  /** Optional pairing tools for conversational setup (API key, model config). */
  getPairingTools?(
    secrets: SecretsManagerInterface,
    configManager: ConfigManagerInterface,
  ): Tool[];
}

/** A tools plugin contributes additional agent tools. */
export interface ToolsPlugin extends PluginMeta {
  readonly type: 'tools';
  /** Return the tools this plugin contributes. */
  createTools(context: AgentContext): Tool[];
}

/** Union type for all plugin variants. */
export type TinyClawPlugin = ChannelPlugin | ProviderPlugin | ToolsPlugin;

/**
 * Runtime context injected into channel plugins when they start.
 * Gives channels everything needed to route messages through the agent.
 */
export interface PluginRuntimeContext {
  /** Push a message into the session queue and run the agent loop. */
  enqueue(userId: string, message: string): Promise<string>;
  /** The initialized AgentContext. */
  agentContext: AgentContext;
  /** Secrets manager for resolving tokens. */
  secrets: SecretsManagerInterface;
  /** Config manager for reading/writing channel config. */
  configManager: ConfigManagerInterface;
}
