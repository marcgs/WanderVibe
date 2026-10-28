using 'main.bicep'

param environmentName = 'prod'
param location = 'switzerlandnorth'
param postgresAdminLogin = 'wandervibe'
// Value comes from the shell. Do not commit a password.
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
// Object id of the account running the deployment. Not a secret.
param deployerPrincipalId = readEnvironmentVariable('AZURE_DEPLOYER_OBJECT_ID')
param deployerPrincipalType = 'User'
// One replica so production does not cold-start. Set this to 0 to scale prod to zero.
param minReplicas = 1
param maxReplicas = 2
param containerImageTag = 'initial'
