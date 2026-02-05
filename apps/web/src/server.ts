import { existsSync } from 'fs'
import { extname, join, resolve } from 'path'

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
    <title>TinyClaw UI</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0d12; color: #e7edf4; display: grid; place-items: center; height: 100vh; margin: 0; }
      .card { max-width: 520px; background: #151c28; padding: 32px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0 0 12px; color: #9aa9ba; }
      code { background: rgba(255,255,255,0.08); padding: 4px 8px; border-radius: 8px; }
      a { color: #f5b85b; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>TinyClaw UI is not built yet</h1>
      <p>Run the Vite dev server for the new Svelte UI:</p>
      <p><code>bun run --cwd apps/web dev</code></p>
      <p>Then open <a href="http://localhost:5173" target="_blank">http://localhost:5173</a>.</p>
    </div>
  </body>
</html>`
}

export function createWebUI(config) {
  const {
    port = 3000,
    host = '0.0.0.0',
    onMessage,
    onMessageStream
  } = config

  let server = null

  return {
    async start() {
      if (server) return

      server = Bun.serve({
        port,
        hostname: host,
        fetch: async (request) => {
          const url = new URL(request.url)
          const pathname = url.pathname

          if (pathname === '/api/health' && request.method === 'GET') {
            return jsonResponse({ ok: true })
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
                  const send = (payload) => {
                    const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
                    controller.enqueue(textEncoder.encode(`data: ${data}\n\n`))
                  }

                  onMessageStream(message, userId, send)
                    .catch((error) => {
                      send({ type: 'error', error: error?.message || 'Streaming error.' })
                    })
                    .finally(() => {
                      controller.close()
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

            return htmlResponse(buildDevNotice())
          }

          const staticPath = findStaticFile(pathname.replace(/^\//, ''))
          if (staticPath) {
            return fileResponse(staticPath)
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
