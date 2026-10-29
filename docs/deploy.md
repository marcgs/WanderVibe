# Continuous deployment

Pushes to `main` build one image, deploy it to staging, and deploy that same tag to prod after approval. The workflow is [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). The decisions are in [ADR-0003](adr/ADR-0003-continuous-deployment.md). Platform resources and the first manual deployment are in [docs/infra.md](infra.md).

Azure login uses OIDC. The repository has no client secret, publish profile, or registry password. Repository secrets are not used.

The workflow does not deploy until the repository variables below are set. A push to `main` before that skips the deploy jobs and succeeds. Pull requests do not run this workflow.

## What a deploy does

1. The build job selects the GitHub Environment `staging` and logs in as `id-wv-cd-staging`. It builds `wandervibe:<full-sha>` and `wandervibe-migrate:<full-sha>` and pushes both to the staging registry.
2. The staging job logs in with the `staging` environment credential. It updates the migration job to that tag, runs `prisma migrate deploy`, then updates the Container App to the same tag. It passes `containerImageTag` every time. An empty tag or `initial` fails before Azure creates a revision.
3. The staging job calls `https://<container-app-fqdn>/api/health` and `https://<container-app-fqdn>/api/ready`. Both must return 200 and `{ "status": "ok" }`. Each path gets 30 attempts, 10 seconds apart.
4. The prod job waits for the GitHub Environment `prod`. It imports the same two tags into the prod registry, then migrates and deploys. It does not build the image again.
5. While `publicAccessRestricted` is true, the runner's IPv4 address is allowed only after Deploy, as the rule `gh-run-<run id>`. An `if: always()` step removes that rule when it is present, and only if Azure login succeeded.

Prod does not start until the staging deploy and its smoke test for that same commit SHA have succeeded in this run. A pending prod approval does not block the next staging deploy. Two deploys of one environment still wait for each other.

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

This is the first deployment from [docs/infra.md](infra.md). The Container App is left out because the registry is empty. Export a password of 16 to 128 characters. The `Aa1!` suffix guarantees an uppercase letter, a lowercase letter, a digit, and a symbol, which is what Azure requires even when the random part is unlucky. Then preview and create staging:

```bash
export POSTGRES_ADMIN_PASSWORD="$(openssl rand -base64 24)Aa1!"
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

### 3. Create the CD identities

Create a resource group that holds only the identities. Do not grant either identity a role on this group.

```bash
az group create --name rg-wandervibe-cd --location switzerlandnorth
az identity create --name id-wv-cd-staging --resource-group rg-wandervibe-cd
az identity create --name id-wv-cd-prod --resource-group rg-wandervibe-cd
```

Each identity has exactly one federated credential, for its own GitHub Environment. There is no `ref:refs/heads/main` credential. A job that does not select an environment cannot obtain an Azure token. The build job selects `staging`, so it logs in as `id-wv-cd-staging`.

The issuer is `https://token.actions.githubusercontent.com`. The audience is `api://AzureADTokenExchange`.

```bash
az identity federated-credential create \
  --name staging \
  --identity-name id-wv-cd-staging \
  --resource-group rg-wandervibe-cd \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:marcgs/WanderVibe:environment:staging \
  --audiences api://AzureADTokenExchange
az identity federated-credential create \
  --name prod \
  --identity-name id-wv-cd-prod \
  --resource-group rg-wandervibe-cd \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:marcgs/WanderVibe:environment:prod \
  --audiences api://AzureADTokenExchange
```

Do not create a client secret. Do not add a second credential to either identity.

Read the client ids and principal ids. The client id of `id-wv-cd-staging` is `AZURE_CLIENT_ID` on the `staging` environment. The client id of `id-wv-cd-prod` is `AZURE_CLIENT_ID` on the `prod` environment.

```bash
az identity show --name id-wv-cd-staging --resource-group rg-wandervibe-cd \
  --query "{clientId: clientId, principalId: principalId}" --output json
az identity show --name id-wv-cd-prod --resource-group rg-wandervibe-cd \
  --query "{clientId: clientId, principalId: principalId}" --output json
az account show --query "{tenantId: tenantId, subscriptionId: id}" --output json
```

Confirm each identity has one credential and only the roles from the next section:

```bash
az identity federated-credential list \
  --identity-name id-wv-cd-staging --resource-group rg-wandervibe-cd --output table
az identity federated-credential list \
  --identity-name id-wv-cd-prod --resource-group rg-wandervibe-cd --output table
az role assignment list --assignee "<staging principalId>" --all --output table
az role assignment list --assignee "<prod principalId>" --all --output table
```

#### App registration instead of a user-assigned identity

Use two app registrations, `wandervibe-cd-staging` and `wandervibe-cd-prod`, if you do not use user-assigned identities. Do not create a client secret. Each application gets one federated credential, with the subject above. `AZURE_CLIENT_ID` is that application's app id. Role assignments use the service principal object id (`az ad sp show --id "$app_id" --query id`).

### 4. Role assignments

Set the principal ids from step 3 and the registry names from the bootstrap outputs. Neither identity gets a role on the other environment's resource group.

```bash
staging_principal="<staging principalId>"
prod_principal="<prod principalId>"
staging_acr="<containerRegistryName from staging>"
prod_acr="<containerRegistryName from prod>"
sub="$(az account show --query id --output tsv)"
staging_acr_id="/subscriptions/${sub}/resourceGroups/rg-wandervibe-staging/providers/Microsoft.ContainerRegistry/registries/${staging_acr}"
prod_acr_id="/subscriptions/${sub}/resourceGroups/rg-wandervibe-prod/providers/Microsoft.ContainerRegistry/registries/${prod_acr}"

az role assignment create \
  --assignee-object-id "$staging_principal" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPush \
  --scope "$staging_acr_id"
az role assignment create \
  --assignee-object-id "$staging_principal" \
  --assignee-principal-type ServicePrincipal \
  --role Contributor \
  --scope "/subscriptions/${sub}/resourceGroups/rg-wandervibe-staging"

az role assignment create \
  --assignee-object-id "$prod_principal" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPull \
  --scope "$staging_acr_id"
az role assignment create \
  --assignee-object-id "$prod_principal" \
  --assignee-principal-type ServicePrincipal \
  --role "Container Registry Data Importer and Data Reader" \
  --scope "$prod_acr_id"
az role assignment create \
  --assignee-object-id "$prod_principal" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPush \
  --scope "$prod_acr_id"
az role assignment create \
  --assignee-object-id "$prod_principal" \
  --assignee-principal-type ServicePrincipal \
  --role Contributor \
  --scope "/subscriptions/${sub}/resourceGroups/rg-wandervibe-prod"
```

Every role assignment:

| Role                                             | Principal          | Scope                   | Created by                                                             |
| ------------------------------------------------ | ------------------ | ----------------------- | ---------------------------------------------------------------------- |
| AcrPull                                          | `id-wv-staging`    | Staging registry        | `infra/main.bicep`                                                     |
| Key Vault Secrets User                           | `id-wv-staging`    | Staging Key Vault       | `infra/main.bicep`                                                     |
| AcrPull                                          | `id-wv-prod`       | Prod registry           | `infra/main.bicep`                                                     |
| Key Vault Secrets User                           | `id-wv-prod`       | Prod Key Vault          | `infra/main.bicep`                                                     |
| AcrPush                                          | `id-wv-cd-staging` | Staging registry        | This step                                                              |
| Contributor                                      | `id-wv-cd-staging` | `rg-wandervibe-staging` | This step, until [#29](https://github.com/marcgs/WanderVibe/issues/29) |
| AcrPull                                          | `id-wv-cd-prod`    | Staging registry        | This step                                                              |
| Container Registry Data Importer and Data Reader | `id-wv-cd-prod`    | Prod registry           | This step                                                              |
| AcrPush                                          | `id-wv-cd-prod`    | Prod registry           | This step                                                              |
| Contributor                                      | `id-wv-cd-prod`    | `rg-wandervibe-prod`    | This step, until [#29](https://github.com/marcgs/WanderVibe/issues/29) |

`id-wv-cd-staging` can push to the staging registry and cannot push to the prod registry. `id-wv-cd-prod` can pull from the staging registry. It cannot push to that registry and it cannot import into it. It can push and import on the prod registry.

The staging registry is Basic, so repository ABAC roles such as Container Registry Repository Reader do not apply. AcrPull is the read-only role. Its only action is `Microsoft.ContainerRegistry/registries/pull/read`. Container Registry Data Importer and Data Reader includes `Microsoft.ContainerRegistry/registries/importImage/action` on the registry where it is assigned, which would let this identity import images into staging. That role stays on the prod registry only. `az acr import --name <prod registry> --registry <staging registry resource id> --source <repository>:<tag>` runs the import on the prod registry and pulls the source with the caller's token. AcrPull on the source authorizes that pull. Do not assign the importer role to `id-wv-cd-prod` on the staging registry.

The app identity roles already exist from the bootstrap. The migration job uses that identity, so it can pull the migrate image and read `database-url`. Neither CD identity receives a Key Vault data-plane role.

Do not assign any of these to either CD identity:

- Key Vault Secrets Officer
- Key Vault Secrets User
- Key Vault Administrator
- Owner
- User Access Administrator
- Contributor on the other environment's resource group

Contributor on that identity's own resource group deploys `infra/cd.bicep`, starts the job, and changes ingress rules. It is broader than the deploy needs. [#29](https://github.com/marcgs/WanderVibe/issues/29) replaces it. While it is assigned, AcrPush on the registry in the same resource group is redundant in non-ABAC mode, because Contributor already includes registry push and pull. The explicit AcrPush and importer roles stay so the registry rights are still named when Contributor is removed. Writing a Key Vault secret from Bicep is a control-plane operation and is not part of the CD deployment. `infra/cd.bicep` does not write secrets and does not create role assignments, so the CD identity does not need `Microsoft.Authorization/roleAssignments/write`.

If you have to read or write a secret outside a Bicep deployment, grant Key Vault Secrets Officer to your user for that task and delete the assignment when you are done. A Privileged Identity Management eligible assignment is the same idea when the tenant has it. Do that on your user, not on the CD identity. [docs/infra.md](infra.md) explains why a standing Secrets Officer role can read the database password.

Role changes can take a minute to apply.

### 5. GitHub environments

In the repository settings, create two environments before any deploy job runs. GitHub creates a missing environment with no protection rules the first time a job selects it. Do not let the prod job be that first use.

**staging**

- Name: `staging`
- Required reviewers: none
- Deployment branches: selected branch `main`
- Environment variable `AZURE_CLIENT_ID`: client id of `id-wv-cd-staging`

**prod**

- Name: `prod`
- Required reviewers: your GitHub user
- Check "Prevent administrators from bypassing configured protection rules"
- Deployment branches: selected branch `main`
- Environment variable `AZURE_CLIENT_ID`: client id of `id-wv-cd-prod`

The environment name is `prod`, matching `rg-wandervibe-prod` and the concurrency group `deploy-prod`. Save the required reviewer and the bypass lock before you set `PROD_GATE_CONFIRMED` in the next section. Until that variable is `true`, the prod job does not run, so it cannot create the environment for you.

### 6. Repository variables

Settings → Secrets and variables → Actions → Variables. These are variables, not secrets. There are no repository secrets.

| Name                               | Value                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `AZURE_TENANT_ID`                  | Tenant id from step 3                                                                                            |
| `AZURE_SUBSCRIPTION_ID`            | Subscription id from step 3                                                                                      |
| `STAGING_AZURE_RESOURCE_GROUP`     | `rg-wandervibe-staging`                                                                                          |
| `STAGING_AZURE_CONTAINER_REGISTRY` | Staging `containerRegistryName`                                                                                  |
| `STAGING_WANDER_ALLOWED_IP_RANGES` | Optional. Comma-separated operator CIDRs, or empty                                                               |
| `PROD_AZURE_RESOURCE_GROUP`        | `rg-wandervibe-prod`                                                                                             |
| `PROD_AZURE_CONTAINER_REGISTRY`    | Prod `containerRegistryName`                                                                                     |
| `PROD_WANDER_ALLOWED_IP_RANGES`    | Optional. Comma-separated operator CIDRs, or empty                                                               |
| `PROD_GATE_CONFIRMED`              | `true` only after the prod environment has you as a required reviewer and administrators cannot bypass that rule |

`AZURE_CLIENT_ID` is not a repository variable. Set it on each GitHub Environment, as the previous section says. The build job and the staging deploy read the staging value. The prod deploy reads the prod value.

Leave the allowed-range variables empty to keep ingress closed to every real client. To allow your own network, set a `/32` from the machine you use:

```bash
curl --fail --silent --show-error --ipv4 --max-time 10 https://api.ipify.org
```

Append `/32`. The runner address is not one of these values. The workflow adds it itself, after Deploy, and removes it afterwards. The same rules as the Bicep allowlist apply: IPv4 CIDRs, prefix `/16` through `/32`, at most 32 entries.

Staging can be configured before prod. Prod stays skipped until its resource group, its registry, and `PROD_GATE_CONFIRMED=true` are all set. Prod also needs the staging variables, because it imports the image from the staging registry.

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

The address lookup runs only when the deployment output `publicAccessRestricted` is the string `true`. The query is `to_string(properties.outputs.publicAccessRestricted.value)`. The script checks both ipify and checkip, requires an IPv4 literal, and writes `RUNNER_CIDR=<ip>/32` to `$GITHUB_ENV`. The Allow rule is `gh-run-<run id>` for that CIDR. `scripts/remove-runner-rule.sh` runs with `if: always() && steps.login.outcome == 'success'`. A failed Azure login does not try to remove a rule that was never added. The step lists the rules, removes `gh-run-<run id>` only when the count is not 0, and leaves `closed-until-allowlist` and the operator rules in place. A missing app or a missing rule prints that there is nothing to remove. A failed list or a failed remove fails the job.

The deploy jobs use concurrency groups `deploy-staging` and `deploy-prod` with `cancel-in-progress: false`. A prod approval does not hold the staging group.

When story #15 sets `restrictPublicAccess` to false, the output is false, and the workflow does not add a runner rule. Adding one would allow only the runner and lock everyone else out.

On the first real staging deploy, also run the live checks in [docs/infra.md](infra.md): `az deployment group what-if` shows `ipSecurityRestrictions` on the Container App, a request from outside the allowlist gets 403, and a request from an allowlisted address gets 200 for `/api/health` and `/api/ready`. Those calls need the subscription. CI does not run them.

## Roll back

Prisma migrations are forward-only. Redeploying an older image does not undo a migration that already succeeded.

To put a previous image back on an environment:

1. Copy the full commit SHA. That string is the image tag.
2. Actions → Deploy → Run workflow.
3. Use the workflow from `main`.
4. Set the image tag to that SHA.
5. Set the target to `both`.

There is no prod-only target. The same SHA is deployed to staging and smoke-tested in this run before prod is asked to approve it. The build job sees that the tag is not this commit and does not rebuild the checkout under that tag. The image must already be in the staging registry. Prod imports it from that registry after staging succeeds.

Use target `staging` when prod should stay on the current release. Re-running an older Deploy workflow run does the same thing for that run's SHA: staging first, then prod after approval.

## When the variables are unset

`scripts/cd-enabled.sh` turns a deploy on only when the repository variables that job needs are non-empty. Staging needs `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `STAGING_AZURE_RESOURCE_GROUP`, and `STAGING_AZURE_CONTAINER_REGISTRY`. Prod needs those plus `PROD_AZURE_RESOURCE_GROUP`, `PROD_AZURE_CONTAINER_REGISTRY`, and `PROD_GATE_CONFIRMED=true`. Anything missing skips that job. The workflow succeeds and prints that deploy was skipped. `AZURE_CLIENT_ID` is read later, from the GitHub Environment the job selects.

Set the repository variables after the bootstrap, the identities, the credentials, the roles, and the GitHub environments exist. Leave `PROD_GATE_CONFIRMED` unset until the prod environment has a required reviewer and administrators cannot bypass it.
