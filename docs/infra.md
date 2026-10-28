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

## Ingress allowlist

Until story #15, the app has no sign-in. Staging and production both keep Container App ingress closed to the public. Both parameter files set `restrictPublicAccess` to `true`. `allowedIpRanges` is the list of IPv4 CIDRs that may call the app. It is empty unless a deploy-time value says otherwise. The parameter files contain no addresses.

Container Apps allows every client when `ipSecurityRestrictions` is empty, and every rule in one list has to share a single action (`Allow` or `Deny`). While access is restricted, the template sends Allow rules only:

| `restrictPublicAccess` | `allowedIpRanges` | Ingress rules                                                                             |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `true`                 | empty             | One Allow rule for `192.0.2.1/32`                                                         |
| `true`                 | one or more CIDRs | One Allow rule per CIDR (`allow-0`, `allow-1`, …)                                         |
| `false`                | ignored           | `[]`, which Azure treats as allow every client. Only after story #15, as described below. |

`192.0.2.1/32` is an RFC 5737 documentation address (TEST-NET-1). It is not a client. Every other IPv4 source misses the Allow rule. Container Apps answers HTTP 403 with the body `RBAC: access denied`. A request from an address on the list reaches the app, and `/api/health` returns 200.

Each entry must be an IPv4 CIDR: exactly one `/`, four decimal octets from 0 to 255 with no leading zeros, and a prefix from `minAllowedPrefixLength` (default 16) through 32. A shorter prefix, a leading zero, or any other typo fails the deployment, and the error names the bad entries. Duplicate entries are removed. `@maxLength(32)` caps how many CIDRs the parameter accepts. That cap belongs to this repository. Container Apps does not document a hard rule limit. A longer list fails when the deployment runs. Startup, liveness, and readiness probes call the replica from inside the Container Apps environment. They do not pass through this list, so a closed allowlist does not fail the revision.

### Supplying addresses

The parameter files read the shell variable `WANDER_ALLOWED_IP_RANGES` (comma-separated CIDRs). When the variable is unset or empty, `allowedIpRanges` is `[]` and ingress stays closed. Each entry must pass the IPv4 check above, and more than 32 entries fails at deployment. Set the variable in the shell you use for `what-if` and `create`. `${sha}` below is the image tag already published to the registry ([First deployment](#first-deployment)).

```bash
export WANDER_ALLOWED_IP_RANGES="$(curl --fail --silent --show-error --ipv4 --max-time 10 --retry 3 https://api.ipify.org)/32"

az deployment group create \
  --name wandervibe-staging \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam \
  --parameters containerImageTag="${sha}"
```

The CLI can pass the array instead. That value replaces the whole list from the variable. It does not append. `203.0.113.10/32` here is an RFC 5737 documentation address, not an operator address:

```bash
az deployment group create \
  --name wandervibe-staging \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam \
  --parameters containerImageTag="${sha}" \
  --parameters allowedIpRanges='["203.0.113.10/32"]'
```

In GitHub Actions, put the `export` and `az deployment group create` in the same step. A later step does not see the export unless the workflow writes it to `GITHUB_ENV`.

Use `rg-wandervibe-prod` and `infra/main.prod.bicepparam` for production. That file also sets `restrictPublicAccess = true` and reads the same variable. Leave the flag true until story #15 is accepted. With an empty allowlist, production's hostname answers 403 to every real client, so the app is not on the public internet and trip data stored there is not reachable from it.

### Verify 403 and 200

Run this once against a deployed staging app. `containerAppFqdn` is a deployment output.

From a network that is outside the allowlist (for example a phone on cellular, or a deploy that left `WANDER_ALLOWED_IP_RANGES` unset):

```bash
fqdn="$(az deployment group show \
  --name wandervibe-staging \
  --resource-group rg-wandervibe-staging \
  --query properties.outputs.containerAppFqdn.value \
  --output tsv)"

code="$(curl --silent --show-error --max-time 10 --output /tmp/wandervibe-health.txt --write-out '%{http_code}' \
  "https://${fqdn}/api/health")"
test "$code" = 403 && grep -q 'RBAC: access denied' /tmp/wandervibe-health.txt
```

`403` is the only passing result. A timeout is `000`, and that must fail the check. The saved body is `RBAC: access denied`.

Deploy again with the network you are on included, then call the app from that same network. `--retry 2` covers a cold start. It does not retry a 403.

```bash
export WANDER_ALLOWED_IP_RANGES="$(curl --fail --silent --show-error --ipv4 --max-time 10 --retry 3 https://api.ipify.org)/32"

az deployment group create \
  --name wandervibe-staging \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam \
  --parameters containerImageTag="${sha}"

code="$(curl --silent --show-error --retry 2 --retry-delay 5 --max-time 10 --output /tmp/wandervibe-health.txt --write-out '%{http_code}' \
  "https://${fqdn}/api/health")"
test "$code" = 200
```

Expect HTTP 200 and `{ "status": "ok" }`.

`what-if` on an environment that already has this template, with the current image tag passed in, changes `properties.configuration.ingress.ipSecurityRestrictions` on the Container App `ca-wv-<environment>`. Pass `containerImageTag` so the image line is unchanged. A first deployment into an empty resource group still creates the whole platform.

```bash
az deployment group what-if \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam \
  --parameters containerImageTag="${sha}"
```

There is no Azure subscription in CI, so CI checks the compiled template and the rule table instead of calling a live hostname. `infra/tests/check-access-restrictions.sh` runs in the `bicep` job.

### Smoke test for story #14

Story #14, after each staging deploy and each production deploy, calls `https://<container-app-fqdn>/api/health` and `https://<container-app-fqdn>/api/ready`. The job fails unless both return 200. A GitHub-hosted runner gets 403 until that job's egress address is allowed. Ingress answers 403 before the container starts, so a retry does not turn a 403 into a 200. Retry only after the runner rule exists, for the scale-to-zero cold start on staging (`minReplicas` is 0).

The Bicep deployment uses operator ranges only. It does not include the runner address. Put those ranges in the GitHub Actions variable `WANDER_ALLOWED_IP_RANGES` on the `staging` and `production` environments. It is not a secret, and it stays out of git. The same 32-entry repository cap and the `/16`–`/32` prefix check apply when that deployment runs.

The deploy job needs only `id-token: write` and `contents: read`. One deploy per environment runs at a time. A new run waits. It does not cancel the run that still has to remove its runner rule:

```yaml
concurrency:
  group: deploy-${{ inputs.environment }}
  cancel-in-progress: false

permissions:
  id-token: write
  contents: read
```

`inputs.environment` is `staging` or `prod`, so the groups are `deploy-staging` and `deploy-prod`.

Resolve the address in the same job that calls the app. Reject a response that is not an IPv4 literal before any rule is added. The second lookup is optional; use it when both services answer:

```bash
ip="$(curl --fail --silent --show-error --ipv4 --max-time 10 --retry 3 https://api.ipify.org)"
[[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "unexpected egress IP: $ip" >&2; exit 1; }
cross="$(curl --fail --silent --show-error --ipv4 --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')"
[ "$ip" = "$cross" ] || { echo "egress IP mismatch: $ip vs $cross" >&2; exit 1; }
runner_cidr="${ip}/32"
```

Then deploy, add one rule for this run, smoke-test, and always remove that rule:

```yaml
- name: Deploy
  run: az deployment group create ... # operator ranges only; no runner IP
- name: Allow this runner
  run: |
    az containerapp ingress access-restriction set \
      --resource-group "$RG" \
      --name "$APP" \
      --rule-name "gh-run-${GITHUB_RUN_ID}" \
      --action Allow \
      --ip-address "${runner_cidr}"
- name: Smoke test
  run: |
    code="$(curl --silent --show-error --retry 2 --retry-delay 5 --max-time 10 \
      --output /tmp/wandervibe-health.txt --write-out '%{http_code}' \
      "https://${FQDN}/api/health")"
    test "$code" = 200
    code="$(curl --silent --show-error --retry 2 --retry-delay 5 --max-time 10 \
      --output /tmp/wandervibe-ready.txt --write-out '%{http_code}' \
      "https://${FQDN}/api/ready")"
    test "$code" = 200
- name: Remove runner rule
  if: always()
  run: |
    az containerapp ingress access-restriction remove \
      --resource-group "$RG" \
      --name "$APP" \
      --rule-name "gh-run-${GITHUB_RUN_ID}"
```

`if: always()` removes `gh-run-${GITHUB_RUN_ID}` when the smoke test fails or the job is cancelled. That removal must not leave the rule list empty. An empty `ipSecurityRestrictions` list allows every client. The Bicep deploy has already installed the sentinel rule `closed-until-allowlist`, or the operator Allow rules, before the runner rule is added. Cleanup removes only `gh-run-${GITHUB_RUN_ID}`. It leaves the sentinel and the operator rules in place. The `set` command adds one Allow rule beside those rules. It does not replace the list, so two overlapping runs cannot wipe each other's operator ranges. `cancel-in-progress: false` keeps the running job alive long enough to reach the remove step. If the runner dies before that step, the next IaC deploy rewrites the list from the operator ranges, or from the sentinel when those ranges are empty, and the leftover runner rule is gone.

Use the production resource group and Container App name for the production smoke test. The same steps apply.

Alternative: run the smoke test on a self-hosted runner whose egress CIDR is already in the operator allowlist. Skip the temporary rule. The check still calls `https://<container-app-fqdn>/api/health` and `https://<container-app-fqdn>/api/ready`.

The `actions` ranges published at `https://api.github.com/meta` are a poor fit. They change, the list is large, and any GitHub-hosted runner could call the app. Leave them out of the repository.

### Opening ingress after story #15

Leave `restrictPublicAccess` true until story #15 is accepted. Before setting it to false, sign-in is enforced on every page except the sign-in page and `/api/health`. Unauthenticated page requests redirect to sign-in. Unauthenticated API requests return 401. `/api/health` stays anonymous so the platform probes keep working.

This deploy sends an empty rule list, which allows every client:

```bash
az deployment group create \
  --name wandervibe-prod \
  --resource-group rg-wandervibe-prod \
  --parameters infra/main.prod.bicepparam \
  --parameters restrictPublicAccess=false \
  --parameters containerImageTag="${sha}"
```

Repeat for staging with `rg-wandervibe-staging` and `infra/main.staging.bicepparam`. To widen access and still keep the public internet out, leave `restrictPublicAccess` true and pass a longer `allowedIpRanges` list.

`/api/ready` is outside the #15 exceptions. After that story, a caller with no session receives 401 from `/api/ready`. The #14 smoke test expects 200 from that path with no session. Keep the allowlist for that check until the smoke test matches the auth rules, or until `/api/ready` is anonymous as well. Clearing `restrictPublicAccess` does not make an anonymous `/api/ready` return 200 once sign-in is enforced.

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

Neither response includes host names, SQL, stack traces, or credentials. The route stops waiting after 2.5 seconds and returns the same 503. Startup and liveness probes call `/api/health` on port 3000. A liveness failure restarts the replica, so that probe does not touch Postgres. The readiness probe calls `/api/ready` with a 5 second timeout. A readiness failure only takes the replica out of traffic. Those probes run inside the Container Apps environment and are outside the [ingress allowlist](#ingress-allowlist). Story #14 can call `https://<container-app-fqdn>/api/ready` after deploy, once the runner address is on that list. `/api/health` stays the process check from story #1.

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

`what-if` prints the resource changes. Secure parameters are redacted. Nothing is created. On an environment that already has this template, also pass the current `containerImageTag`. The ingress change is `ipSecurityRestrictions` on the Container App, described under [Ingress allowlist](#ingress-allowlist).

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

Create the Container App against that tag. The default of `deployContainerApp` is true, so this run creates the app. Ingress is closed unless `WANDER_ALLOWED_IP_RANGES` lists this machine. The [Ingress allowlist](#ingress-allowlist) section covers that variable, the 403 check, and the story #14 smoke test.

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
- Sign-in (story #15). The allowlist is the control until that story is accepted.
- Custom domain and TLS certificates
- Front Door, a WAF, VNet integration, and private ingress
- Grant AcrPush to the future GitHub OIDC identity (story #14's one-time setup)
