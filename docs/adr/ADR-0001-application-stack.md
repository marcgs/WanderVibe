# ADR-0001: Application stack and production target

## Status

Accepted

## Date

2026-10-28

## Context

WanderVibe is a personal trip-planning web app. It will run as a container on Azure, so the foundation needs a server database, a reproducible image, and a health probe. Accounts are not part of this scaffold.

## Decision

- Build the app with Next.js (App Router), TypeScript, and Tailwind CSS.
- Turn on `cacheComponents` and `partialPrefetching`. They are the App Router's static shell and prefetch behaviour in this Next.js version, so pages can render a static shell and prefetch the rest. A route that must run on each request, such as `GET /api/health`, calls `connection()` from `next/server` so it is not baked at build time.
- Persist data with PostgreSQL through Prisma. The connection string is `DATABASE_URL`, and the app throws if it is missing. Local development runs Postgres with Docker Compose, bound to `127.0.0.1`. Continuous integration applies migrations and runs tests against a pinned Postgres service container.
- Test with Vitest and React Testing Library for unit tests, and Playwright for end-to-end smoke tests. Both run in CI on pull requests and on `main`, so a broken page or health probe fails before merge.
- Format and lint with Prettier and ESLint. CI runs `format:check` and `lint` on the same triggers, so style and static checks stay part of the gate rather than a local habit.
- Ship the app as a multi-stage Docker image that uses Next.js `output: "standalone"`, runs as the non-root `node` user, and listens on port 3000. `GET /api/health` returns HTTP 200 with `cache-control: no-store` for container liveness probes. The runtime image does not include the Prisma CLI.
- The production target is Azure Container Apps. This repository does not yet contain Azure infrastructure or a deploy workflow. Authentication and per-user trips arrive in story #15.

## Consequences

- Developers copy `.env.example` to `.env` before install and migrations. Prisma and the app both require `DATABASE_URL`.
- Developers need Postgres running (Docker Compose, or another server that matches `DATABASE_URL`) before `npx prisma migrate dev` and before the database test.
- Production configuration supplies `DATABASE_URL` at runtime. The image does not embed a database credential.
- Production migrations are a separate `prisma migrate deploy` step in the deploy workflow (stories #13 and #14), because the runtime image has no Prisma CLI.
- A later story will add the Azure Container Apps resources, the managed Postgres service, and the workflow that pushes and deploys the image. Continuous integration only builds the image. Story #15 adds authentication.

## Alternatives considered

- SQLite kept the laptop setup to a single file, and it is a poor fit for Container Apps because the container filesystem is ephemeral and Azure does not offer managed SQLite.
- Putting Postgres inside the application container would couple the database lifecycle to every app replica. The app depends only on `DATABASE_URL`, so the managed database can be chosen with the infrastructure story.
- Leaving `cacheComponents` off would avoid the static health-route pitfall, and it would also drop the static shell this Next.js version is set up to use. Request-time routes opt out with `connection()` instead.
