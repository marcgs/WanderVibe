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
  --role "Container Registry Data Importer and Data Reader" \
  --scope "$staging_acr_id"
az role assignment create \
  --assignee-object-id "$prod_principal" \
  --assignee-principal-type ServicePrincipal \
  --role "Container Registry Data Importer and Data Reader" \
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
| Container Registry Data Importer and Data Reader | `id-wv-cd-prod`    | Staging registry        | This step                                                              |
| Container Registry Data Importer and Data Reader | `id-wv-cd-prod`    | Prod registry           | This step                                                              |
| Contributor                                      | `id-wv-cd-prod`    | `rg-wandervibe-prod`    | This step, until [#29](https://github.com/marcgs/WanderVibe/issues/29) |

`id-wv-cd-staging` can push to the staging registry and cannot push to the prod registry. `id-wv-cd-prod` has Container Registry Data Importer and Data Reader on both registries, which is the role [Microsoft documents](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-import-images) for a same-tenant `az acr import` that passes the source registry resource id. The importer role gives no push or delete on the staging registry. It does add `importImage/action` there, so this identity can import an image into staging. That import right into staging is an accepted residual risk for now. [#29](https://github.com/marcgs/WanderVibe/issues/29), the custom least-privilege role, would remove it, as would a pull-through or cache rule on the prod registry once a read-only import has been verified live. On the prod registry, push and delete come only from Contributor on `rg-wandervibe-prod`, until #29.

Both registries set `roleAssignmentMode` to `LegacyRegistryPermissions`. This table depends on that mode. In ABAC repository-permission mode, AcrPull and AcrPush are not honored, and Contributor has no data-plane access. Microsoft documents that mode becoming the default, and the documentation does not limit it by registry tier.

The app identity roles already exist from the bootstrap. The migration job uses that identity, so it can pull the migrate image and read `database-url`. Neither CD identity receives a Key Vault data-plane role.

Do not assign any of these to either CD identity:

- Key Vault Secrets Officer
- Key Vault Secrets User
- Key Vault Administrator
- Owner
- User Access Administrator
- Contributor on the other environment's resource group

Contributor on that identity's own resource group deploys `infra/cd.bicep`, starts the job, and changes ingress rules. It is broader than the deploy needs. [#29](https://github.com/marcgs/WanderVibe/issues/29) replaces it. While `LegacyRegistryPermissions` is set, Contributor on the resource group that contains a registry already includes push, pull, and import on that registry. `id-wv-cd-staging` still has an explicit AcrPush assignment so the push right remains when Contributor is removed. `id-wv-cd-prod` has no AcrPush role. The importer role covers the import. On the prod registry, push and delete come only from Contributor on `rg-wandervibe-prod`, until #29. Writing a Key Vault secret from Bicep is a control-plane operation and is not part of the CD deployment. `infra/cd.bicep` does not write secrets and does not create role assignments, so the CD identity does not need `Microsoft.Authorization/roleAssignments/write`.

If you have to read or write a secret outside a Bicep deployment, grant Key Vault Secrets Officer to your user for that task and delete the assignment when you are done. A Privileged Identity Management eligible assignment is the same idea when the tenant has it. Do that on your user, not on the CD identity. [docs/infra.md](infra.md) explains why a standing Secrets Officer role can read the database password.

Role changes can take a minute to apply.

### 5. GitHub environments

In the repository settings, create two environments before any deploy job runs. GitHub creates a missing environment with no protection rules the first time a job selects it. Do not let the prod job be that first use.

**staging**

- Name: `staging`
- Required reviewers: none
- Deployment branches: selected branch `main`
- Environment variable `AZURE_CLIENT_ID`: client id of `id-wv-cd-staging`
- Environment variable `AUTH_CONFIGURED`: leave unset until `auth-secret` exists. Set it to `true` to turn auth on. See [Sign-in](#sign-in).
- Environment variable `AUTH_GOOGLE_CONFIGURED`: set to `true` only when the Google secrets exist. Leave unset to skip Google.
- Environment variable `AUTH_MICROSOFT_CONFIGURED`: set to `true` only when the Entra secrets exist. Leave unset to skip Entra.

The build job selects this environment, so every workflow run creates a GitHub deployment record for `staging` before the Container App changes. A required reviewer or a wait timer added here later would block image builds as well as deploys.

**prod**

- Name: `prod`
- Required reviewers: your GitHub user
- Check "Prevent administrators from bypassing configured protection rules"
- Deployment branches: selected branch `main`
- Environment variable `AZURE_CLIENT_ID`: client id of `id-wv-cd-prod`
- Environment variable `AUTH_CONFIGURED`: leave unset until `auth-secret` exists. Set it to `true` to turn auth on. See [Sign-in](#sign-in).
- Environment variable `AUTH_GOOGLE_CONFIGURED`: set to `true` only when the Google secrets exist. Leave unset to skip Google.
- Environment variable `AUTH_MICROSOFT_CONFIGURED`: set to `true` only when the Entra secrets exist. Leave unset to skip Entra.

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

When a deployment sets `restrictPublicAccess` to false, the output is false, and the workflow does not add a runner rule. Adding one would allow only the runner and lock everyone else out. The parameter files still set the flag to true, so GitHub deploys keep adding and removing the runner rule. `/api/health` and `/api/ready` answer without a session, which is what this smoke test calls. The sign-in setup below does not change that step.

On the first real staging deploy, also run the live checks in [docs/infra.md](infra.md): `az deployment group what-if` shows `ipSecurityRestrictions` on the Container App, a request from outside the allowlist gets 403, and a request from an allowlisted address gets 200 for `/api/health` and `/api/ready`. Those calls need the subscription. CI does not run them.

## Sign-in

Auth.js signs a traveler in with Microsoft Entra ID or Google and stores the session in Postgres. The decisions are in [ADR-0004](adr/ADR-0004-authentication.md). The Container App reads provider values from Key Vault only after auth is turned on. The repository and the GitHub Actions variables do not hold those values. There are no new repository secrets.

Leave auth off for the first deploys. `authConfigured` defaults to false. The parameter files set it from the GitHub Environment variable `AUTH_CONFIGURED`. Each of `AUTH_CONFIGURED`, `AUTH_GOOGLE_CONFIGURED`, and `AUTH_MICROSOFT_CONFIGURED` must be exactly `true`, case-sensitive. Unset, empty, `True`, or any other value leaves that switch off. Set the variables on the `staging` environment and, separately, on the `prod` environment. They are not repository variables, so one environment can turn on before the other. The deploy job copies them into the shell before `az deployment group create`.

A manual `infra/main.bicep` deploy reads the same shell variables. If that shell does not export `AUTH_CONFIGURED=true` and the provider flags you already turned on, the deployment sets those flags back to false and turns auth off. The next CD run restores whatever the GitHub Environment variables say. Export the same `true` values in that shell when you want the manual deploy to leave auth on.

While the flag is false, the template does not reference `auth-secret` or the provider secrets. A missing secret cannot fail the revision. The app starts. `/api/health` and `/api/ready` return 200 with no session. Every page returns plain text `Sign-in is not configured yet`. Every other API returns 401. The proxy does not call Auth.js in that state.

Turn auth on in this order, after a deploy with the flag off has succeeded:

1. Register the Entra ID app and the Google client, with the redirect URIs below.
2. Write `auth-secret` and the secrets for each provider you will use. You can use only Google, only Entra, or both. Do not create placeholder secrets for a provider you are skipping. The app identity already has Key Vault Secrets User. Do not grant that role to a CD identity.
3. Set `AUTH_CONFIGURED` to `true`. Set `AUTH_GOOGLE_CONFIGURED` and `AUTH_MICROSOFT_CONFIGURED` to `true` only for the providers whose secrets you wrote.
4. Deploy again. The revision references those secrets and sets `AUTH_URL` to `https://<container-app-fqdn>`. A referenced secret that does not exist fails this revision.

For a manual deploy, export the same variables in the shell you use for `az deployment group create`. `infra/main.<environment>.bicepparam` and `infra/cd.<environment>.bicepparam` both read them.

### Environment variables

| Variable                         | Local                            | Azure                                                                       |
| -------------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`                   | `.env`                           | Key Vault `database-url`, already created by Bicep                          |
| `AUTH_SECRET`                    | `.env`, a local value only       | Key Vault `auth-secret`                                                     |
| `AUTH_URL`                       | Optional. Local dev can omit it. | `https://<container-app-fqdn>`, set by Bicep when auth is on. Not a secret. |
| `AUTH_TRUST_HOST`                | `true` in `.env`                 | Set in the app (`trustHost: true`). No Key Vault secret.                    |
| `AUTH_GOOGLE_ID`                 | `.env`, or empty                 | Key Vault `auth-google-id`                                                  |
| `AUTH_GOOGLE_SECRET`             | `.env`, or empty                 | Key Vault `auth-google-secret`                                              |
| `AUTH_MICROSOFT_ENTRA_ID_ID`     | `.env`, or empty                 | Key Vault `auth-microsoft-entra-id-id`                                      |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | `.env`, or empty                 | Key Vault `auth-microsoft-entra-id-secret`                                  |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | `.env`, or empty                 | Key Vault `auth-microsoft-entra-id-issuer`                                  |
| `AUTH_TEST_LOGIN`                | Playwright sets `true`           | Do not set it. `NODE_ENV=production` ignores it anyway.                     |

Use a different `AUTH_SECRET` in the staging vault and the prod vault. The Google client and the Entra app can be the same registration for both environments when both redirect URIs are on that app. Generate the secret with `openssl rand -base64 32`. Do not commit the output.

Versionless Key Vault references pick up a new secret version on their own. Container Apps checks within 30 minutes and restarts the revision. You do not have to deploy again only to rotate a secret. [Manage secrets in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets) describes that refresh.

### Redirect URIs

Auth.js uses these callback paths. The host is the Container App hostname, from the deployment output `containerAppFqdn` or:

```bash
az containerapp show \
  --name ca-wv-staging \
  --resource-group rg-wandervibe-staging \
  --query properties.configuration.ingress.fqdn \
  --output tsv
```

Use `ca-wv-prod` and `rg-wandervibe-prod` for production. Register all three origins on each provider. The platform is **Web**.

| Environment | Microsoft Entra ID                                            | Google                                            |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Local       | `http://localhost:3000/api/auth/callback/microsoft-entra-id`  | `http://localhost:3000/api/auth/callback/google`  |
| Staging     | `https://<staging-fqdn>/api/auth/callback/microsoft-entra-id` | `https://<staging-fqdn>/api/auth/callback/google` |
| Prod        | `https://<prod-fqdn>/api/auth/callback/microsoft-entra-id`    | `https://<prod-fqdn>/api/auth/callback/google`    |

If the hostname does not exist yet, register localhost first, deploy the platform, then add the staging and prod URIs before you try to sign in there. A wrong redirect URI fails at the provider. It does not stop the container from starting.

### Microsoft Entra ID

In the Microsoft Entra admin center, create an app registration named WanderVibe.

1. Choose who can sign in, and set the issuer to match. Do not use the `common` issuer. It accepts both work accounts and personal Microsoft accounts, and Entra does not verify work or school email addresses. This app does not link accounts that share an email, so a second provider becomes a second user, but `common` still widens who can attempt sign-in.
   - This directory only, which is the usual choice: `https://login.microsoftonline.com/<tenant-id>/v2.0`
   - Personal Microsoft accounts only: `https://login.microsoftonline.com/consumers/v2.0`
2. Add a **Web** redirect URI for each row in the table above. Do not use a SPA or mobile platform. Auth.js is a confidential server client.
3. Create a client secret and copy the **Value** once. That is `AUTH_MICROSOFT_ENTRA_ID_SECRET`. The secret expires. Write a new Key Vault version before it expires, then deploy so the revision picks it up.
4. Copy the Application (client) ID. That is `AUTH_MICROSOFT_ENTRA_ID_ID`. The Directory (tenant) ID is the `<tenant-id>` in a single-tenant issuer.
5. The provider asks for `openid`, `profile`, `email`, and `User.Read`. If the tenant requires admin consent, grant it for this app. Otherwise the sign-in stops on the consent screen.

### Google

In Google Cloud Console, configure the OAuth consent screen, then create an OAuth client ID.

1. Application type: **Web application**.
2. Authorized redirect URIs: the Google column above. Authorized JavaScript origins are not required for this server callback.
3. If the consent screen is in testing, add the Google account you will sign in with as a test user.
4. The client id is `AUTH_GOOGLE_ID`. The client secret is `AUTH_GOOGLE_SECRET`.

### Write the Key Vault secrets

Grant your user Key Vault Secrets Officer on the vault for this step, on your user, not on a CD identity. Remove the assignment when the secrets exist. A Privileged Identity Management eligible assignment is the same idea when the tenant has it. [docs/infra.md](infra.md) explains why that role can also read the database password.

`auth-secret` is always required once auth is on. Add the Google pair, the Entra trio, or both. Skip the commands for a provider you are not turning on.

Do not enable shell tracing (`set -x`) while you run this. `read -rs` does not echo the value, and the history records the prompt rather than the secret. The value is passed to Azure CLI through `--file`, not `--value`, so it is not an argument in the process list. `--output none` keeps the CLI from printing it. Unset each variable before the next prompt.

```bash
vault="<keyVaultName>"

secret="$(openssl rand -base64 32)"
az keyvault secret set --vault-name "$vault" --name auth-secret --file <(printf '%s' "$secret") --encoding utf-8 --output none
unset secret

# Google, when AUTH_GOOGLE_CONFIGURED=true
read -rsp "Google client id: " google_id
printf '\n'
az keyvault secret set --vault-name "$vault" --name auth-google-id --file <(printf '%s' "$google_id") --encoding utf-8 --output none
unset google_id
read -rsp "Google client secret: " google_secret
printf '\n'
az keyvault secret set --vault-name "$vault" --name auth-google-secret --file <(printf '%s' "$google_secret") --encoding utf-8 --output none
unset google_secret

# Entra, when AUTH_MICROSOFT_CONFIGURED=true
read -rsp "Entra application id: " entra_id
printf '\n'
az keyvault secret set --vault-name "$vault" --name auth-microsoft-entra-id-id --file <(printf '%s' "$entra_id") --encoding utf-8 --output none
unset entra_id
read -rsp "Entra client secret: " entra_secret
printf '\n'
az keyvault secret set --vault-name "$vault" --name auth-microsoft-entra-id-secret --file <(printf '%s' "$entra_secret") --encoding utf-8 --output none
unset entra_secret
read -rsp "Entra issuer URL: " entra_issuer
printf '\n'
az keyvault secret set --vault-name "$vault" --name auth-microsoft-entra-id-issuer --file <(printf '%s' "$entra_issuer") --encoding utf-8 --output none
unset entra_issuer
```

Repeat for the other environment's vault with a new `auth-secret`. Do not put the values in a parameter file, a GitHub variable, or a GitHub secret.

After that deploy, from an address on the allowlist, open `https://<fqdn>/signin` and complete Microsoft or Google. An unsigned request to `/` redirects to `/signin`. An unsigned request to any other API returns 401. `https://<fqdn>/api/health` and `https://<fqdn>/api/ready` return 200 with no session. Before the flag is true, `/` is the plain "not configured" page instead of the sign-in form.

### Opening ingress

Leave the parameter files at `restrictPublicAccess = true` until that sign-in works. `infra/tests/check-access-restrictions.sh` fails the build if a parameter file sets the flag to false.

A one-off override opens the hostname only until the next GitHub deploy, which applies `infra/cd.staging.bicepparam` or `infra/cd.prod.bicepparam` and closes it again:

```bash
az deployment group create \
  --name wandervibe-staging \
  --resource-group rg-wandervibe-staging \
  --template-file infra/cd.bicep \
  --parameters infra/cd.staging.bicepparam \
  --parameters containerImageTag="${sha}" \
  --parameters restrictPublicAccess=false
```

To keep ingress open, set `restrictPublicAccess = false` in both the main and the cd parameter file for that environment, and change the check script in the same commit. The deploy output `publicAccessRestricted` becomes false. The workflow then skips `gh-run-<run id>`, which is required: adding an Allow rule on an open list would lock the app to the runner. The smoke test still expects 200 from `/api/health` and `/api/ready` with no session.

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
