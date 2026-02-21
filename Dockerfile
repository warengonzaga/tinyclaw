# ── Stage 1: Install + Build ────────────────────────────────────────
FROM oven/bun:1.3.9 AS builder

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json bun.lock tsconfig.json ./
COPY packages/compactor/package.json ./packages/compactor/
COPY packages/config/package.json ./packages/config/
COPY packages/core/package.json ./packages/core/
COPY packages/delegation/package.json ./packages/delegation/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/heartware/package.json ./packages/heartware/
COPY packages/intercom/package.json ./packages/intercom/
COPY packages/learning/package.json ./packages/learning/
COPY packages/logger/package.json ./packages/logger/
COPY packages/matcher/package.json ./packages/matcher/
COPY packages/memory/package.json ./packages/memory/
COPY packages/nudge/package.json ./packages/nudge/
COPY packages/plugins/package.json ./packages/plugins/
COPY packages/pulse/package.json ./packages/pulse/
COPY packages/queue/package.json ./packages/queue/
COPY packages/router/package.json ./packages/router/
COPY packages/sandbox/package.json ./packages/sandbox/
COPY packages/secrets/package.json ./packages/secrets/
COPY packages/shell/package.json ./packages/shell/
COPY packages/shield/package.json ./packages/shield/
COPY packages/types/package.json ./packages/types/
COPY src/cli/package.json ./src/cli/
COPY src/web/package.json ./src/web/
COPY plugins/channel/plugin-channel-discord/package.json ./plugins/channel/plugin-channel-discord/
COPY plugins/channel/plugin-channel-friends/package.json ./plugins/channel/plugin-channel-friends/
COPY plugins/provider/plugin-provider-openai/package.json ./plugins/provider/plugin-provider-openai/

# Install all deps (dev included — needed to build)
RUN bun install

# Copy source
COPY . .

# Build web UI (Vite → static assets) + CLI
RUN bun run build

# ── Stage 2: Production ─────────────────────────────────────────────
FROM oven/bun:1.3.9-slim AS production

WORKDIR /app

# Create non-root user for security (Trivy DS002)
RUN groupadd --gid 1001 tinyclaw && \
    useradd --uid 1001 --gid tinyclaw --shell /bin/sh tinyclaw

# Copy everything needed at runtime
COPY --from=builder --chown=tinyclaw:tinyclaw /app/package.json ./
COPY --from=builder --chown=tinyclaw:tinyclaw /app/bun.lock ./
COPY --from=builder --chown=tinyclaw:tinyclaw /app/packages ./packages
COPY --from=builder --chown=tinyclaw:tinyclaw /app/src ./src
COPY --from=builder --chown=tinyclaw:tinyclaw /app/plugins ./plugins
COPY --from=builder --chown=tinyclaw:tinyclaw /app/node_modules ./node_modules

# SQLite data volume (defaults to ~/.tinyclaw inside the container)
ENV TINYCLAW_DATA_DIR=/data
RUN mkdir -p /data && chown tinyclaw:tinyclaw /data
VOLUME /data

# Switch to non-root user
USER tinyclaw

# API + Web UI
EXPOSE 3000

# Health check against the API server
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

ENV NODE_ENV=production

# The app handles SIGINT for graceful shutdown (not SIGTERM)
STOPSIGNAL SIGINT

ENTRYPOINT ["bun", "run", "start"]
