import { existsSync, chmodSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { timingSafeEqual } from 'crypto'
import { SecurityDatabase } from './security-db'
import { DEFAULT_PROVIDER, DEFAULT_MODEL, DEFAULT_BASE_URL } from '@tinyclaw/core'
import { logger } from '@tinyclaw/logger'
import {
  generateRecoveryToken,
  generateBackupCodes,
  generateTotpSecret,
  createTotpUri,
  verifyTotpCode as _verifyTotpCode,
  sha256,
  generateSessionToken,
  BACKUP_CODES_COUNT,
} from '@tinyclaw/core/owner-auth'

const textEncoder = new TextEncoder()

// ---------------------------------------------------------------------------
// Owner Authority — bootstrap setup + session authentication
// ---------------------------------------------------------------------------

/** Bootstrap/setup token expiry — valid for 1 hour. */
const TOKEN_EXPIRY_MS = 60 * 60 * 1000
const SETUP_SESSION_EXPIRY_MS = 15 * 60 * 1000

/**
 * Human-friendly alphabet for secrets/codes — excludes ambiguous characters
 * (0/O, 1/I/L) following the OpenClaw pairing-code pattern.
 */
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const BOOTSTRAP_SECRET_LENGTH = 30

interface SetupSession {
  expiresAt: number
  totpSecret: string
}

/**
 * Generate a cryptographically random bootstrap secret.
 * Uses 30 characters from a 32-char human-friendly alphabet (~150-bit entropy).
 */
function generateClaimToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BOOTSTRAP_SECRET_LENGTH))
  const chars = Array.from(bytes, b => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length])
  return chars.join('')
}

function buildProviderApiKeyName(providerName: string): string {
  return `provider.${providerName}.apiKey`
}

function parseSoulSeed(value?: string): number {
  const raw = String(value ?? '').trim()
  if (!raw) {
    const random = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    return random
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) throw new Error('Soul seed must be a valid integer')
  return parsed
}

/**
 * Timing-safe string comparison — prevents timing attacks on token verification.
 * Always compares in constant time regardless of where strings differ.
 * (Pattern from OpenClaw's src/security/secret-equal.ts)
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const enc = new TextEncoder()
  const bufA = enc.encode(a)
  const bufB = enc.encode(b)
  // If lengths differ, compare bufA against itself (constant time) and return false
  if (bufA.byteLength !== bufB.byteLength) {
    timingSafeEqual(bufA, bufA) // burn the same CPU time
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

/** TOTP verification using timing-safe comparison. */
async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  return _verifyTotpCode(secret, code, timingSafeCompare)
}

// ---------------------------------------------------------------------------
// Rate Limiting — sliding-window per IP (inspired by OpenClaw)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  /** Timestamps of recent attempts within the window. */
  attempts: number[]
  /** If set, requests are blocked until this timestamp. */
  lockedUntil: number
}

const RATE_LIMIT_WINDOW_MS = 60_000       // 60-second sliding window
const RATE_LIMIT_MAX_ATTEMPTS = 5         // max 5 attempts per window
const RATE_LIMIT_LOCKOUT_MS = 5 * 60_000  // 5-minute lockout after exceeding
const rateLimitStore = new Map<string, RateLimitEntry>()

// ---------------------------------------------------------------------------
// Recovery Rate Limiting — persistent, stricter: 3 attempts, exponential backoff
// Permanent IP block after MAX_TOTAL_RECOVERY_FAILURES total failures
// ---------------------------------------------------------------------------

const RECOVERY_MAX_ATTEMPTS = 3
const RECOVERY_BASE_LOCKOUT_MS = 60_000   // 1 minute base
const MAX_TOTAL_RECOVERY_FAILURES = 10    // permanently block after this many total failures

/**
 * Security database instance — initialized inside createWebUI when dataDir is available.
 * Null when no dataDir is provided (e.g. in tests without persistence).
 */
let securityDb: SecurityDatabase | null = null

/**
 * In-memory fallback for environments without a security database (tests, etc.).
 */
const recoveryRateLimitStore = new Map<string, { failedAttempts: number; lockedUntil: number }>()

/**
 * Check rate limit for a given key (typically IP address).
 * Returns true if the request should be allowed, false if rate-limited.
 */
function checkRateLimit(key: string): boolean {
  // Loopback is exempt (local development)
  if (key === '127.0.0.1' || key === '::1' || key === 'localhost') return true

  const now = Date.now()
  let entry = rateLimitStore.get(key)

  if (!entry) {
    entry = { attempts: [], lockedUntil: 0 }
    rateLimitStore.set(key, entry)
  }

  // Check lockout
  if (entry.lockedUntil > now) return false

  // Clean old attempts outside the window
  entry.attempts = entry.attempts.filter(t => now - t < RATE_LIMIT_WINDOW_MS)

  // Check if under limit
  if (entry.attempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    entry.lockedUntil = now + RATE_LIMIT_LOCKOUT_MS
    return false
  }

  entry.attempts.push(now)
  return true
}

/**
 * Check recovery rate limit for a given key.
 * 3 attempts max, then exponential lockout (1min, 2min, 4min, 8min, ...).
 * Permanently blocked IPs are always denied.
 * Returns { allowed: true } or { allowed: false, retryAfterMs, permanent }.
 */
function checkRecoveryRateLimit(key: string): { allowed: boolean; retryAfterMs?: number; permanent?: boolean } {
  // Check permanent block first (persistent DB)
  if (securityDb?.isBlocked(key)) {
    return { allowed: false, permanent: true }
  }

  const now = Date.now()

  if (securityDb) {
    const row = securityDb.getRecoveryAttempts(key)
    if (!row) return { allowed: true }

    if (row.locked_until > now) {
      return { allowed: false, retryAfterMs: row.locked_until - now }
    }

    if (row.failed_attempts >= RECOVERY_MAX_ATTEMPTS) {
      const lockoutMultiplier = Math.pow(2, Math.floor(row.failed_attempts / RECOVERY_MAX_ATTEMPTS) - 1)
      const lockoutMs = RECOVERY_BASE_LOCKOUT_MS * lockoutMultiplier
      securityDb.setLockout(key, now + lockoutMs)
      return { allowed: false, retryAfterMs: lockoutMs }
    }

    return { allowed: true }
  }

  // Fallback: in-memory
  let entry = recoveryRateLimitStore.get(key)
  if (!entry) return { allowed: true }

  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfterMs: entry.lockedUntil - now }
  }

  if (entry.failedAttempts >= RECOVERY_MAX_ATTEMPTS) {
    const lockoutMultiplier = Math.pow(2, Math.floor(entry.failedAttempts / RECOVERY_MAX_ATTEMPTS) - 1)
    const lockoutMs = RECOVERY_BASE_LOCKOUT_MS * lockoutMultiplier
    entry.lockedUntil = now + lockoutMs
    return { allowed: false, retryAfterMs: lockoutMs }
  }

  return { allowed: true }
}

/**
 * Record a failed recovery attempt — increments counter.
 * If total failures exceed MAX_TOTAL_RECOVERY_FAILURES, permanently blocks the IP.
 */
function recordRecoveryFailure(key: string): void {
  if (securityDb) {
    const row = securityDb.recordFailure(key)

    // Permanent block after reaching the threshold
    if (row.failed_attempts >= MAX_TOTAL_RECOVERY_FAILURES) {
      securityDb.blockIP(key, 'max_recovery_attempts', row.failed_attempts)
      securityDb.resetAttempts(key)
      return
    }

    // Start lockout if they hit the attempt limit
    if (row.failed_attempts >= RECOVERY_MAX_ATTEMPTS) {
      const lockoutMultiplier = Math.pow(2, Math.floor(row.failed_attempts / RECOVERY_MAX_ATTEMPTS) - 1)
      securityDb.setLockout(key, Date.now() + (RECOVERY_BASE_LOCKOUT_MS * lockoutMultiplier))
    }
    return
  }

  // Fallback: in-memory
  let entry = recoveryRateLimitStore.get(key)
  if (!entry) {
    entry = { failedAttempts: 0, lockedUntil: 0 }
    recoveryRateLimitStore.set(key, entry)
  }
  entry.failedAttempts++

  if (entry.failedAttempts >= RECOVERY_MAX_ATTEMPTS) {
    const lockoutMultiplier = Math.pow(2, Math.floor(entry.failedAttempts / RECOVERY_MAX_ATTEMPTS) - 1)
    entry.lockedUntil = Date.now() + (RECOVERY_BASE_LOCKOUT_MS * lockoutMultiplier)
  }
}

/**
 * Reset recovery rate limit on successful recovery.
 */
function resetRecoveryRateLimit(key: string): void {
  if (securityDb) {
    securityDb.resetAttempts(key)
    return
  }
  recoveryRateLimitStore.delete(key)
}

/**
 * Get the IP address from a request.
 */
function getClientIP(request: Request, server: any): string {
  // Check standard proxy headers first
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const realIP = request.headers.get('x-real-ip')
  if (realIP) return realIP
  // Fall back to Bun's socket address
  try {
    const addr = server?.requestIP?.(request)
    if (addr) return addr.address
  } catch {}
  return 'unknown'
}

// Periodically clean stale rate-limit entries (every 10 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore) {
    if (entry.lockedUntil < now && entry.attempts.every(t => now - t > RATE_LIMIT_WINDOW_MS)) {
      rateLimitStore.delete(key)
    }
  }
  // Clean in-memory fallback store
  for (const [key, entry] of recoveryRateLimitStore) {
    if (entry.lockedUntil < now - 30 * 60_000) {
      recoveryRateLimitStore.delete(key)
    }
  }
  // Clean persistent DB stale attempts (30 min inactive)
  securityDb?.cleanStaleAttempts(30 * 60_000)
}, 10 * 60_000).unref?.()

// ---------------------------------------------------------------------------
// File Permission Hardening (non-Windows)
// ---------------------------------------------------------------------------

/**
 * Harden file permissions on sensitive files (config database, etc.).
 * Sets files to 0o600 (owner read/write only) and directories to 0o700.
 * Skipped on Windows where chmod is not meaningful.
 */
function hardenFilePermissions(filePath: string): void {
  if (process.platform === 'win32') return
  try {
    const stats = statSync(filePath)
    const targetMode = stats.isDirectory() ? 0o700 : 0o600
    chmodSync(filePath, targetMode)
  } catch {
    // Silently ignore — file may not exist yet
  }
}

/**
 * Extract the session token from a request's Cookie header.
 */
function getSessionToken(request: Request): string | null {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null
  const match = cookie.match(/(?:^|;\s*)tinyclaw_session=([^;]+)/)
  return match ? match[1] : null
}

/**
 * Build a Set-Cookie header for the owner session.
 * HttpOnly, SameSite=Strict, persistent (1 year), path=/.
 */
function buildSessionCookie(token: string): string {
  const maxAge = 365 * 24 * 60 * 60 // 1 year
  return `tinyclaw_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`
}

/**
 * Standard security headers applied to all responses.
 * Prevents clickjacking, MIME sniffing, and XSS reflection.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...SECURITY_HEADERS,
    }
  })
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...SECURITY_HEADERS,
    }
  })
}

function fileResponse(filePath) {
  return new Response(Bun.file(filePath), {
    headers: SECURITY_HEADERS,
  })
}

function resolveUiPaths() {
  const webRoot = resolve(import.meta.dir, '..')
  return {
    webRoot,
    distDir: join(webRoot, 'dist'),
    publicDir: join(webRoot, 'public')
  }
}

function findStaticFile(pathname) {
  const { distDir, publicDir } = resolveUiPaths()

  const candidates = [
    join(distDir, pathname),
    join(publicDir, pathname)
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return null
}

function buildDevNotice() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tiny Claw</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0d12; color: #e7edf4; display: grid; place-items: center; height: 100vh; margin: 0; }
      .card { max-width: 520px; background: #151c28; padding: 32px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); text-align: center; }
      h1 { margin: 0 0 16px; font-size: 24px; }
      p { margin: 0 0 12px; color: #9aa9ba; line-height: 1.6; }
      code { background: rgba(255,255,255,0.08); padding: 4px 8px; border-radius: 6px; font-size: 14px; }
      .steps { text-align: left; margin: 20px 0; }
      .step { margin: 8px 0; }
      a { color: #f5b85b; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .divider { border-top: 1px solid rgba(255,255,255,0.1); margin: 20px 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>🐾 Tiny Claw</h1>
      <p>The UI needs to be started or built.</p>
      <div class="divider"></div>
      <div class="steps">
        <div class="step"><strong>Development:</strong></div>
        <div class="step">1. Run <code>bun run --cwd apps/web dev</code></div>
        <div class="step">2. Open <a href="http://localhost:5173">http://localhost:5173</a></div>
        <div class="divider"></div>
        <div class="step"><strong>Production:</strong></div>
        <div class="step">Run <code>bun run --cwd apps/web build</code></div>
      </div>
    </div>
  </body>
</html>`
}

export function createWebUI(config) {
  const {
    port = 3000,
    host = '0.0.0.0',
    onMessage,
    onMessageStream,
    getBackgroundTasks,
    getSubAgents,
    configManager,
    secretsManager,
    onOwnerClaimed,
    configDbPath,
    dataDir,
  } = config

  const serverStartedAt = Date.now()
  let server = null

  // Initialize persistent security database when dataDir is available
  if (dataDir) {
    const securityDbPath = join(dataDir, 'data', 'security.db')
    securityDb = new SecurityDatabase(securityDbPath)
    hardenFilePermissions(securityDbPath)
  }

  // Bootstrap secret — generated once per boot for first-time setup claim.
  let claimToken: string | null = null
  let claimTokenCreatedAt: number = 0
  const setupSessions = new Map<string, SetupSession>()

  // Recovery sessions — validated recovery tokens (token hash → expiry)
  const recoveryValidSessions = new Map<string, number>()
  const RECOVERY_SESSION_EXPIRY_MS = 10 * 60_000 // 10 minutes

  // Harden config database permissions on startup
  if (configDbPath) {
    hardenFilePermissions(configDbPath)
  }

  /**
   * Check if ownership has been claimed.
   */
  function isOwnerClaimed(): boolean {
    if (!configManager) return false
    return Boolean(configManager.get('owner.ownerId'))
  }

  /**
   * Verify that a request comes from the owner via session cookie.
   * Uses timing-safe comparison on the hash to prevent timing attacks.
   */
  async function isOwnerRequest(request: Request): Promise<boolean> {
    if (!configManager) return false
    const storedHash = configManager.get<string>('owner.sessionTokenHash')
    if (!storedHash) return false
    const token = getSessionToken(request)
    if (!token) return false
    const hash = await sha256(token)
    return timingSafeCompare(hash, storedHash)
  }

  /**
   * Generate (or return existing) claim token. Called once on boot.
   * Tokens expire after TOKEN_EXPIRY_MS (1 hour).
   */
  function getOrCreateClaimToken(): string {
    const now = Date.now()
    if (!claimToken || (now - claimTokenCreatedAt) > TOKEN_EXPIRY_MS) {
      claimToken = generateClaimToken()
      claimTokenCreatedAt = now
    }
    return claimToken
  }

  /**
   * Check if the claim token is still valid (not expired).
   */
  function isClaimTokenValid(): boolean {
    if (!claimToken) return false
    return (Date.now() - claimTokenCreatedAt) <= TOKEN_EXPIRY_MS
  }

  function getOrCreateSetupSession(): { token: string; session: SetupSession } {
    const token = generateSessionToken()
    const session: SetupSession = {
      expiresAt: Date.now() + SETUP_SESSION_EXPIRY_MS,
      totpSecret: generateTotpSecret(),
    }
    setupSessions.set(token, session)
    return { token, session }
  }

  function getSetupSession(token?: string): SetupSession | null {
    if (!token) return null
    const existing = setupSessions.get(token)
    if (!existing) return null
    if (existing.expiresAt < Date.now()) {
      setupSessions.delete(token)
      return null
    }
    return existing
  }

  return {
    async start() {
      if (server) return

      if (!isOwnerClaimed()) {
        // First-time: display bootstrap secret
        const token = getOrCreateClaimToken()
        logger.info(`Bootstrap secret: ${token}`, 'web')
        logger.info('Open /setup and enter this to claim ownership (expires in 1 hour)', 'web')
      } else {
        // Already claimed: owner can log in via /login
        logger.info('Owner claimed — open /login to access the dashboard', 'web')
      }

      server = Bun.serve({
        port,
        hostname: host,
        // NOTE: Bun caps idleTimeout at 255s, but worst-case agent time is
        // ~360s (MAX_TIMEOUT_MS 300s + 2 extensions at 60s). The SSE heartbeat
        // (8s interval) keeps the connection alive beyond the idle timeout so
        // long-running requests are not prematurely closed. If heartbeats are
        // not flowing (e.g. non-streaming requests), responses exceeding 255s
        // may be terminated by the runtime.
        idleTimeout: 255,
        fetch: async (request) => {
          const url = new URL(request.url)
          const pathname = url.pathname

          const now = Date.now()
          for (const [token, session] of setupSessions.entries()) {
            if (session.expiresAt < now) setupSessions.delete(token)
          }

          // =================================================================
          // Public API endpoints (no auth required)
          // =================================================================

          if (pathname === '/api/health' && request.method === 'GET') {
            return jsonResponse({ ok: true, startedAt: serverStartedAt })
          }

          // Auth status — tells the UI whether owner is claimed and whether
          // the current request is from the owner.
          if (pathname === '/api/auth/status' && request.method === 'GET') {
            const claimed = isOwnerClaimed()
            const isOwner = claimed ? await isOwnerRequest(request) : false
            return jsonResponse({
              claimed,
              isOwner,
              setupRequired: !claimed,
              mfaConfigured: Boolean(configManager?.get('owner.totpSecret')),
            })
          }

          // Bootstrap verification — first step of /setup flow
          if (pathname === '/api/setup/bootstrap' && request.method === 'POST') {
            // Rate limit login attempts
            const clientIP = getClientIP(request, server)
            if (!checkRateLimit(clientIP)) {
              return jsonResponse({ error: 'Too many attempts. Try again later.' }, 429)
            }

            if (isOwnerClaimed()) {
              return jsonResponse({ error: 'Setup already completed.' }, 403)
            }

            let body
            try {
              body = await request.json()
            } catch {
              return jsonResponse({ error: 'Invalid JSON' }, 400)
            }

            const secret = String(body?.secret ?? '').trim().toUpperCase()
            if (!secret || !isClaimTokenValid() || !timingSafeCompare(secret, claimToken!)) {
              return jsonResponse({ error: 'Invalid or expired bootstrap secret. Restart Tiny Claw to generate a new one.' }, 401)
            }

            const { token: setupToken, session } = getOrCreateSetupSession()

            return jsonResponse({
              ok: true,
              setupToken,
              expiresInMs: SETUP_SESSION_EXPIRY_MS,
              defaultProvider: 'Ollama Cloud',
              defaultModel: DEFAULT_MODEL,
              defaultBaseUrl: DEFAULT_BASE_URL,
              totpSecret: session.totpSecret,
              totpUri: createTotpUri(session.totpSecret),
            })
          }

          // Setup completion — persist owner, API key, soul seed, TOTP config
          if (pathname === '/api/setup/complete' && request.method === 'POST') {
            const clientIP = getClientIP(request, server)
            if (!checkRateLimit(clientIP)) {
              return jsonResponse({ error: 'Too many attempts. Try again later.' }, 429)
            }

            if (isOwnerClaimed()) {
              return jsonResponse({ error: 'Setup already completed.' }, 403)
            }

            let body
            try {
              body = await request.json()
            } catch {
              return jsonResponse({ error: 'Invalid JSON' }, 400)
            }

            const setupToken = String(body?.setupToken ?? '')
            const session = getSetupSession(setupToken)
            if (!session) {
              return jsonResponse({ error: 'Setup session expired. Re-enter the bootstrap secret.' }, 401)
            }

            const acceptRisk = Boolean(body?.acceptRisk)
            if (!acceptRisk) {
              return jsonResponse({ error: 'You must accept the security warning to continue.' }, 400)
            }

            const apiKey = String(body?.apiKey ?? '').trim()
            if (!apiKey) {
              return jsonResponse({ error: 'API key is required.' }, 400)
            }

            const totpCode = String(body?.totpCode ?? '').trim()
            const isValidTotp = await verifyTotpCode(session.totpSecret, totpCode)
            if (!isValidTotp) {
              return jsonResponse({ error: 'Invalid TOTP code. Check your authenticator and try again.' }, 400)
            }

            let soulSeed: number
            try {
              soulSeed = parseSoulSeed(body?.soulSeed)
            } catch (error) {
              return jsonResponse({ error: (error as Error).message }, 400)
            }

            const backupCodes = generateBackupCodes(BACKUP_CODES_COUNT)
            const backupCodeHashes = await Promise.all(backupCodes.map((code) => sha256(code)))

            const recoveryToken = generateRecoveryToken()
            const recoveryTokenHash = await sha256(recoveryToken)

            const sessionToken = generateSessionToken()
            const sessionHash = await sha256(sessionToken)
            const ownerId = 'web:owner'

            if (!configManager || !secretsManager) {
              return jsonResponse({ error: 'Server setup managers are not available.' }, 500)
            }

            await secretsManager.store(buildProviderApiKeyName(DEFAULT_PROVIDER), apiKey)

            configManager.set('providers.starterBrain', {
              model: DEFAULT_MODEL,
              baseUrl: DEFAULT_BASE_URL,
              apiKeyRef: buildProviderApiKeyName(DEFAULT_PROVIDER),
            })
            configManager.set('heartware.seed', soulSeed)
            configManager.set('owner.ownerId', ownerId)
            configManager.set('owner.sessionTokenHash', sessionHash)
            configManager.set('owner.claimedAt', Date.now())
            configManager.set('owner.totpSecret', session.totpSecret)
            configManager.set('owner.backupCodeHashes', backupCodeHashes)
            configManager.set('owner.backupCodesRemaining', backupCodeHashes.length)
            configManager.set('owner.recoveryTokenHash', recoveryTokenHash)
            configManager.set('owner.mfaConfiguredAt', Date.now())

            // Clear one-time setup state after successful claim
            claimToken = null
            setupSessions.delete(setupToken)

            if (onOwnerClaimed) {
              onOwnerClaimed(ownerId)
            }

            return new Response(JSON.stringify({ ok: true, backupCodes, recoveryToken }), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': buildSessionCookie(sessionToken),
              },
            })
          }

          // Owner login — re-authenticate using TOTP
          if (pathname === '/api/auth/login' && request.method === 'POST') {
            const clientIP = getClientIP(request, server)
            if (!checkRateLimit(clientIP)) {
              return jsonResponse({ error: 'Too many attempts. Try again later.' }, 429)
            }

            if (!isOwnerClaimed()) {
              return jsonResponse({ error: 'No owner is configured yet. Complete /setup first.' }, 400)
            }

            let body
            try {
              body = await request.json()
            } catch {
              return jsonResponse({ error: 'Invalid JSON' }, 400)
            }

            const totpSecret = configManager?.get<string>('owner.totpSecret')
            if (!totpSecret) {
              return jsonResponse({ error: 'Owner MFA is not configured.' }, 400)
            }

            const totpCode = String(body?.totpCode ?? '').trim()
            if (!totpCode) {
              return jsonResponse({ error: 'Enter your authenticator code.' }, 400)
            }

            const authenticated = await verifyTotpCode(totpSecret, totpCode)

            if (!authenticated) {
              return jsonResponse({ error: 'Invalid code.' }, 401)
            }

            const sessionToken = generateSessionToken()
            const hash = await sha256(sessionToken)
            configManager?.set('owner.sessionTokenHash', hash)

            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': buildSessionCookie(sessionToken),
              },
            })
          }

          // =================================================================
          // Recovery endpoints — backup code recovery with token gate
          // =================================================================

          // Validate recovery token — grants a short-lived recovery session
          if (pathname === '/api/recovery/validate-token' && request.method === 'POST') {
            const clientIP = getClientIP(request, server)
            const rateCheck = checkRecoveryRateLimit(clientIP)
            if (!rateCheck.allowed) {
              if (rateCheck.permanent) {
                return jsonResponse({ error: 'Access permanently blocked.' }, 403)
              }
              const retrySeconds = Math.ceil((rateCheck.retryAfterMs || 60_000) / 1000)
              return jsonResponse({ error: `Too many attempts. Try again in ${retrySeconds} seconds.` }, 429)
            }

            if (!isOwnerClaimed()) {
              return jsonResponse({ error: 'No owner is configured.' }, 400)
            }

            let body
            try {
              body = await request.json()
            } catch {
              return jsonResponse({ error: 'Invalid request.' }, 400)
            }

            const token = String(body?.token ?? '').trim().toUpperCase()
            if (!token) {
              recordRecoveryFailure(clientIP)
              return jsonResponse({ error: 'Invalid token.' }, 401)
            }

            const storedHash = configManager?.get<string>('owner.recoveryTokenHash')
            if (!storedHash) {
              recordRecoveryFailure(clientIP)
              return jsonResponse({ error: 'Invalid token.' }, 401)
            }

            const submittedHash = await sha256(token)
            if (!timingSafeCompare(submittedHash, storedHash)) {
              recordRecoveryFailure(clientIP)
              return jsonResponse({ error: 'Invalid token.' }, 401)
            }

            // Token valid — create a recovery session
            resetRecoveryRateLimit(clientIP)
            const recoverySessionId = generateSessionToken()
            recoveryValidSessions.set(recoverySessionId, Date.now() + RECOVERY_SESSION_EXPIRY_MS)

            return jsonResponse({
              ok: true,
              recoverySessionId,
              expiresInMs: RECOVERY_SESSION_EXPIRY_MS,
            })
          }

          // Use backup code to regain access — requires valid recovery session
          if (pathname === '/api/recovery/use-backup' && request.method === 'POST') {
            const clientIP = getClientIP(request, server)
            const rateCheck = checkRecoveryRateLimit(clientIP)
            if (!rateCheck.allowed) {
              if (rateCheck.permanent) {
                return jsonResponse({ error: 'Access permanently blocked.' }, 403)
              }
              const retrySeconds = Math.ceil((rateCheck.retryAfterMs || 60_000) / 1000)
              return jsonResponse({ error: `Too many attempts. Try again in ${retrySeconds} seconds.` }, 429)
            }

            if (!isOwnerClaimed()) {
              return jsonResponse({ error: 'No owner is configured.' }, 400)
            }

            let body
            try {
              body = await request.json()
            } catch {
              return jsonResponse({ error: 'Invalid request.' }, 400)
            }

            // Verify recovery session
            const recoverySessionId = String(body?.recoverySessionId ?? '')
            const sessionExpiry = recoveryValidSessions.get(recoverySessionId)
            if (!sessionExpiry || sessionExpiry < Date.now()) {
              recoveryValidSessions.delete(recoverySessionId)
              recordRecoveryFailure(clientIP)
              return jsonResponse({ error: 'Recovery session expired. Re-enter your recovery token.' }, 401)
            }

            const backupCode = String(body?.backupCode ?? '').trim().toUpperCase()
            if (!backupCode) {
              recordRecoveryFailure(clientIP)
              return jsonResponse({ error: 'Invalid code.' }, 401)
            }

            // Verify backup code
            const storedHashes = configManager?.get<string[]>('owner.backupCodeHashes') || []
            const submittedHash = await sha256(backupCode)
            const matched = storedHashes.find((hash) => timingSafeCompare(hash, submittedHash))

            if (!matched || !configManager) {
              recordRecoveryFailure(clientIP)
              return jsonResponse({ error: 'Invalid code.' }, 401)
            }

            // Consume the backup code
            const remaining = storedHashes.filter((hash) => !timingSafeCompare(hash, submittedHash))
            configManager.set('owner.backupCodeHashes', remaining)
            configManager.set('owner.backupCodesRemaining', remaining.length)

            // Grant owner session
            const sessionToken = generateSessionToken()
            const hash = await sha256(sessionToken)
            configManager.set('owner.sessionTokenHash', hash)

            // Cleanup recovery session
            recoveryValidSessions.delete(recoverySessionId)
            resetRecoveryRateLimit(clientIP)

            return new Response(JSON.stringify({
              ok: true,
              backupCodesRemaining: remaining.length,
            }), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': buildSessionCookie(sessionToken),
              },
            })
          }

          // =================================================================
          // TOTP Re-enrollment — for owners recovering via backup codes
          // =================================================================

          // Start TOTP re-setup — generates a new TOTP secret (owner auth required)
          if (pathname === '/api/owner/totp-setup' && request.method === 'POST') {
            if (!await isOwnerRequest(request)) {
              return jsonResponse({ error: 'Unauthorized.' }, 401)
            }

            // Create a new setup session (reuses existing mechanism)
            const { token: reenrollToken, session } = getOrCreateSetupSession()

            return jsonResponse({
              ok: true,
              reenrollToken,
              totpSecret: session.totpSecret,
              totpUri: createTotpUri(session.totpSecret),
            })
          }

          // Confirm TOTP re-enrollment — verify code, replace TOTP + backup codes + recovery token
          if (pathname === '/api/owner/totp-confirm' && request.method === 'POST') {
            if (!await isOwnerRequest(request)) {
              return jsonResponse({ error: 'Unauthorized.' }, 401)
            }

            let body
            try {
              body = await request.json()
            } catch {
              return jsonResponse({ error: 'Invalid JSON' }, 400)
            }

            const reenrollToken = String(body?.reenrollToken ?? '')
            const session = getSetupSession(reenrollToken)
            if (!session) {
              return jsonResponse({ error: 'Session expired. Start TOTP setup again.' }, 401)
            }

            const totpCode = String(body?.totpCode ?? '').trim()
            const isValid = await verifyTotpCode(session.totpSecret, totpCode)
            if (!isValid) {
              return jsonResponse({ error: 'Invalid TOTP code. Check your authenticator and try again.' }, 400)
            }

            // Generate new backup codes and recovery token
            const backupCodes = generateBackupCodes(BACKUP_CODES_COUNT)
            const backupCodeHashes = await Promise.all(backupCodes.map((code) => sha256(code)))
            const recoveryToken = generateRecoveryToken()
            const recoveryTokenHash = await sha256(recoveryToken)

            // Persist new TOTP, backup codes, and recovery token
            configManager?.set('owner.totpSecret', session.totpSecret)
            configManager?.set('owner.backupCodeHashes', backupCodeHashes)
            configManager?.set('owner.backupCodesRemaining', backupCodeHashes.length)
            configManager?.set('owner.recoveryTokenHash', recoveryTokenHash)
            configManager?.set('owner.mfaConfiguredAt', Date.now())

            // Clear the setup session
            setupSessions.delete(reenrollToken)

            return jsonResponse({
              ok: true,
              backupCodes,
              recoveryToken,
              backupCodesRemaining: backupCodeHashes.length,
            })
          }

          // =================================================================
          // Friend chat endpoint — open to everyone, uses friend userId
          // =================================================================

          if (pathname === '/api/chat/friend' && request.method === 'POST') {
            let body = null
            try {
              body = await request.json()
            } catch {
              return jsonResponse({ error: 'Invalid JSON' }, 400)
            }

            const message = body?.message || ''
            const friendName = body?.friendName || 'Anonymous'
            // Friends get a prefixed userId to separate from owner
            const friendUserId = `friend:${friendName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`

            if (!message) {
              return jsonResponse({ error: 'Message is required' }, 400)
            }

            if (onMessageStream) {
              const stream = new ReadableStream({
                start(controller) {
                  let isClosed = false
                  const heartbeat = setInterval(() => {
                    if (isClosed) { clearInterval(heartbeat); return }
                    try {
                      controller.enqueue(textEncoder.encode(': heartbeat\n\n'))
                    } catch {
                      clearInterval(heartbeat)
                    }
                  }, 8_000)

                  const send = (payload) => {
                    if (isClosed) return
                    try {
                      const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
                      controller.enqueue(textEncoder.encode(`data: ${data}\n\n`))
                      if (typeof payload === 'object' && payload?.type === 'done') {
                        isClosed = true
                        clearInterval(heartbeat)
                        controller.close()
                      }
                    } catch {
                      isClosed = true
                      clearInterval(heartbeat)
                    }
                  }

                  onMessageStream(message, friendUserId, send)
                    .then(() => {
                      if (!isClosed) {
                        isClosed = true
                        clearInterval(heartbeat)
                        try { controller.close() } catch {}
                      }
                    })
                    .catch((error) => {
                      if (!isClosed) {
                        send({ type: 'error', error: error?.message || 'Streaming error.' })
                        isClosed = true
                        clearInterval(heartbeat)
                        try { controller.close() } catch {}
                      }
                    })
                }
              })

              return new Response(stream, {
                headers: {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  Connection: 'keep-alive'
                }
              })
            }

            const responseText = await onMessage(message, friendUserId)
            return jsonResponse({ content: responseText })
          }

          // =================================================================
          // Owner-only API endpoints — require session cookie
          // =================================================================

          if (pathname === '/api/background-tasks' && request.method === 'GET') {
            if (!await isOwnerRequest(request)) {
              return jsonResponse({ error: 'Unauthorized' }, 401)
            }
            const userId = url.searchParams.get('userId') || 'web:owner'
            const tasks = getBackgroundTasks ? getBackgroundTasks(userId) : []
            return jsonResponse({ tasks })
          }

          if (pathname === '/api/sub-agents' && request.method === 'GET') {
            if (!await isOwnerRequest(request)) {
              return jsonResponse({ error: 'Unauthorized' }, 401)
            }
            const userId = url.searchParams.get('userId') || 'web:owner'
            try {
              const agents = getSubAgents ? getSubAgents(userId) : []
              return jsonResponse({ agents })
            } catch (err) {
              logger.error(`Error fetching sub-agents: ${err}`, 'web')
              return jsonResponse({ agents: [], error: String(err) }, 500)
            }
          }

          if (pathname === '/api/chat' && request.method === 'POST') {
            if (!await isOwnerRequest(request)) {
              return jsonResponse({ error: 'Unauthorized' }, 401)
            }

            let body = null

            try {
              body = await request.json()
            } catch (error) {
              return jsonResponse({ error: 'Invalid JSON' }, 400)
            }

            const message = body?.message || ''
            // Owner always uses the owner userId
            const userId = configManager?.get<string>('owner.ownerId') || 'web:owner'
            const wantsStream = Boolean(body?.stream)

            if (!message) {
              return jsonResponse({ error: 'Message is required' }, 400)
            }

            if (wantsStream && onMessageStream) {
              const stream = new ReadableStream({
                start(controller) {
                  let isClosed = false

                  // SSE heartbeat: send a comment every 8 s to keep the
                  // connection alive while sub-agents are working.
                  const heartbeat = setInterval(() => {
                    if (isClosed) { clearInterval(heartbeat); return }
                    try {
                      controller.enqueue(textEncoder.encode(': heartbeat\n\n'))
                    } catch {
                      clearInterval(heartbeat)
                    }
                  }, 8_000)
                  
                  const send = (payload) => {
                    if (isClosed) return
                    
                    try {
                      const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
                      controller.enqueue(textEncoder.encode(`data: ${data}\n\n`))
                      
                      // Close on done event
                      if (typeof payload === 'object' && payload?.type === 'done') {
                        isClosed = true
                        clearInterval(heartbeat)
                        controller.close()
                      }
                    } catch (error) {
                      // Controller already closed, ignore
                      isClosed = true
                      clearInterval(heartbeat)
                    }
                  }

                  onMessageStream(message, userId, send)
                    .then(() => {
                      // Ensure the stream is closed if onMessageStream resolves
                      // without emitting a {type: 'done'} event.
                      if (!isClosed) {
                        isClosed = true
                        clearInterval(heartbeat)
                        try {
                          controller.close()
                        } catch {
                          // Already closed
                        }
                      }
                    })
                    .catch((error) => {
                      if (!isClosed) {
                        send({ type: 'error', error: error?.message || 'Streaming error.' })
                        isClosed = true
                        clearInterval(heartbeat)
                        try {
                          controller.close()
                        } catch {
                          // Already closed
                        }
                      }
                    })
                }
              })

              return new Response(stream, {
                headers: {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  Connection: 'keep-alive'
                }
              })
            }

            const responseText = await onMessage(message, userId)
            return jsonResponse({ content: responseText })
          }

          if (pathname === '/' || pathname === '/index.html') {
            const { distDir } = resolveUiPaths()
            const distIndex = join(distDir, 'index.html')

            if (existsSync(distIndex)) {
              // If ownership not claimed, redirect to setup page
              if (!isOwnerClaimed()) {
                return Response.redirect(new URL('/setup', request.url).toString(), 302)
              }
              // If owner, serve the admin dashboard
              if (await isOwnerRequest(request)) {
                return fileResponse(distIndex)
              }
              // Not owner — redirect to login page
              return Response.redirect(new URL('/login', request.url).toString(), 302)
            }

            // No built files - show setup instructions
            return htmlResponse(buildDevNotice())
          }

          // Setup route — first-time onboarding flow
          if (pathname === '/setup') {
            const { distDir } = resolveUiPaths()
            const distIndex = join(distDir, 'index.html')

            if (existsSync(distIndex)) {
              return fileResponse(distIndex)
            }

            return htmlResponse(buildDevNotice())
          }

          // Login route — owner re-authentication page
          if (pathname === '/login') {
            if (!isOwnerClaimed()) {
              return Response.redirect(new URL('/setup', request.url).toString(), 302)
            }

            const { distDir } = resolveUiPaths()
            const distIndex = join(distDir, 'index.html')

            if (existsSync(distIndex)) {
              return fileResponse(distIndex) // SPA handles login view
            }

            return htmlResponse(buildDevNotice())
          }

          // Recovery route — owner account recovery via backup codes
          // Strip any query parameters to prevent token leakage via URL,
          // browser history, server logs, or Referer headers.
          if (pathname === '/recovery') {
            if (!isOwnerClaimed()) {
              return Response.redirect(new URL('/setup', request.url).toString(), 302)
            }

            if (url.search) {
              return Response.redirect(new URL('/recovery', request.url).toString(), 302)
            }

            const { distDir } = resolveUiPaths()
            const distIndex = join(distDir, 'index.html')

            if (existsSync(distIndex)) {
              return fileResponse(distIndex) // SPA handles recovery view
            }

            return htmlResponse(buildDevNotice())
          }

          // Friend chat route — served to everyone
          if (pathname === '/chat') {
            const { distDir } = resolveUiPaths()
            const distIndex = join(distDir, 'index.html')

            if (existsSync(distIndex)) {
              return fileResponse(distIndex) // SPA handles friend vs owner view
            }

            return htmlResponse(buildDevNotice())
          }

          // Serve static files from dist/ or public/
          const staticPath = findStaticFile(pathname.replace(/^\//, ''))
          if (staticPath) {
            return fileResponse(staticPath)
          }

          // SPA fallback: serve index.html for client-side routing
          const { distDir } = resolveUiPaths()
          const distIndex = join(distDir, 'index.html')
          if (existsSync(distIndex)) {
            return fileResponse(distIndex)
          }

          return jsonResponse({ error: 'Not found' }, 404)
        }
      })
    },

    async stop() {
      if (server) {
        server.stop()
        server = null
      }
    },

    getPort() {
      return server?.port || port
    }
  }
}
