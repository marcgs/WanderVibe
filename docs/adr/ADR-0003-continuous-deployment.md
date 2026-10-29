# ADR-0003: Continuous deployment

## Status

Accepted

## Date

2026-10-29

## Context

Story #14 deploys the container from GitHub Actions after a merge to `main`. Staging follows that merge. Production waits for Marc. Azure login uses OIDC, so the repository stores no client secret. PR #21 left the CD identity with no AcrPush role and no Key Vault data-plane role. PR #27 closed ingress until sign-in and described how a GitHub-hosted runner reaches `/api/health` and `/api/ready`.

Postgres allows only Azure services. A GitHub-hosted runner cannot open a database connection. The app identity already has Key Vault Secrets User. The CD identity must not.

## Decision

### One image build, then two deploys

`.github/workflows/deploy.yml` runs on a push to `main` and on `workflow_dispatch`. It builds `wandervibe:<full-sha>` and `wandervibe-migrate:<full-sha>` once and pushes both to the staging registry. The staging job migrates and deploys that tag. The prod job imports the same two tags into the prod registry and deploys them. It does not build again.

The image tag is the full 40-character commit SHA. `scripts/require-image-tag.sh` rejects anything else before `az deployment group create`. `infra/modules/image-tag.bicep` calls `fail()` when `deployContainerApp` or `deployMigrationJob` is true and the tag is empty or `initial`. Parameter files do not set a tag. A manual deploy may still pass a short SHA. An empty tag or `initial` does not roll out a revision.

`infra/cd.bicep` updates the migration job and the Container App. It references the registry, identity, vault, and Container Apps environment that `infra/main.bicep` already created. It does not set the Postgres password, write Key Vault secrets, or create role assignments. Each CD identity therefore needs a deployment role on its own resource group, not `Microsoft.Authorization/roleAssignments/write`.

The prod job runs only when the staging job in the same workflow run succeeded. Both jobs receive `needs.build.outputs.image_tag`, so prod cannot publish a SHA that staging did not just deploy and smoke-test. There is no prod-only workflow target.

### GitHub Environments are `staging` and `prod`

The build job and the staging deploy job set `environment: staging`. The prod job sets `environment: prod`. That is the approval gate. Marc is the required reviewer, configured in GitHub, not in the workflow file. Staging has no required reviewer.

The issue text originally said a GitHub Environment named `production`. This repository uses `prod` so the environment name, the resource group `rg-wandervibe-prod`, and the concurrency group `deploy-prod` are the same token.

A job that selects an environment presents that environment in the OIDC subject. There is no branch subject. Each identity has one federated credential:

| Identity           | Subject                                      | Jobs                                         |
| ------------------ | -------------------------------------------- | -------------------------------------------- |
| `id-wv-cd-staging` | `repo:marcgs/WanderVibe:environment:staging` | Build, push, staging migrate, staging deploy |
| `id-wv-cd-prod`    | `repo:marcgs/WanderVibe:environment:prod`    | Prod import, migrate, and deploy             |

Every `azure/login` step is in a job that sets `environment:`. `AZURE_CLIENT_ID` is an environment variable, so the staging jobs log in as `id-wv-cd-staging` and the prod job logs in as `id-wv-cd-prod`. Tenant id and subscription id are repository variables. There is no client secret, publish profile, or registry password. A job without `environment:` cannot obtain a token, because neither identity trusts `ref:refs/heads/main`.

`PROD_GATE_CONFIRMED` must be the repository value `true` before the prod job is queued. GitHub would otherwise create a missing `prod` environment with no required reviewer the first time a job selected it.

### The CD identity's roles

| Role                                             | Principal          | Scope                   |
| ------------------------------------------------ | ------------------ | ----------------------- |
| AcrPush                                          | `id-wv-cd-staging` | Staging registry        |
| Contributor                                      | `id-wv-cd-staging` | `rg-wandervibe-staging` |
| AcrPull                                          | `id-wv-cd-prod`    | Staging registry        |
| Container Registry Data Importer and Data Reader | `id-wv-cd-prod`    | Prod registry           |
| AcrPush                                          | `id-wv-cd-prod`    | Prod registry           |
| Contributor                                      | `id-wv-cd-prod`    | `rg-wandervibe-prod`    |

Staging can push only to the staging registry. Prod can pull from the staging registry and cannot push to it or import into it. Prod can push and import on the prod registry. Neither identity has a role assignment on the other environment's resource group.

AcrPull (`7f951dda-4ed3-4680-a7ca-43fe172d538d`) allows only `Microsoft.ContainerRegistry/registries/pull/read`. Container Registry Data Importer and Data Reader (`577a9874-89fd-4f24-9dbd-b5034d0ad23a`) also allows `Microsoft.ContainerRegistry/registries/importImage/action` on the registry it is assigned to, so assigning it on staging would let the prod identity import images into staging. The registries are Basic. Repository ABAC roles such as Container Registry Repository Reader require Premium, so AcrPull is the read-only role on the source. `az acr import` with `--registry` set to the staging registry resource id and `--source` set to `repository:tag` calls `importImage` on the prod registry, where the importer role is assigned, and pulls the source with the caller's token. AcrPull authorizes that pull. The importer role is not assigned on the staging registry.

Contributor is the deployment role until [#29](https://github.com/marcgs/WanderVibe/issues/29). On the resource group it can do more than deploy the container:

- Reset the Postgres administrator password and open the server firewall (`Microsoft.DBforPostgreSQL/flexibleServers/write`).
- Delete Key Vault, Postgres, or the registry.
- Read Container App and job secret values with `listSecrets`.

It still does not include a Key Vault data-plane role. The template grants the app identity AcrPull on its registry and Key Vault Secrets User on its vault. The migration job runs as that app identity, so `prisma migrate deploy` reads `database-url` without either CD identity seeing the value.

Contributor is accepted here because this is a personal project and the narrower role was not going to be proven without a subscription. A custom role is easy to get wrong: "Container Apps Contributor" is missing `Microsoft.Resources/deployments/*` and the managed-identity `assign/action`, and it can still call `listSecrets`. [#29](https://github.com/marcgs/WanderVibe/issues/29) replaces Contributor with a custom role. The action list from the PR #28 review is the one that issue uses:

- `Microsoft.Resources/subscriptions/resourceGroups/read`
- `Microsoft.Resources/deployments/*`
- `Microsoft.App/managedEnvironments/read` and `Microsoft.App/managedEnvironments/join/action`
- `Microsoft.App/containerApps/read`, `Microsoft.App/containerApps/write`, and `Microsoft.App/containerApps/revisions/read`
- `Microsoft.App/jobs/read`, `Microsoft.App/jobs/write`, `Microsoft.App/jobs/start/action`, and `Microsoft.App/jobs/executions/read`
- `Microsoft.ManagedIdentity/userAssignedIdentities/read` and `Microsoft.ManagedIdentity/userAssignedIdentities/assign/action`
- `Microsoft.ContainerRegistry/registries/read`
- `Microsoft.App/locations/*/read` if a live run is denied while polling Container Apps status

That list is also in [the review comment](https://github.com/marcgs/WanderVibe/pull/28#issuecomment-6490957748). The registry data roles stay outside it. AcrPush is the push role on the registry that identity pushes to. Container Registry Data Importer and Data Reader is the import role, and only on the prod registry. AcrPull is the prod identity's role on the staging registry. While Contributor is assigned on the resource group that contains a registry, AcrPush and the importer role on that same registry are redundant in non-ABAC mode, because Contributor already includes registry push, pull, and import. Those assignments stay so the registry rights are still explicit when #29 removes Contributor. AcrPull on the staging registry is not redundant: the prod identity has no Contributor assignment there.

Neither CD identity has Key Vault Secrets User, Key Vault Secrets Officer, Key Vault Administrator, Owner, or User Access Administrator. A break-glass read or write outside Bicep is a role assignment on Marc's user, removed when the task is done. [docs/infra.md](../infra.md) already says a standing Secrets Officer assignment can read the database password.

### Migrations run in Azure

The `migrate` stage of the Dockerfile contains the Prisma CLI, the schema, and the migrations. A manual Container Apps job `job-wv-<environment>-migrate` runs `npx --no-install prisma migrate deploy` with `DATABASE_URL` as a Key Vault reference. The workflow deploys that job first, with `deployContainerApp=false`, so the running app keeps its current image. It waits for the execution to succeed, then deploys the app with the same tag.

The job replica timeout is 10 minutes. The workflow waits 12 minutes, so image pull fits inside the wait, and then stops the execution. One replica runs. A failed migration does not change the Container App image. A failed start does not start a second execution while one is already running.

### Runner rule

While `publicAccessRestricted` is true, the job resolves its egress address after Deploy, writes `RUNNER_CIDR=<ipv4>/32` to `$GITHUB_ENV`, and adds an Allow rule named `gh-run-<run id>`. `to_string` reads the deployment output so the value is the string `true`. The remove step is `if: always() && steps.login.outcome == 'success'` and deletes that rule only when `access-restriction list` shows it. A failed login does not try to remove a rule that was never added. Each deploy job uses concurrency group `deploy-staging` or `deploy-prod` with `cancel-in-progress: false`. Those groups are separate, so a pending prod approval does not block the next staging deploy.

When `publicAccessRestricted` is false, the resolve and add steps are skipped. The remove step still runs. The rule is absent, and the open list stays empty.

### The workflow is safe to merge first

Deploy jobs run only when the repository variables in [docs/deploy.md](../deploy.md) are set. Until then a push to `main` skips them and succeeds. Pull requests do not run the deploy workflow. There is no Azure subscription in CI, so the live deploy, the live 403/200 check, and the live `what-if` stay for Marc.

## Consequences

- Marc creates the identity, the federated credentials, the role assignments, the GitHub environments, and the repository variables himself. The commands are in [docs/deploy.md](../deploy.md).
- The first platform deployment is still the manual `deployContainerApp=false` command in [docs/infra.md](../infra.md). CD then pushes the image, migrates, and creates the app with the commit SHA.
- Production waits on the `prod` environment, and only after staging for that SHA succeeded in the same run. A prod approval does not block the next staging deploy.
- Rollback redeploys an existing image tag through staging first. Prisma migrations are forward-only, so an older image does not undo a migration that already ran.
- Contributor on each environment resource group is temporary. [#29](https://github.com/marcgs/WanderVibe/issues/29) replaces it. Until then it can reset the database password, open the firewall, delete the vault, database, or registry, and read app and job secrets with `listSecrets`.

## Alternatives considered

- **Run `prisma migrate deploy` on the GitHub runner.** The runner is not an Azure service, so the Postgres firewall refuses it. Opening the firewall to the runner, or to every address, is the wider network this project already rejected.
- **Give the CD identity Key Vault Secrets User.** The workflow could then read `database-url`. That is a standing data-plane role. The migration job uses the app identity instead.
- **Store `DATABASE_URL` or a client secret in GitHub Actions secrets.** Both are long-lived credentials in GitHub. OIDC and the Key Vault reference avoid that.
- **Name the GitHub Environment `production`.** It matches the issue text and disagrees with `rg-wandervibe-prod` and `deploy-prod`. `prod` keeps one name.
- **A `ref:refs/heads/main` credential for the build.** That subject is presented by every job on `main` that does not select an environment, including CI. The build job selects `staging` instead, and `id-wv-cd-staging` trusts only that environment.
- **One identity with Contributor on both resource groups.** The staging credential could then deploy prod with no approval. The identities are split, and neither has a role on the other resource group.
- **Redeploy `infra/main.bicep` on every CD run.** That deployment sends the Postgres password and the role assignments. CD would need the password and `roleAssignments/write`. `infra/cd.bicep` updates the image and the job only.
