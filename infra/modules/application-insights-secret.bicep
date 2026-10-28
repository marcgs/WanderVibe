@description('Application Insights component name in this resource group.')
param appInsightsName string

@description('Key Vault name in this resource group.')
param vaultName string

@description('Secret name that stores the Application Insights connection string.')
param secretName string

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' existing = {
  name: vaultName
}

resource secret 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = {
  parent: vault
  name: secretName
  properties: {
    value: appInsights.properties.ConnectionString
  }
}

output versionlessUrl string = '${vault.properties.vaultUri}secrets/${secretName}'
