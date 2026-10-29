#!/usr/bin/env bash
# Print RUNNER_CIDR=<ipv4>/32 for $GITHUB_ENV.
# Both lookups must be the same IPv4 literal. Octets are 0-255 with no leading zeros.
set -euo pipefail

is_ipv4() {
  local ip="$1"
  local octet
  [[ "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  local o1 o2 o3 o4
  IFS='.' read -r o1 o2 o3 o4 <<<"$ip"
  for octet in "$o1" "$o2" "$o3" "$o4"; do
    if ((octet > 255)); then
      return 1
    fi
    if [[ "$octet" =~ ^0[0-9]+$ ]]; then
      return 1
    fi
  done
}

ip="$(curl --fail --silent --show-error --ipv4 --max-time 10 --retry 3 https://api.ipify.org)"
ip="$(printf '%s' "$ip" | tr -d '[:space:]')"
if ! is_ipv4 "$ip"; then
  echo "unexpected egress IP: ${ip}" >&2
  exit 1
fi

cross="$(curl --fail --silent --show-error --ipv4 --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')"
if ! is_ipv4 "$cross"; then
  echo "unexpected egress IP from cross-check: ${cross}" >&2
  exit 1
fi
if [[ "$ip" != "$cross" ]]; then
  echo "egress IP mismatch: ${ip} vs ${cross}" >&2
  exit 1
fi

printf 'RUNNER_CIDR=%s/32\n' "$ip"
