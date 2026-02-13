// Core type definitions for TinyClaw
// Re-exported from @tinyclaw/types for backward compatibility

export {
  // Core Primitives
  type Message,
  type ToolCall,
  type LLMResponse,
  type StreamEvent,
  type StreamCallback,
  type Provider,
  type Tool,

  // Agent Context
  type AgentContext,

  // Database
  type Database,

  // Database Records
  type SubAgentRecord,
  type RoleTemplate,
  type BackgroundTask,
  type CompactionRecord,

  // Episodic Memory (v3)
  type EpisodicEventType,
  type EpisodicRecord,
  type MemorySearchResult,
  type MemoryEngine,
  type TaskMetricRecord,

  // Blackboard (v3)
  type BlackboardEntry,

  // Learning
  type LearningEngine,
  type LearnedContext,

  // Cron
  type CronJob,

  // Config
  type TinyClawConfig,
  type ConfigManagerConfig,
  type ConfigManagerInterface,

  // Secrets
  type SecretsConfig,
  type SecretsManagerInterface,
  SECRET_KEY_PREFIXES,
  buildProviderKeyName,
  buildChannelKeyName,

  // Plugin System
  type PluginMeta,
  type ChannelPlugin,
  type ProviderPlugin,
  type ToolsPlugin,
  type TinyClawPlugin,
  type PluginRuntimeContext,

  // Learning internal types
  type Signal,
  type Pattern,
} from '@tinyclaw/types';
