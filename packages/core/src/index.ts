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
  SECURITY_LICENSE,
  SECURITY_WARRANTY,
  SECURITY_SAFETY_TITLE,
  SECURITY_SAFETY_PRACTICES,
  SECURITY_CONFIRM,
  defaultModelNote,
  TOTP_SETUP_TITLE,
  TOTP_SETUP_BODY,
  BACKUP_CODES_INTRO,
  BACKUP_CODES_HINT,
  RECOVERY_TOKEN_HINT,
} from './messages.js';

// Owner authority — shared crypto utilities
export {
  generateRecoveryToken,
  generateBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  createTotpUri,
  generateTotpCode,
  verifyTotpCode,
  sha256,
  generateSessionToken,
  BACKUP_CODES_COUNT,
  BACKUP_CODE_LENGTH,
  RECOVERY_TOKEN_LENGTH,
} from './owner-auth.js';
