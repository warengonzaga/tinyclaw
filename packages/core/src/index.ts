// Database
export { createDatabase } from './database.js';

// Agent loop
export { agentLoop } from './loop.js';

// Built-in Ollama provider (default LLM)
export { createOllamaProvider } from './llm.js';

// Model constants — single source of truth
export {
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_PROVIDER,
  BUILTIN_MODELS,
  BUILTIN_MODEL_TAGS,
} from './models.js';
export type { BuiltinModelTag } from './models.js';
