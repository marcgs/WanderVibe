@description('Manual Container Apps job that runs prisma migrate deploy.')
param name string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object

@description('Container Apps environment resource id.')
param environmentId string

@description('User-assigned managed identity resource id. This identity reads Key Vault. The CD identity does not.')
param identityResourceId string

@description('Registry login server, for example myregistry.azurecr.io.')
param registryServer string

@description('Full migration image reference in the registry.')
param containerImage string

@description('Container App secret name for the database connection string.')
param databaseUrlSecretName string

@description('Versionless Key Vault URL of the database-url secret. The value stays in Key Vault.')
param databaseUrlSecretUrl string

// The GitHub-hosted runner is not an Azure service, and Postgres allows only Azure services.
// This job runs in the environment, as the app identity, which already has Key Vault Secrets User.
resource job 'Microsoft.App/jobs@2026-01-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    configuration: {
      triggerType: 'Manual'
      // scripts/wait-for-migration.sh polls for this plus 120 seconds.
      replicaTimeout: 600
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: registryServer
          identity: identityResourceId
        }
      ]
      secrets: [
        {
          name: databaseUrlSecretName
          keyVaultUrl: databaseUrlSecretUrl
          identity: identityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: containerImage
          command: [
            'npx'
            '--no-install'
            'prisma'
            'migrate'
            'deploy'
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              secretRef: databaseUrlSecretName
            }
          ]
        }
      ]
    }
  }
}

output id string = job.id
output name string = job.name
