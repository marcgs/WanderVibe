@description('Container Apps environment name.')
param name string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object

@description('Log Analytics workspace name in this resource group.')
param logAnalyticsWorkspaceName string

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-07-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource environment 'Microsoft.App/managedEnvironments@2026-01-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    zoneRedundant: false
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
  }
}

output id string = environment.id
output name string = environment.name
output defaultDomain string = environment.properties.defaultDomain
