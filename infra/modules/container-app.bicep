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

@description('IPv4 CIDRs allowed through ingress while restrictPublicAccess is true. Empty closes ingress to every real client. Set the value at deploy time. Do not commit addresses. At most 32 entries. That cap belongs to this repository, not to Container Apps.')
@maxLength(32)
param allowedIpRanges string[] = []

@description('Smallest prefix length accepted in allowedIpRanges. Defaults to 16. Cannot be set below 8, so a CLI override cannot allow a prefix shorter than /8. 32 is the longest prefix.')
@minValue(8)
@maxValue(32)
param minAllowedPrefixLength int = 16

@description('When true, ingress allows only allowedIpRanges. Parameter files keep this true. Set false only after sign-in is configured, as docs/deploy.md describes. /api/health and /api/ready stay anonymous.')
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
// which Azure treats as allow all, and only after sign-in is configured.
// Octets are decimal, 0-255, with no leading zeros. The prefix is /minAllowedPrefixLength through /32.
func isOctet(o string) bool => length(o) >= 1 && length(o) <= 3 && empty(filter(range(0, length(o)), i => !contains('0123456789', substring(o, i, 1)))) && string(int(o)) == o && int(o) <= 255
func isIpv4Cidr(r string, minPrefix int) bool => length(split(r, '/')) == 2 && length(split(split(r, '/')[0], '.')) == 4 && empty(filter(split(split(r, '/')[0], '.'), o => !isOctet(o))) && isOctet(split(r, '/')[1]) && int(split(r, '/')[1]) >= minPrefix && int(split(r, '/')[1]) <= 32

var normalizedIpRanges = union(filter(map(allowedIpRanges, r => trim(r)), r => !empty(r)), [])
var invalidIpRanges = filter(normalizedIpRanges, r => !isIpv4Cidr(r, minAllowedPrefixLength))
var allowlistAccepted = empty(invalidIpRanges) ? true : fail('allowedIpRanges entries must be IPv4 CIDRs with a prefix from /${minAllowedPrefixLength} to /32: ${join(invalidIpRanges, ', ')}')

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

// The false branch is unreachable while fail() aborts on invalidIpRanges. It stays
// the closed rule so a later edit cannot fall through to an empty list (allow all).
var ipSecurityRestrictions = allowlistAccepted
  ? (restrictPublicAccess ? (empty(normalizedIpRanges) ? closedAllowlistRule : allowIpRules) : [])
  : closedAllowlistRule
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
