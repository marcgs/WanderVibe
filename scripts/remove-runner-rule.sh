#!/usr/bin/env bash
# Remove gh-run-<run id> when it is present.
# A missing rule is a no-op. A failed list or remove still fails the job.
# The sentinel and operator rules are not named here, so they stay.
set -euo pipefail

resource_group="${1:?resource group}"
app_name="${2:?container app name}"
rule_name="${3:?rule name}"

if [[ ! "$rule_name" =~ ^gh-run-[0-9]+$ ]]; then
  echo "Refusing to remove unexpected rule name: ${rule_name}" >&2
  exit 1
fi

show_err="$(mktemp)"
trap 'rm -f "$show_err"' EXIT
if ! az containerapp show --name "$app_name" --resource-group "$resource_group" --query name --output tsv >"$show_err" 2>&1; then
  if grep -Eqi 'ResourceNotFound|was not found|could not be found' "$show_err"; then
    echo "Container App ${app_name} does not exist; nothing to remove."
    exit 0
  fi
  cat "$show_err" >&2
  exit 1
fi

present="$(az containerapp ingress access-restriction list \
  --resource-group "$resource_group" \
  --name "$app_name" \
  --query "length([?name=='${rule_name}'])" \
  --output tsv)"
if [[ "$present" != "0" ]]; then
  az containerapp ingress access-restriction remove \
    --resource-group "$resource_group" \
    --name "$app_name" \
    --rule-name "$rule_name"
  echo "Removed ${rule_name}."
else
  echo "${rule_name} not present; nothing to remove."
fi
