#!/usr/bin/env bash
# Checks the continuous-deployment workflow and the image-tag guard without Azure.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

if ! command -v bicep >/dev/null 2>&1; then
  echo "bicep is not on PATH"
  exit 1
fi

fail() {
  echo "$1" >&2
  exit 1
}

sha="0123456789abcdef0123456789abcdef01234567"
other="fedcba9876543210fedcba9876543210fedcba98"

expect_fail() {
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail "expected failure: ${description}"
  fi
}

bash scripts/require-image-tag.sh "$sha"
expect_fail "empty tag" bash scripts/require-image-tag.sh
expect_fail "initial tag" bash scripts/require-image-tag.sh initial
expect_fail "short sha" bash scripts/require-image-tag.sh abcdef1
expect_fail "uppercase sha" bash scripts/require-image-tag.sh ABCDEF0123456789ABCDEF0123456789ABCDEF01

read_lines() {
  local file="$1"
  image_tag="$(awk -F= '/^image_tag=/{print $2}' "$file")"
  build="$(awk -F= '/^build=/{print $2}' "$file")"
}

out="$(mktemp)"
bash scripts/resolve-image-tag.sh "" "$sha" >"$out"
read_lines "$out"
[[ "$image_tag" == "$sha" && "$build" == true ]] || fail "empty request should build github.sha"
bash scripts/resolve-image-tag.sh "$sha" "$sha" >"$out"
read_lines "$out"
[[ "$image_tag" == "$sha" && "$build" == true ]] || fail "matching sha should build"
bash scripts/resolve-image-tag.sh "$other" "$sha" >"$out"
read_lines "$out"
[[ "$image_tag" == "$other" && "$build" == false ]] || fail "rollback tag must not rebuild"
expect_fail "rollback initial" bash scripts/resolve-image-tag.sh initial "$sha"

cd_lines() {
  local file="$1"
  staging="$(awk -F= '/^staging=/{print $2}' "$file")"
  prod="$(awk -F= '/^prod=/{print $2}' "$file")"
}

run_cd() {
  env -u AZURE_TENANT_ID -u AZURE_SUBSCRIPTION_ID \
    -u STAGING_AZURE_RESOURCE_GROUP -u STAGING_AZURE_CONTAINER_REGISTRY \
    -u PROD_AZURE_RESOURCE_GROUP -u PROD_AZURE_CONTAINER_REGISTRY \
    -u PROD_GATE_CONFIRMED -u AZURE_BUILD_CLIENT_ID -u AZURE_CLIENT_ID \
    "$@" bash scripts/cd-enabled.sh >"$out"
}

run_cd
cd_lines "$out"
[[ "$staging" == false && "$prod" == false ]] || fail "unset variables should skip both"
run_cd \
  AZURE_TENANT_ID=tenant AZURE_SUBSCRIPTION_ID=sub \
  STAGING_AZURE_RESOURCE_GROUP=rg-wandervibe-staging STAGING_AZURE_CONTAINER_REGISTRY=acrstaging
cd_lines "$out"
[[ "$staging" == true && "$prod" == false ]] || fail "staging variables should skip prod"
run_cd \
  AZURE_TENANT_ID=tenant AZURE_SUBSCRIPTION_ID=sub \
  STAGING_AZURE_RESOURCE_GROUP=rg-wandervibe-staging STAGING_AZURE_CONTAINER_REGISTRY=acrstaging \
  PROD_AZURE_RESOURCE_GROUP=rg-wandervibe-prod PROD_AZURE_CONTAINER_REGISTRY=acrprod
cd_lines "$out"
[[ "$staging" == true && "$prod" == false ]] || fail "prod stays off until the reviewer gate is confirmed"
run_cd \
  AZURE_TENANT_ID=tenant AZURE_SUBSCRIPTION_ID=sub \
  STAGING_AZURE_RESOURCE_GROUP=rg-wandervibe-staging STAGING_AZURE_CONTAINER_REGISTRY=acrstaging \
  PROD_AZURE_RESOURCE_GROUP=rg-wandervibe-prod PROD_AZURE_CONTAINER_REGISTRY=acrprod \
  PROD_GATE_CONFIRMED=true
cd_lines "$out"
[[ "$staging" == true && "$prod" == true ]] || fail "confirmed prod gate should enable prod"
run_cd DEPLOY_TARGET=staging \
  AZURE_TENANT_ID=tenant AZURE_SUBSCRIPTION_ID=sub \
  STAGING_AZURE_RESOURCE_GROUP=rg-wandervibe-staging STAGING_AZURE_CONTAINER_REGISTRY=acrstaging \
  PROD_AZURE_RESOURCE_GROUP=rg-wandervibe-prod PROD_AZURE_CONTAINER_REGISTRY=acrprod \
  PROD_GATE_CONFIRMED=true
cd_lines "$out"
[[ "$staging" == true && "$prod" == false ]] || fail "staging target should skip prod"
run_cd \
  PROD_AZURE_RESOURCE_GROUP=rg-wandervibe-prod PROD_AZURE_CONTAINER_REGISTRY=acrprod \
  PROD_GATE_CONFIRMED=true
cd_lines "$out"
[[ "$staging" == false && "$prod" == false ]] || fail "prod variables alone should skip prod"
expect_fail "prod target" env DEPLOY_TARGET=prod bash scripts/cd-enabled.sh
expect_fail "bad target" env DEPLOY_TARGET=production bash scripts/cd-enabled.sh

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

cat >"$tmp/curl" <<'EOF'
#!/usr/bin/env bash
url="${@: -1}"
case "$url" in
  *ipify*) printf '%s' "${IPIFY_BODY:-203.0.113.10}" ;;
  *checkip*) printf '%s\n' "${CHECKIP_BODY:-203.0.113.10}" ;;
  *) echo "unexpected curl url: $url" >&2; exit 1 ;;
esac
EOF
chmod +x "$tmp/curl"

PATH="$tmp:$PATH" bash scripts/resolve-runner-cidr.sh >"$out"
[[ "$(cat "$out")" == "RUNNER_CIDR=203.0.113.10/32" ]] || fail "runner cidr was not written"
expect_fail "mismatched egress" env IPIFY_BODY=203.0.113.10 CHECKIP_BODY=198.51.100.20 PATH="$tmp:$PATH" bash scripts/resolve-runner-cidr.sh
expect_fail "egress is not an address" env IPIFY_BODY=foo CHECKIP_BODY=foo PATH="$tmp:$PATH" bash scripts/resolve-runner-cidr.sh
expect_fail "octet above 255" env IPIFY_BODY=999.1.1.1 CHECKIP_BODY=999.1.1.1 PATH="$tmp:$PATH" bash scripts/resolve-runner-cidr.sh
expect_fail "leading zero" env IPIFY_BODY=01.2.3.4 CHECKIP_BODY=01.2.3.4 PATH="$tmp:$PATH" bash scripts/resolve-runner-cidr.sh

python3 - <<'PY' &
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

hits = {"/api/health": 0}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/health":
            hits["/api/health"] += 1
            if hits["/api/health"] < 3:
                body, code = b'{"status":"unavailable"}', 503
            else:
                body, code = b'{"status":"ok"}', 200
        elif self.path == "/api/ready":
            body, code = b'{"status":"ok"}', 200
        else:
            body, code = b"no", 404
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open("/tmp/wandervibe-smoke-port", "w", encoding="utf-8") as handle:
    handle.write(str(server.server_address[1]))
server.serve_forever()
PY
smoke_pid=$!
for _ in $(seq 1 50); do
  [[ -s /tmp/wandervibe-smoke-port ]] && break
  sleep 0.05
done
port="$(cat /tmp/wandervibe-smoke-port)"
rm -f /tmp/wandervibe-smoke-port
[[ -n "$port" ]] || fail "smoke server did not start"
SMOKE_ATTEMPTS=5 SMOKE_SLEEP_SECONDS=0 bash scripts/smoke-test.sh "http://127.0.0.1:${port}"
kill "$smoke_pid" >/dev/null 2>&1 || true
wait "$smoke_pid" >/dev/null 2>&1 || true

python3 - <<'PY' &
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"status":"unavailable"}'
        self.send_response(503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open("/tmp/wandervibe-smoke-port", "w", encoding="utf-8") as handle:
    handle.write(str(server.server_address[1]))
server.serve_forever()
PY
smoke_pid=$!
for _ in $(seq 1 50); do
  [[ -s /tmp/wandervibe-smoke-port ]] && break
  sleep 0.05
done
port="$(cat /tmp/wandervibe-smoke-port)"
rm -f /tmp/wandervibe-smoke-port
[[ -n "$port" ]] || fail "failing smoke server did not start"
expect_fail "permanent 503" env SMOKE_ATTEMPTS=2 SMOKE_SLEEP_SECONDS=0 bash scripts/smoke-test.sh "http://127.0.0.1:${port}"
kill "$smoke_pid" >/dev/null 2>&1 || true
wait "$smoke_pid" >/dev/null 2>&1 || true

cat >"$tmp/az" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${AZ_LOG:?}"
if [[ "$*" == *'containerapp show'* ]]; then
  if [[ -n "${AZ_SHOW_MISSING:-}" ]]; then
    echo "ResourceNotFound: was not found" >&2
    exit 3
  fi
  if [[ -n "${AZ_SHOW_FAIL:-}" ]]; then
    echo "authorization failed" >&2
    exit 1
  fi
  printf '%s\n' ca-wv-staging
  exit 0
fi
if [[ "$*" == *'access-restriction list'* ]]; then
  if [[ -n "${AZ_LIST_FAIL:-}" ]]; then
    echo "list failed" >&2
    exit 1
  fi
  printf '%s\n' "${AZ_RULE_COUNT:-0}"
  exit 0
fi
if [[ "$*" == *'access-restriction remove'* ]]; then
  if [[ -n "${AZ_REMOVE_FAIL:-}" ]]; then
    echo "remove failed" >&2
    exit 1
  fi
  exit 0
fi
if [[ "$*" == *'execution list'* ]]; then
  if [[ -n "${AZ_RUNNING_EXECUTION:-}" ]]; then
    printf '%s\n' "$AZ_RUNNING_EXECUTION"
  fi
  exit 0
fi
if [[ "$*" == *'job stop'* ]]; then
  exit 0
fi
if [[ "$*" == *'job start'* ]]; then
  count_file="${AZ_LOG}.starts"
  starts=0
  [[ -f "$count_file" ]] && starts="$(cat "$count_file")"
  starts=$((starts + 1))
  printf '%s\n' "$starts" >"$count_file"
  if [[ "$starts" -lt "${AZ_START_SUCCEEDS_ON:-1}" ]]; then
    echo "job not found yet" >&2
    exit 1
  fi
  printf '%s\n' job-wv-staging-migrate-exec
  exit 0
fi
if [[ "$*" == *'execution show'* ]]; then
  if [[ -n "${AZ_MIGRATION_HANG:-}" ]]; then
    printf '%s\n' Running
    exit 0
  fi
  count_file="${AZ_LOG}.polls"
  polls=0
  [[ -f "$count_file" ]] && polls="$(cat "$count_file")"
  polls=$((polls + 1))
  printf '%s\n' "$polls" >"$count_file"
  if [[ -n "${AZ_MIGRATION_FAIL:-}" && "$polls" -ge 2 ]]; then
    printf '%s\n' Failed
  elif [[ "$polls" -ge 2 ]]; then
    printf '%s\n' Succeeded
  else
    printf '%s\n' Running
  fi
  exit 0
fi
if [[ "$*" == *'logs show'* ]]; then
  echo "migration log"
  exit 0
fi
if [[ "$*" == *'deployment group create'* ]]; then
  if [[ "$*" != *'containerImageTag='* || "$*" != *'to_string(properties.outputs.publicAccessRestricted.value)'* ]]; then
    echo "deployment is missing the tag guard query" >&2
    exit 1
  fi
  printf '%s\n' '{"restricted":"true","fqdn":"ca.example.com","job":"job-wv-staging-migrate"}'
  exit 0
fi
if [[ "$*" == *'acr import'* ]]; then
  [[ "$*" == *'--force'* ]] || exit 1
  exit 0
fi
echo "unexpected az: $*" >&2
exit 1
EOF
chmod +x "$tmp/az"
export PATH="$tmp:$PATH"

export AZ_LOG="$tmp/az.log"
: >"$AZ_LOG"
expect_fail "bad rule name" bash scripts/remove-runner-rule.sh rg app 'closed-until-allowlist'
[[ ! -s "$AZ_LOG" ]] || fail "bad rule name called az"

AZ_SHOW_MISSING=1 bash scripts/remove-runner-rule.sh rg ca-wv-staging gh-run-42 >"$out"
grep -q "nothing to remove" "$out" || fail "missing app should be a no-op"
unset AZ_SHOW_MISSING

: >"$AZ_LOG"
AZ_RULE_COUNT=0 bash scripts/remove-runner-rule.sh rg ca-wv-staging gh-run-42 >"$out"
grep -q "gh-run-42 not present" "$out" || fail "absent rule should be a no-op"
grep -q "access-restriction remove" "$AZ_LOG" && fail "absent rule was removed"

: >"$AZ_LOG"
AZ_RULE_COUNT=1 bash scripts/remove-runner-rule.sh rg ca-wv-staging gh-run-42 >"$out"
grep -q "Removed gh-run-42." "$out" || fail "present rule was not removed"
grep -q "access-restriction remove" "$AZ_LOG" || fail "remove was not called"

expect_fail "list failure" env AZ_LIST_FAIL=1 bash scripts/remove-runner-rule.sh rg ca-wv-staging gh-run-42
expect_fail "remove failure" env AZ_RULE_COUNT=1 AZ_REMOVE_FAIL=1 bash scripts/remove-runner-rule.sh rg ca-wv-staging gh-run-42
expect_fail "show failure" env AZ_SHOW_FAIL=1 bash scripts/remove-runner-rule.sh rg ca-wv-staging gh-run-42
unset AZ_LIST_FAIL AZ_REMOVE_FAIL AZ_SHOW_FAIL AZ_RULE_COUNT

: >"$AZ_LOG"
rm -f "$AZ_LOG.starts" "$AZ_LOG.polls"
AZ_START_SUCCEEDS_ON=2 MIGRATION_POLL_SECONDS=0 MIGRATION_TIMEOUT_SECONDS=5 \
  bash scripts/wait-for-migration.sh rg-wandervibe-staging job-wv-staging-migrate >"$out"
grep -q "Succeeded" "$out" || fail "migration did not succeed"
expect_fail "migration failed" env AZ_MIGRATION_FAIL=1 MIGRATION_POLL_SECONDS=0 MIGRATION_TIMEOUT_SECONDS=5 \
  bash scripts/wait-for-migration.sh rg job-wv-staging-migrate
unset AZ_MIGRATION_FAIL AZ_START_SUCCEEDS_ON

: >"$AZ_LOG"
rm -f "$AZ_LOG.starts" "$AZ_LOG.polls"
AZ_START_SUCCEEDS_ON=99 AZ_RUNNING_EXECUTION=job-already \
  MIGRATION_POLL_SECONDS=0 MIGRATION_TIMEOUT_SECONDS=5 \
  bash scripts/wait-for-migration.sh rg job-wv-staging-migrate >"$out" 2>&1
grep -q "job-already is already running" "$out" || fail "a failed start started a second execution"
starts="$(grep -c 'job start' "$AZ_LOG" || true)"
[[ "$starts" -eq 1 ]] || fail "start was retried after an execution was already running"
unset AZ_RUNNING_EXECUTION AZ_START_SUCCEEDS_ON

: >"$AZ_LOG"
rm -f "$AZ_LOG.starts" "$AZ_LOG.polls"
expect_fail "migration timeout" env AZ_MIGRATION_HANG=1 MIGRATION_POLL_SECONDS=0 MIGRATION_TIMEOUT_SECONDS=0 \
  bash scripts/wait-for-migration.sh rg job-wv-staging-migrate
grep -q 'job stop' "$AZ_LOG" || fail "a timed-out migration was not stopped"
unset AZ_MIGRATION_HANG

: >"$AZ_LOG"
expect_fail "deploy refuses initial" bash scripts/deploy-cd.sh infra/cd.staging.bicepparam dep rg initial false true
[[ ! -s "$AZ_LOG" ]] || fail "initial tag reached az"
bash scripts/deploy-cd.sh infra/cd.staging.bicepparam wandervibe-staging-job rg "$sha" false true >"$out"
grep -q "containerImageTag=${sha}" "$AZ_LOG" || fail "deploy did not pass the commit SHA"
grep -q "deployContainerApp=false" "$AZ_LOG" || fail "job deploy updated the app"
grep -q "deployMigrationJob=true" "$AZ_LOG" || fail "job deploy skipped the migration job"
grep -q "to_string(properties.outputs.publicAccessRestricted.value)" "$AZ_LOG" || fail "restricted output is not to_string"
python3 -c 'import json,sys; data=json.load(open(sys.argv[1])); assert data["restricted"]=="true" and data["fqdn"]' "$out"
if grep -q RUNNER_CIDR scripts/deploy-cd.sh; then
  fail "bicep deploy must not read RUNNER_CIDR"
fi

: >"$AZ_LOG"
source_id="/subscriptions/sub/resourceGroups/rg-wandervibe-staging/providers/Microsoft.ContainerRegistry/registries/acrstaging"
bash scripts/import-image.sh acrprod "$source_id" "$sha" >"$out"
imports="$(grep -c 'acr import' "$AZ_LOG")"
[[ "$imports" -eq 2 ]] || fail "import did not copy both images"
grep -q -- "--registry ${source_id}" "$AZ_LOG" || fail "import did not use the staging registry resource id"
grep -q -- "--source wandervibe:${sha}" "$AZ_LOG" || fail "import missed the app image"
grep -q -- "--source wandervibe-migrate:${sha}" "$AZ_LOG" || fail "import missed the migrate image"
grep -q -- '--force' "$AZ_LOG" || fail "import did not force the tag"
if grep -q 'azurecr.io/' "$AZ_LOG"; then
  fail "import used a login-server source"
fi

if grep -nE '^param containerImageTag' infra/*.bicepparam; then
  fail "parameter files must not set containerImageTag"
fi
grep -q 'param minReplicas = 0' infra/main.staging.bicepparam
grep -q 'param minReplicas = 0' infra/cd.staging.bicepparam
grep -q 'param minReplicas = 1' infra/main.prod.bicepparam
grep -q 'param minReplicas = 1' infra/cd.prod.bicepparam

build_dir="${tmp}/bicep"
mkdir -p "$build_dir"
bicep build infra/main.bicep --outfile "${build_dir}/main.json"
bicep build infra/cd.bicep --outfile "${build_dir}/cd.json"
python3 - "${build_dir}/main.json" "${build_dir}/cd.json" <<'PY'
import json
import sys

message = "An empty tag or initial is refused."
for path in sys.argv[1:]:
    template = json.load(open(path))
    rendered = json.dumps(template)
    if message not in rendered or "fail(" not in rendered:
        raise SystemExit(f"{path} does not fail a missing image tag")
    default = template["parameters"]["containerImageTag"].get("defaultValue")
    if default != "":
        raise SystemExit(f"{path} containerImageTag default is {default!r}")
main = json.load(open(sys.argv[1]))
image = json.dumps(main["resources"]["containerApp"])
if "acceptedImageTag" not in image and "requireImageTag" not in image and "initial" not in json.dumps(main["variables"]):
    raise SystemExit("main.bicep does not thread the checked image tag into the container app")
PY

workflow=".github/workflows/deploy-environment.yml"
caller=".github/workflows/deploy.yml"
python3 - "$workflow" "$caller" <<'PY'
import sys

workflow = open(sys.argv[1], encoding="utf-8").read()
caller = open(sys.argv[2], encoding="utf-8").read()

def pos(text, needle):
    index = text.find(needle)
    if index < 0:
        raise SystemExit(f"missing {needle}")
    return index

order = [
    "name: Deploy migration job",
    "name: Apply database migrations",
    "id: deploy",
    "name: Resolve runner address",
    "name: Allow this runner",
    "name: Smoke test",
    "name: Remove runner rule",
]
indexes = [pos(workflow, needle) for needle in order]
if indexes != sorted(indexes):
    raise SystemExit(f"deploy steps are out of order: {order}")

if workflow.count("if: steps.deploy.outputs.restricted == 'true'") != 2:
    raise SystemExit("resolve and allow must share the restricted if")
cleanup = workflow.split("name: Remove runner rule", 1)[1]
if "if: always() && steps.login.outcome == 'success'" not in cleanup:
    raise SystemExit("cleanup must run only after a successful Azure login")
if "id: login" not in workflow.split("name: Remove runner rule", 1)[0]:
    raise SystemExit("the Azure login step needs an id so cleanup can see it")
for needle in (
    "group: deploy-${{ inputs.environment_name }}",
    "cancel-in-progress: false",
    "id-token: write",
    "contents: read",
    "azure/login@",
    "gh-run-${GITHUB_RUN_ID}",
    'bash scripts/resolve-runner-cidr.sh >> "$GITHUB_ENV"',
    "--ip-address \"${RUNNER_CIDR}\"",
    "scripts/smoke-test.sh",
):
    if needle not in workflow:
        raise SystemExit(f"workflow missing {needle}")
if "pull_request:" in caller:
    raise SystemExit("deploy workflow must not run on pull requests")
for needle in ("client-secret", "AZURE_CREDENTIALS", "creds:", "POSTGRES_ADMIN_PASSWORD"):
    for text, name in ((workflow, "deploy-environment"), (caller, "deploy")):
        if needle in text:
            raise SystemExit(f"{name} contains {needle}")
for needle in (
    "environment_name: staging",
    "environment_name: prod",
    "vars.STAGING_AZURE_CONTAINER_REGISTRY",
    "vars.PROD_AZURE_CONTAINER_REGISTRY",
    "vars.PROD_GATE_CONFIRMED",
    "needs.deploy-staging.result == 'success'",
    "image_tag: ${{ needs.build.outputs.image_tag }}",
):
    if needle not in caller:
        raise SystemExit(f"caller missing {needle}")
if caller.count("image_tag: ${{ needs.build.outputs.image_tag }}") != 2:
    raise SystemExit("staging and prod must deploy the same image tag from this run")
if "wandervibe-cd" in caller:
    raise SystemExit("a workflow-level concurrency group would hold staging behind prod approval")
if "AZURE_BUILD_CLIENT_ID" in caller or "refs/heads/main" in caller:
    raise SystemExit("the build must not use a branch credential or a separate client id")
if "skipped" in caller.split("deploy-prod:", 1)[1]:
    raise SystemExit("deploy-prod must not run when staging was skipped")
prod_job = caller.split("deploy-prod:", 1)[1]
if "needs.deploy-staging.result == 'success'" not in prod_job.split("uses:", 1)[0]:
    raise SystemExit("deploy-prod can run without a successful staging deploy")
first_permissions = caller.split("permissions:", 1)[1].split("jobs:", 1)[0]
if "id-token" in first_permissions:
    raise SystemExit("top-level permissions must be contents: read only")
if caller.count("id-token: write") != 3:
    raise SystemExit("id-token: write belongs on build, deploy-staging, and deploy-prod")

def jobs(text):
    blocks = {}
    name = None
    body = []
    in_jobs = False
    for line in text.splitlines():
        if line.startswith("jobs:"):
            in_jobs = True
            continue
        if not in_jobs:
            continue
        if line.startswith("  ") and not line.startswith("   ") and line.endswith(":") and line.strip() != "jobs:":
            if name is not None:
                blocks[name] = "\n".join(body)
            name = line.strip()[:-1]
            body = [line]
            continue
        if name is not None:
            body.append(line)
    if name is not None:
        blocks[name] = "\n".join(body)
    return blocks

for label, text in (("deploy-environment", workflow), ("deploy", caller)):
    for name, block in jobs(text).items():
        if "azure/login@" not in block:
            continue
        if not any(line.startswith("    environment:") for line in block.splitlines()):
            raise SystemExit(f"{label} job {name} runs azure/login without environment:")
build_job = jobs(caller)["build"]
if not any(line.strip() == "environment: staging" for line in build_job.splitlines()):
    raise SystemExit("the build job must select the staging environment")
PY

bicep test infra/tests/image-tag.test.bicep
rejected_log="${tmp}/image-tag-rejected.log"
set +e
bicep test infra/tests/image-tag-rejected.test.bicep >"${rejected_log}" 2>&1
rejected_status=$?
set -e
if [[ "${rejected_status}" -eq 0 ]]; then
  echo "empty and initial tags were accepted"
  cat "${rejected_log}"
  exit 1
fi
grep -q "An empty tag or initial is refused" "${rejected_log}" || fail "image-tag rejection did not name the tag"
grep -q "Evaluation initial" "${rejected_log}" || fail "initial tag was not evaluated"
grep -q "Evaluation empty" "${rejected_log}" || fail "empty tag was not evaluated"
grep -q 'replicaTimeout: 600' infra/modules/migration-job.bicep
grep -q 'MIGRATION_TIMEOUT_SECONDS:-720' scripts/wait-for-migration.sh

python3 - <<'PY'
import re
from pathlib import Path

deploy = Path("docs/deploy.md").read_text()
adr = Path("docs/adr/ADR-0003-continuous-deployment.md").read_text()
section = deploy.split("### 4. Role assignments", 1)[1].split("### 5.", 1)[0]
blocks = section.split("az role assignment create")[1:]
assignments = []
for block in blocks:
    assignee = re.search(r'--assignee-object-id "([^"]+)"', block)
    role = re.search(r'--role (?:"([^"]+)"|(\S+))', block)
    scope = re.search(r'--scope "([^"]+)"', block)
    if not (assignee and role and scope):
        raise SystemExit(f"could not parse a role assignment:\n{block}")
    assignments.append((assignee.group(1), role.group(1) or role.group(2), scope.group(1)))

expected = {
    ("$staging_principal", "AcrPush", "$staging_acr_id"),
    ("$staging_principal", "Contributor", "/subscriptions/${sub}/resourceGroups/rg-wandervibe-staging"),
    ("$prod_principal", "AcrPull", "$staging_acr_id"),
    ("$prod_principal", "Container Registry Data Importer and Data Reader", "$prod_acr_id"),
    ("$prod_principal", "AcrPush", "$prod_acr_id"),
    ("$prod_principal", "Contributor", "/subscriptions/${sub}/resourceGroups/rg-wandervibe-prod"),
}
if set(assignments) != expected:
    raise SystemExit(f"role commands drifted:\n{assignments}")
for assignee, role, scope in assignments:
    if role == "Container Registry Data Importer and Data Reader" and scope == "$staging_acr_id":
        raise SystemExit("the importer role on the staging registry can import into staging")

def row_has(text, role, principal, scope):
    return any(role in line and principal in line and scope in line for line in text.splitlines())

for text, name in ((deploy, "docs/deploy.md"), (adr, "ADR-0003")):
    if not row_has(text, "AcrPull", "`id-wv-cd-prod`", "Staging registry"):
        raise SystemExit(f"{name} must give id-wv-cd-prod AcrPull on the staging registry")
    if row_has(text, "Container Registry Data Importer and Data Reader", "`id-wv-cd-prod`", "Staging registry"):
        raise SystemExit(f"{name} still grants the importer role on the staging registry")
    if not row_has(text, "Container Registry Data Importer and Data Reader", "`id-wv-cd-prod`", "Prod registry"):
        raise SystemExit(f"{name} must keep the importer role on the prod registry")
    if not row_has(text, "AcrPush", "`id-wv-cd-prod`", "Prod registry"):
        raise SystemExit(f"{name} must keep AcrPush on the prod registry")
PY

echo "Continuous deployment checks passed."
