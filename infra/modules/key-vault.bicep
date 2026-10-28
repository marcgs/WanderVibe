@description('Key Vault name. Globally unique, 3-24 characters.')
param name string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object

@description('Principal id of the Container App identity. Granted Key Vault Secrets User.')
param appIdentityPrincipalId string

// Key Vault Secrets User: get secret values. The Container App identity gets this and nothing broader.
var secretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    // RBAC only. Do not add accessPolicies.
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: false
    publicNetworkAccess: 'Enabled'
  }
}

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, appIdentityPrincipalId, secretsUserRoleId)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsUserRoleId)
    principalId: appIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output id string = vault.id
output name string = vault.name
output uri string = vault.properties.vaultUri
output secretsUserAssignmentName string = secretsUser.name
