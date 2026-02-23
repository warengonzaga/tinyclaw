// Database
export { createDatabase } from './database.js';
// Built-in Ollama provider (default LLM)
export { createOllamaProvider } from './llm.js';
// Agent loop
export { agentLoop } from './loop.js';
// Shared onboarding messages — single source of truth
export {
  BACKUP_CODES_HINT,
  BACKUP_CODES_INTRO,
  defaultModelNote,
  RECOVERY_TOKEN_HINT,
  SECURITY_CONFIRM,
  SECURITY_LICENSE,
  SECURITY_SAFETY_PRACTICES,
  SECURITY_SAFETY_TITLE,
  SECURITY_WARNING_BODY,
  SECURITY_WARNING_TITLE,
  SECURITY_WARRANTY,
  TOTP_SETUP_BODY,
  TOTP_SETUP_TITLE,
} from './messages.js';
export type { BuiltinModelTag } from './models.js';
// Model constants — single source of truth
export {
  BUILTIN_MODEL_TAGS,
  BUILTIN_MODELS,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
} from './models.js';

// Owner authority — shared crypto utilities
export {
  BACKUP_CODE_LENGTH,
  BACKUP_CODES_COUNT,
  createTotpUri,
  generateBackupCode,
  generateBackupCodes,
  generateRecoveryToken,
  generateSessionToken,
  generateTotpCode,
  generateTotpSecret,
  RECOVERY_TOKEN_LENGTH,
  sha256,
  verifyTotpCode,
} from './owner-auth.js';
export type { UpdateInfo, UpdateRuntime } from './update-checker.js';
// Update checker — npm registry polling + system prompt context
export {
  buildUpdateContext,
  checkForUpdate,
  detectRuntime,
  isNewerVersion,
} from './update-checker.js';
