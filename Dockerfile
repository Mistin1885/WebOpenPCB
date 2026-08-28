# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app

# The package lock pins the shared @openpcb packages to Git tags.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests separately so dependency installation stays cached
# when only application source changes.
COPY package.json package-lock.json ./
COPY electron/package.json electron/package.json
COPY src/core/backend/package.json src/core/backend/package.json
COPY src/core/frontend/package.json src/core/frontend/package.json
RUN npm ci

COPY . .
RUN npm run build:frontend

FROM oven/bun:1.3.5 AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    OPENPCB_DB_PATH=/data/openpcb.sqlite \
    OPENPCB_STATIC_DIR=/app/frontend-dist \
    OPENPCB_WORKSPACE_ROOT=/app/src

WORKDIR /app

COPY --chown=bun:bun --from=build /app/node_modules ./node_modules
COPY --chown=bun:bun --from=build /app/package.json ./package.json
COPY --chown=bun:bun --from=build /app/src ./src
COPY --chown=bun:bun --from=build /app/resources ./resources
COPY --chown=bun:bun --from=build /app/src/core/frontend/dist ./frontend-dist

RUN mkdir -p /data && chown bun:bun /data

USER bun
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:3000/api/health'); if (!response.ok) process.exit(1)"]

CMD ["bun", "src/core/backend/main.ts"]
