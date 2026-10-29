#!/usr/bin/env bash
# Refuse a deploy that would roll out a missing tag or the placeholder "initial".
# Continuous deployment uses the full git commit SHA.
set -euo pipefail

tag="${1:-}"
if [[ ! "$tag" =~ ^[0-9a-f]{40}$ ]]; then
  echo "containerImageTag must be the full commit SHA (40 lowercase hex digits). An empty tag, initial, or any other value is refused." >&2
  exit 1
fi
