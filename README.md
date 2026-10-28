# WanderVibe

WanderVibe is a personal trip-planning web app. This repository is the project foundation: the Next.js app, PostgreSQL, tests, and a production container image. Authentication is not implemented yet; accounts and per-user trips arrive in story #15.

The intended host is Azure Container Apps. Azure infrastructure and deploy workflows are not in this repository yet. See [ADR-0001](docs/adr/0001-application-stack.md). `cacheComponents` and `partialPrefetching` are on so pages can use the App Router static shell; request-time routes such as `/api/health` opt out with `connection()`.

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

`.env.example` sets the local connection string:

```bash
DATABASE_URL="postgresql://wandervibe:wandervibe@localhost:5432/wandervibe"
```

`npm install` generates the Prisma Client (`postinstall` runs `prisma generate`). `npx prisma migrate dev` creates the database schema from the committed migrations. Docker Compose publishes Postgres on `127.0.0.1:5432` only, with database, user, and password `wandervibe`. That password is for local development only.

The app and the Prisma CLI require `DATABASE_URL`. They do not fall back to a built-in URL. Next.js reads `.env`. The Prisma CLI reads it through `prisma.config.ts`.

## Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The home page is a WanderVibe placeholder. [http://localhost:3000/api/health](http://localhost:3000/api/health) returns HTTP 200 and `{ "status": "ok" }` for container health probes.

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

Pass `DATABASE_URL` at runtime. The image does not contain a database password, and it does not include the Prisma CLI. Container Apps should probe `GET /api/health` on port 3000. Apply production migrations with `prisma migrate deploy` in the deploy workflow (stories #13 and #14). Continuous integration builds this image and does not push it.

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

Playwright starts `npm run dev` on port 3000 when that port is free. If a dev server is already running there, Playwright reuses it. The smoke tests open the home page and call `/api/health`.

## Database

Prisma ORM stores data in PostgreSQL. The schema is `prisma/schema.prisma` and currently contains a minimal `Trip` model. Migrations live in `prisma/migrations` and are committed. Create or update the local database with:

```bash
cp .env.example .env
docker compose up -d --wait
npx prisma migrate dev
```

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pull requests and on pushes to `main`.

- The `verify` job starts Postgres 17.11, applies migrations, then runs lint, Prettier, typecheck, unit tests, the production build, and Playwright.
- The `image` job builds the Docker image and checks that `/api/health` returns 200. It does not push the image.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Prisma + PostgreSQL
- Vitest and React Testing Library
- Playwright
- ESLint + Prettier
- Docker, with Azure Container Apps as the deployment target
