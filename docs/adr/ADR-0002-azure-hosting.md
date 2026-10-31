# ADR-0002: Azure hosting and infrastructure

## Status

Accepted

## Date

2026-10-28

Story #24 updated this decision the same day: ingress stays closed until sign-in.

Story #16 updated this decision on 2026-10-31: the app exports telemetry when the Application Insights connection string is set.

## Context

WanderVibe is a personal trip planner. ADR-0001 ships it as a non-root Next.js container with `GET /api/health` and PostgreSQL via `DATABASE_URL`. The epic hosts that container in Switzerland North and wants staging and production created the same way every time, at a small personal-use cost. Story #13 defines the resources. Story #14 deploys the image from CI. Custom domains, VNet integration, and private endpoints are out of scope.

The container has no stable egress IP on the Consumption plan. The database password and the Application Insights connection string must not be committed.

## Decision

### Host on Azure Container Apps, not App Service

The app is already a standalone container. Azure Container Apps Consumption runs that image, terminates TLS on the default `azurecontainerapps.io` hostname, and can scale to zero. Staging sets the minimum replica count to 0 and uses an HTTP scale rule so the next request starts a replica. Production keeps one replica (0.25 vCPU, 0.5 GiB) so the real site does not cold-start, and both environments cap replicas at 2.

App Service was the other serious option. A custom container there needs an App Service plan that is billed while the plan exists. Scale to zero is not a plan feature, and the free tier does not fit this image. Deployment slots are a nicer rollback tool than Container Apps revisions, but story #14 rolls back by deploying an older commit SHA, which a Container App revision also supports. The epic already named Container Apps, and this story keeps that choice.

The trade-off is operational: cold starts on staging, revisions instead of slots, and no built-in Easy Auth. Sign-in is Auth.js in the app (ADR-0004), so Easy Auth is not a reason to pick App Service.

### Cheapest SKUs that still match the app

| Piece                | Choice                                                                                                                         | Why                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Container Apps       | Consumption, 0.25 vCPU, 0.5 GiB, zone redundancy off                                                                           | Smallest replica size. Staging scale-to-zero removes the always-on container charge there.                            |
| Registry             | Basic, admin user disabled                                                                                                     | Basic is the cheapest SKU. Pull uses the managed identity, so there is no registry password.                          |
| PostgreSQL           | Burstable `Standard_B1ms`, 32 GiB, autogrow off, backup 7 days, geo-redundant backup off, high availability off, PostgreSQL 17 | B1ms is the smallest Flexible Server. 32 GiB is the smallest disk. PostgreSQL 17 matches local Docker and CI (17.11). |
| Key Vault            | Standard, soft-delete 7 days, purge protection off                                                                             | Standard is enough for secrets. Purge protection would block tearing the personal vault down.                         |
| Log Analytics        | PerGB2018, 30-day retention, 0.2 GB daily cap                                                                                  | 30 days is the minimum retention. 0.2 GB/day stays inside the free grant in normal use.                               |
| Application Insights | Workspace-based, same Log Analytics workspace                                                                                  | One ingestion bill, covered by the daily cap.                                                                         |

Region for both parameter files is `switzerlandnorth`.

### Postgres is public, limited to Azure services, with TLS required

Private endpoints and VNet integration are out of scope, and Consumption egress addresses change, so a firewall of fixed IPs would rot. The server allows public network access and has one firewall rule, `AllowAzureServices` (`0.0.0.0` to `0.0.0.0`), which is the documented "Azure services" rule. That rule admits connections from any Azure tenant, not only ours. `require_secure_transport` is `ON`. The connection string uses `sslmode=verify-full`. node-pg checks the server name with Node's CA store, which includes DigiCert Global Root G2, the root Azure Flexible Server uses. The image does not need an extra CA file.

The trade-off is real: any Azure IP can reach the port. The password and TLS are the controls, not the network. VNet-integrated Flexible Server and Entra authentication on Postgres are follow-ups. The app only knows `DATABASE_URL`, so either change can land without an application rewrite. A rule of `0.0.0.0`–`255.255.255.255` must not be added.

### Key Vault uses RBAC, and secret values stay out of git

The vault sets `enableRbacAuthorization` and does not define access policies. The Container App identity gets Key Vault Secrets User. The template does not grant the deployer a data-plane role. Writing a Key Vault secret from Bicep is a control-plane operation, which Owner or Contributor on the resource group already allows. A standing Secrets Officer assignment would also let that principal read every secret, including the database password. Break-glass reads are granted outside this template when someone needs them.

The database password is a `@secure()` parameter. Parameter files read it with `readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')`. The template URL-encodes it, builds `database-url`, and stores that in Key Vault. The Application Insights connection string is copied into `applicationinsights-connection-string` inside the template, from the component resource, and is not an output. The Container App receives both as Key Vault secret references (`DATABASE_URL` and `APPLICATIONINSIGHTS_CONNECTION_STRING`). Deployment outputs name the secrets and the vault. They do not contain the values.

A user-assigned identity is created before the app so the role assignments exist on the registry and the vault before the app starts. A system-assigned identity would not have a principal id until the app existed, which makes the registry pull and the secret references harder to order.

### Startup and liveness call `/api/health`. Readiness calls `/api/ready`

Startup and liveness probes request `GET /api/health` on port 3000. That route does not open a database connection. A liveness failure restarts the replica, so that probe stays independent of Postgres.

The readiness probe requests `GET /api/ready` with `timeoutSeconds` of 5. A readiness failure only removes the replica from ingress. It does not restart it. That is what should happen when the app cannot reach Postgres: stop sending traffic, leave the process running.

`GET /api/ready` runs `SELECT 1` and returns `200` `{ "status": "ok" }` or `503` `{ "status": "unavailable" }`. The body has no host, SQL, or error text. The route gives up after 2.5 seconds, which is inside the probe timeout, so the probe observes the 503 instead of timing out on its own. The driver sets `connectionTimeoutMillis` to 3 seconds and a query timeout of 2.5 seconds. `connect_timeout` in the URL is not used, because node-postgres ignores it. Story #14 can call the same path after deploy. [docs/observability.md](../observability.md) records the same probe setup for operators.

### Telemetry is off until the connection string is set

The app starts the Azure Monitor OpenTelemetry distro from `src/instrumentation.ts` only when `APPLICATIONINSIGHTS_CONNECTION_STRING` is non-empty. Local development and the CI image leave it unset, so nothing is exported and the process does not load the distro. Container Apps already receives the Key Vault reference from this template. If the distro throws while starting, the process logs `Telemetry did not start` and keeps serving `/api/health`.

The distro exports incoming HTTP requests, PostgreSQL client spans from the `pg` driver (including `SELECT 1` on `/api/ready`), and exceptions that escape a request. Sampling is 100 percent. The distro default of 5 traces per second drops the first spans in a process, which would hide a short check such as `/api/ready`. Logs are one JSON object per line on stdout, with a request id, and the same record is sent as an OpenTelemetry log. Emails, tokens, passwords, cookies, authorization headers, and connection strings are removed before a line is written or a span is exported. The browser snippet is not injected. Live Metrics is off. The probe setup above is unchanged.

### Ingress stays closed until sign-in

Sign-in is enforced in the app (ADR-0004). Staging and production still set `restrictPublicAccess` to true until an operator opens ingress after the provider apps exist. `allowedIpRanges` is an array of IPv4 CIDRs and defaults to empty. The parameter files read `WANDER_ALLOWED_IP_RANGES` and commit no addresses.

Container Apps allows every client when the restriction list is empty, and every rule in that list shares one action. While access is restricted, the template sends Allow rules only. An empty parameter becomes one Allow rule for `192.0.2.1/32` (RFC 5737 TEST-NET-1, not a client address). Every other IPv4 source receives HTTP 403 with the body `RBAC: access denied`. A non-empty parameter becomes one Allow rule per CIDR, and every other source still receives 403. Each entry must be an IPv4 CIDR with a prefix from `minAllowedPrefixLength` (default 16) through 32. A shorter prefix or any other malformed entry fails the deployment and the error names it. `restrictPublicAccess` set to false sends an empty rule list, which opens the hostname. That waits until sign-in is configured. `/api/health` and `/api/ready` stay anonymous so the probes and the smoke test keep working. ADR-0004 records the other public paths.

Production uses the same flag and the same empty default, so it is not publicly exposed while the parameter files keep the flag true. The deploy smoke test calls the public hostname for `/api/health` and `/api/ready` with no session. Both stay anonymous. The Bicep deploy keeps operator ranges only. While `publicAccessRestricted` is true, the job adds one Allow rule named for that GitHub run and an `always` step removes that rule only if it is present, so the sentinel or the operator rules remain. When that output is false, the temporary rule is skipped. An empty rule list would open the app. [docs/infra.md](../infra.md) and [docs/deploy.md](../deploy.md) have the commands. A self-hosted runner that is already on the operator list can run the same check without a temporary address.

Platform probes call the replica directly. A closed public list leaves them healthy.

## Consequences

- Operators create `rg-wandervibe-staging` and `rg-wandervibe-prod`, then run `az deployment group what-if` and `az deployment group create` as [docs/infra.md](../infra.md) describes. CI only compiles and lints.
- The first deployment creates everything except the Container App (`deployContainerApp=false`), then an image is pushed, then a second deployment creates the app. [docs/infra.md](../infra.md) has the commands.
- The template URL-encodes the Postgres password, so it does not have to be hex.
- Staging can be cold. Production holds one small replica.
- The 0.2 GB daily log cap can drop telemetry. That is accepted for a personal app.
- Anyone who can open a connection from Azure can attempt a login. The password must be long and must stay in Key Vault.
- [ADR-0003](ADR-0003-continuous-deployment.md) splits the GitHub OIDC identity per environment, passes the commit SHA as `containerImageTag`, runs `prisma migrate deploy` as a Container Apps job, and smoke-checks the app from an allowlisted address. This template still does not grant those CD roles, and it does not read Key Vault from either CD identity.
- While `restrictPublicAccess` stays true, staging and production answer 403 to every real client unless the deploy passes `allowedIpRanges`. Opening the hostname is `restrictPublicAccess=false` after sign-in is configured, and the parameter files have to change or the next GitHub deploy closes it again. [docs/deploy.md](../deploy.md) has that step.

## Alternatives considered

- **App Service.** Simpler slots and a familiar model, and a poor fit for scale-to-zero and for an image we already build. Rejected for the reasons above.
- **System-assigned identity.** Fewer resources, and the principal id appears only after the app is created. User-assigned lets AcrPull and Key Vault Secrets User exist first.
- **Private endpoint for Postgres and Key Vault.** The right long-term network boundary, and explicitly out of scope. It also needs a VNet, a private DNS zone, and a Container Apps environment that joins that network, which is more than a personal-use first deployment.
- **Allow all IPs on Postgres (`0.0.0.0`–`255.255.255.255`).** Simpler to debug from a laptop, and it exposes the database to the whole internet. The Azure-services rule is the narrower option that still lets Container Apps connect.
- **Entra-only database auth.** No password in the connection string, and Prisma would need a token refresh the app does not have yet. Password auth over TLS is the story #13 choice.
- **Keep the readiness probe on `/api/health`.** The replica would stay in the load balancer while Postgres is down and would serve errors. Readiness does not restart the process, so pointing it at `/api/ready` only stops traffic. That is the behavior we want. Liveness stays on `/api/health` because a liveness failure does restart the replica.
- **Deny `0.0.0.0/0` when the allowlist is empty.** That also yields 403, and a later Allow rule cannot sit beside a Deny rule. Azure requires one action for the whole list, so the switch takes a delete and then an add. One Allow list, with the documentation address standing in for an empty list, updates in a single deployment.
- **Internal ingress, or an internal-only environment.** The public hostname would go away. Story #14 calls that hostname. Private networking stays out of scope.
- **Commit an operator address in the parameter file.** Addresses change, and the repository would hold a real IP. Deploy-time values stay out of git.
- **Allow every range in the GitHub `actions` list from `api.github.com/meta`.** Any GitHub-hosted runner could call the app. The smoke test adds one `/32` for the job that calls the health endpoints.
