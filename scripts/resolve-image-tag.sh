#!/usr/bin/env bash
# Resolve the image tag for this run.
# An empty request deploys github.sha and builds it.
# A different full SHA is a rollback: do not rebuild this checkout under that tag.
set -euo pipefail

requested="${1:-}"
sha="${2:?github sha}"
root="$(cd "$(dirname "$0")" && pwd)"

if [[ -z "$requested" ]]; then
  tag="$sha"
else
  tag="$requested"
fi
bash "${root}/require-image-tag.sh" "$tag"

if [[ "$tag" == "$sha" ]]; then
  build=true
else
  build=false
fi

printf 'image_tag=%s\n' "$tag"
printf 'build=%s\n' "$build"
