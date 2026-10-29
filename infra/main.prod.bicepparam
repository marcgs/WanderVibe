using 'main.bicep'

param environmentName = 'prod'
param location = 'switzerlandnorth'
param postgresAdminLogin = 'wandervibe'
// Value comes from the shell. Do not commit a password.
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
// One replica so production does not cold-start. Set this to 0 to scale prod to zero.
param minReplicas = 1
param maxReplicas = 2
param containerImageTag = 'initial'
// Comma-separated IPv4 CIDRs, supplied at deploy time. Unset or empty closes ingress.
// Do not commit addresses. Production uses the same closure as staging until story #15.
var allowedIpRangesFromEnv = readEnvironmentVariable('WANDER_ALLOWED_IP_RANGES', '')
param allowedIpRanges = empty(allowedIpRangesFromEnv)
  ? []
  : filter(map(split(allowedIpRangesFromEnv, ','), range => trim(range)), range => !empty(range))
// Stay closed until story #15. Do not set this to false before then.
param restrictPublicAccess = true
