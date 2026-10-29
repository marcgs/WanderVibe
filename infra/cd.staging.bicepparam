using 'cd.bicep'

param environmentName = 'staging'
param location = 'switzerlandnorth'
// Scale to zero when nobody is using staging.
param minReplicas = 0
param maxReplicas = 2
// Comma-separated IPv4 CIDRs, supplied at deploy time. Unset or empty closes ingress.
// Operator ranges only. Do not commit addresses and do not include the GitHub runner.
var allowedIpRangesFromEnv = readEnvironmentVariable('WANDER_ALLOWED_IP_RANGES', '')
param allowedIpRanges = empty(allowedIpRangesFromEnv)
  ? []
  : filter(map(split(allowedIpRangesFromEnv, ','), range => trim(range)), range => !empty(range))
// Stay closed until sign-in is configured and you open ingress on purpose.
// GitHub deploys read this file, so a one-off false value is overwritten.
// See docs/deploy.md.
param restrictPublicAccess = true
