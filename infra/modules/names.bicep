@description('Deployment environment. Staging and production use separate resource groups.')
@allowed([
  'staging'
  'prod'
])
param environmentName string

@description('Optional lowercase alphanumeric suffix (max 10) for globally unique names. Empty uses a hash of the resource group id.')
@maxLength(10)
param nameSuffix string = ''

var envShort = environmentName == 'prod' ? 'prd' : 'stg'
var suffix = nameSuffix == '' ? take(uniqueString(resourceGroup().id), 8) : nameSuffix

output databaseName string = 'wandervibe'
output databaseUrlSecretName string = 'database-url'
output applicationInsightsSecretName string = 'applicationinsights-connection-string'
output containerRegistryName string = 'acrwv${envShort}${suffix}'
output keyVaultName string = 'kvwv${envShort}${suffix}'
output postgresServerName string = 'psql-wv-${envShort}-${suffix}'
output logAnalyticsName string = 'log-wv-${environmentName}'
output applicationInsightsName string = 'appi-wv-${environmentName}'
output identityName string = 'id-wv-${environmentName}'
output containerAppsEnvironmentName string = 'cae-wv-${environmentName}'
output containerAppName string = 'ca-wv-${environmentName}'
output migrationJobName string = 'job-wv-${environmentName}-migrate'
