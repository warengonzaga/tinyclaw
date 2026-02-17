/**
 * Friends Chat HTTP Server
 *
 * Lightweight Bun HTTP server that exposes:
 *   - GET  /chat           → Friends chat UI (static HTML)
 *   - GET  /chat?invite=X  → Auto-redeem invite, set cookie, show chat
 *   - POST /api/chat       → Chat API (SSE stream or JSON)
 *   - POST /api/nickname   → Update friend's nickname
 *   - GET  /api/health     → Health check
 *
 * Authentication is cookie-based. The invite code is consumed on first use
 * and replaced with a long-lived session cookie (`tc_friend_session`).
 */

import { logger } from '@tinyclaw/logger';
import type { InviteStore, FriendUser } from './store.js';

const COOKIE_NAME = 'tc_friend_session';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds

interface FriendsServerConfig {
  port: number;
  host: string;
  store: InviteStore;
  chatHtml: string;
  secure?: boolean;
  onMessage: (message: string, userId: string) => Promise<string>;
  onMessageStream?: (
    message: string,
    userId: string,
    send: (payload: unknown) => void,
  ) => Promise<void>;
}

/**
 * Parse the session token from the cookie header.
 */
function getSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

/**
 * Build a Set-Cookie header for the friend session.
 */
function buildSessionCookie(token: string, secure = false): string {
  let cookie = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
  if (secure) cookie += '; Secure';
  return cookie;
}

/**
 * JSON response helper.
 */
function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * HTML response helper.
 */
function htmlResponse(html: string, status = 200, headers?: Record<string, string>): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...headers,
    },
  });
}

/**
 * Authenticate a request — returns the friend user or null.
 */
function authenticateFriend(request: Request, store: InviteStore): FriendUser | null {
  const token = getSessionToken(request);
  if (!token) return null;
  return store.getBySessionToken(token);
}

export function createFriendsServer(config: FriendsServerConfig) {
  const { port, host, store, chatHtml, onMessage, onMessageStream } = config;
  const secure = config.secure ?? (process.env.NODE_ENV === 'production');
  const textEncoder = new TextEncoder();

  let server: ReturnType<typeof Bun.serve> | null = null;

  return {
    async start() {
      server = Bun.serve({
        port,
        hostname: host,
        async fetch(request: Request): Promise<Response> {
          const url = new URL(request.url);
          const pathname = url.pathname;

          // ─── Health check ───────────────────────────────────────
          if (pathname === '/api/health' && request.method === 'GET') {
            return jsonResponse({ ok: true, service: 'friends-chat' });
          }

          // ─── Chat page ──────────────────────────────────────────
          if ((pathname === '/chat' || pathname === '/') && request.method === 'GET') {
            const inviteCode = url.searchParams.get('invite');

            // If invite code provided, try to redeem
            if (inviteCode) {
              const result = store.redeemInvite(inviteCode);
              if (result) {
                logger.info(`Friend "${result.friend.username}" redeemed invite`);
                // Redirect to /chat (without invite param) with session cookie
                return new Response(null, {
                  status: 302,
                  headers: {
                    Location: '/chat',
                    'Set-Cookie': buildSessionCookie(result.sessionToken, secure),
                  },
                });
              }
              // Invalid code — show chat page (will show invite code input)
              return htmlResponse(chatHtml);
            }

            // No invite code — serve the chat page
            // Auth check happens client-side via /api/auth/status
            return htmlResponse(chatHtml);
          }

          // ─── Auth status ────────────────────────────────────────
          if (pathname === '/api/auth/status' && request.method === 'GET') {
            const friend = authenticateFriend(request, store);
            if (friend) {
              store.touchLastSeen(friend.username);
              return jsonResponse({
                authenticated: true,
                username: friend.username,
                nickname: friend.nickname,
              });
            }
            return jsonResponse({ authenticated: false });
          }

          // ─── Redeem invite via API (for manual code entry) ──────
          if (pathname === '/api/auth/redeem' && request.method === 'POST') {
            let body: Record<string, unknown> | null = null;
            try {
              body = await request.json();
            } catch {
              return jsonResponse({ error: 'Invalid JSON' }, 400);
            }

            if (typeof body?.code !== 'string') {
              return jsonResponse({ error: 'Invite code must be a string' }, 400);
            }
            const code = body.code.trim();
            if (!code) {
              return jsonResponse({ error: 'Invite code is required' }, 400);
            }

            const result = store.redeemInvite(code);
            if (!result) {
              return jsonResponse({ error: 'Invalid or expired invite code' }, 401);
            }

            logger.info(`Friend "${result.friend.username}" redeemed invite via code entry`);
            return jsonResponse(
              {
                authenticated: true,
                username: result.friend.username,
                nickname: result.friend.nickname,
              },
              200,
              { 'Set-Cookie': buildSessionCookie(result.sessionToken, secure) },
            );
          }

          // ─── Update nickname ────────────────────────────────────
          if (pathname === '/api/nickname' && request.method === 'POST') {
            const friend = authenticateFriend(request, store);
            if (!friend) {
              return jsonResponse({ error: 'Unauthorized' }, 401);
            }

            let body: Record<string, unknown> | null = null;
            try {
              body = await request.json();
            } catch {
              return jsonResponse({ error: 'Invalid JSON' }, 400);
            }

            if (typeof body?.nickname !== 'string') {
              return jsonResponse({ error: 'Nickname must be a string' }, 400);
            }
            const newNickname = body.nickname.trim();
            if (!newNickname || newNickname.length > 64) {
              return jsonResponse({ error: 'Nickname must be 1–64 characters' }, 400);
            }

            store.updateNickname(friend.username, newNickname);
            return jsonResponse({ ok: true, nickname: newNickname });
          }

          // ─── Chat API (message) ─────────────────────────────────
          if (pathname === '/api/chat' && request.method === 'POST') {
            const friend = authenticateFriend(request, store);
            if (!friend) {
              return jsonResponse({ error: 'Unauthorized' }, 401);
            }

            let body: Record<string, unknown> | null = null;
            try {
              body = await request.json();
            } catch {
              return jsonResponse({ error: 'Invalid JSON' }, 400);
            }

            if (typeof body?.message !== 'string') {
              return jsonResponse({ error: 'Message is required' }, 400);
            }
            const message = body.message.trim();
            if (!message) {
              return jsonResponse({ error: 'Message is required' }, 400);
            }

            store.touchLastSeen(friend.username);
            const userId = `friend:${friend.username}`;

            // SSE streaming response
            if (onMessageStream) {
              const stream = new ReadableStream({
                start(controller) {
                  let isClosed = false;
                  const heartbeat = setInterval(() => {
                    if (isClosed) {
                      clearInterval(heartbeat);
                      return;
                    }
                    try {
                      controller.enqueue(textEncoder.encode(': heartbeat\n\n'));
                    } catch {
                      clearInterval(heartbeat);
                    }
                  }, 8_000);

                  const send = (payload: unknown) => {
                    if (isClosed) return;
                    try {
                      const data =
                        typeof payload === 'string'
                          ? payload
                          : JSON.stringify(payload);
                      controller.enqueue(textEncoder.encode(`data: ${data}\n\n`));
                      if (
                        typeof payload === 'object' &&
                        payload &&
                        (payload as Record<string, unknown>).type === 'done'
                      ) {
                        isClosed = true;
                        clearInterval(heartbeat);
                        controller.close();
                      }
                    } catch {
                      isClosed = true;
                      clearInterval(heartbeat);
                    }
                  };

                  onMessageStream(message, userId, send)
                    .then(() => {
                      if (!isClosed) {
                        isClosed = true;
                        clearInterval(heartbeat);
                        try {
                          controller.close();
                        } catch {}
                      }
                    })
                    .catch((error) => {
                      if (!isClosed) {
                        send({
                          type: 'error',
                          error: (error as Error)?.message || 'Streaming error.',
                        });
                        isClosed = true;
                        clearInterval(heartbeat);
                        try {
                          controller.close();
                        } catch {}
                      }
                    });
                },
              });

              return new Response(stream, {
                headers: {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  Connection: 'keep-alive',
                },
              });
            }

            // Fallback: non-streaming
            try {
              const responseText = await onMessage(message, userId);
              return jsonResponse({ content: responseText });
            } catch (error) {
              logger.error(`Friends chat onMessage error for userId=${userId}: ${(error as Error)?.message}`);
              return jsonResponse({ error: 'Internal server error' }, 500);
            }
          }

          // ─── 404 fallback ───────────────────────────────────────
          return jsonResponse({ error: 'Not found' }, 404);
        },
      });

      logger.info(`Friends chat server listening on ${host}:${port}`);
    },

    stop() {
      if (server) {
        server.stop();
        server = null;
        logger.info('Friends chat server stopped');
      }
    },

    getPort() {
      return server?.port || port;
    },
  };
}
