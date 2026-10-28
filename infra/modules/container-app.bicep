@description('Container App name.')
param name string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object

@description('Container Apps environment resource id.')
param environmentId string

@description('User-assigned managed identity resource id.')
param identityResourceId string

@description('Registry login server, for example myregistry.azurecr.io.')
param registryServer string

@description('Full container image reference in the registry.')
param containerImage string

@description('Minimum replicas. Staging uses 0 so the app scales to zero.')
@minValue(0)
param minReplicas int

@description('Maximum replicas.')
@minValue(1)
param maxReplicas int

type keyVaultSecret = {
  name: string
  keyVaultUrl: string
}

type secretEnvironmentVariable = {
  name: string
  secretRef: string
}

@description('Key Vault secret references. Values stay in Key Vault.')
param keyVaultSecrets keyVaultSecret[]

@description('Environment variables whose values are Key Vault secret references.')
param secretEnvironmentVariables secretEnvironmentVariable[]

// Platform probes hit /api/health only. That route does not touch Postgres, so a
// database outage does not restart the replica. The database round-trip is GET /api/ready.
var healthProbeHttp = {
  path: '/api/health'
  port: 3000
  scheme: 'HTTP'
}

resource app 'Microsoft.App/containerApps@2026-01-01' = {
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
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: registryServer
          identity: identityResourceId
        }
      ]
      secrets: [
        for item in keyVaultSecrets: {
          name: item.name
          keyVaultUrl: item.keyVaultUrl
          identity: identityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'wandervibe'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            for item in secretEnvironmentVariables: {
              name: item.name
              secretRef: item.secretRef
            }
          ]
          probes: [
            {
              type: 'Startup'
              initialDelaySeconds: 1
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 24
              successThreshold: 1
              httpGet: healthProbeHttp
            }
            {
              type: 'Liveness'
              initialDelaySeconds: 5
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
              successThreshold: 1
              httpGet: healthProbeHttp
            }
            {
              type: 'Readiness'
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
              successThreshold: 1
              httpGet: healthProbeHttp
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

output id string = app.id
output name string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
