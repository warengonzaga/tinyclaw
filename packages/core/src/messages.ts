/**
 * Shared onboarding messages — single source of truth.
 *
 * Both the CLI setup wizard and the web onboarding UI import from here
 * so the wording stays in sync. Update once, reflected everywhere.
 *
 * IMPORTANT: This file (and its imports) must remain free of Node APIs
 * so it can be bundled safely in both server and browser contexts.
 */

// Re-export so consumers of '@tinyclaw/core/messages' get everything they need
export { DEFAULT_MODEL } from './models.js'

// ---------------------------------------------------------------------------
// Security warning
// ---------------------------------------------------------------------------

export const SECURITY_WARNING_TITLE = 'Security warning — please read carefully.'

export const SECURITY_WARNING_BODY =
  'Tiny Claw is an open-source AI agent that runs on your machine. ' +
  'It can read files, execute code, and perform actions when tools are enabled. ' +
  'A malicious or poorly crafted prompt could trick the agent into ' +
  'performing unintended or harmful operations.'

export const SECURITY_LICENSE =
  'This software is licensed under the GNU General Public License v3.0 (GPLv3). ' +
  'You are free to use, modify, and distribute it under the terms of that license.'

export const SECURITY_WARRANTY =
  'This software is provided "AS IS", without warranty of any kind. ' +
  'The authors and contributors are not liable for any damages, data loss, ' +
  'or security incidents arising from its use. You assume all risks.'

export const SECURITY_SAFETY_TITLE = 'Recommended safety practices:'

export const SECURITY_SAFETY_PRACTICES = [
  'Run in a sandboxed or isolated environment when possible.',
  'Never expose Tiny Claw to the public internet without access control.',
  'Keep secrets and sensitive files out of the agent\'s reachable paths.',
  'Review enabled tools and permissions regularly.',
  'Use the strongest available model for any bot with tool access.',
  'Keep Tiny Claw up to date for the latest security patches.',
] as const

export const SECURITY_CONFIRM = 'I understand the risks and want to proceed'

// ---------------------------------------------------------------------------
// Default model
// ---------------------------------------------------------------------------

/**
 * Returns the default-model note with the given model tag interpolated.
 * Kept as a function so the caller can pass the live `DEFAULT_MODEL` value.
 */
export function defaultModelNote(modelTag: string): string {
  return (
    `Your default built-in model is ${modelTag}.\n\n` +
    'This model is always available as your fallback. If your primary\n' +
    'model is down or hits a rate limit, Tiny Claw automatically falls\n' +
    'back to this one so you\'re never left without a brain.\n\n' +
    'You can switch the default model anytime by asking the AI agent\n' +
    'during a conversation (e.g. "switch to gpt-oss:120b-cloud").'
  )
}

// ---------------------------------------------------------------------------
// TOTP setup
// ---------------------------------------------------------------------------

export const TOTP_SETUP_TITLE = 'Set up TOTP'

export const TOTP_SETUP_BODY =
  'Add this key in your authenticator app, then enter the code it generates.'

// ---------------------------------------------------------------------------
// Backup codes & recovery
// ---------------------------------------------------------------------------

export const BACKUP_CODES_INTRO =
  'Save these backup codes and your recovery token now. ' +
  'You will need both to recover access if you lose your authenticator.'

export const BACKUP_CODES_HINT =
  'Each backup code can only be used once. Keep them in a secure place separate from your authenticator.'

export const RECOVERY_TOKEN_HINT =
  'Go to /recovery and enter this token to start the recovery process.'
