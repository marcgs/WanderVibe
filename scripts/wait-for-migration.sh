#!/usr/bin/env bash
# Start the migration job and wait until it succeeds. The bound is the job replica timeout.
set -euo pipefail

resource_group="${1:?resource group}"
job_name="${2:?job name}"
deadline_seconds="${MIGRATION_TIMEOUT_SECONDS:-600}"
sleep_seconds="${MIGRATION_POLL_SECONDS:-10}"

start_err="$(mktemp)"
trap 'rm -f "$start_err"' EXIT

execution=""
for attempt in 1 2 3 4 5 6; do
  if execution="$(az containerapp job start \
    --name "$job_name" \
    --resource-group "$resource_group" \
    --query name \
    --output tsv 2>"$start_err")"; then
    break
  fi
  if [[ "$attempt" -eq 6 ]]; then
    echo "Could not start ${job_name}." >&2
    cat "$start_err" >&2
    exit 1
  fi
  echo "Migration job start attempt ${attempt} failed; retrying." >&2
  cat "$start_err" >&2
  sleep "$sleep_seconds"
done

echo "Started migration execution ${execution}."
deadline=$((SECONDS + deadline_seconds))
status=""
while true; do
  status="$(az containerapp job execution show \
    --name "$job_name" \
    --resource-group "$resource_group" \
    --job-execution-name "$execution" \
    --query properties.status \
    --output tsv)"
  echo "Migration ${execution} status: ${status}"
  case "$status" in
    Succeeded)
      exit 0
      ;;
    Failed | Stopped | Degraded)
      az containerapp job logs show \
        --name "$job_name" \
        --resource-group "$resource_group" \
        --execution "$execution" \
        --container migrate || true
      exit 1
      ;;
  esac
  if ((SECONDS >= deadline)); then
    echo "Migration ${execution} did not succeed within ${deadline_seconds}s (last status: ${status})." >&2
    exit 1
  fi
  sleep "$sleep_seconds"
done
