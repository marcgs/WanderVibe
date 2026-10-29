@description('Versionless Key Vault URI, including the trailing slash. Secret values are not passed in.')
param keyVaultUri string

@description('Key Vault secret that holds the Postgres connection string. Written by infra/main.bicep.')
param databaseUrlSecretName string

@description('Key Vault secret that holds the Application Insights connection string. Written by infra/main.bicep.')
param applicationInsightsSecretName string

// Auth provider values are written by the operator with az keyvault secret set.
// This module only builds references. See docs/deploy.md.

var references = [
  {
    name: 'DATABASE_URL'
    secret: databaseUrlSecretName
  }
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    secret: applicationInsightsSecretName
  }
  {
    name: 'AUTH_SECRET'
    secret: 'auth-secret'
  }
  {
    name: 'AUTH_GOOGLE_ID'
    secret: 'auth-google-id'
  }
  {
    name: 'AUTH_GOOGLE_SECRET'
    secret: 'auth-google-secret'
  }
  {
    name: 'AUTH_MICROSOFT_ENTRA_ID_ID'
    secret: 'auth-microsoft-entra-id-id'
  }
  {
    name: 'AUTH_MICROSOFT_ENTRA_ID_SECRET'
    secret: 'auth-microsoft-entra-id-secret'
  }
  {
    name: 'AUTH_MICROSOFT_ENTRA_ID_ISSUER'
    secret: 'auth-microsoft-entra-id-issuer'
  }
]

output keyVaultSecrets array = [
  for item in references: {
    name: item.secret
    keyVaultUrl: '${keyVaultUri}secrets/${item.secret}'
  }
]

output secretEnvironmentVariables array = [
  for item in references: {
    name: item.name
    secretRef: item.secret
  }
]
