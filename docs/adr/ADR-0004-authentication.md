# ADR-0004: Authentication and trip ownership

## Status

Accepted

## Date

2026-10-29

## Context

Story #15 lets a traveler sign in with a Microsoft or Google account so trips belong to that person. ADR-0003 already records continuous deployment, so this decision is ADR-0004.

The app is Next.js on Azure Container Apps. Postgres is reached through `DATABASE_URL`. Startup and liveness call `GET /api/health`. Readiness and the deploy smoke test call `GET /api/ready` with no session and expect 200. Ingress stays limited to operator CIDRs until an operator opens it. Auth.js v5 is still published as `next-auth@5.0.0-beta.32`. There is no stable `5.0.0` tag. The Prisma adapter's declared peer range stops at Prisma 6. This app uses Prisma 7.

Sharing trips and any role other than owner are out of scope. Email and password login are out of scope.

## Decision

### Auth.js with Microsoft Entra ID and Google

Sign-in uses Auth.js (`next-auth` 5) with the Prisma adapter and database sessions. The providers are Microsoft Entra ID (`microsoft-entra-id`) and Google (`google`). A person can sign out. The adapter persists `User`, `Account`, and `Session`. The migration also creates `VerificationToken` because that model is part of the adapter schema. Nothing writes it. Email login is out of scope.

The session cookie holds only the session id. Auth.js loads the row from Postgres. The session callback copies `user.id` onto the session so later stories can compare it with `Trip.ownerId`.

Both providers set `allowDangerousEmailAccountLinking`. Google and Microsoft verify the email address. Auth.js otherwise refuses the second provider when that email already has a user, and the safe recovery path is email sign-in, which this app does not have. One person then has one `User` and one set of trips. A provider that does not verify email could take over an account. These two providers are the ones we accept that risk for.

`trustHost` is on. Container Apps terminates TLS, and the app does not know its hostname at image build time. Auth.js builds callback URLs from the forwarded host. The app is not behind an open proxy.

Client ids, client secrets, the Entra issuer, and `AUTH_SECRET` are environment variables. In Azure they are Key Vault references on the Container App. The app identity already has Key Vault Secrets User and reads them. Bicep does not write those values, and GitHub Actions does not receive them. Marc creates the provider apps and the secrets. [docs/deploy.md](../deploy.md) is the procedure. Local names are in `.env.example`. Empty provider variables omit that provider, so CI can boot without a real OAuth client.

### Who can open a route

`src/proxy.ts` is the Next.js 16 proxy. It runs on the Node.js runtime, which is what this Next.js version requires, and what lets the proxy use the database session. Anonymous requests:

| Path              | Result                                                                    |
| ----------------- | ------------------------------------------------------------------------- |
| `/signin`         | The sign-in page                                                          |
| `/api/auth/*`     | Auth.js, including the provider callbacks. A callback has no session yet. |
| `GET /api/health` | `200`. The proxy does not look up a session.                              |
| `GET /api/ready`  | `200` or `503` from the route. The proxy does not look up a session.      |
| Any other page    | Redirect to `/signin`                                                     |
| Any other API     | `401` `{ "error": "unauthorized" }`                                       |

`/api/health` and `/api/ready` are anonymous on purpose. The readiness probe and the story #14 smoke test call them with no session. A session lookup on those paths would also make a database outage fail liveness. Criterion 2's "every API returns 401" does not apply to these two routes.

The proxy returns before Auth.js on those public paths. Protected requests do one indexed `Session` read. Next.js prefers that a proxy only decrypt a cookie, because the proxy also runs on prefetches. The database session cookie is an opaque id, so the check has to read Postgres. A personal app with at most two replicas can pay that. The page still calls `requireUser()` after the proxy. The proxy is not the only check.

`authorizeTrip` is the ownership check later stories will call. No viewer is 401. A signed-in user who is not `Trip.ownerId` is 403. The owner is allowed.

### Trip ownership, and sharing later

`Trip.ownerId` references `User` and deletes the trip when the user is deleted. The table was empty when the column was added. A non-empty `Trip` table cannot take a required `ownerId` in this migration.

Sharing is not built. When it is, add `TripMember`:

| Column   | Meaning             |
| -------- | ------------------- |
| `tripId` | The trip            |
| `userId` | The person          |
| `role`   | `owner` or `editor` |

The pair `(tripId, userId)` is unique. Creating a trip writes `Trip.ownerId` and one `TripMember` row with role `owner` in the same transaction. An editor can change the trip. Delete and membership stay with the owner. `authorizeTrip` grows a member lookup at that point. There is no sharing UI and no editor role in this story.

### Test sign-in

Playwright cannot complete a real Microsoft or Google login in CI. `AUTH_TEST_LOGIN=true` shows "Sign in as test traveler" and enables `POST /api/test/session`. Both upsert the user `playwright@wandervibe.test` and insert a `Session` row, then set the Auth.js session cookie. The flag is ignored when `NODE_ENV` is `production`, including when the variable is set on the container. Azure does not set it. The Playwright web server sets it.

### Ingress stays closed in the parameter files

Sign-in in the app is not the same as opening the hostname. `restrictPublicAccess` stays `true` in the parameter files. The deploy workflow still adds `gh-run-<run id>` only when the deployment output `publicAccessRestricted` is `true`, and the `if: always()` step still removes that rule when it is present. Setting the flag to false in a one-off command is overwritten by the next GitHub deploy, because `infra/cd.*.bicepparam` sets it back to true. Opening ingress for good is a later edit of those files, after a real sign-in works from an allowlisted address. [docs/deploy.md](../deploy.md) has that step. The check script rejects `restrictPublicAccess = false` in a parameter file until that edit also updates the check.

## Consequences

- Marc registers the Entra ID app and the Google client, writes six secrets into each Key Vault, and only then deploys this revision. A missing secret fails the revision. The procedure is in [docs/deploy.md](../deploy.md).
- Live Microsoft and Google sign-in cannot be proven in CI. The test traveler covers the session, the protected page, and sign-out.
- `next-auth` stays on the v5 beta until a stable 5.0.0 exists.
- The Prisma adapter is called through a cast because its types target Prisma 6. An integration test creates a user, an account, and a session through the adapter.
- Protected requests read Postgres. `/api/health` and `/api/ready` do not.
- Two providers with the same verified email share one user. A third provider must not be added with linking turned on unless it verifies email.
- Ingress remains closed to the public until the parameter files change.

## Alternatives considered

- **JWT sessions.** The proxy could skip Postgres. The `Session` table would stay empty, and the adapter would not be storing sessions. Rejected.
- **Credentials provider for tests.** Auth.js allows that provider only with JWT sessions. The test path writes a database session instead.
- **Auth.js middleware file.** Next.js 16 deprecates `middleware.ts` and runs `proxy.ts` on Node.js. The proxy file is the supported place.
- **Easy Auth on Container Apps.** ADR-0002 already chose in-app Auth.js so the session lives in Postgres next to the trips.
- **Leave `/api/ready` authenticated.** The readiness probe and the smoke test would get 401 and the revision would never become ready. Both paths stay anonymous.
- **Open ingress in this change.** The provider apps do not exist until Marc registers them. The parameter files stay closed.
- **Add `TripMember` now.** The sharing UI and roles beyond owner are out of scope. The table arrives with that story. This ADR is the plan.
