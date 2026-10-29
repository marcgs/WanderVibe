#!/usr/bin/env bash
# Copy the app and migration images into this environment's registry. Does not rebuild them.
# --registry is the source registry resource id. Import runs on the destination.
# The caller needs Container Registry Data Importer and Data Reader on the source and on the destination.
set -euo pipefail

dest_registry="${1:?destination registry name}"
source_registry_id="${2:?source registry resource id}"
tag="${3:?image tag}"
root="$(cd "$(dirname "$0")" && pwd)"
bash "${root}/require-image-tag.sh" "$tag"

import_one() {
  local name="$1"
  az acr import \
    --name "$dest_registry" \
    --registry "$source_registry_id" \
    --source "${name}:${tag}" \
    --image "${name}:${tag}" \
    --force
  echo "Imported ${name}:${tag} into ${dest_registry}."
}

import_one wandervibe
import_one wandervibe-migrate
