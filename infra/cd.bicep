targetScope = 'resourceGroup'

import { requireImageTag } from 'modules/image-tag.bicep'
import { appResourceName, environmentResourceName } from 'modules/names.bicep'

// Deploys only the migration job and the Container App.
// Postgres, Key Vault secrets, and role assignments stay in infra/main.bicep.
// The CD identity can run this file with Contributor. It does not get a Key Vault data-plane role,
// and it does not get roleAssignments/write.

@description('Deployment environment. Staging and production use separate resource groups and parameter files.')
@allowed([
  'staging'
  'prod'
])
param environmentName string

@description('Azure region. WanderVibe defaults to Switzerland North.')
param location string = 'switzerlandnorth'

@description('Optional lowercase alphanumeric suffix (max 10). Must match the suffix used by infra/main.bicep. Empty uses the same resource group hash.')
@maxLength(10)
param nameSuffix string = ''

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

@description('Migration image repository name inside the container registry.')
param migrateImageName string = 'wandervibe-migrate'

@description('Image tag in the container registry. Pass the full commit SHA. An empty tag or initial fails the deployment when the app or the migration job is deployed.')
@maxLength(128)
param containerImageTag string = ''

@description('Create or update the Container App. The migration step sets this false so the running app stays on its current image.')
param deployContainerApp bool = true

@description('Create or update the migration job.')
param deployMigrationJob bool = true

@description('IPv4 CIDRs allowed through Container App ingress while restrictPublicAccess is true. Operator ranges only. The runner address is not included. Empty closes ingress to every real client.')
@maxLength(32)
param allowedIpRanges string[] = []

@description('Smallest prefix length accepted in allowedIpRanges. Defaults to 16. Cannot be set below 8.')
@minValue(8)
@maxValue(32)
param minAllowedPrefixLength int = 16

@description('When true, ingress allows only allowedIpRanges. Stays true in the parameter files. Set false only after sign-in is configured. See docs/deploy.md.')
param restrictPublicAccess bool = true

@description('When true, the Container App references auth-secret and sets AUTH_URL. Default false so a deploy succeeds before that secret exists. Parameter files read AUTH_CONFIGURED.')
param authConfigured bool = false

@description('When true with authConfigured, reference the Google client id and secret. Parameter files read AUTH_GOOGLE_CONFIGURED.')
param googleAuthConfigured bool = false

@description('When true with authConfigured, reference the Entra client id, secret, and issuer. Parameter files read AUTH_MICROSOFT_CONFIGURED.')
param microsoftAuthConfigured bool = false

var acceptedImageTag = requireImageTag(containerImageTag, deployContainerApp || deployMigrationJob)

var tags = {
  project: 'wandervibe'
  environment: environmentName
}

module names 'modules/names.bicep' = {
  name: 'names'
  params: {
    environmentName: environmentName
    nameSuffix: nameSuffix
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: names.outputs.identityName
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = {
  name: names.outputs.containerRegistryName
}

resource keyVault 'Microsoft.KeyVault/vaults@2025-05-01' existing = {
  name: names.outputs.keyVaultName
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2026-01-01' existing = {
  // A name known at the start of the deployment, so defaultDomain can be read.
  // names.bicep uses the same function for containerAppsEnvironmentName.
  name: environmentResourceName(environmentName)
}

// existing resources whose names come from another module only expose id, name, type,
// and apiVersion here. The public-cloud host names are derived from those names.
var registryLoginServer = '${registry.name}.azurecr.io'
var keyVaultUri = 'https://${keyVault.name}${environment().suffixes.keyvaultDns}/'
var databaseUrlSecretUrl = '${keyVaultUri}secrets/${names.outputs.databaseUrlSecretName}'
// reference() returns the environment properties. defaultDomain is not a compile-time
// field on an existing resource whose name comes from another module.
var authHost = '${appResourceName(environmentName)}.${containerAppsEnvironment.properties.defaultDomain}'

module appEnv 'modules/app-env.bicep' = {
  name: 'app-env'
  params: {
    keyVaultUri: keyVaultUri
    databaseUrlSecretName: names.outputs.databaseUrlSecretName
    applicationInsightsSecretName: names.outputs.applicationInsightsSecretName
    authConfigured: authConfigured
    googleAuthConfigured: googleAuthConfigured
    microsoftAuthConfigured: microsoftAuthConfigured
    authUrl: 'https://${authHost}'
  }
}

module migrationJob 'modules/migration-job.bicep' = if (deployMigrationJob) {
  name: 'migration-job'
  params: {
    name: names.outputs.migrationJobName
    location: location
    tags: tags
    environmentId: containerAppsEnvironment.id
    identityResourceId: identity.id
    registryServer: registryLoginServer
    containerImage: '${registryLoginServer}/${migrateImageName}:${acceptedImageTag}'
    databaseUrlSecretName: names.outputs.databaseUrlSecretName
    databaseUrlSecretUrl: databaseUrlSecretUrl
  }
}

module containerApp 'modules/container-app.bicep' = if (deployContainerApp) {
  name: 'container-app'
  params: {
    name: names.outputs.containerAppName
    location: location
    tags: tags
    environmentId: containerAppsEnvironment.id
    identityResourceId: identity.id
    registryServer: registryLoginServer
    containerImage: '${registryLoginServer}/${containerImageName}:${acceptedImageTag}'
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    keyVaultSecrets: appEnv.outputs.keyVaultSecrets
    secretEnvironmentVariables: appEnv.outputs.secretEnvironmentVariables
    plainEnvironmentVariables: appEnv.outputs.plainEnvironmentVariables
    allowedIpRanges: allowedIpRanges
    minAllowedPrefixLength: minAllowedPrefixLength
    restrictPublicAccess: restrictPublicAccess
  }
}

@description('Container App name. Empty when deployContainerApp is false.')
output containerAppName string = containerApp.?outputs.name ?? ''

@description('Public hostname of the Container App. Empty when deployContainerApp is false.')
output containerAppFqdn string = containerApp.?outputs.fqdn ?? ''

@description('Migration job name. Empty when deployMigrationJob is false.')
output migrationJobName string = migrationJob.?outputs.name ?? ''

@description('True while Container App ingress is limited to allowedIpRanges.')
output publicAccessRestricted bool = restrictPublicAccess

@description('Registry login server.')
output containerRegistryLoginServer string = registryLoginServer
