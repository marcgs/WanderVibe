@description('Registry name. Alphanumeric, globally unique.')
param name string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object

@description('Principal id of the Container App user-assigned identity.')
param acrPullPrincipalId string

// Built-in AcrPull. Pull only; the registry admin user stays disabled.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled'
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, acrPullPrincipalId, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: acrPullPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output id string = registry.id
output name string = registry.name
output loginServer string = registry.properties.loginServer
output acrPullAssignmentName string = acrPull.name
