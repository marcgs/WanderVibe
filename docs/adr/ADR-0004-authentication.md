# ADR-0004: Authentication and trip ownership

## Status

Accepted

## Date

2026-10-29

## Context

Story #15 lets a traveler sign in with a Microsoft or Google account so trips belong to that person. ADR-0003 already records continuous deployment, so this decision is ADR-0004.

The app is Next.js on Azure Container Apps. Postgres is reached through `DATABASE_URL`. Startup and liveness call `GET /api/health`. Readiness and the deploy smoke test call `GET /api/ready` with no session and expect 200. Ingress stays limited to operator CIDRs until an operator opens it. Auth.js v5 is pinned at `next-auth@5.0.0-beta.32` and `@auth/prisma-adapter@2.11.3`. There is no stable `5.0.0` tag. The beta can still change or ship an advisory. Watch the `next-auth` and `@auth/core` advisories, upgrade on purpose, and run the Playwright suite before that upgrade merges. Move to `5.0.0` when a stable release exists, with the same e2e run. The Prisma adapter's declared peer range stops at Prisma 6. This app uses Prisma 7.

Sharing trips and any role other than owner are out of scope. Email and password login are out of scope.

## Decision

### Auth.js with Microsoft Entra ID and Google

Sign-in uses Auth.js (`next-auth` 5) with the Prisma adapter and database sessions. The providers are Microsoft Entra ID (`microsoft-entra-id`) and Google (`google`). A person can sign out. The adapter persists `User`, `Account`, and `Session`. The migration also creates `VerificationToken` because that model is part of the adapter schema. Nothing writes it. Email login is out of scope.

The session cookie holds only the session id. Auth.js loads the row from Postgres. Sessions last 30 days (`maxAge`) and the expiry is rewritten when the session is used and is at least a day old (`updateAge`). The session callback copies `user.id` onto the session so later stories can compare it with `Trip.ownerId`.

Account linking by email is off. The providers do not set `allowDangerousEmailAccountLinking`. Entra ID does not verify work or school email addresses, so treating "same email" as "same person" would let a second provider take over an account. Auth.js then returns `OAuthAccountNotLinked`. The sign-in page shows that error. Google does verify email, and linking stays off there too, so the two providers follow one rule. There is no email sign-in to confirm a link later.

`trustHost` is on. When auth is turned on, Bicep also sets `AUTH_URL` to `https://<container-app-fqdn>` for that environment. Container Apps terminates TLS. The app is not behind an open proxy.

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

The proxy matcher always includes `/api`, including a path that looks like a file such as `/api/x.png`. File extensions are skipped only outside `/api`, along with `/_next/static` and `/_next/image`. The proxy returns before Auth.js on the public paths. Protected requests do one indexed `Session` read. Next.js prefers that a proxy only decrypt a cookie, because the proxy also runs on prefetches. The database session cookie is an opaque id, so the check has to read Postgres. A personal app with at most two replicas can pay that. The page still calls `requireUser()` after the proxy. Route handlers and server actions call `requireApiUser()`, which returns 401 when there is no session. The proxy is not the only check.

`authorizeTrip` is the ownership check later stories will call. No viewer is 401. A signed-in user who is not `Trip.ownerId` is 404, so the response does not reveal that the trip exists. The owner is allowed. `findOwnedTrip` queries `id` and `ownerId` together, so another user's trip and a missing trip are both null.

### Trip ownership, and sharing later

`Trip.ownerId` references `User` and deletes the trip when the user is deleted. Nothing has been deployed, so no Azure environment has trips. The migration deletes any local rows and then adds the required column. There is no seed.

Sharing is not built. When it is, add `TripMember`:

| Column   | Meaning             |
| -------- | ------------------- |
| `tripId` | The trip            |
| `userId` | The person          |
| `role`   | `owner` or `editor` |

The pair `(tripId, userId)` is unique. Creating a trip writes `Trip.ownerId` and one `TripMember` row with role `owner` in the same transaction. An editor can change the trip. Delete and membership stay with the owner. `authorizeTrip` grows a member lookup at that point. There is no sharing UI and no editor role in this story.

### Test sign-in

Playwright cannot complete a real Microsoft or Google login in CI. `AUTH_TEST_LOGIN=true` shows "Sign in as test traveler" and enables `POST /api/test/session`. Both upsert the user `playwright@wandervibe.test` and insert a `Session` row, then set the Auth.js session cookie. The flag is ignored when `NODE_ENV` is `production`, including when the variable is set on the container. Azure does not set it. The Playwright web server sets it.

### Auth stays off until the secrets exist

`authConfigured` defaults to false in `infra/main.bicep` and `infra/cd.bicep`. The parameter files set it from the GitHub Environment variable `AUTH_CONFIGURED`. Unset, empty, or any value other than `true` is false. While it is false, `app-env.bicep` does not reference auth secrets, even if a provider flag is set, so a missing secret cannot fail the revision. The app starts. `/api/health` and `/api/ready` stay 200. `AUTH_URL` is set only in that same on state.

In that state the proxy does not call Auth.js. Pages, including `/signin`, return a plain `Sign-in is not configured yet` response. Other API routes return 401. Trip data is not in that response. The same page is used when `AUTH_SECRET` is unset, or when no provider is configured and the test sign-in path is off. Production ignores `AUTH_TEST_LOGIN`, so a secret with no provider still fails closed there.

One provider is enough. `AUTH_GOOGLE_CONFIGURED` and `AUTH_MICROSOFT_CONFIGURED` are separate GitHub Environment variables. Only the secrets for the providers that are on are referenced. A Google-only environment does not need Entra placeholder secrets.

Turning auth on is a later deploy: register the apps you will use, write those secrets plus `auth-secret`, set `AUTH_CONFIGURED=true` and the provider flag, and deploy again. [docs/deploy.md](../deploy.md) has the order. The secrets have to exist before the flag is true, or the new revision fails.

### Ingress stays closed in the parameter files

Sign-in in the app is not the same as opening the hostname. `restrictPublicAccess` stays `true` in the parameter files. The deploy workflow still adds `gh-run-<run id>` only when the deployment output `publicAccessRestricted` is `true`, and the `if: always()` step still removes that rule when it is present. Setting the flag to false in a one-off command is overwritten by the next GitHub deploy, because `infra/cd.*.bicepparam` sets it back to true. Opening ingress for good is a later edit of those files, after a real sign-in works from an allowlisted address. [docs/deploy.md](../deploy.md) has that step. The check script rejects `restrictPublicAccess = false` in a parameter file until that edit also updates the check.

## Consequences

- A deploy with `AUTH_CONFIGURED` unset succeeds and does not read the auth secrets. Marc registers the apps, writes the six secrets, sets `AUTH_CONFIGURED=true`, and deploys again. [docs/deploy.md](../deploy.md) has the order.
- Live Microsoft and Google sign-in cannot be proven in CI. The test traveler covers the session, the protected page, and sign-out.
- `next-auth` stays on the pinned v5 beta until a stable 5.0.0 exists. An upgrade is a deliberate change with an e2e run, not a floating range.
- The Prisma adapter is called through a cast because its types target Prisma 6. An integration test creates a user, an account, and a session through the adapter.
- Protected requests read Postgres. `/api/health` and `/api/ready` do not.
- The same email from Google and Entra stays two users. Signing in with the second provider shows `OAuthAccountNotLinked`.
- Ingress remains closed to the public until the parameter files change.

## Alternatives considered

- **JWT sessions.** The proxy could skip Postgres. The `Session` table would stay empty, and the adapter would not be storing sessions. Rejected.
- **Credentials provider for tests.** Auth.js allows that provider only with JWT sessions. The test path writes a database session instead.
- **Auth.js middleware file.** Next.js 16 deprecates `middleware.ts` and runs `proxy.ts` on Node.js. The proxy file is the supported place.
- **Easy Auth on Container Apps.** ADR-0002 already chose in-app Auth.js so the session lives in Postgres next to the trips.
- **Leave `/api/ready` authenticated.** The readiness probe and the smoke test would get 401 and the revision would never become ready. Both paths stay anonymous.
- **Open ingress in this change.** The provider apps do not exist until Marc registers them. The parameter files stay closed.
- **Add `TripMember` now.** The sharing UI and roles beyond owner are out of scope. The table arrives with that story. This ADR is the plan.
