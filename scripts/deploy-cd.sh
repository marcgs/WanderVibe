#!/usr/bin/env bash
# Deploy infra/cd.bicep. Operator ranges come from WANDER_ALLOWED_IP_RANGES.
# The runner allow rule is a later step and is not an input to this deployment.
set -euo pipefail

parameter_file="${1:?parameter file}"
deployment_name="${2:?deployment name}"
resource_group="${3:?resource group}"
image_tag="${4:?image tag}"
deploy_app="${5:?deployContainerApp}"
deploy_job="${6:?deployMigrationJob}"
root="$(cd "$(dirname "$0")/.." && pwd)"

bash "${root}/scripts/require-image-tag.sh" "$image_tag"
case "$deploy_app" in
  true | false) ;;
  *)
    echo "deployContainerApp must be true or false." >&2
    exit 1
    ;;
esac
case "$deploy_job" in
  true | false) ;;
  *)
    echo "deployMigrationJob must be true or false." >&2
    exit 1
    ;;
esac

cd "$root"
az deployment group create \
  --name "$deployment_name" \
  --resource-group "$resource_group" \
  --template-file infra/cd.bicep \
  --parameters "$parameter_file" \
  --parameters "containerImageTag=${image_tag}" \
  --parameters "deployContainerApp=${deploy_app}" \
  --parameters "deployMigrationJob=${deploy_job}" \
  --query "{restricted: to_string(properties.outputs.publicAccessRestricted.value), fqdn: properties.outputs.containerAppFqdn.value, job: properties.outputs.migrationJobName.value}" \
  --output json
