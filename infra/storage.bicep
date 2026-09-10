@description('Name of the storage account')
param storageAccountName string

@description('Azure region for all resources')
param location string = resourceGroup().location

// Storage Account
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

// Blob Services
resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

// Blob Container for scan results
resource scanResultsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobServices
  name: 'a11y-scan-results'
  properties: {
    publicAccess: 'None'
  }
}

@description('Storage account name')
output storageAccountName string = storageAccount.name

@description('Blob service endpoint')
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob

@description('Container name')
output containerName string = scanResultsContainer.name
