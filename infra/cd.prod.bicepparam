using 'cd.bicep'

param environmentName = 'prod'
param location = 'switzerlandnorth'
// One replica so production does not cold-start. Set this to 0 to scale prod to zero.
param minReplicas = 1
param maxReplicas = 2
// Comma-separated IPv4 CIDRs, supplied at deploy time. Unset or empty closes ingress.
// Operator ranges only. Do not commit addresses and do not include the GitHub runner.
var allowedIpRangesFromEnv = readEnvironmentVariable('WANDER_ALLOWED_IP_RANGES', '')
param allowedIpRanges = empty(allowedIpRangesFromEnv)
  ? []
  : filter(map(split(allowedIpRangesFromEnv, ','), range => trim(range)), range => !empty(range))
// false until the GitHub environment variable AUTH_CONFIGURED is true.
// See docs/deploy.md. Unset or any other value keeps the auth secrets off the app.
param authConfigured = readEnvironmentVariable('AUTH_CONFIGURED', 'false') == 'true'
param googleAuthConfigured = readEnvironmentVariable('AUTH_GOOGLE_CONFIGURED', 'false') == 'true'
param microsoftAuthConfigured = readEnvironmentVariable('AUTH_MICROSOFT_CONFIGURED', 'false') == 'true'
// Stay closed until sign-in is configured and you open ingress on purpose.
// GitHub deploys read this file, so a one-off false value is overwritten.
// See docs/deploy.md.
param restrictPublicAccess = true
