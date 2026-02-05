// Core type definitions for TinyClaw

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
}

export interface Database {
  saveMessage(userId: string, role: string, content: string): void;
  getHistory(userId: string, limit?: number): Message[];
  saveMemory(userId: string, key: string, value: string): void;
  getMemory(userId: string): Record<string, string>;
  close(): void;
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

export interface TinyClawConfig {
  dataDir?: string;
  provider?: Provider;
  tools?: Tool[];
}
