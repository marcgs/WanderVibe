targetScope = 'resourceGroup'

import { requireImageTag } from 'modules/image-tag.bicep'

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

@description('When true, ingress allows only allowedIpRanges. Stays true until story #15.')
param restrictPublicAccess bool = true

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
  name: names.outputs.containerAppsEnvironmentName
}

// existing resources whose names come from another module only expose id, name, type,
// and apiVersion here. The public-cloud host names are derived from those names.
var registryLoginServer = '${registry.name}.azurecr.io'
var keyVaultUri = 'https://${keyVault.name}${environment().suffixes.keyvaultDns}/'
var databaseUrlSecretUrl = '${keyVaultUri}secrets/${names.outputs.databaseUrlSecretName}'
var applicationInsightsSecretUrl = '${keyVaultUri}secrets/${names.outputs.applicationInsightsSecretName}'

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
    keyVaultSecrets: [
      {
        name: names.outputs.databaseUrlSecretName
        keyVaultUrl: databaseUrlSecretUrl
      }
      {
        name: names.outputs.applicationInsightsSecretName
        keyVaultUrl: applicationInsightsSecretUrl
      }
    ]
    secretEnvironmentVariables: [
      {
        name: 'DATABASE_URL'
        secretRef: names.outputs.databaseUrlSecretName
      }
      {
        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
        secretRef: names.outputs.applicationInsightsSecretName
      }
    ]
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
