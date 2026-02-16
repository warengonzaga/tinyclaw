import { existsSync, chmodSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { timingSafeEqual } from 'crypto'

const textEncoder = new TextEncoder()

// ---------------------------------------------------------------------------
// Owner Authority — claim-based token authentication
// ---------------------------------------------------------------------------

/** Token expiry — claim & login tokens are valid for 1 hour (per OpenClaw pattern). */
const TOKEN_EXPIRY_MS = 60 * 60 * 1000

/**
 * Human-friendly alphabet for tokens — excludes ambiguous characters
 * (0/O, 1/I/L) following the OpenClaw pairing-code pattern.
 */
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Generate a cryptographically random claim/login token.
 * Uses 16 characters from a 32-char human-friendly alphabet (~80-bit entropy).
 * This is printed to the console on boot.
 */
function generateClaimToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const chars = Array.from(bytes, b => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length])
  // Format as tc_XXXX-XXXX-XXXX-XXXX for readability
  const raw = chars.join('')
  return `tc_${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`
}

/**
 * Generate a persistent session token for the owner cookie.
 * 48 hex chars (24 random bytes = 192-bit entropy) — matches OpenClaw auto-token strength.
 */
function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * SHA-256 hash a string (for storing session token hashes in config).
 */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
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
    <title>TinyClaw</title>
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
      <h1>🐾 TinyClaw</h1>
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
    onOwnerClaimed,
    configDbPath,
  } = config

  const serverStartedAt = Date.now()
  let server = null

  // Claim token — generated once per boot, printed to console
  let claimToken: string | null = null
  let claimTokenCreatedAt: number = 0

  // Login token — generated on boot when ownership is already claimed,
  // allows the owner to re-authenticate from a new browser / cleared cookies.
  let loginToken: string | null = null
  let loginTokenCreatedAt: number = 0

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

  /**
   * Generate (or return existing) login token. Called on boot when
   * ownership is already claimed. Tokens expire after TOKEN_EXPIRY_MS.
   */
  function getOrCreateLoginToken(): string {
    const now = Date.now()
    if (!loginToken || (now - loginTokenCreatedAt) > TOKEN_EXPIRY_MS) {
      loginToken = generateClaimToken() // same format, different purpose
      loginTokenCreatedAt = now
    }
    return loginToken
  }

  /**
   * Check if the login token is still valid (not expired).
   */
  function isLoginTokenValid(): boolean {
    if (!loginToken) return false
    return (Date.now() - loginTokenCreatedAt) <= TOKEN_EXPIRY_MS
  }

  return {
    async start() {
      if (server) return

      if (!isOwnerClaimed()) {
        // First-time: display claim token
        const token = getOrCreateClaimToken()
        console.log('')
        console.log('  ┌────────────────────────────────────────────────────────┐')
        console.log('  │                                                        │')
        console.log('  │   🐜 TinyClaw — Owner Claim Token                      │')
        console.log('  │                                                        │')
        console.log(`  │   Token: ${token}                   │`)
        console.log('  │                                                        │')
        console.log('  │   Enter this on the web UI to claim ownership.         │')
        console.log('  │   The first person to claim becomes the owner.         │')
        console.log('  │   ⏳ Expires in 1 hour. Restart to generate a new one. │')
        console.log('  │                                                        │')
        console.log('  └────────────────────────────────────────────────────────┘')
        console.log('')
      } else {
        // Already claimed: display login token for re-authentication
        const token = getOrCreateLoginToken()
        console.log('')
        console.log('  ┌────────────────────────────────────────────────────────┐')
        console.log('  │                                                        │')
        console.log('  │   🐜 TinyClaw — Owner Login Token                      │')
        console.log('  │                                                        │')
        console.log(`  │   Token: ${token}                   │`)
        console.log('  │                                                        │')
        console.log('  │   Use this at /login to access the dashboard           │')
        console.log('  │   from a new browser or after clearing cookies.        │')
        console.log('  │   ⏳ Expires in 1 hour. Restart to generate a new one. │')
        console.log('  │                                                        │')
        console.log('  └────────────────────────────────────────────────────────┘')
        console.log('')
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
            return jsonResponse({ claimed, isOwner })
          }

          // Owner login — re-authenticate using a login token from the console
          if (pathname === '/api/auth/login' && request.method === 'POST') {
            // Rate limit login attempts
            const clientIP = getClientIP(request, server)
            if (!checkRateLimit(clientIP)) {
              return jsonResponse({ error: 'Too many attempts. Try again later.' }, 429)
            }

            if (!isOwnerClaimed()) {
              return jsonResponse({ error: 'No owner to log in as. Use the claim flow first.' }, 400)
            }
            let body
            try {
              body = await request.json()
            } catch {
              return jsonResponse({ error: 'Invalid JSON' }, 400)
            }
            const token = body?.token
            if (!token || !isLoginTokenValid() || !timingSafeCompare(token, loginToken!)) {
              return jsonResponse({ error: 'Invalid or expired login token. Restart TinyClaw to generate a new one.' }, 401)
            }

            // Issue a new session token and update the stored hash
            const sessionToken = generateSessionToken()
            const hash = await sha256(sessionToken)

            if (configManager) {
              configManager.set('owner.sessionTokenHash', hash)
            }

            // Rotate login token after successful use
            loginToken = null

            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': buildSessionCookie(sessionToken),
              },
            })
          }

          // Claim ownership — first-to-claim flow
          if (pathname === '/api/auth/claim' && request.method === 'POST') {
            // Rate limit claim attempts
            const clientIP = getClientIP(request, server)
            if (!checkRateLimit(clientIP)) {
              return jsonResponse({ error: 'Too many attempts. Try again later.' }, 429)
            }

            if (isOwnerClaimed()) {
              return jsonResponse({ error: 'Ownership already claimed' }, 403)
            }
            let body
            try {
              body = await request.json()
            } catch {
              return jsonResponse({ error: 'Invalid JSON' }, 400)
            }
            const token = body?.token
            if (!token || !isClaimTokenValid() || !timingSafeCompare(token, claimToken!)) {
              return jsonResponse({ error: 'Invalid or expired claim token. Restart TinyClaw to generate a new one.' }, 401)
            }

            // Claim successful — generate session token and persist owner
            const sessionToken = generateSessionToken()
            const hash = await sha256(sessionToken)
            const ownerId = 'web:owner'

            if (configManager) {
              configManager.set('owner.ownerId', ownerId)
              configManager.set('owner.sessionTokenHash', hash)
              configManager.set('owner.claimedAt', Date.now())
            }

            // Clear claim token — it's single-use
            claimToken = null

            // Notify the start command so it can wire ownerId into AgentContext
            if (onOwnerClaimed) {
              onOwnerClaimed(ownerId)
            }

            return new Response(JSON.stringify({ ok: true, ownerId }), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': buildSessionCookie(sessionToken),
              },
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
              console.error('[/api/sub-agents] Error fetching sub-agents:', err)
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
              // If ownership not claimed, redirect to claim page
              if (!isOwnerClaimed()) {
                return fileResponse(distIndex) // SPA handles claim flow client-side
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

          // Login route — owner re-authentication page
          if (pathname === '/login') {
            const { distDir } = resolveUiPaths()
            const distIndex = join(distDir, 'index.html')

            if (existsSync(distIndex)) {
              return fileResponse(distIndex) // SPA handles login view
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
