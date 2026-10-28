#!/usr/bin/env bash
# Checks the Container App ingress allowlist without an Azure subscription.
# Requires Bicep CLI 0.48.x on PATH (the same binary the bicep CI job installs).
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

if ! command -v bicep >/dev/null 2>&1; then
  echo "bicep is not on PATH"
  exit 1
fi

extract_rules() {
  awk '
    /ingress-ip-rules:begin/ { flag = 1; next }
    /ingress-ip-rules:end/ { flag = 0 }
    flag { print }
  ' "$1"
}

app_rules="$(extract_rules infra/modules/container-app.bicep)"
test_rules="$(extract_rules infra/tests/ingress-rules.bicep)"
if [[ -z "${app_rules}" || -z "${test_rules}" ]]; then
  echo "ingress-ip-rules markers are missing"
  exit 1
fi
diff -u \
  --label infra/modules/container-app.bicep \
  --label infra/tests/ingress-rules.bicep \
  <(printf '%s\n' "${app_rules}") \
  <(printf '%s\n' "${test_rules}")

if grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}' infra/*.bicepparam; then
  echo "Parameter files must not contain IP addresses."
  exit 1
fi
if grep -nE 'restrictPublicAccess[[:space:]]*=[[:space:]]*false' infra/*.bicepparam; then
  echo "Parameter files must keep restrictPublicAccess true until story #15."
  exit 1
fi
for file in infra/main.staging.bicepparam infra/main.prod.bicepparam; do
  if ! grep -q "readEnvironmentVariable('WANDER_ALLOWED_IP_RANGES', '')" "${file}"; then
    echo "${file} must read WANDER_ALLOWED_IP_RANGES."
    exit 1
  fi
  if ! grep -q 'param restrictPublicAccess = true' "${file}"; then
    echo "${file} must set restrictPublicAccess = true."
    exit 1
  fi
done

echo "Running client-side ingress rule tests (experimental Bicep test framework, infra/tests only)."
bicep test infra/tests/ingress-rules.test.bicep

rejected_log="$(mktemp)"
set +e
bicep test infra/tests/ingress-rules-rejected.test.bicep >"${rejected_log}" 2>&1
rejected_status=$?
set -e
if [[ "${rejected_status}" -eq 0 ]]; then
  echo "Expected a /0 prefix and a value without a slash to fail."
  cat "${rejected_log}"
  rm -f "${rejected_log}"
  exit 1
fi
if ! grep -F "must not contain a /0 prefix" "${rejected_log}" >/dev/null; then
  echo "Missing /0 rejection."
  cat "${rejected_log}"
  rm -f "${rejected_log}"
  exit 1
fi
if ! grep -F "must be an IPv4 CIDR" "${rejected_log}" >/dev/null; then
  echo "Missing CIDR rejection."
  cat "${rejected_log}"
  rm -f "${rejected_log}"
  exit 1
fi
rm -f "${rejected_log}"
echo "Rejected allowlists failed closed."

tmp="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp}"
}
trap cleanup EXIT

build_log="$(mktemp)"
if ! bicep build infra/main.bicep --outfile "${tmp}/main.json" >"${build_log}" 2>&1; then
  cat "${build_log}"
  exit 1
fi
if grep -i experimental "${build_log}"; then
  echo "infra/main.bicep must not enable experimental Bicep features."
  exit 1
fi
rm -f "${build_log}"

python3 - "${tmp}/main.json" <<'PY'
import json
import sys

template = json.load(open(sys.argv[1]))
parameters = template["parameters"]
for name in ("allowedIpRanges", "restrictPublicAccess"):
    if name not in parameters:
        raise SystemExit(f"missing parameter {name}")
if parameters["allowedIpRanges"].get("defaultValue") != []:
    raise SystemExit("allowedIpRanges must default to an empty array")
if parameters["restrictPublicAccess"].get("defaultValue") is not True:
    raise SystemExit("restrictPublicAccess must default to true")
if parameters["allowedIpRanges"].get("maxLength") != 32:
    raise SystemExit("allowedIpRanges must allow at most 32 CIDRs")

app = template["resources"]["containerApp"]["properties"]["template"]
ingress = app["resources"]["app"]["properties"]["configuration"]["ingress"]
if ingress.get("external") is not True:
    raise SystemExit("ingress stays external so clients outside the allowlist receive HTTP 403")
if ingress.get("ipSecurityRestrictions") != "[variables('ipSecurityRestrictions')]":
    raise SystemExit(f"ingress is not bound to the allowlist rules: {ingress.get('ipSecurityRestrictions')}")

rules = app["variables"]["closedAllowlistRule"]
if rules != [
    {
        "name": "closed-until-allowlist",
        "description": "Empty allowlist. This documentation address is not a client.",
        "ipAddressRange": "192.0.2.1/32",
        "action": "Allow",
    }
]:
    raise SystemExit(f"unexpected closed allowlist rule: {rules}")

rendered = json.dumps(template)
if "0.0.0.0/0" in rendered:
    raise SystemExit("the template must not contain 0.0.0.0/0")
if "Deny" in rendered:
    raise SystemExit("ingress rules must be Allow-only")
if '"action": "Allow"' not in rendered:
    raise SystemExit("missing Allow action")
PY

export POSTGRES_ADMIN_PASSWORD="$(openssl rand -hex 24)"
unset WANDER_ALLOWED_IP_RANGES || true

check_params() {
  local file="$1"
  local expected="$2"
  local outfile="${tmp}/$(basename "${file}").json"
  bicep build-params "${file}" --outfile "${outfile}"
  python3 - "${outfile}" "${expected}" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1]))
allowed = data["parameters"]["allowedIpRanges"]["value"]
restricted = data["parameters"]["restrictPublicAccess"]["value"]
expected = json.loads(sys.argv[2])
if allowed != expected or restricted is not True:
    raise SystemExit(f"unexpected {sys.argv[1]}: allowed={allowed!r} restricted={restricted!r}")
PY
  rm -f "${outfile}"
}

check_params infra/main.staging.bicepparam "[]"
check_params infra/main.prod.bicepparam "[]"

export WANDER_ALLOWED_IP_RANGES="203.0.113.10/32, 198.51.100.0/24,"
check_params infra/main.staging.bicepparam '["203.0.113.10/32","198.51.100.0/24"]'
check_params infra/main.prod.bicepparam '["203.0.113.10/32","198.51.100.0/24"]'

export WANDER_ALLOWED_IP_RANGES=", ,"
check_params infra/main.staging.bicepparam "[]"

echo "Ingress allowlist checks passed."
