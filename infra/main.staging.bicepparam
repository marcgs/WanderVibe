using 'main.bicep'

param environmentName = 'staging'
param location = 'switzerlandnorth'
param postgresAdminLogin = 'wandervibe'
// Value comes from the shell. Do not commit a password.
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
// Object id of the account running the deployment. Not a secret.
param deployerPrincipalId = readEnvironmentVariable('AZURE_DEPLOYER_OBJECT_ID')
param deployerPrincipalType = 'User'
// Scale to zero when nobody is using staging.
param minReplicas = 0
param maxReplicas = 2
param containerImageTag = 'initial'
