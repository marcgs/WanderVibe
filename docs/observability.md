# Observability

WanderVibe sends server telemetry to Application Insights when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set. Local development leaves the variable unset. The CI image job does too. Nothing is exported in those cases, and the process still serves `/api/health` and `/api/ready`.

Dashboards, alerts, browser telemetry, and log-retention changes are out of scope. Retention stays at 30 days with the 0.2 GB daily cap from [ADR-0002](adr/ADR-0002-azure-hosting.md).

## Enable it

Story #13 stores the workspace-based connection string in Key Vault as `applicationinsights-connection-string`. The Container App receives it as `APPLICATIONINSIGHTS_CONNECTION_STRING`. The value is not a Bicep output, a parameter, or a GitHub secret. [docs/infra.md](infra.md) lists the secret.

`src/instrumentation.ts` reads the variable when the Node.js server starts. A non-empty value loads the Azure Monitor OpenTelemetry distro (`@azure/monitor-opentelemetry`). An empty or unset value returns before that import. A throw while starting the distro is logged as `Telemetry did not start` and does not stop the process, so a bad or missing optional value does not fail the revision.

The service name sent with telemetry is `wandervibe` unless `OTEL_SERVICE_NAME` is already set. Sampling is 100 percent, and every pino line is exported as a log record. The distro's default limit of 5 traces per second drops the first spans in a process, so a short check such as `/api/ready` would be missing. Successful `/api/health` and `/api/ready` traces are not exported: each one is about 9 to 12 records, roughly 90 MB per day per replica at the probe intervals, which would consume the 0.2 GB daily cap. A failed readiness check still exports its request span and the `Readiness check failed` log. 100 percent sampling of real traffic, plus exporting every log line, can still reach that cap as traffic grows. The cap from [ADR-0002](adr/ADR-0002-azure-hosting.md) then drops later telemetry.

The exporter uses Node's HTTPS stack. The runtime image does not install the `openssl` CLI. Postgres connections from the container use the same Node TLS stack, with `sslmode=verify-full` as [ADR-0002](adr/ADR-0002-azure-hosting.md) describes.

Live Metrics is off. The Application Insights browser snippet is not injected.

## What is collected

| Signal       | What it is                                                                                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requests     | Incoming HTTP calls. Next.js opens the request spans once the SDK is running. In the standalone server the distro's HTTP instrumentation does not add a second server span. A bare `GET` span with `next.bubble` is not exported: it reports 200 when the proxy answered 401 or 307. |
| Dependencies | PostgreSQL calls made through the `pg` driver, including `SELECT 1` on `GET /api/ready`. The statement text is kept. Query parameter values are not attached.                                                                                                                        |
| Exceptions   | Errors that escape a route, a render, a server action, or the proxy. The recorded message is scrubbed.                                                                                                                                                                               |
| Logs         | One JSON object per line on stdout, also sent as an OpenTelemetry log record. Each line has `requestId`.                                                                                                                                                                             |

`/api/ready` logs `Readiness check failed` when Postgres does not answer. That line does not include the driver error. The HTTP body stays `{ "status": "unavailable" }`.

## Where to look

| Environment | Resource group          | Application Insights | Log Analytics workspace |
| ----------- | ----------------------- | -------------------- | ----------------------- |
| Staging     | `rg-wandervibe-staging` | `appi-wv-staging`    | `log-wv-staging`        |
| Production  | `rg-wandervibe-prod`    | `appi-wv-prod`       | `log-wv-prod`           |

In the Application Insights resource:

| Blade                            | What you should see                                                         |
| -------------------------------- | --------------------------------------------------------------------------- |
| Investigate → Transaction search | Requests, and a PostgreSQL dependency on a call such as `GET /api/ready`    |
| Investigate → Failures           | Failed requests, failed dependencies, and exceptions                        |
| Monitoring → Logs                | `requests`, `dependencies`, `exceptions`, and `traces` (the JSON log lines) |

After a staging deploy, call `https://<container-app-fqdn>/api/ready` from an allowlisted address, or let the deploy smoke test call it. Search Transaction search for that operation. The dependency is PostgreSQL and the statement is `SELECT 1`.

Container stdout is in the same Log Analytics workspace, because the Container Apps environment is attached to it. The pino lines there are the scrubbed JSON. Next.js and Auth.js also write console output to stdout, and that output is not scrubbed.

## Logging rules

The app logger is pino. It writes JSON to stdout. Before a line is written or exported, values are replaced with `[Redacted]` when they are:

- fields and free-text assignments whose names are passwords, tokens (`access_token`, `refresh_token`, `id_token`, `sessionToken`, and the same names with `_` or `-`), secrets, cookies, authorization, emails, or connection strings. A quoted value is removed whole, including spaces and commas
- email addresses, including an address written with `%40`
- `Bearer` and `Basic` credentials, and JWTs
- `InstrumentationKey=...` connection strings, and database URLs that contain a password
- query parameters `code`, `state`, `token`, `password`, `secret`, and `email`, including a percent-encoded name such as `%63ode` and a secret nested in an encoded `callbackUrl`

`requestId` uses a valid incoming `x-request-id` first. That header counts only when it is a UUID or a 32-character hex trace id. Otherwise the active trace id is used. When telemetry is off there is no trace, so the proxy stores one id for the request and every log line in that request uses it. A session token or an email in that header is not copied into the log.

The logger does not receive the session cookie, the authorization header, or `DATABASE_URL`.

## Probes

Startup and liveness call `GET /api/health` on port 3000. The route returns `200` `{ "status": "ok" }` and does not open a database connection. A liveness failure restarts the replica, so that probe stays independent of Postgres.

Readiness calls `GET /api/ready` with `timeoutSeconds` of 5. The route runs `SELECT 1` and gives up after 2.5 seconds, inside that timeout, so the probe observes `503` `{ "status": "unavailable" }` instead of timing out on its own. A readiness failure only removes the replica from ingress. It does not restart the process. That is what should happen when the app cannot reach Postgres: stop sending traffic, leave the process running.

Both routes are anonymous. The auth proxy does not look up a session for them, including when auth is not configured. [ADR-0004](adr/ADR-0004-authentication.md) lists the public paths. The story #14 smoke test, `scripts/smoke-test.sh`, calls both URLs with no session and expects `200` `{ "status": "ok" }`.

Platform probes call the replica directly. They do not pass through the ingress allowlist. [docs/infra.md](infra.md) has the allowlist and the smoke-test steps.

## Check without Azure

Unit tests cover the log scrubber, both health routes, and that telemetry stays off when the connection string is empty. CI builds the image without the variable and checks `/api/health` and `/api/ready`. Seeing a request in `appi-wv-staging` needs a staging deploy. Use the blades above after that deploy.
