#!/usr/bin/env bash
# Call /api/health and /api/ready until both return 200 {"status":"ok"}, or the bound is hit.
# Retries cover scale-to-zero cold start. They do not turn a permanent 403 into a 200.
set -euo pipefail

origin="${1:?origin, for example https://app.example}"
attempts="${SMOKE_ATTEMPTS:-30}"
sleep_seconds="${SMOKE_SLEEP_SECONDS:-10}"

check() {
  local path="$1"
  local attempt code
  for attempt in $(seq 1 "$attempts"); do
    code="$(curl --ipv4 --silent --show-error --max-time 10 \
      --output /tmp/wandervibe-smoke.txt --write-out '%{http_code}' \
      "${origin}${path}" || true)"
    if [[ "$code" == "200" ]] && python3 -c 'import json,sys; body=json.load(open("/tmp/wandervibe-smoke.txt")); sys.exit(0 if body.get("status")=="ok" else 1)'; then
      echo "${path} returned 200"
      return 0
    fi
    echo "${path} attempt ${attempt}/${attempts} returned ${code}"
    if [[ "$attempt" -lt "$attempts" ]]; then
      sleep "$sleep_seconds"
    fi
  done
  echo "${path} did not return 200 with status ok" >&2
  cat /tmp/wandervibe-smoke.txt >&2 || true
  return 1
}

check /api/health
check /api/ready
