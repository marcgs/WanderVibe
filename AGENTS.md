# AGENTS.md — WanderVibe

Collaborative trip planning app (web + mobile) monorepo. See `docs/spec.md` for full specification.

**Repository:** https://github.com/marcgs/WanderVibe

## Monorepo Structure

```
apps/web/               → Next.js (App Router) on Vercel
apps/mobile/            → React Native + Expo
packages/shared/        → Business logic, types, validation (Zod)
packages/db/            → Drizzle ORM, schema, migrations, PostGIS
packages/ui/            → Design tokens (CSS vars for web, JS constants for mobile)
bin/wv                  → CLI dispatcher (invoke as bin/wv <command>)
bin/commands/           → Individual command scripts (bash)
```

## Tech Stack

- **Language:** TypeScript everywhere
- **Tooling:** pnpm workspaces + Turborepo
- **Database:** Azure PostgreSQL Flexible + PostGIS, Drizzle ORM
- **Auth:** Google Sign-In (Auth.js on web, expo-auth-session on mobile), whitelist-gated
- **Maps:** Mapbox GL JS (web), react-native-maps (mobile)
- **Places:** Google Places API (proxied through Next.js API routes)
- **Styling:** Tailwind + shadcn/ui (web), Nativewind (mobile)
- **State:** Zustand + TanStack Query (both apps)
- **Hosting:** Vercel (web), Expo EAS (mobile)
- **Infra:** Azure (Postgres, Blob Storage, Key Vault, App Insights) — region: Switzerland North

## Agent Team

| Agent | Owns | Model |
|-------|------|-------|
| `schema-architect` | `packages/db/`, `packages/shared/`, `packages/ui/` | inherit |
| `web-developer` | `apps/web/` | inherit |
| `mobile-developer` | `apps/mobile/` | inherit |
| `quality-gate` | cross-cutting (read-only) | sonnet |
| `infra-ops` | CI/CD, Docker, Bicep, `bin/` | sonnet |

**Flow:** `schema-architect` → `web-developer` + `mobile-developer` (parallel) → `quality-gate`

### Coordination Protocol

- **Handoff:** When `schema-architect` finishes, it posts the list of changed types/schemas so web and mobile agents know what to import.
- **Parity:** `web-developer` and `mobile-developer` must implement the same user-facing features. If one discovers a missing shared type or helper, it requests it from `schema-architect` before duplicating logic.
- **Escalation:** If an agent is blocked (e.g., unclear requirement, conflicting convention), it stops and flags the issue to the lead rather than guessing.
- **Quality gate triggers:** Run `quality-gate` after every feature or fix — never merge without it passing. Also run it after any schema migration to catch cross-package type breakage.

### Compound Learning

- After completing each task, every teammate appends to `REFLECTION.md` (project root):
  - What surprised me
  - One pattern worth adding to AGENTS.md
  - One thing I'd do differently next time
- Lead reviews reflections and merges approved learnings into AGENTS.md `## LEARNED` section.
- Only the lead approves changes to AGENTS.md — teammates PROPOSE, never write directly.
- Keep entries concrete and actionable, not vague.
- Format: "DO [specific thing] BECAUSE [specific reason]"
- Next session's agents read `## LEARNED` automatically — knowledge compounds across sessions.

## CLI (`bin/wv`)

Pure bash, no external dependencies. Each command is a standalone script in `bin/commands/`.

| Command | Description |
|---------|-------------|
| `wv up` | Start local dev services (Docker Compose), run migrations |
| `wv down` | Tear down Docker services and dev server ports |
| `wv serve [web\|mobile]` | Start dev servers via Turborepo |
| `wv test [--e2e\|--watch] [path]` | Run tests (Vitest, Playwright, or Maestro) |
| `wv check` | Full quality gate: typecheck → lint → test |
| `wv lint [file]` | Typecheck + lint |
| `wv db <sub>` | Database ops: `migrate`, `generate`, `push`, `studio`, `seed` |
| `wv build [web\|mobile]` | Production build |
| `wv infra <env>` | Provision Azure resources via Bicep (dev\|prod) |
| `wv eas <env>` | Trigger Expo EAS build (dev\|prod) |
| `wv docs [topic]` | List or print docs (spec, tech, backlog, conventions) |
| `wv check-env-leak` | Scan staged diff for leaked `.env` values |

### Extending the CLI

If you find yourself repeating a multi-step shell operation, codify it:

1. Create `bin/commands/<name>.sh` (strict mode, `PROJECT_ROOT` resolution).
2. Register in `bin/wv` dispatcher.
3. Update the CLI table here and in `docs/spec.md`.

## Key Conventions

- All timestamps `timestamptz` stored as UTC. Timezone per-location (IANA format).
- All primary keys are UUIDs.
- Flights/hotels belong to trips, not days. Render on days via date range overlap.
- Places with `day_id = null` are wishlist/unassigned items.
- Secrets in Azure Key Vault only. Local dev uses `.env.local` (gitignored).
- Integration tests use testcontainers with real Postgres — no DB mocks.
- Shared package has highest test priority — bugs there affect both apps.

## LEARNED

<!-- Approved learnings from REFLECTION.md go here. Format: DO [thing] BECAUSE [reason] -->

