/**
 * Owner Authority — shared cryptographic utilities.
 *
 * TOTP generation/verification, backup codes, recovery tokens, and
 * related helpers used by both the CLI setup wizard and the web server.
 *
 * Uses the Web Crypto API (crypto.subtle + crypto.getRandomValues)
 * plus Node's crypto.timingSafeEqual for constant-time comparisons.
 * Works in Bun and Node 20+.
 */

import { timingSafeEqual } from 'node:crypto'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Human-friendly alphabet — excludes ambiguous characters (0/O, 1/I/L).
 */
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const TOTP_BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TOTP_STEP_SECONDS = 30
const TOTP_DIGITS = 6

export const BACKUP_CODES_COUNT = 10
export const BACKUP_CODE_LENGTH = 30
export const RECOVERY_TOKEN_LENGTH = 200

// ---------------------------------------------------------------------------
// Token / code generators
// ---------------------------------------------------------------------------

/** Generate a cryptographically random recovery token. */
export function generateRecoveryToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_TOKEN_LENGTH))
  return Array.from(bytes, b => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('')
}

/** Generate a single backup code. */
export function generateBackupCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BACKUP_CODE_LENGTH))
  return Array.from(bytes, b => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('')
}

/** Generate a batch of backup codes. */
export function generateBackupCodes(count = BACKUP_CODES_COUNT): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) codes.push(generateBackupCode())
  return codes
}

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

/** Generate a random Base32-encoded TOTP secret. */
export function generateTotpSecret(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, b => TOTP_BASE32_ALPHABET[b % TOTP_BASE32_ALPHABET.length]).join('')
}

/** Decode a Base32 string to bytes. */
function base32Decode(input: string): Uint8Array {
  const cleaned = input.toUpperCase().replace(/=+$/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []

  for (const ch of cleaned) {
    const idx = TOTP_BASE32_ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error('Invalid Base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Uint8Array.from(bytes)
}

/** Build an `otpauth://` URI for QR-code scanning or manual entry. */
export function createTotpUri(
  secret: string,
  accountName = 'owner',
  issuer = 'Tiny Claw',
): string {
  return (
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}` +
    `?secret=${encodeURIComponent(secret)}` +
    `&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`
  )
}

/** Compute a single TOTP code for the given counter value. */
export async function generateTotpCode(secret: string, counter: number): Promise<string> {
  const keyData = base32Decode(secret)
  const counterBuffer = new ArrayBuffer(8)
  const view = new DataView(counterBuffer)
  view.setUint32(4, counter >>> 0)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBuffer)
  const hmac = new Uint8Array(signature)
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  const otp = binary % (10 ** TOTP_DIGITS)
  return String(otp).padStart(TOTP_DIGITS, '0')
}

/**
 * Timing-safe string comparison — prevents timing attacks on TOTP verification.
 * Uses Node's crypto.timingSafeEqual for constant-time comparison.
 */
function defaultSafeCompare(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)
  if (bufA.byteLength !== bufB.byteLength) {
    // Burn the same CPU time so length differences don't leak timing info
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

/**
 * Verify a TOTP code with ±1 step drift tolerance.
 *
 * Uses a timing-safe comparison by default to prevent timing attacks.
 * Callers may supply a custom comparator if needed.
 */
export async function verifyTotpCode(
  secret: string,
  code: string,
  safeCompare: (a: string, b: string) => boolean = defaultSafeCompare,
): Promise<boolean> {
  const normalized = String(code || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(normalized)) return false

  const nowCounter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS)
  for (const drift of [-1, 0, 1]) {
    const expected = await generateTotpCode(secret, nowCounter + drift)
    if (safeCompare(normalized, expected)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** SHA-256 hash a string — for storing token/code hashes in config. */
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}

/** Generate a 48-hex-char session token (192-bit entropy). */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
