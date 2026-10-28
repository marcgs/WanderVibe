@description('Log Analytics workspace name. Unique inside the resource group.')
param name string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object

@description('Retention in days. 30 is the minimum for the PerGB2018 SKU.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 30

@description('Daily ingestion cap in GB. Limits cost for a personal app.')
@minValue(1)
param dailyQuotaGb int = 1

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    workspaceCapping: {
      dailyQuotaGb: dailyQuotaGb
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

output id string = workspace.id
output name string = workspace.name
output customerId string = workspace.properties.customerId
