import { includedSecretNames, plainEnvNames } from '../modules/app-env.bicep'

param authConfigured bool
param googleAuthConfigured bool
param microsoftAuthConfigured bool

var names = includedSecretNames(
  authConfigured,
  authConfigured && googleAuthConfigured,
  authConfigured && microsoftAuthConfigured,
  'database-url',
  'applicationinsights-connection-string'
)
var packed = ',${replace(names, '=', ',')},'

func has(name string) bool => contains(packed, ',${name},')

var expectAuth = authConfigured
var expectGoogle = authConfigured && googleAuthConfigured
var expectMicrosoft = authConfigured && microsoftAuthConfigured

assert databaseStays = has('database-url') && has('DATABASE_URL')
assert insightsStays = has('applicationinsights-connection-string') && has('APPLICATIONINSIGHTS_CONNECTION_STRING')
assert authSecret = (has('AUTH_SECRET') && has('auth-secret')) == expectAuth
assert google = (has('AUTH_GOOGLE_ID') && has('auth-google-id') && has('AUTH_GOOGLE_SECRET') && has('auth-google-secret')) == expectGoogle
assert microsoft = (has('AUTH_MICROSOFT_ENTRA_ID_ID') && has('auth-microsoft-entra-id-id') && has('AUTH_MICROSOFT_ENTRA_ID_SECRET') && has('auth-microsoft-entra-id-secret') && has('AUTH_MICROSOFT_ENTRA_ID_ISSUER') && has('auth-microsoft-entra-id-issuer')) == expectMicrosoft
assert authUrl = plainEnvNames(authConfigured) == (authConfigured ? 'AUTH_URL' : '')
