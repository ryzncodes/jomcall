# syntax=docker/dockerfile:1
# Agent and engine worker image (one image, two commands). Build context: the
# repository root. No secret is copied or baked in: settings arrive at run time
# from the service's own env file (see docker-compose.yml).
# Base pinned by exact tag and multi-arch index digest.
ARG NODE_IMAGE=node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Workers import the workspace packages by relative path, so only the root
# dependencies are needed. Dev dependencies stay: the workers run through tsx.
RUN npm ci --workspaces=false --include-workspace-root --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root package.json tsconfig.json ./
COPY --chown=root:root packages ./packages
COPY --chown=root:root engine ./engine
COPY --chown=root:root scripts/hosted ./scripts/hosted
# The `node` user (uid 1000) ships with the base image. Code stays root-owned
# and read-only to it.
USER node
# Overridden per service in docker-compose.yml.
CMD ["node", "--import", "tsx", "engine/src/index.ts"]
