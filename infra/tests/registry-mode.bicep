// Asserts the registry permission mode the production module must keep.
// bicep test cannot read a nested module output (reference() is rejected),
// so check-cd.sh also compiles infra/modules/container-registry.bicep.
param registryName string

var roleAssignmentMode = 'LegacyRegistryPermissions'

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: registryName
  location: 'switzerlandnorth'
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled'
    roleAssignmentMode: roleAssignmentMode
  }
}

assert legacyPermissions = roleAssignmentMode == 'LegacyRegistryPermissions'
