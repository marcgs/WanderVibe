@description('Name of the existing Key Vault.')
param vaultName string

@description('Secret name.')
param secretName string

@secure()
@description('Secret value. Never written to a parameter file.')
param secretValue string

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' existing = {
  name: vaultName
}

resource secret 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = {
  parent: vault
  name: secretName
  properties: {
    value: secretValue
  }
}

// Versionless URL so a new secret version does not require a new id in the template.
output versionlessUrl string = '${vault.properties.vaultUri}secrets/${secretName}'
