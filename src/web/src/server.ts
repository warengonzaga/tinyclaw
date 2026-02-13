import { existsSync } from 'fs'
import { join, resolve } from 'path'

const textEncoder = new TextEncoder()

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  })
}

function fileResponse(filePath) {
  return new Response(Bun.file(filePath))
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
    getSubAgents
  } = config

  let server = null

  return {
    async start() {
      if (server) return

      server = Bun.serve({
        port,
        hostname: host,
        idleTimeout: 255, // seconds — MAX_TIMEOUT_MS (300s) + 2 extensions (60s) = 360s is worst-case agent time; Bun caps at 255
        fetch: async (request) => {
          const url = new URL(request.url)
          const pathname = url.pathname

          if (pathname === '/api/health' && request.method === 'GET') {
            return jsonResponse({ ok: true })
          }

          if (pathname === '/api/background-tasks' && request.method === 'GET') {
            const userId = url.searchParams.get('userId') || 'default-user'
            const tasks = getBackgroundTasks ? getBackgroundTasks(userId) : []
            return jsonResponse({ tasks })
          }

          if (pathname === '/api/sub-agents' && request.method === 'GET') {
            const userId = url.searchParams.get('userId') || 'default-user'
            try {
              const agents = getSubAgents ? getSubAgents(userId) : []
              if (agents.length > 0) {
                console.log(`[/api/sub-agents] Returning ${agents.length} agents for userId="${userId}":`, agents.map(a => `${a.role}(${a.status})`))
              }
              return jsonResponse({ agents })
            } catch (err) {
              console.error('[/api/sub-agents] Error fetching sub-agents:', err)
              return jsonResponse({ agents: [], error: String(err) }, 500)
            }
          }

          if (pathname === '/api/chat' && request.method === 'POST') {
            let body = null

            try {
              body = await request.json()
            } catch (error) {
              return jsonResponse({ error: 'Invalid JSON' }, 400)
            }

            const message = body?.message || ''
            const userId = body?.userId || 'default-user'
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
              return fileResponse(distIndex)
            }

            // No built files - show setup instructions
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
