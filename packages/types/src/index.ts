// Core type definitions for Tiny Claw

// ---------------------------------------------------------------------------
// Core Primitives
// ---------------------------------------------------------------------------

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
  type: 'text' | 'tool_start' | 'tool_result' | 'done' | 'error'
    | 'delegation_start' | 'delegation_complete' | 'background_start' | 'background_update';
  content?: string;
  tool?: string;
  result?: string;
  error?: string;
  /** Delegation metadata (present on delegation_* events) */
  delegation?: {
    agentId?: string;
    role?: string;
    task?: string;
    taskId?: string;
    tier?: string;
    isReuse?: boolean;
    success?: boolean;
    status?: string;
  };
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

// ---------------------------------------------------------------------------
// Owner Authority
// ---------------------------------------------------------------------------

/**
 * Authority tier determines what a user is allowed to do.
 *
 * - **owner**: Full control — config, secrets, heartware, delegation, model switching, tools.
 *   There is exactly one owner per Tiny Claw instance (the "assigned human").
 * - **friend**: Chat only — Tiny Claw is friendly and remembers preferences,
 *   but refuses commands that modify its internals or take action on the owner's behalf.
 */
export type AuthorityTier = 'owner' | 'friend';

/**
 * Owner authority configuration stored in config.
 *
 * Set during first-time claim flow: Tiny Claw generates a claim token on boot,
 * the first person to enter it in the web UI becomes the owner.
 */
export interface OwnerAuthority {
  /** The userId of the owner (e.g. 'web:owner', 'discord:123456'). */
  ownerId: string;
  /** SHA-256 hash of the persistent session token (never store raw tokens). */
  sessionTokenHash: string;
  /** Timestamp when ownership was claimed. */
  claimedAt: number;
}

/**
 * Sensitive tools that only the owner may invoke.
 * Non-owner users receive a polite refusal when these are called.
 */
export const OWNER_ONLY_TOOLS: ReadonlySet<string> = new Set([
  // Heartware modifications
  'heartware_write',
  'identity_update',
  'soul_update',
  'soul_info',
  'soul_explain',
  'preferences_set',
  'bootstrap_complete',
  // System control
  'builtin_model_switch',
  'primary_model_list',
  'primary_model_set',
  'primary_model_clear',
  'tinyclaw_restart',
  // Code execution
  'execute_code',
  // Delegation
  'delegate_task',
  'delegate_background',
  'delegate_to_existing',
  'manage_sub_agent',
  'confirm_task',
  'list_sub_agents',
  // Shell execution
  'run_shell',
  'shell_approve',
  'shell_allow',
  // Config & secrets (pairing tools are dynamically added)
  'config_get',
  'config_set',
  'config_reset',
  'secrets_store',
  'secrets_check',
  'secrets_list',
]);

/**
 * Check whether a userId has owner authority.
 */
export function isOwner(userId: string, ownerId: string | undefined): boolean {
  if (!ownerId) return false;
  return userId === ownerId;
}

// ---------------------------------------------------------------------------
// Agent Context
// ---------------------------------------------------------------------------

export interface AgentContext {
  db: Database;
  provider: Provider;
  learning: LearningEngine;
  tools: Tool[];
  heartwareContext?: string; // Optional heartware configuration context
  secrets?: SecretsManagerInterface; // Optional secrets manager for API key storage
  configManager?: ConfigManagerInterface; // Optional config manager for persistent settings
  /** The model tag currently in use (e.g. 'kimi-k2.5:cloud'). */
  modelName?: string;
  /** Human-readable provider name (e.g. 'Ollama Cloud'). */
  providerName?: string;
  /** The userId of the instance owner. */
  ownerId?: string;
  /** Adaptive memory engine (v3) — episodic memory + FTS5 + temporal decay. */
  memory?: MemoryEngine;
  /** Runtime SHIELD.md enforcement engine. */
  shield?: ShieldEngine;
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
  /** Compaction engine — tiered compression of conversation history. */
  compactor?: {
    compactIfNeeded(userId: string, provider: Provider): Promise<unknown>;
    getLatestSummary(userId: string): string | null;
    estimateTokens(text: string): number;
  };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export interface Database {
  // Messages
  saveMessage(userId: string, role: string, content: string): void;
  getHistory(userId: string, limit?: number): Message[];
  getMessageCount(userId: string): number;
  /** Return message timestamps ordered ascending (oldest first). */
  getMessageTimestamps(userId: string): number[];
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
  getUserBackgroundTasks(userId: string): BackgroundTask[];
  getBackgroundTask(id: string): BackgroundTask | null;
  markTaskDelivered(id: string): void;
  getStaleBackgroundTasks(olderThanMs: number): BackgroundTask[];

  // Episodic memory (v3)
  saveEpisodicEvent(record: EpisodicRecord): void;
  getEpisodicEvent(id: string): EpisodicRecord | null;
  getEpisodicEvents(userId: string, limit?: number): EpisodicRecord[];
  updateEpisodicEvent(id: string, updates: Partial<EpisodicRecord>): void;
  deleteEpisodicEvents(ids: string[]): void;
  searchEpisodicFTS(query: string, userId: string, limit?: number): Array<{ id: string; rank: number }>;
  decayEpisodicImportance(userId: string, olderThanDays: number, decayFactor: number): number;
  pruneEpisodicEvents(userId: string, maxImportance: number, maxAccessCount: number, olderThanMs: number): number;

  // Task metrics (v3)
  saveTaskMetric(record: TaskMetricRecord): void;
  getTaskMetrics(taskType: string, tier: string, limit?: number): TaskMetricRecord[];

  // Blackboard (v3)
  saveBlackboardEntry(entry: BlackboardEntry): void;
  getBlackboardEntry(id: string): BlackboardEntry | null;
  getBlackboardProposals(problemId: string): BlackboardEntry[];
  getActiveProblems(userId: string): BlackboardEntry[];
  resolveBlackboardProblem(problemId: string, synthesis: string): void;
  cleanupBlackboard(olderThanMs: number): number;

  close(): void;
}

// ---------------------------------------------------------------------------
// Database Records
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Episodic Memory (v3)
// ---------------------------------------------------------------------------

export type EpisodicEventType =
  | 'task_completed'
  | 'preference_learned'
  | 'correction'
  | 'delegation_result'
  | 'fact_stored';

export interface EpisodicRecord {
  id: string;
  userId: string;
  eventType: EpisodicEventType;
  content: string;
  outcome: string | null;
  importance: number;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  relevanceScore: number; // Combined: FTS5 rank + temporal decay + importance
  source: 'episodic' | 'key_value';
}

export interface MemoryEngine {
  /** Store an episodic event. */
  recordEvent(userId: string, event: {
    type: EpisodicEventType;
    content: string;
    outcome?: string;
    importance?: number;
  }): string; // returns event id

  /** Search memory using hybrid scoring: FTS5 BM25 + temporal decay + importance. */
  search(userId: string, query: string, limit?: number): MemorySearchResult[];

  /** Consolidate: merge duplicates, prune contradictions, decay old memories. */
  consolidate(userId: string): { merged: number; pruned: number; decayed: number };

  /** Get context string for injection into agent system prompt. */
  getContextForAgent(userId: string, query?: string): string;

  /** Strengthen a memory (bump access_count + last_accessed_at). */
  reinforce(memoryId: string): void;

  /** Get a single episodic record by ID. */
  getEvent(id: string): EpisodicRecord | null;

  /** Get all episodic records for a user. */
  getEvents(userId: string, limit?: number): EpisodicRecord[];
}

export interface TaskMetricRecord {
  id: string;
  userId: string;
  taskType: string;
  tier: string;
  durationMs: number;
  iterations: number;
  success: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Blackboard (v3)
// ---------------------------------------------------------------------------

export interface BlackboardEntry {
  id: string;
  userId: string;
  problemId: string;
  problemText: string | null;
  agentId: string | null;
  agentRole: string | null;
  proposal: string | null;
  confidence: number;
  synthesis: string | null;
  status: 'open' | 'resolved';
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pulse (Tiny Claw's version of OpenClaw's Heartbeat — cron-like task scheduler)
// ---------------------------------------------------------------------------

export interface PulseJob {
  id: string;
  schedule: string; // interval like '30m', '1h', '24h'
  handler: () => Promise<void>;
  lastRun?: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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
// Config Manager Interface
// ---------------------------------------------------------------------------

/**
 * Configuration for the ConfigManager factory
 */
export interface ConfigManagerConfig {
  /** Override the config storage directory (defaults to ~/.tinyclaw/data/) */
  readonly cwd?: string;
}

/**
 * Contract for the ConfigManager wrapper.
 * Mirrors config-engine's public API through a controlled interface.
 */
export interface ConfigManagerInterface {
  /** Get a config value by dot-notation key */
  get<V = unknown>(key: string, defaultValue?: V): V | undefined;
  /** Check if a config key exists */
  has(key: string): boolean;
  /** Set a config value by dot-notation key, or set multiple values via object */
  set(key: string, value: unknown): void;
  set(object: Record<string, unknown>): void;
  /** Delete a config key */
  delete(key: string): void;
  /** Reset specific keys to their defaults */
  reset(...keys: string[]): void;
  /** Clear all config and restore defaults */
  clear(): void;
  /** Get the full config snapshot */
  readonly store: Record<string, unknown>;
  /** Number of top-level config entries */
  readonly size: number;
  /** Absolute path to the config database file */
  readonly path: string;
  /** Watch a specific key for changes */
  onDidChange<V = unknown>(key: string, callback: (newValue?: V, oldValue?: V) => void): () => void;
  /** Watch the entire config for any change */
  onDidAnyChange(callback: (newValue?: Record<string, unknown>, oldValue?: Record<string, unknown>) => void): () => void;
  /** Close the underlying config engine */
  close(): void;
}

// ---------------------------------------------------------------------------
// Secrets Manager Interface
// ---------------------------------------------------------------------------

/**
 * Configuration for the SecretsManager
 */
export interface SecretsConfig {
  /** Explicit path to the secrets storage directory */
  readonly path?: string;
}

/**
 * Contract for the SecretsManager wrapper
 */
export interface SecretsManagerInterface {
  /** Store or overwrite a secret */
  store(key: string, value: string): Promise<void>;
  /** Check if a secret exists (no decryption) */
  check(key: string): Promise<boolean>;
  /** Retrieve a decrypted secret value, or null if missing */
  retrieve(key: string): Promise<string | null>;
  /** List secret key names matching an optional glob pattern */
  list(pattern?: string): Promise<string[]>;
  /** Convenience: resolve a provider API key by provider name */
  resolveProviderKey(providerName: string): Promise<string | null>;
  /** Close the underlying secrets engine */
  close(): Promise<void>;
}

/**
 * Well-known key prefixes for structured secret storage.
 *
 * Provider API keys follow: `provider.<name>.apiKey`
 * Example: `provider.ollama.apiKey`, `provider.openai.apiKey`
 */
export const SECRET_KEY_PREFIXES = {
  provider: 'provider',
  channel: 'channel',
} as const;

/**
 * Build a provider API key following the naming convention
 */
export function buildProviderKeyName(providerName: string): string {
  return `${SECRET_KEY_PREFIXES.provider}.${providerName}.apiKey`;
}

/**
 * Build a channel token key following the naming convention
 */
export function buildChannelKeyName(channelName: string): string {
  return `${SECRET_KEY_PREFIXES.channel}.${channelName}.token`;
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

// ---------------------------------------------------------------------------
// Shield — Runtime SHIELD.md Enforcement
// ---------------------------------------------------------------------------

/** The three enforcement actions defined by the SHIELD.md v0.1 spec. */
export type ShieldAction = 'block' | 'require_approval' | 'log';

/**
 * Event scopes that the shield engine can evaluate.
 * Maps 1:1 to the SHIELD.md specification's scope definitions.
 */
export type ShieldScope =
  | 'prompt'
  | 'skill.install'
  | 'skill.execute'
  | 'tool.call'
  | 'network.egress'
  | 'secrets.read'
  | 'mcp';

/** Threat severity levels. */
export type ThreatSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Threat categories from the SHIELD.md v0.1 spec.
 */
export type ThreatCategory =
  | 'prompt'
  | 'tool'
  | 'mcp'
  | 'memory'
  | 'supply_chain'
  | 'vulnerability'
  | 'fraud'
  | 'policy_bypass'
  | 'anomaly'
  | 'skill'
  | 'other';

/**
 * A parsed threat entry from SHIELD.md.
 */
export interface ThreatEntry {
  id: string;
  fingerprint: string;
  category: ThreatCategory;
  severity: ThreatSeverity;
  confidence: number;
  action: ShieldAction;
  title: string;
  description: string;
  recommendationAgent: string;
  expiresAt: string | null;
  revoked: boolean;
  revokedAt: string | null;
}

/**
 * An event to evaluate against the shield threat feed.
 */
export interface ShieldEvent {
  scope: ShieldScope;
  /** Tool name (for tool.call scope). */
  toolName?: string;
  /** Tool arguments (for tool.call scope). */
  toolArgs?: Record<string, unknown>;
  /** Target domain (for network.egress scope). */
  domain?: string;
  /** Secret key path (for secrets.read scope). */
  secretPath?: string;
  /** Skill/plugin name (for skill.install / skill.execute scope). */
  skillName?: string;
  /** Raw input text (for prompt scope). */
  inputText?: string;
  /** The user ID associated with this event. */
  userId?: string;
}

/**
 * The decision output — maps 1:1 to the SHIELD.md DECISION block format.
 */
export interface ShieldDecision {
  action: ShieldAction;
  scope: ShieldScope;
  threatId: string | null;
  fingerprint: string | null;
  matchedOn: string | null;
  matchValue: string | null;
  reason: string;
}

/**
 * A tool call pending human approval via conversational flow.
 */
export interface PendingApproval {
  /** The tool call that was blocked. */
  toolCall: ToolCall;
  /** The shield decision that triggered the approval request. */
  decision: ShieldDecision;
  /** Timestamp when approval was requested. */
  createdAt: number;
}

/**
 * Runtime shield engine interface.
 *
 * Evaluates events against the parsed SHIELD.md threat feed and returns
 * deterministic decisions following the v0.1 spec.
 */
export interface ShieldEngine {
  /** Evaluate an event against active threats. */
  evaluate(event: ShieldEvent): ShieldDecision;
  /** Whether the shield has active threats loaded. */
  isActive(): boolean;
  /** Get all loaded threat entries (for debugging/audit). */
  getThreats(): ThreatEntry[];
}

// ---------------------------------------------------------------------------
// Learning (internal types used by the learning package)
// ---------------------------------------------------------------------------

export interface Signal {
  type: 'positive' | 'negative' | 'correction' | 'preference';
  confidence: number;
  context: string;
  learned?: string;
  timestamp: number;
}

export interface Pattern {
  category: string;
  preference: string;
  confidence: number;
  examples: string[];
  lastUpdated: number;
}
