@description('Flexible Server name. Globally unique, lowercase.')
param name string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object

@description('Administrator login. Not a secret.')
param administratorLogin string

@secure()
@description('Administrator password. Supplied at deploy time.')
param administratorLoginPassword string

@description('Database name created on the server.')
param databaseName string

@description('PostgreSQL major version. Matches local and CI Postgres 17.')
param version string = '17'

@description('Storage in GiB. 32 is the smallest Flexible Server size.')
@minValue(32)
param storageSizeGB int = 32

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: version
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    authConfig: {
      passwordAuth: 'Enabled'
      activeDirectoryAuth: 'Disabled'
    }
    // Public access with the Azure-services firewall rule below.
    // VNet integration and private endpoints are out of scope. See ADR-0002.
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// 0.0.0.0–0.0.0.0 is the documented "allow Azure services" rule.
// Container Apps consumption has no stable egress IP, and private endpoints are out of scope.
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = {
  parent: server
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource requireSsl 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2025-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: {
    value: 'ON'
    source: 'user-override'
  }
}

output id string = server.id
output name string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
