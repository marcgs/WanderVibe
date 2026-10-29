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

`infra/cd.bicep` updates the migration job and the Container App. It references the registry, identity, vault, and Container Apps environment that `infra/main.bicep` already created. It does not set the Postgres password, write Key Vault secrets, or create role assignments. The CD identity therefore needs Contributor on each resource group, not `Microsoft.Authorization/roleAssignments/write`.

### GitHub Environments are `staging` and `prod`

The prod job sets `environment: prod`. That is the approval gate. Marc is the required reviewer, configured in GitHub, not in the workflow file. The staging job sets `environment: staging` and has no required reviewer.

The issue text says a GitHub Environment named `production`. This repository uses `prod` so the environment name, the resource group `rg-wandervibe-prod`, and the concurrency group `deploy-prod` are the same token.

A job that selects an environment presents that environment in the OIDC subject. The branch subject is a different credential. The CD identity has three federated credentials:

| Subject                                      | Job                                              |
| -------------------------------------------- | ------------------------------------------------ |
| `repo:marcgs/WanderVibe:ref:refs/heads/main` | Build and push. This job selects no environment. |
| `repo:marcgs/WanderVibe:environment:staging` | Staging migrate and deploy.                      |
| `repo:marcgs/WanderVibe:environment:prod`    | Prod import, migrate, and deploy.                |

`azure/login` receives `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID` as repository variables. There is no client secret, publish profile, or registry password.

### The CD identity's roles

One user-assigned identity (or one app registration) is the CD principal. Its standing roles are:

| Role        | Scope                   |
| ----------- | ----------------------- |
| AcrPush     | Staging registry        |
| AcrPush     | Prod registry           |
| Contributor | `rg-wandervibe-staging` |
| Contributor | `rg-wandervibe-prod`    |

AcrPush is what `docker push` and `az acr login` use. Contributor deploys `infra/cd.bicep`, starts the migration job, and edits ingress rules. It does not include Key Vault data-plane actions.

The identity has no Key Vault Secrets User, Key Vault Secrets Officer, Key Vault Administrator, Owner, or User Access Administrator role. The template still grants the app identity AcrPull on its registry and Key Vault Secrets User on its vault. Those assignments stay. The migration job runs as that app identity, so `prisma migrate deploy` reads `database-url` without the CD identity seeing the value.

A break-glass read or write outside Bicep is a role assignment on Marc's user, removed when the task is done. It is not a standing role on the CD identity. [docs/infra.md](../infra.md) already says a standing Secrets Officer assignment can read the database password.

### Migrations run in Azure

The `migrate` stage of the Dockerfile contains the Prisma CLI, the schema, and the migrations. A manual Container Apps job `job-wv-<environment>-migrate` runs `npx --no-install prisma migrate deploy` with `DATABASE_URL` as a Key Vault reference. The workflow deploys that job first, with `deployContainerApp=false`, so the running app keeps its current image. It waits for the execution to succeed, then deploys the app with the same tag.

The job replica timeout is 10 minutes. The workflow polls with the same bound. One replica runs. A failed migration does not change the Container App image.

### Runner rule

While `publicAccessRestricted` is true, the job resolves its egress address after Deploy, writes `RUNNER_CIDR=<ipv4>/32` to `$GITHUB_ENV`, and adds an Allow rule named `gh-run-<run id>`. `to_string` reads the deployment output so the value is the string `true`. The remove step is `if: always()` and deletes that rule only when `access-restriction list` shows it. Each deploy job uses concurrency group `deploy-staging` or `deploy-prod` with `cancel-in-progress: false`. The workflow also uses group `wandervibe-cd` with the same cancel setting, so a later commit waits instead of deploying over the commit that still holds a runner rule, and an older commit cannot finish after a newer one.

When `publicAccessRestricted` is false, the resolve and add steps are skipped. The remove step still runs. The rule is absent, and the open list stays empty.

### The workflow is safe to merge first

Deploy jobs run only when the repository variables in [docs/deploy.md](../deploy.md) are set. Until then a push to `main` skips them and succeeds. Pull requests do not run the deploy workflow. There is no Azure subscription in CI, so the live deploy, the live 403/200 check, and the live `what-if` stay for Marc.

## Consequences

- Marc creates the identity, the federated credentials, the role assignments, the GitHub environments, and the repository variables himself. The commands are in [docs/deploy.md](../deploy.md).
- The first platform deployment is still the manual `deployContainerApp=false` command in [docs/infra.md](../infra.md). CD then pushes the image, migrates, and creates the app with the commit SHA.
- Production waits on the `prod` environment. The next run waits until that run finishes, including the approval.
- Rollback redeploys an existing image tag. Prisma migrations are forward-only, so an older image does not undo a migration that already ran.
- A Contributor on the resource group can change more than the container image. That is the deployment role this story uses. It is still not a Key Vault data-plane role.

## Alternatives considered

- **Run `prisma migrate deploy` on the GitHub runner.** The runner is not an Azure service, so the Postgres firewall refuses it. Opening the firewall to the runner, or to every address, is the wider network this project already rejected.
- **Give the CD identity Key Vault Secrets User.** The workflow could then read `database-url`. That is a standing data-plane role. The migration job uses the app identity instead.
- **Store `DATABASE_URL` or a client secret in GitHub Actions secrets.** Both are long-lived credentials in GitHub. OIDC and the Key Vault reference avoid that.
- **Name the GitHub Environment `production`.** It matches the issue text and disagrees with `rg-wandervibe-prod` and `deploy-prod`. `prod` keeps one name.
- **One federated credential for `refs/heads/main` on every job.** A job that sets `environment:` does not present the branch subject. Staging and prod need their own credentials. The main credential remains the one the build job uses.
- **Redeploy `infra/main.bicep` on every CD run.** That deployment sends the Postgres password and the role assignments. CD would need the password and `roleAssignments/write`. `infra/cd.bicep` updates the image and the job only.
