# Production image for Azure Container Apps.
# Startup and liveness: GET /api/health on port 3000.
# Readiness: GET /api/ready. The route returns within 2.5s.
# The body is only ok or unavailable.
# The runtime image has no Prisma CLI. The migrate stage does.
# Continuous deployment runs that stage inside Azure, because Postgres
# accepts connections from Azure services only.
#
#   docker build -t wandervibe .
#   docker run --rm -p 3000:3000 -e DATABASE_URL=postgresql://... wandervibe

FROM node:26.12.0-bookworm-slim@sha256:742a0fe7320e09e0321222b68165e6ac731d30470e7ea7f98f9bfc3a6e1034fe AS base

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

# prisma migrate deploy. The Container Apps job runs this as the app identity,
# which reads DATABASE_URL from Key Vault. npx uses the local Prisma CLI.
FROM deps AS migrate

ENV HOME=/tmp
ENV NPM_CONFIG_CACHE=/tmp/npm-cache
ENV PRISMA_HIDE_UPDATE_MESSAGE=1

# prisma migrate deploy only reads the schema and migrations. node_modules stays
# owned by root and world-readable, so this stage does not copy it with chown.
USER node

CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]

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
