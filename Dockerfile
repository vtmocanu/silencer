# syntax=docker/dockerfile:1.7
# Multi-stage build:
#   1. builder — `npm ci` from a committed lockfile for reproducible installs
#   2. runtime — node:24-alpine + production node_modules + source only
# node:*-alpine ships with a `node` user/group at UID/GID 1000 — we reuse it
# rather than create a duplicate (which collides on `addgroup -g 1000`).

FROM node:24-alpine AS builder
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY app/package.json ./package.json
COPY app/src ./src

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://localhost:3000/healthz || exit 1

CMD ["node", "src/index.js"]
