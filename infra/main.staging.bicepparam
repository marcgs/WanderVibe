using 'main.bicep'

param environmentName = 'staging'
param location = 'switzerlandnorth'
param postgresAdminLogin = 'wandervibe'
// Value comes from the shell. Do not commit a password.
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
// Scale to zero when nobody is using staging.
param minReplicas = 0
param maxReplicas = 2
// Do not set containerImageTag here. Pass the commit SHA at deploy time.
// An empty tag or initial is refused when deployContainerApp is true.
// Comma-separated IPv4 CIDRs, supplied at deploy time. Unset or empty closes ingress.
// Do not commit addresses.
var allowedIpRangesFromEnv = readEnvironmentVariable('WANDER_ALLOWED_IP_RANGES', '')
param allowedIpRanges = empty(allowedIpRangesFromEnv)
  ? []
  : filter(map(split(allowedIpRangesFromEnv, ','), range => trim(range)), range => !empty(range))
// Stay closed until story #15. Do not set this to false before then.
param restrictPublicAccess = true
