# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
ARG BUN_VERSION=1.4.3

FROM oven/bun:${BUN_VERSION}-alpine AS bun

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

FROM base AS deps
COPY package.json bun.lock prisma.config.ts ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN bun run build

FROM base AS prod-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts --omit=peer

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S citycare && adduser -S citycare -G citycare
COPY --from=prod-deps --chown=citycare:citycare /app/node_modules ./node_modules
COPY --from=build --chown=citycare:citycare /app/dist ./dist
COPY --chown=citycare:citycare package.json ./
USER citycare
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:5000/api/v1/health/live > /dev/null || exit 1
CMD ["node", "dist/server.js"]
