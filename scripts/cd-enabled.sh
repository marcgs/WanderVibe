#!/usr/bin/env bash
# Print whether staging and prod deploys should run.
# A missing repository variable skips that deploy instead of failing the workflow.
# AZURE_CLIENT_ID is a GitHub Environment variable, so this script cannot see it.
# The build job selects the staging environment and uses that environment's client id.
set -euo pipefail

target="${DEPLOY_TARGET:-both}"
case "$target" in
  both | staging) ;;
  *)
    echo "DEPLOY_TARGET must be both or staging." >&2
    exit 1
    ;;
esac

staging=false
prod=false
if [[ -n "${AZURE_TENANT_ID:-}" && -n "${AZURE_SUBSCRIPTION_ID:-}" && -n "${STAGING_AZURE_RESOURCE_GROUP:-}" && -n "${STAGING_AZURE_CONTAINER_REGISTRY:-}" ]]; then
  staging=true
fi
# PROD_GATE_CONFIRMED is set only after the prod environment has a required reviewer.
# Without it, the first prod job can create that environment with no reviewer.
if [[ "$staging" == true && -n "${PROD_AZURE_RESOURCE_GROUP:-}" && -n "${PROD_AZURE_CONTAINER_REGISTRY:-}" && "${PROD_GATE_CONFIRMED:-}" == true ]]; then
  prod=true
fi
if [[ "$target" == staging ]]; then
  prod=false
fi

printf 'staging=%s\n' "$staging"
printf 'prod=%s\n' "$prod"
