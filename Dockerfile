# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.5 AS bun-bin

FROM oven/bun:1.3.0 AS corelib-bun-bin

FROM node:22-bookworm-slim AS core-library

ARG OPENPCB_CORELIB_REF="b1ec4e48a6a9ac89abc4a1c9b34ea941117f57f1"
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
COPY --from=corelib-bun-bin /usr/local/bin/bun /usr/local/bin/bun
RUN git init /core-library \
    && git -C /core-library remote add origin https://github.com/OpenPCB-app/CoreLibrary.git \
    && git -C /core-library fetch --depth 1 origin "${OPENPCB_CORELIB_REF}" \
    && git -C /core-library checkout --detach FETCH_HEAD \
    && test "$(git -C /core-library rev-parse HEAD)" = "${OPENPCB_CORELIB_REF}"
WORKDIR /core-library
RUN npm install
# The upstream STEP-to-GLB converter crashes under Docker's virtualized CPU.
# Keep all 231 schematic/footprint components; Docker builds omit only the
# optional pre-generated 3D assets until upstream publishes a full release.
RUN mv 3d /core-library-3d-source \
    && mkdir 3d \
    && bun run pack --version=0.1.1-docker.1 --channel=beta --no-step=true --out=/core-library-dist

FROM node:22-bookworm-slim AS build

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app

# The package lock pins the shared @openpcb packages to Git tags.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun

# Copy workspace manifests separately so dependency installation stays cached
# when only application source changes.
COPY package.json package-lock.json ./
COPY electron/package.json electron/package.json
COPY src/core/backend/package.json src/core/backend/package.json
COPY src/core/frontend/package.json src/core/frontend/package.json
RUN npm ci

COPY . .
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_CLOUD_API_URL=""
ARG VITE_CLOUD_WEB_URL=""
ARG VITE_CLOUD_COPILOT_URL=""
COPY --from=core-library /core-library-dist/*.opclib resources/core-library/
RUN cd resources/core-library \
    && sha256sum ./*.opclib > SHA256SUMS \
    && cd /app \
    && npm run build:frontend

FROM build AS runtime-deps

RUN npm ci --omit=dev \
    --workspace src/core/backend \
    --workspace src/core/frontend \
    --include-workspace-root \
    && sed -i 's/maxEntries: 500/maxEntries: 8192/' node_modules/@openpcb/opclib-pack/dist/validate/constants.js \
    && grep -q 'maxEntries: 8192' node_modules/@openpcb/opclib-pack/dist/validate/constants.js

FROM oven/bun:1.3.5 AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    OPENPCB_DB_PATH=/data/openpcb.sqlite \
    OPENPCB_STATIC_DIR=/app/frontend-dist \
    OPENPCB_WORKSPACE_ROOT=/app/src

WORKDIR /app

COPY --chown=bun:bun --from=runtime-deps /app/node_modules ./node_modules
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
