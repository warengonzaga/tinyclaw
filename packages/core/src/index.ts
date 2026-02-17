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

// Shared onboarding messages — single source of truth
export {
  SECURITY_WARNING_TITLE,
  SECURITY_WARNING_BODY,
  SECURITY_WARRANTY,
  SECURITY_SAFETY_TITLE,
  SECURITY_SAFETY_PRACTICES,
  SECURITY_CONFIRM,
  defaultModelNote,
} from './messages.js';
