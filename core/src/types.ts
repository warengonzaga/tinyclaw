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
}

export interface Database {
  saveMessage(userId: string, role: string, content: string): void;
  getHistory(userId: string, limit?: number): Message[];
  getMessageCount(userId: string): number;
  saveCompaction(userId: string, summary: string, replacedBefore: number): void;
  getLatestCompaction(userId: string): CompactionRecord | null;
  deleteMessagesBefore(userId: string, beforeTimestamp: number): void;
  saveMemory(userId: string, key: string, value: string): void;
  getMemory(userId: string): Record<string, string>;
  close(): void;
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
