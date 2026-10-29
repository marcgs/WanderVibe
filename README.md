# WanderVibe

WanderVibe is a personal trip-planning web app. This repository is the Next.js app, PostgreSQL, tests, and a production container image. Sign-in uses Auth.js with Microsoft Entra ID or Google. Trips belong to the signed-in user. The auth decisions are [ADR-0004](docs/adr/ADR-0004-authentication.md).

The host is Azure Container Apps. Infrastructure is Bicep in [`infra/`](infra), described in [docs/infra.md](docs/infra.md) and [ADR-0002](docs/adr/ADR-0002-azure-hosting.md). Continuous deployment is [docs/deploy.md](docs/deploy.md) and [ADR-0003](docs/adr/ADR-0003-continuous-deployment.md). See [ADR-0001](docs/adr/ADR-0001-application-stack.md). `cacheComponents` and `partialPrefetching` are on so pages can use the App Router static shell; request-time routes such as `/api/health` and `/api/ready` opt out with `connection()`.

## Prerequisites

- Node.js 22.12 or newer
- npm 10 or newer
- Docker, for the local Postgres database and for building the production image

## Setup

Copy the environment file, start Postgres, install dependencies, and apply migrations:

```bash
cp .env.example .env
docker compose up -d --wait
npm install
npx prisma migrate dev
```

`.env.example` sets the local connection string and the auth variables. Provider client ids and secrets stay empty until you register them. `AUTH_SECRET` in that file is a local placeholder. Azure reads the real value from Key Vault. [docs/deploy.md](docs/deploy.md) lists every variable and the Entra ID and Google registration steps, including the redirect URIs for localhost, staging, and production.

```bash
DATABASE_URL="postgresql://wandervibe:wandervibe@localhost:5432/wandervibe"
```

`npm install` generates the Prisma Client (`postinstall` runs `prisma generate`). `npx prisma migrate dev` creates the database schema from the committed migrations. Docker Compose publishes Postgres on `127.0.0.1:5432` only, with database, user, and password `wandervibe`. That password is for local development only.

The app and the Prisma CLI require `DATABASE_URL`. They do not fall back to a built-in URL. Next.js reads `.env`. The Prisma CLI reads it through `prisma.config.ts`. Auth.js requires `AUTH_SECRET` at runtime. Leave the provider variables empty to run without Microsoft or Google. Set `AUTH_TEST_LOGIN=true` when you want the local test-traveler button. That flag does nothing when `NODE_ENV` is `production`.

## Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). An unsigned visit redirects to [http://localhost:3000/signin](http://localhost:3000/signin). With provider credentials in `.env`, the page offers Microsoft and Google. With `AUTH_TEST_LOGIN=true`, it also offers a test traveler. After sign-in, the home page is the WanderVibe placeholder and a sign-out button. [http://localhost:3000/api/health](http://localhost:3000/api/health) returns HTTP 200 and `{ "status": "ok" }` with no session. It does not touch the database. [http://localhost:3000/api/ready](http://localhost:3000/api/ready) runs `SELECT 1` with no session and returns `{ "status": "ok" }` when Postgres answers, or HTTP 503 and `{ "status": "unavailable" }` when it does not. The body does not include error text. Any other unsigned API request returns 401.

For a production build on the host, without Docker:

```bash
npm run build
npm run start
```

## Production image

The Dockerfile is a multi-stage build. It compiles Next.js with `output: "standalone"` and runs `node server.js` as the non-root `node` user.

```bash
docker build -t wandervibe .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="postgresql://wandervibe:wandervibe@host.docker.internal:5432/wandervibe" \
  wandervibe
```

Pass `DATABASE_URL` at runtime. The image does not contain a database password, and the runtime stage does not include the Prisma CLI. The `migrate` stage does. Container Apps use `GET /api/health` for startup and liveness, and `GET /api/ready` for readiness. Continuous deployment runs `prisma migrate deploy` from that stage inside Azure. Continuous integration builds the runtime image and the migrate stage, and does not push them.

## Checks

| Command                | What it does                                      |
| ---------------------- | ------------------------------------------------- |
| `npm run lint`         | ESLint                                            |
| `npm run format:check` | Prettier (check only)                             |
| `npm run format`       | Prettier (write)                                  |
| `npm run typecheck`    | Generate Next.js route types, then `tsc --noEmit` |
| `npm run test`         | Vitest unit tests, once                           |
| `npm run test:watch`   | Vitest in watch mode                              |
| `npm run test:e2e`     | Playwright smoke tests                            |
| `npm run build`        | Production build                                  |

Unit tests include a Postgres check, so Postgres must be up and migrated before `npm run test`.

### End-to-end tests

Install the Chromium browser Playwright drives (once per machine):

```bash
npx playwright install chromium
```

Then run:

```bash
npm run test:e2e
```

Playwright starts `npm run dev` on port 3000 when that port is free, with `AUTH_TEST_LOGIN=true`. If a dev server is already running there, Playwright reuses it, and that server needs the same flag or the test traveler button is missing. Stop the other server when it was started without the flag. The smoke tests sign in as the test traveler, open the home page, sign out, and call `/api/health` and `/api/ready` with no session. `/api/ready` needs Postgres.

## Database

Prisma ORM stores data in PostgreSQL. The schema is `prisma/schema.prisma`. Auth.js uses `User`, `Account`, and `Session`. `Trip.ownerId` points at `User`. Migrations live in `prisma/migrations` and are committed. Create or update the local database with:

```bash
cp .env.example .env
docker compose up -d --wait
npx prisma migrate dev
```

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pull requests and on pushes to `main`.

- The `verify` job starts Postgres 17.11, applies migrations, then runs lint, Prettier, typecheck, unit tests, the production build, and Playwright.
- The `image` job builds the Docker image and the `migrate` stage, checks that `/api/health` returns 200, and checks that `/api/ready` returns 503 without a database. It does not push the image.
- The `bicep` job downloads Bicep CLI 0.48.1, checks its SHA-256, then runs `bicep build` and `bicep lint` on `infra/`. It also checks the ingress allowlist and the deploy workflow. It does not deploy.

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on pushes to `main`. Until the repository variables in [docs/deploy.md](docs/deploy.md) are set, it skips the deploy and stays green. It does not run on pull requests.

## Infrastructure

The first deployment of staging and production is documented in [docs/infra.md](docs/infra.md). It leaves the Container App out, because the registry is empty. After that, merges to `main` deploy through [docs/deploy.md](docs/deploy.md). For the first deployment, after `az login`, export `POSTGRES_ADMIN_PASSWORD` and:

```bash
az group create --name rg-wandervibe-staging --location switzerlandnorth
az deployment group what-if \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam \
  --parameters deployContainerApp=false
az deployment group create \
  --name wandervibe-staging \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam \
  --parameters deployContainerApp=false
```

Then `az acr build` (or `az acr login` and `docker push`) and deploy again with `containerImageTag` set to that tag. Use `rg-wandervibe-prod` and `infra/main.prod.bicepparam` for production. Do not commit the database password. `az acr login` uses an Entra token. It works with the registry admin user disabled.

Staging and production ingress still allow only IPv4 CIDRs supplied at deploy time. The parameter files commit no addresses and keep `restrictPublicAccess` true. An empty list answers 403 to every real client. Sign-in stays off until the GitHub Environment variable `AUTH_CONFIGURED` is `true`, so a deploy before the provider secrets exist still starts. `/api/health` and `/api/ready` stay anonymous. [docs/infra.md](docs/infra.md) and [docs/deploy.md](docs/deploy.md) cover the allowlist, the runner rule, and how to turn auth on.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Prisma + PostgreSQL
- Auth.js (NextAuth v5) with Microsoft Entra ID and Google
- Vitest and React Testing Library
- Playwright
- ESLint + Prettier
- Docker, with Azure Container Apps as the deployment target (see [docs/infra.md](docs/infra.md))
