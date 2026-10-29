using 'main.bicep'

param environmentName = 'prod'
param location = 'switzerlandnorth'
param postgresAdminLogin = 'wandervibe'
// Value comes from the shell. Do not commit a password.
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
// One replica so production does not cold-start. Set this to 0 to scale prod to zero.
param minReplicas = 1
param maxReplicas = 2
// Do not set containerImageTag here. Pass the commit SHA at deploy time.
// An empty tag or initial is refused when deployContainerApp is true.
// Comma-separated IPv4 CIDRs, supplied at deploy time. Unset or empty closes ingress.
// Do not commit addresses. Production stays closed until you open ingress. See docs/deploy.md.
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
// A later change of this file is what keeps GitHub deploys from closing it again.
// See docs/deploy.md.
param restrictPublicAccess = true
