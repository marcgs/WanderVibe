# Azure infrastructure

WanderVibe's Azure resources are Bicep in [`infra/`](../infra). `infra/main.bicep` composes the modules in `infra/modules/`. Parameter files `infra/main.staging.bicepparam` and `infra/main.prod.bicepparam` target Switzerland North. This repository does not deploy from CI. Story #14 adds that pipeline. The decisions are in [ADR-0002](adr/ADR-0002-azure-hosting.md).

There is no Azure subscription in CI. CI downloads Bicep CLI 0.48.1, checks its SHA-256, and runs `bicep build` and `bicep lint`. It does not create resources.

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
| Log Analytics              | `log-wv-<environment>`                        | PerGB2018, 30-day retention, 0.2 GB daily cap    |
| Application Insights       | `appi-wv-<environment>`                       | Workspace-based                                  |
| Managed identity           | `id-wv-<environment>`                         | User-assigned                                    |

`<suffix>` is the first 8 characters of `uniqueString(resourceGroup().id)` unless `nameSuffix` is set. Globally unique names stay out of the parameter files so two subscriptions do not need hand-picked strings.

Staging sets `minReplicas` to 0, with an HTTP scale rule so a request can wake the app. Production sets `minReplicas` to 1. Both cap `maxReplicas` at 2.

## Access

The Container App uses a user-assigned managed identity.

- **AcrPull** on the registry. The registry admin user is off, so there is no registry password.
- **Key Vault Secrets User** on the vault. The identity can read secret values and cannot manage the vault.

Key Vault authorization is Azure RBAC. The template does not set access policies, and it does not grant the deployer a data-plane role. Writing the secret resources is a control-plane operation. Owner or Contributor on the resource group is enough. A standing Key Vault Secrets Officer assignment would also allow that principal to read every secret, including the database password. Grant that only when someone needs a break-glass read, and do it outside this template.

## Secrets

No secret values are in the Bicep files or the parameter files.

At deploy time the shell provides `POSTGRES_ADMIN_PASSWORD`. It must be 16 to 128 characters and meet Azure's password rules (mix of upper case, lower case, numbers, and symbols). The template URL-encodes it, so characters such as `@`, `:`, `/`, and `#` are safe.

The template stores these Key Vault secrets and gives them to the Container App as Key Vault references:

| Secret                                  | Container App variable                  | Value                                                  |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `database-url`                          | `DATABASE_URL`                          | Postgres connection string with `sslmode=verify-full`  |
| `applicationinsights-connection-string` | `APPLICATIONINSIGHTS_CONNECTION_STRING` | Workspace-based Application Insights connection string |

The app reads `DATABASE_URL` today. It does not read the Application Insights variable until story #16. The reference is still created here so that value is never a plain environment variable or a file in git.

After a successful deployment the password lives in the `database-url` secret. You can drop the shell variable. If both are lost, reset the server password with `az postgres flexible-server update` and update the Key Vault secret. Do not commit either value.

## Health and readiness

| Request           | What it proves                                             | Response                                                                   |
| ----------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /api/health` | The process is up. It does not touch Postgres.             | `200` and `{ "status": "ok" }`                                             |
| `GET /api/ready`  | The container completed `SELECT 1` against `DATABASE_URL`. | `200` and `{ "status": "ok" }`, or `503` and `{ "status": "unavailable" }` |

Neither response includes host names, SQL, stack traces, or credentials. The route stops waiting after 2.5 seconds and returns the same 503. Startup and liveness probes call `/api/health` on port 3000. A liveness failure restarts the replica, so that probe does not touch Postgres. The readiness probe calls `/api/ready` with a 5 second timeout. A readiness failure only takes the replica out of traffic. Story #14 can call `https://<container-app-fqdn>/api/ready` after deploy. `/api/health` stays the process check from story #1.

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

Export the database password in the shell you will use for `what-if` and `create`:

```bash
export POSTGRES_ADMIN_PASSWORD="$(openssl rand -base64 24)"
```

Use a different password for production than for staging. Keep the value until that environment's deployment has written Key Vault.

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

The same template creates the registry and the Container App, so an image cannot exist on the first run. Deploy the platform without the app, publish an image, then deploy the app. `deployContainerApp` defaults to true. The first command sets it to false.

Staging, from the repository root:

```bash
az deployment group create \
  --name wandervibe-staging \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam \
  --parameters deployContainerApp=false
```

The outputs include `containerRegistryName` and `containerRegistryLoginServer`. `containerAppName` and `containerAppFqdn` are empty on this run. Build the image in the registry. `<sha>` is any tag you choose; a git commit SHA is a good one.

```bash
sha="$(git rev-parse --short HEAD)"
az acr build \
  --registry "<containerRegistryName>" \
  --image "wandervibe:${sha}" \
  .
```

`az acr login` also works with the admin user disabled. It uses your Entra token. Disabling the admin user only turns off the registry username and password. The account that pushes needs a role that can push images, such as AcrPush, Owner, or Contributor:

```bash
az acr login --name "<containerRegistryName>"
docker build --tag "<containerRegistryLoginServer>/wandervibe:${sha}" .
docker push "<containerRegistryLoginServer>/wandervibe:${sha}"
```

Create the Container App against that tag. The default of `deployContainerApp` is true, so this run creates the app:

```bash
az deployment group create \
  --name wandervibe-staging \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam \
  --parameters containerImageTag="${sha}"
```

Repeat the same three steps for production with `rg-wandervibe-prod`, `infra/main.prod.bicepparam`, and a different password. The deployment prints the registry login server, Container App hostname, Key Vault URI, Postgres hostname, and the secret names. It does not print the connection string.

The platform deployment creates AcrPull and Key Vault Secrets User for the app identity. If the Container App revision cannot pull the image or read secrets, wait a minute and run the app deployment again. It is idempotent.

`/api/ready` returns 200 once the running image is this app and Postgres accepts `SELECT 1`. It does not require the Trip table. The app still needs `prisma migrate deploy` before it stores trips. Story #14 runs that migration. Startup and liveness probes call `/api/health`. The readiness probe calls `/api/ready`.

## What this does not do

- Deploy or migrate from GitHub Actions (story #14)
- Custom domain and TLS certificates
- VNet integration and private endpoints
- Grant AcrPush to the future GitHub OIDC identity (story #14's one-time setup)
