@description('Versionless Key Vault URI, including the trailing slash. Secret values are not passed in.')
param keyVaultUri string

@description('Key Vault secret that holds the Postgres connection string. Written by infra/main.bicep.')
param databaseUrlSecretName string

@description('Key Vault secret that holds the Application Insights connection string. Written by infra/main.bicep.')
param applicationInsightsSecretName string

@description('When true, reference auth-secret and set AUTH_URL. Provider secrets stay off until their own flags are true.')
param authConfigured bool

@description('When true with authConfigured, reference the Google client id and secret. No placeholder is created for a provider you are not using.')
param googleAuthConfigured bool

@description('When true with authConfigured, reference the Entra client id, secret, and issuer.')
param microsoftAuthConfigured bool

@description('Public origin, https://<container-app-fqdn>. Used as AUTH_URL only when authConfigured is true.')
param authUrl string

// One list for the template and for infra/tests/auth-secrets.test.bicep.
// Provider flags do nothing until authConfigured is true, so a half-set
// variable cannot point the app at a secret that does not exist.
@export()
func platformNames(databaseSecret string, insightsSecret string) string => 'DATABASE_URL=${databaseSecret},APPLICATIONINSIGHTS_CONNECTION_STRING=${insightsSecret}'

@export()
func googleNames(on bool) string => on ? ',AUTH_GOOGLE_ID=auth-google-id,AUTH_GOOGLE_SECRET=auth-google-secret' : ''

@export()
func microsoftNames(on bool) string => on ? ',AUTH_MICROSOFT_ENTRA_ID_ID=auth-microsoft-entra-id-id,AUTH_MICROSOFT_ENTRA_ID_SECRET=auth-microsoft-entra-id-secret,AUTH_MICROSOFT_ENTRA_ID_ISSUER=auth-microsoft-entra-id-issuer' : ''

@export()
func includedSecretNames(authOn bool, googleOn bool, microsoftOn bool, databaseSecret string, insightsSecret string) string =>
  authOn
    ? '${platformNames(databaseSecret, insightsSecret)},AUTH_SECRET=auth-secret${googleNames(googleOn)}${microsoftNames(microsoftOn)}'
    : platformNames(databaseSecret, insightsSecret)

@export()
func plainEnvNames(authOn bool) string => authOn ? 'AUTH_URL' : ''

var useGoogle = authConfigured && googleAuthConfigured
var useMicrosoft = authConfigured && microsoftAuthConfigured

var references = [
  for pair in split(includedSecretNames(authConfigured, useGoogle, useMicrosoft, databaseUrlSecretName, applicationInsightsSecretName), ','): {
    name: split(pair, '=')[0]
    secret: split(pair, '=')[1]
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

output plainEnvironmentVariables array = authConfigured
  ? [
      {
        name: 'AUTH_URL'
        value: authUrl
      }
    ]
  : []
