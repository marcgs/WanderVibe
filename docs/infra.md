# Azure infrastructure

WanderVibe's Azure resources are Bicep in [`infra/`](../infra). `infra/main.bicep` composes the modules in `infra/modules/`. Parameter files `infra/main.staging.bicepparam` and `infra/main.prod.bicepparam` target Switzerland North. This repository does not deploy from CI. Story #14 adds that pipeline. The decisions are in [ADR-0002](adr/ADR-0002-azure-hosting.md).

There is no Azure subscription in CI. CI compiles and lints the templates with `az bicep build` and `az bicep lint`. It does not create resources.

## Resources

Each environment gets its own resource group.

| Resource                   | Name pattern                                  | SKU                                              |
| -------------------------- | --------------------------------------------- | ------------------------------------------------ |
| Resource group             | `rg-wandervibe-staging`, `rg-wandervibe-prod` | Created by hand before the deployment            |
| Container Apps environment | `cae-wv-<environment>`                        | Consumption, not zone redundant                  |
| Container App              | `ca-wv-<environment>`                         | 0.25 vCPU, 0.5 GiB memory                        |
| Container Registry         | `acrwv<stg\|prd><suffix>`                     | Basic, admin user disabled                       |
| PostgreSQL Flexible Server | `psql-wv-<stg\|prd>-<suffix>`                 | Burstable `Standard_B1ms`, 32 GiB, backup 7 days |
| Database                   | `wandervibe`                                  | On that server                                   |
| Key Vault                  | `kvwv<stg\|prd><suffix>`                      | Standard, RBAC, no access policies               |
| Log Analytics              | `log-wv-<environment>`                        | PerGB2018, 30-day retention, 1 GB daily cap      |
| Application Insights       | `appi-wv-<environment>`                       | Workspace-based                                  |
| Managed identity           | `id-wv-<environment>`                         | User-assigned                                    |

`<suffix>` is the first 8 characters of `uniqueString(resourceGroup().id)` unless `nameSuffix` is set. Globally unique names stay out of the parameter files so two subscriptions do not need hand-picked strings.

Staging sets `minReplicas` to 0, with an HTTP scale rule so a request can wake the app. Production sets `minReplicas` to 1. Both cap `maxReplicas` at 2.

## Access

The Container App uses a user-assigned managed identity.

- **AcrPull** on the registry. The registry admin user is off, so there is no registry password.
- **Key Vault Secrets User** on the vault. The identity can read secret values and cannot manage the vault.

Key Vault authorization is Azure RBAC. The template does not set access policies.

The principal that runs the deployment receives **Key Vault Secrets Officer** so the same deployment can write secrets. That object id is `AZURE_DEPLOYER_OBJECT_ID`. A signed-in user is principal type `User`. A service principal would be `ServicePrincipal` (`deployerPrincipalType` in the parameter file).

## Secrets

No secret values are in the Bicep files or the parameter files.

At deploy time the shell provides:

- `POSTGRES_ADMIN_PASSWORD` — URL-safe, 16 to 128 characters. `openssl rand -hex 24` is a good fit. The template does not URL-encode the password, so characters such as `@`, `:`, `/`, and `#` would break the connection string.
- `AZURE_DEPLOYER_OBJECT_ID` — object id of the deployer. Not a secret.

The template stores these Key Vault secrets and gives them to the Container App as Key Vault references:

| Secret                                  | Container App variable                  | Value                                                  |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `database-url`                          | `DATABASE_URL`                          | Postgres connection string with `sslmode=require`      |
| `applicationinsights-connection-string` | `APPLICATIONINSIGHTS_CONNECTION_STRING` | Workspace-based Application Insights connection string |

The app reads `DATABASE_URL` today. It does not read the Application Insights variable until story #16. The reference is still created here so that value is never a plain environment variable or a file in git.

After a successful deployment the password lives in the `database-url` secret. You can drop the shell variable. If both are lost, reset the server password with `az postgres flexible-server update` and update the Key Vault secret. Do not commit either value.

## Health and readiness

| Request           | What it proves                                             | Response                                                                   |
| ----------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /api/health` | The process is up. It does not touch Postgres.             | `200` and `{ "status": "ok" }`                                             |
| `GET /api/ready`  | The container completed `SELECT 1` against `DATABASE_URL`. | `200` and `{ "status": "ok" }`, or `503` and `{ "status": "unavailable" }` |

Neither response includes host names, SQL, stack traces, or credentials. Platform startup, liveness, and readiness probes all call `/api/health` on port 3000. A database outage must not restart the replica. Story #14's deploy smoke test can call `https://<container-app-fqdn>/api/ready` when it needs proof of a real database round-trip. `/api/health` stays the process check from story #1.

## One-time setup

You need the Azure CLI with Bicep, and permission to create the resource groups, deploy to them, and create role assignments (Owner on the groups is enough). Sign in and select the subscription:

```bash
az login
az account set --subscription "<subscription-id>"
```

Create the groups in Switzerland North:

```bash
az group create --name rg-wandervibe-staging --location switzerlandnorth
az group create --name rg-wandervibe-prod --location switzerlandnorth
```

Export the deploy-time values in the shell you will use for `what-if` and `create`:

```bash
export POSTGRES_ADMIN_PASSWORD="$(openssl rand -hex 24)"
export AZURE_DEPLOYER_OBJECT_ID="$(az ad signed-in-user show --query id --output tsv)"
```

Use a different password for production than for staging. Keep each value until that environment's deployment has written Key Vault.

## Preview

From the repository root:

```bash
az deployment group what-if \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam

az deployment group what-if \
  --resource-group rg-wandervibe-prod \
  --parameters infra/main.prod.bicepparam
```

`what-if` prints the resource changes. Secure parameters are redacted. Nothing is created.

## First deployment

Staging:

```bash
az deployment group create \
  --name wandervibe-staging \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam
```

Production:

```bash
az deployment group create \
  --name wandervibe-prod \
  --resource-group rg-wandervibe-prod \
  --parameters infra/main.prod.bicepparam
```

The deployment prints outputs: registry login server, Container App hostname, Key Vault URI, Postgres hostname, and the secret names. It does not print the connection string.

Two first-run cases are expected:

- **Key Vault or registry access is denied on the first try.** Role assignments can take a minute to propagate. Re-run the same `az deployment group create` command. It is idempotent.
- **The Container App revision is unhealthy.** The app image is `<login-server>/wandervibe:initial`, and that tag does not exist until an image is pushed. Story #14 pushes the commit SHA and deploys it. A manual push works too: build the repo image, `az acr login` is not available because the admin user is disabled, so push with an identity that has **AcrPush**. Probes already point at `/api/health`. Re-run the deployment after the tag exists if Azure marked the deployment failed.

`/api/ready` stays unavailable until two more things are true: the running image is this app, and story #14 (or a manual step) has applied `prisma migrate deploy` against that database. The readiness check only runs `SELECT 1`, so it does not require the Trip table, but the app still needs migrations before it stores trips.

## What this does not do

- Deploy or migrate from GitHub Actions (story #14)
- Custom domain and TLS certificates
- VNet integration and private endpoints
- Grant AcrPush to the future GitHub OIDC identity (story #14's one-time setup)
