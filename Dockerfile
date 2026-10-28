# Production image for Azure Container Apps.
# Liveness probe: GET /api/health on port 3000.
# The runtime image has no Prisma CLI. Apply migrations with
# `prisma migrate deploy` in the deploy workflow (stories #13 and #14).
#
#   docker build -t wandervibe .
#   docker run --rm -p 3000:3000 -e DATABASE_URL=postgresql://... wandervibe

FROM node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS base

FROM base AS deps

WORKDIR /app

# Prisma's CLI looks up OpenSSL when it generates the client.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Generate does not connect. The URL stays in this build stage.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
  npm ci --no-audit --no-fund

FROM base AS builder

WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npx prisma generate \
  && npm run build

FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/public ./public

RUN mkdir .next && chown node:node .next

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

CMD ["node", "server.js"]
