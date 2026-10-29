#!/usr/bin/env bash
# Print whether staging and prod deploys should run.
# A missing repository variable skips that deploy instead of failing the workflow.
set -euo pipefail

target="${DEPLOY_TARGET:-both}"
case "$target" in
  both | staging | prod) ;;
  *)
    echo "DEPLOY_TARGET must be both, staging, or prod." >&2
    exit 1
    ;;
esac

staging=false
prod=false
if [[ -n "${AZURE_CLIENT_ID:-}" && -n "${AZURE_TENANT_ID:-}" && -n "${AZURE_SUBSCRIPTION_ID:-}" && -n "${STAGING_AZURE_RESOURCE_GROUP:-}" && -n "${STAGING_AZURE_CONTAINER_REGISTRY:-}" ]]; then
  staging=true
fi
if [[ "$staging" == true && -n "${PROD_AZURE_RESOURCE_GROUP:-}" && -n "${PROD_AZURE_CONTAINER_REGISTRY:-}" ]]; then
  prod=true
fi
if [[ "$target" == prod ]]; then
  staging=false
fi
if [[ "$target" == staging ]]; then
  prod=false
fi

printf 'staging=%s\n' "$staging"
printf 'prod=%s\n' "$prod"
