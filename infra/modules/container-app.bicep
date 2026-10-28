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

@description('IPv4 CIDRs allowed through ingress while restrictPublicAccess is true. Empty closes ingress to every real client. Set the value at deploy time. Do not commit addresses.')
@maxLength(32)
param allowedIpRanges string[] = []

@description('When true, ingress allows only allowedIpRanges. Remains true until story #15. Set false only after sign-in is enforced on every page except the sign-in page and /api/health.')
param restrictPublicAccess bool = true

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

// Startup and liveness stay on /api/health. A liveness failure restarts the replica,
// so that probe must not depend on Postgres.
var healthProbeHttp = {
  path: '/api/health'
  port: 3000
  scheme: 'HTTP'
}

// Readiness only removes the replica from ingress. /api/ready returns within 2.5s,
// so this timeout is larger than that bound.
var readyProbeHttp = {
  path: '/api/ready'
  port: 3000
  scheme: 'HTTP'
}

// ingress-ip-rules:begin
// Azure accepts only Allow rules or only Deny rules, and an empty rule list allows
// every client. An empty allowlist still sends one Allow rule for 192.0.2.1/32
// (RFC 5737 TEST-NET-1, not a client). Every other IPv4 source misses that rule
// and receives HTTP 403. restrictPublicAccess false is the only way to send [],
// which Azure treats as allow all, and only after story #15.
var normalizedIpRanges = filter(map(allowedIpRanges, range => trim(range)), range => !empty(range))

var allowlistAccepted = !empty(filter(normalizedIpRanges, range => endsWith(range, '/0')))
  ? fail(
      'allowedIpRanges must not contain a /0 prefix. To open ingress after story #15, set restrictPublicAccess to false.'
    )
  : !empty(filter(normalizedIpRanges, range => !contains(range, '/')))
      ? fail('Each allowedIpRanges entry must be an IPv4 CIDR, for example 203.0.113.10/32.')
      : true

var closedAllowlistRule = [
  {
    name: 'closed-until-allowlist'
    description: 'Empty allowlist. This documentation address is not a client.'
    ipAddressRange: '192.0.2.1/32'
    action: 'Allow'
  }
]

var allowIpRules = [
  for (range, index) in normalizedIpRanges: {
    name: 'allow-${index}'
    description: 'Deploy-time allowlist entry.'
    ipAddressRange: range
    action: 'Allow'
  }
]

var ipSecurityRestrictions = allowlistAccepted
  ? (restrictPublicAccess ? (empty(normalizedIpRanges) ? closedAllowlistRule : allowIpRules) : [])
  : []
// ingress-ip-rules:end

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
        // Platform probes call the replica directly. They do not pass through this list.
        ipSecurityRestrictions: ipSecurityRestrictions
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
              httpGet: readyProbeHttp
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
