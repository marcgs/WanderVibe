#!/usr/bin/env bash
# Copy the app and migration images into this environment's registry. Does not rebuild them.
set -euo pipefail

dest_registry="${1:?destination registry name}"
source_login_server="${2:?source login server}"
tag="${3:?image tag}"
root="$(cd "$(dirname "$0")" && pwd)"
bash "${root}/require-image-tag.sh" "$tag"

import_one() {
  local name="$1"
  az acr import \
    --name "$dest_registry" \
    --source "${source_login_server}/${name}:${tag}" \
    --image "${name}:${tag}" \
    --force
  echo "Imported ${name}:${tag} into ${dest_registry}."
}

import_one wandervibe
import_one wandervibe-migrate
