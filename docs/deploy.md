# Continuous deployment

Pushes to `main` build one image, deploy it to staging, and deploy that same tag to prod after approval. The workflow is [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). The decisions are in [ADR-0003](adr/ADR-0003-continuous-deployment.md). Platform resources and the first manual deployment are in [docs/infra.md](infra.md).

Azure login uses OIDC. The repository has no client secret, publish profile, or registry password. Repository secrets are not used.

The workflow does not deploy until the repository variables below are set. A push to `main` before that skips the deploy jobs and succeeds. Pull requests do not run this workflow.

## What a deploy does

1. The build job logs in with the `main` branch federated credential, builds `wandervibe:<full-sha>` and `wandervibe-migrate:<full-sha>`, and pushes both to the staging registry.
2. The staging job logs in with the `staging` environment credential. It updates the migration job to that tag, runs `prisma migrate deploy`, then updates the Container App to the same tag. It passes `containerImageTag` every time. An empty tag or `initial` fails before Azure creates a revision.
3. The staging job calls `https://<container-app-fqdn>/api/health` and `https://<container-app-fqdn>/api/ready`. Both must return 200 and `{ "status": "ok" }`. Each path gets 30 attempts, 10 seconds apart.
4. The prod job waits for the GitHub Environment `prod`. It imports the same two tags into the prod registry, then migrates and deploys. It does not build the image again.
5. While `publicAccessRestricted` is true, the runner's IPv4 address is allowed only after Deploy, as the rule `gh-run-<run id>`, and an `if: always()` step removes that rule when it is present.

Prod does not start until staging has succeeded. A run waits for the previous run, including a pending prod approval, so an older commit cannot deploy on top of a newer one.

## One-time setup

Do these in order. Use a different Postgres password for prod than for staging.

### 1. Subscription and resource groups

```bash
az login
az account set --subscription "<subscription-id>"
az group create --name rg-wandervibe-staging --location switzerlandnorth
az group create --name rg-wandervibe-prod --location switzerlandnorth
```

### 2. Bootstrap the platform

This is the first deployment from [docs/infra.md](infra.md). The Container App is left out because the registry is empty. Export a password of 16 to 128 characters that meets Azure's password rules, then preview and create staging:

```bash
export POSTGRES_ADMIN_PASSWORD="$(openssl rand -base64 24)"
az deployment group what-if \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam \
  --parameters deployContainerApp=false
az deployment group create \
  --name wandervibe-staging \
  --resource-group rg-wandervibe-staging \
  --parameters infra/main.staging.bicepparam \
  --parameters deployContainerApp=false
```

Repeat for prod with a new password, `rg-wandervibe-prod`, and `infra/main.prod.bicepparam`. Keep each password until that deployment finishes. The password is then inside the `database-url` Key Vault secret. Drop the shell variable. Do not commit it.

Record these outputs for each environment. They are not secret:

- `containerRegistryName`
- `containerRegistryLoginServer`
- `keyVaultName`
- `managedIdentityName`

`containerAppName` and `containerAppFqdn` are empty on this run.

`deployContainerApp=false` does not need an image tag. A later deployment that creates the app without `containerImageTag`, or with `initial`, fails and does not roll out a revision.

### 3. Create the CD identity

Create a resource group that holds only the identity. Do not grant the identity a role on this group.

```bash
az group create --name rg-wandervibe-cd --location switzerlandnorth
az identity create \
  --name id-wv-cd \
  --resource-group rg-wandervibe-cd
```

Read the values the GitHub variables need:

```bash
az identity show \
  --name id-wv-cd \
  --resource-group rg-wandervibe-cd \
  --query "{clientId: clientId, principalId: principalId}" \
  --output json
az account show --query "{tenantId: tenantId, subscriptionId: id}" --output json
```

Create three federated credentials. The issuer is `https://token.actions.githubusercontent.com`. The audience is `api://AzureADTokenExchange`.

```bash
az identity federated-credential create \
  --name main \
  --identity-name id-wv-cd \
  --resource-group rg-wandervibe-cd \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:marcgs/WanderVibe:ref:refs/heads/main \
  --audiences api://AzureADTokenExchange
az identity federated-credential create \
  --name staging \
  --identity-name id-wv-cd \
  --resource-group rg-wandervibe-cd \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:marcgs/WanderVibe:environment:staging \
  --audiences api://AzureADTokenExchange
az identity federated-credential create \
  --name prod \
  --identity-name id-wv-cd \
  --resource-group rg-wandervibe-cd \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:marcgs/WanderVibe:environment:prod \
  --audiences api://AzureADTokenExchange
```

Do not create a client secret.

A job that sets `environment:` presents the environment subject, so the `main` credential does not authenticate the staging or prod jobs. The build job selects no environment and uses the `main` credential.

#### App registration instead of a user-assigned identity

Skip the `az identity` commands above if you use an app registration. Create the application and its service principal, and do not create a client secret:

```bash
app_id="$(az ad app create --display-name wandervibe-cd --query appId --output tsv)"
az ad sp create --id "$app_id"
principal_id="$(az ad sp show --id "$app_id" --query id --output tsv)"
```

`AZURE_CLIENT_ID` is `app_id`. Role assignments use `principal_id`. The federated-credential subjects, issuer, and audience are the same three values:

```bash
az ad app federated-credential create --id "$app_id" --parameters '{
  "name": "main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:marcgs/WanderVibe:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
az ad app federated-credential create --id "$app_id" --parameters '{
  "name": "staging",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:marcgs/WanderVibe:environment:staging",
  "audiences": ["api://AzureADTokenExchange"]
}'
az ad app federated-credential create --id "$app_id" --parameters '{
  "name": "prod",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:marcgs/WanderVibe:environment:prod",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

### 4. Role assignments

Set `principal_id` from step 3. Set the registry names from the bootstrap outputs.

```bash
principal_id="<principalId>"
staging_acr="<containerRegistryName from staging>"
prod_acr="<containerRegistryName from prod>"
sub="$(az account show --query id --output tsv)"

az role assignment create \
  --assignee-object-id "$principal_id" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPush \
  --scope "/subscriptions/${sub}/resourceGroups/rg-wandervibe-staging/providers/Microsoft.ContainerRegistry/registries/${staging_acr}"
az role assignment create \
  --assignee-object-id "$principal_id" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPush \
  --scope "/subscriptions/${sub}/resourceGroups/rg-wandervibe-prod/providers/Microsoft.ContainerRegistry/registries/${prod_acr}"
az role assignment create \
  --assignee-object-id "$principal_id" \
  --assignee-principal-type ServicePrincipal \
  --role Contributor \
  --scope "/subscriptions/${sub}/resourceGroups/rg-wandervibe-staging"
az role assignment create \
  --assignee-object-id "$principal_id" \
  --assignee-principal-type ServicePrincipal \
  --role Contributor \
  --scope "/subscriptions/${sub}/resourceGroups/rg-wandervibe-prod"
```

Every role assignment:

| Role                   | Principal       | Scope                   | Created by         |
| ---------------------- | --------------- | ----------------------- | ------------------ |
| AcrPull                | `id-wv-staging` | Staging registry        | `infra/main.bicep` |
| Key Vault Secrets User | `id-wv-staging` | Staging Key Vault       | `infra/main.bicep` |
| AcrPull                | `id-wv-prod`    | Prod registry           | `infra/main.bicep` |
| Key Vault Secrets User | `id-wv-prod`    | Prod Key Vault          | `infra/main.bicep` |
| AcrPush                | CD identity     | Staging registry        | This step          |
| AcrPush                | CD identity     | Prod registry           | This step          |
| Contributor            | CD identity     | `rg-wandervibe-staging` | This step          |
| Contributor            | CD identity     | `rg-wandervibe-prod`    | This step          |

The app identity roles already exist from the bootstrap. The migration job uses that identity, so it can pull the migrate image and read `database-url`. The CD identity never receives a Key Vault data-plane role.

Do not assign any of these to the CD identity:

- Key Vault Secrets Officer
- Key Vault Secrets User
- Key Vault Administrator
- Owner
- User Access Administrator

Contributor on the resource group deploys `infra/cd.bicep`, starts the job, and changes ingress rules. Writing a Key Vault secret from Bicep is a control-plane operation and is not part of the CD deployment. `infra/cd.bicep` does not write secrets and does not create role assignments, so the CD identity does not need `Microsoft.Authorization/roleAssignments/write`.

If you have to read or write a secret outside a Bicep deployment, grant Key Vault Secrets Officer to your user for that task and delete the assignment when you are done. A Privileged Identity Management eligible assignment is the same idea when the tenant has it. Do that on your user, not on the CD identity. [docs/infra.md](infra.md) explains why a standing Secrets Officer role can read the database password.

Role changes can take a minute to apply.

### 5. GitHub environments

In the repository settings, create two environments. Do this before you set the repository variables. If `prod` does not exist yet, the first prod job can create it with no reviewer.

**staging**

- Name: `staging`
- Required reviewers: none
- Deployment branches: selected branch `main`

**prod**

- Name: `prod`
- Required reviewers: your GitHub user
- Deployment branches: selected branch `main`

The environment name is `prod`, matching `rg-wandervibe-prod` and the concurrency group `deploy-prod`.

### 6. Repository variables

Settings → Secrets and variables → Actions → Variables. These are variables, not secrets. There are no repository secrets.

| Name                               | Value                                              |
| ---------------------------------- | -------------------------------------------------- |
| `AZURE_CLIENT_ID`                  | Client id from step 3                              |
| `AZURE_TENANT_ID`                  | Tenant id from step 3                              |
| `AZURE_SUBSCRIPTION_ID`            | Subscription id from step 3                        |
| `STAGING_AZURE_RESOURCE_GROUP`     | `rg-wandervibe-staging`                            |
| `STAGING_AZURE_CONTAINER_REGISTRY` | Staging `containerRegistryName`                    |
| `STAGING_WANDER_ALLOWED_IP_RANGES` | Optional. Comma-separated operator CIDRs, or empty |
| `PROD_AZURE_RESOURCE_GROUP`        | `rg-wandervibe-prod`                               |
| `PROD_AZURE_CONTAINER_REGISTRY`    | Prod `containerRegistryName`                       |
| `PROD_WANDER_ALLOWED_IP_RANGES`    | Optional. Comma-separated operator CIDRs, or empty |

Leave the allowed-range variables empty to keep ingress closed to every real client. To allow your own network, set a `/32` from the machine you use:

```bash
curl --fail --silent --show-error --ipv4 --max-time 10 https://api.ipify.org
```

Append `/32`. The runner address is not one of these values. The workflow adds it itself, after Deploy, and removes it afterwards. The same rules as the Bicep allowlist apply: IPv4 CIDRs, prefix `/16` through `/32`, at most 32 entries.

Staging can be configured before prod. Prod stays skipped until `PROD_AZURE_RESOURCE_GROUP` and `PROD_AZURE_CONTAINER_REGISTRY` are set. Prod also needs the staging variables, because it imports the image from the staging registry.

### 7. First CD deploy

After the variables are saved, merge to `main` or run the Deploy workflow on `main` with target `both`.

For a fresh platform from step 2, that run:

1. Pushes `wandervibe:<full-sha>` and `wandervibe-migrate:<full-sha>` to the staging registry.
2. Deploys the migration job with `deployContainerApp=false` and `containerImageTag` set to that SHA. The Container App is still absent, so this does not create a revision of a missing image.
3. Runs `prisma migrate deploy` in the job. The job uses the app identity and the existing `database-url` secret.
4. Deploys the Container App with the same SHA. The first revision uses the image that was just pushed.
5. Adds `gh-run-<run id>` when `publicAccessRestricted` is true, calls `/api/health` and `/api/ready`, then removes that rule.
6. After you approve the `prod` environment, imports the same tags and repeats the migrate, deploy, and smoke test in prod.

The smoke test passes when both URLs return 200 and `{ "status": "ok" }`. `/api/ready` is `SELECT 1`. It does not require the Trip table. The migration is what creates that table.

## Smoke test

The check is `scripts/smoke-test.sh`. It requests each path up to 30 times, waiting 10 seconds between attempts, with a 10 second cap on each request. Staging scales to zero, so the first attempts can fail while a replica starts. A 403 from a runner that was never allowed does not become a 200 by retrying. The runner rule is added before this step.

The address lookup runs only when the deployment output `publicAccessRestricted` is the string `true`. The query is `to_string(properties.outputs.publicAccessRestricted.value)`. The script checks both ipify and checkip, requires an IPv4 literal, and writes `RUNNER_CIDR=<ip>/32` to `$GITHUB_ENV`. The Allow rule is `gh-run-<run id>` for that CIDR. `scripts/remove-runner-rule.sh` runs with `if: always()`. It lists the rules, removes `gh-run-<run id>` only when the count is not 0, and leaves `closed-until-allowlist` and the operator rules in place. A missing app or a missing rule prints that there is nothing to remove. A failed list or a failed remove fails the job.

The deploy jobs use concurrency groups `deploy-staging` and `deploy-prod` with `cancel-in-progress: false`.

When story #15 sets `restrictPublicAccess` to false, the output is false, and the workflow does not add a runner rule. Adding one would allow only the runner and lock everyone else out.

On the first real staging deploy, also run the live checks in [docs/infra.md](infra.md): `az deployment group what-if` shows `ipSecurityRestrictions` on the Container App, a request from outside the allowlist gets 403, and a request from an allowlisted address gets 200 for `/api/health` and `/api/ready`. Those calls need the subscription. CI does not run them.

## Roll back

Prisma migrations are forward-only. Redeploying an older image does not undo a migration that already succeeded.

To put a previous image back on an environment:

1. Copy the full commit SHA. That string is the image tag.
2. Actions → Deploy → Run workflow.
3. Use the workflow from `main`.
4. Set the image tag to that SHA.
5. Set the target to `staging`, `prod`, or `both`.

The build job sees that the tag is not this commit and does not rebuild the checkout under that tag. The image must already be in the staging registry. Prod imports it again if you include prod. Approving the `prod` environment is still required for a prod target.

Re-running an older Deploy workflow run deploys that run's SHA as well. Re-run the staging job, then approve prod if you want prod to follow.

## When the variables are unset

`scripts/cd-enabled.sh` turns a deploy on only when the variables that job needs are non-empty. Staging needs `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `STAGING_AZURE_RESOURCE_GROUP`, and `STAGING_AZURE_CONTAINER_REGISTRY`. Prod needs those plus `PROD_AZURE_RESOURCE_GROUP` and `PROD_AZURE_CONTAINER_REGISTRY`. Anything missing skips that job. The workflow succeeds and prints that deploy was skipped.

Set the variables after the bootstrap, the identity, the credentials, the roles, and the GitHub environments exist. Prod stays off until both prod variables are set. Those two variables start the prod job, which waits for approval and then fails if the identity or the registry is wrong.
