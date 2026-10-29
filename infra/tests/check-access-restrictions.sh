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

tmp="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp}"
}
trap cleanup EXIT

echo "Running client-side ingress rule tests (experimental Bicep test framework, infra/tests only)."
bicep test infra/tests/ingress-rules.test.bicep

rejected_log="${tmp}/rejected.log"
set +e
bicep test infra/tests/ingress-rules-rejected.test.bicep >"${rejected_log}" 2>&1
rejected_status=$?
set -e
if [[ "${rejected_status}" -eq 0 ]]; then
  echo "Expected invalid CIDRs to fail."
  cat "${rejected_log}"
  exit 1
fi
expect_rejection() {
  local needle="$1"
  if ! grep -F "${needle}" "${rejected_log}" >/dev/null; then
    echo "Missing rejection: ${needle}"
    cat "${rejected_log}"
    exit 1
  fi
}
expect_rejection "to /32: 203.0.113.10/3"
expect_rejection "to /32: 0.0.0.0/1"
expect_rejection "to /32: 1.2.3.4/00"
expect_rejection "to /32: foo/32"
expect_rejection "to /32: 1.2.3.256/32"
expect_rejection "to /32: 2001:db8::/64"
expect_rejection "to /32: 01.2.3.4/32"
expect_rejection "to /32: 1.2.3.4/32/1"
expect_rejection "from /16 to /32: 203.0.113.0/15"
expect_rejection "from /24 to /32: 198.51.100.0/20"
# The bare address is followed by the runtime's period, so it does not match 1.2.3.4/00.
if ! grep -E 'to /32: 1\.2\.3\.4([^0-9/]|$)' "${rejected_log}" >/dev/null; then
  echo "Missing rejection: 1.2.3.4"
  cat "${rejected_log}"
  exit 1
fi
echo "Rejected allowlists failed closed."

build_log="${tmp}/build.log"
if ! bicep build infra/main.bicep --outfile "${tmp}/main.json" >"${build_log}" 2>&1; then
  cat "${build_log}"
  exit 1
fi
if grep -i experimental "${build_log}"; then
  echo "infra/main.bicep must not enable experimental Bicep features."
  exit 1
fi

python3 - "${tmp}/main.json" <<'PY'
import json
import sys

template = json.load(open(sys.argv[1]))
parameters = template["parameters"]
for name in ("allowedIpRanges", "restrictPublicAccess", "minAllowedPrefixLength"):
    if name not in parameters:
        raise SystemExit(f"missing parameter {name}")
if parameters["allowedIpRanges"].get("defaultValue") != []:
    raise SystemExit("allowedIpRanges must default to an empty array")
if parameters["restrictPublicAccess"].get("defaultValue") is not True:
    raise SystemExit("restrictPublicAccess must default to true")
if parameters["allowedIpRanges"].get("maxLength") != 32:
    raise SystemExit("allowedIpRanges must allow at most 32 CIDRs")
if parameters["minAllowedPrefixLength"].get("defaultValue") != 16:
    raise SystemExit("minAllowedPrefixLength must default to 16")
if parameters["minAllowedPrefixLength"].get("minValue") != 8:
    raise SystemExit("minAllowedPrefixLength must not allow a prefix shorter than /8")
if parameters["minAllowedPrefixLength"].get("maxValue") != 32:
    raise SystemExit("minAllowedPrefixLength must cap at 32")

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

POSTGRES_ADMIN_PASSWORD="$(openssl rand -hex 24)"
export POSTGRES_ADMIN_PASSWORD
unset WANDER_ALLOWED_IP_RANGES || true

check_params() {
  local file="$1"
  local expected="$2"
  local outfile
  outfile="${tmp}/$(basename "${file}").json"
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
