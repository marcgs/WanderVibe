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
@description('PostgreSQL administrator password. Set POSTGRES_ADMIN_PASSWORD at deploy time. Do not put the value in a parameter file. 16 to 128 characters. The template URL-encodes it.')
@minLength(16)
@maxLength(128)
param postgresAdminPassword string

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

@description('Image tag in the container registry. Pass the tag published by az acr build. The default does not exist until an image is pushed.')
@minLength(1)
@maxLength(128)
param containerImageTag string = 'initial'

@description('Create the Container App. Set false on the first deployment, before an image exists in the registry.')
param deployContainerApp bool = true

@description('IPv4 CIDRs allowed through Container App ingress while restrictPublicAccess is true. Empty closes ingress to every real client. Parameter files read WANDER_ALLOWED_IP_RANGES. Do not commit addresses. At most 32 entries. That cap belongs to this repository, not to Container Apps.')
@maxLength(32)
param allowedIpRanges string[] = []

@description('Smallest prefix length accepted in allowedIpRanges. Defaults to 16. Cannot be set below 8. 32 is the longest prefix.')
@minValue(8)
@maxValue(32)
param minAllowedPrefixLength int = 16

@description('When true, ingress allows only allowedIpRanges. Stays true until story #15. Set false only after sign-in is enforced on every page except the sign-in page and /api/health.')
param restrictPublicAccess bool = true

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
    // uriComponent encodes it. sslmode=verify-full matches what node-pg 8 already
    // does for "require", without the warning. Node's CA store includes
    // DigiCert Global Root G2, which signs Azure Flexible Server certificates.
    secretValue: 'postgresql://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${postgres.outputs.fqdn}:5432/${databaseName}?sslmode=verify-full'
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

module containerApp 'modules/container-app.bicep' = if (deployContainerApp) {
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
    allowedIpRanges: allowedIpRanges
    minAllowedPrefixLength: minAllowedPrefixLength
    restrictPublicAccess: restrictPublicAccess
  }
}

@description('staging or prod.')
output environmentName string = environmentName

@description('Resource group the template was deployed to.')
output resourceGroupName string = resourceGroup().name

@description('Container App name. Empty when deployContainerApp is false.')
output containerAppName string = containerApp.?outputs.name ?? ''

@description('Public hostname of the Container App. Empty when deployContainerApp is false. Smoke tests use https://<this host>.')
output containerAppFqdn string = containerApp.?outputs.fqdn ?? ''

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

@description('True while Container App ingress is limited to allowedIpRanges.')
output publicAccessRestricted bool = restrictPublicAccess
