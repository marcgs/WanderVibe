targetScope = 'resourceGroup'

@description('Deployment environment. Staging and production use separate resource groups and parameter files.')
@allowed([
  'staging'
  'prod'
])
param environmentName string

@description('Azure region. WanderVibe defaults to Switzerland North.')
param location string = 'switzerlandnorth'

@description('Optional lowercase alphanumeric suffix (max 10) for globally unique names. Empty uses a hash of the resource group id.')
@maxLength(10)
param nameSuffix string = ''

@description('PostgreSQL administrator login. Not a secret. Do not use admin, root, or azure_superuser.')
@minLength(1)
@maxLength(63)
param postgresAdminLogin string

@secure()
@description('PostgreSQL administrator password. Set POSTGRES_ADMIN_PASSWORD at deploy time. Do not put the value in a parameter file. Use a URL-safe password (hex is safe), 16 to 128 characters.')
@minLength(16)
@maxLength(128)
param postgresAdminPassword string

@description('Object id of the principal running the deployment. It receives Key Vault Secrets Officer. Set AZURE_DEPLOYER_OBJECT_ID. Not a secret.')
@minLength(1)
param deployerPrincipalId string

@description('Principal type of deployerPrincipalId. A signed-in user is User. A GitHub OIDC app registration is ServicePrincipal.')
@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param deployerPrincipalType string = 'User'

@description('Minimum Container App replicas. The staging parameter file sets 0.')
@minValue(0)
@maxValue(10)
param minReplicas int

@description('Maximum Container App replicas.')
@minValue(1)
@maxValue(10)
param maxReplicas int

@description('Repository name inside the container registry.')
param containerImageName string = 'wandervibe'

@description('Image tag in the container registry. Story #14 replaces this with the commit SHA. The tag does not exist until an image is pushed.')
@minLength(1)
@maxLength(128)
param containerImageTag string = 'initial'

var envShort = environmentName == 'prod' ? 'prd' : 'stg'
var suffix = nameSuffix == '' ? take(uniqueString(resourceGroup().id), 8) : nameSuffix
var databaseName = 'wandervibe'
var databaseUrlSecretName = 'database-url'
var applicationInsightsSecretName = 'applicationinsights-connection-string'

var tags = {
  project: 'wandervibe'
  environment: environmentName
}

var containerRegistryName = 'acrwv${envShort}${suffix}'
var keyVaultName = 'kvwv${envShort}${suffix}'
var postgresServerName = 'psql-wv-${envShort}-${suffix}'
var logAnalyticsName = 'log-wv-${environmentName}'
var applicationInsightsName = 'appi-wv-${environmentName}'
var identityName = 'id-wv-${environmentName}'
var containerAppsEnvironmentName = 'cae-wv-${environmentName}'
var containerAppName = 'ca-wv-${environmentName}'

module logAnalytics 'modules/log-analytics.bicep' = {
  name: 'log-analytics'
  params: {
    name: logAnalyticsName
    location: location
    tags: tags
  }
}

module applicationInsights 'modules/application-insights.bicep' = {
  name: 'application-insights'
  params: {
    name: applicationInsightsName
    location: location
    tags: tags
    workspaceId: logAnalytics.outputs.id
  }
}

module identity 'modules/managed-identity.bicep' = {
  name: 'managed-identity'
  params: {
    name: identityName
    location: location
    tags: tags
  }
}

module registry 'modules/container-registry.bicep' = {
  name: 'container-registry'
  params: {
    name: containerRegistryName
    location: location
    tags: tags
    acrPullPrincipalId: identity.outputs.principalId
  }
}

module keyVault 'modules/key-vault.bicep' = {
  name: 'key-vault'
  params: {
    name: keyVaultName
    location: location
    tags: tags
    appIdentityPrincipalId: identity.outputs.principalId
    deployerPrincipalId: deployerPrincipalId
    deployerPrincipalType: deployerPrincipalType
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    name: postgresServerName
    location: location
    tags: tags
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    databaseName: databaseName
  }
}

module databaseUrlSecret 'modules/key-vault-secret.bicep' = {
  name: 'secret-database-url'
  params: {
    vaultName: keyVault.outputs.name
    secretName: databaseUrlSecretName
    // The password is a secure parameter, so this string stays secure.
    // connect_timeout keeps a down database from hanging the readiness check.
    secretValue: 'postgresql://${postgresAdminLogin}:${postgresAdminPassword}@${postgres.outputs.fqdn}:5432/${databaseName}?sslmode=require&connect_timeout=5'
  }
}

module applicationInsightsSecret 'modules/application-insights-secret.bicep' = {
  name: 'secret-application-insights'
  params: {
    appInsightsName: applicationInsights.outputs.name
    vaultName: keyVault.outputs.name
    secretName: applicationInsightsSecretName
  }
}

module containerAppsEnvironment 'modules/container-apps-environment.bicep' = {
  name: 'container-apps-environment'
  params: {
    name: containerAppsEnvironmentName
    location: location
    tags: tags
    logAnalyticsWorkspaceName: logAnalytics.outputs.name
  }
}

module containerApp 'modules/container-app.bicep' = {
  name: 'container-app'
  params: {
    name: containerAppName
    location: location
    tags: tags
    environmentId: containerAppsEnvironment.outputs.id
    identityResourceId: identity.outputs.id
    registryServer: registry.outputs.loginServer
    containerImage: '${registry.outputs.loginServer}/${containerImageName}:${containerImageTag}'
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    keyVaultSecrets: [
      {
        name: databaseUrlSecretName
        keyVaultUrl: databaseUrlSecret.outputs.versionlessUrl
      }
      {
        name: applicationInsightsSecretName
        keyVaultUrl: applicationInsightsSecret.outputs.versionlessUrl
      }
    ]
    secretEnvironmentVariables: [
      {
        name: 'DATABASE_URL'
        secretRef: databaseUrlSecretName
      }
      {
        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
        secretRef: applicationInsightsSecretName
      }
    ]
  }
}

@description('staging or prod.')
output environmentName string = environmentName

@description('Resource group the template was deployed to.')
output resourceGroupName string = resourceGroup().name

@description('Container App name.')
output containerAppName string = containerApp.outputs.name

@description('Public hostname of the Container App. Smoke tests use https://<this host>.')
output containerAppFqdn string = containerApp.outputs.fqdn

@description('Container registry name.')
output containerRegistryName string = registry.outputs.name

@description('Registry login server. Story #14 pushes wandervibe:<commit-sha> here.')
output containerRegistryLoginServer string = registry.outputs.loginServer

@description('Key Vault name.')
output keyVaultName string = keyVault.outputs.name

@description('Key Vault URI. Does not include a secret value.')
output keyVaultUri string = keyVault.outputs.uri

@description('Key Vault secret that holds the Postgres connection string.')
output databaseUrlSecretName string = databaseUrlSecretName

@description('Key Vault secret that holds the Application Insights connection string.')
output applicationInsightsSecretName string = applicationInsightsSecretName

@description('PostgreSQL Flexible Server name.')
output postgresServerName string = postgres.outputs.name

@description('PostgreSQL hostname.')
output postgresServerFqdn string = postgres.outputs.fqdn

@description('Application database name.')
output postgresDatabaseName string = postgres.outputs.databaseName

@description('User-assigned identity name.')
output managedIdentityName string = identity.outputs.name

@description('User-assigned identity client id.')
output managedIdentityClientId string = identity.outputs.clientId

@description('Log Analytics workspace name.')
output logAnalyticsWorkspaceName string = logAnalytics.outputs.name

@description('Application Insights component name.')
output applicationInsightsName string = applicationInsights.outputs.name
