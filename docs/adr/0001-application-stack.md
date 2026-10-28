# ADR-0001: Application stack and production target

## Status

Accepted

## Date

2026-10-28

## Context

WanderVibe is a single-user trip-planning web app. The first scaffold sketch used a local SQLite file so the app could run without extra services. The product will be deployed as a real production-style app on Azure, which needs a server database and a container image a hosting platform can run and probe.

## Decision

- Build the app with Next.js (App Router), TypeScript, and Tailwind CSS.
- Persist data with PostgreSQL through Prisma. The connection string is `DATABASE_URL`. Local development runs Postgres with Docker Compose. Continuous integration applies migrations and runs tests against a Postgres service container.
- Ship the app as a multi-stage Docker image that uses Next.js `output: "standalone"`, runs as the non-root `node` user, and listens on port 3000. `GET /api/health` returns HTTP 200 for container health probes.
- The production target is Azure Container Apps. This repository does not yet contain Azure infrastructure or a deploy workflow.

## Consequences

- Developers need Postgres running (Docker Compose, or another server that matches `DATABASE_URL`) before `npx prisma migrate dev` and before the database test.
- Production configuration supplies `DATABASE_URL` at runtime. The image does not embed a database credential.
- A later story will add the Azure Container Apps resources, the managed Postgres service, and the workflow that pushes and deploys the image. Continuous integration only builds the image.

## Alternatives considered

- SQLite kept the laptop setup to a single file, and it is a poor fit for Container Apps because the container filesystem is ephemeral and Azure does not offer managed SQLite.
- Putting Postgres inside the application container would couple the database lifecycle to every app replica. The app depends only on `DATABASE_URL`, so the managed database can be chosen with the infrastructure story.
