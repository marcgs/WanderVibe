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
