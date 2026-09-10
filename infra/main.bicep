@description('Base name for all resources')
param appName string

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Docker image tag to deploy')
param imageTag string = 'latest'

@description('App Service Plan SKU')
param appServicePlanSku string = 'P1v3'

var suffix = uniqueString(resourceGroup().id)
var acrName = replace('${appName}${suffix}acr', '-', '')
var appServicePlanName = '${appName}-${suffix}-plan'
var webAppName = '${appName}-${suffix}-app'
var logAnalyticsName = '${appName}-${suffix}-log'
var appInsightsName = '${appName}-${suffix}-ai'

// Azure Container Registry
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
  }
}

// Log Analytics Workspace (required by Application Insights)
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// Application Insights
resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

// App Service Plan (Linux)
resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: appServicePlanSku
  }
  properties: {
    reserved: true
  }
}

// Web App for Containers
resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/${appName}:${imageTag}'
      appSettings: [
        {
          name: 'DOCKER_REGISTRY_SERVER_URL'
          value: 'https://${acr.properties.loginServer}'
        }
        {
          name: 'DOCKER_REGISTRY_SERVER_USERNAME'
          value: acr.listCredentials().username
        }
        {
          name: 'DOCKER_REGISTRY_SERVER_PASSWORD'
          value: acr.listCredentials().passwords[0].value
        }
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'false'
        }
        {
          name: 'WEBSITES_PORT'
          value: '3000'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: applicationInsights.properties.ConnectionString
        }
      ]
    }
    httpsOnly: true
  }
}

@description('ACR login server')
output acrLoginServer string = acr.properties.loginServer

@description('Web app default hostname')
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'

@description('Web app name')
output webAppName string = webApp.name

@description('ACR name')
output acrName string = acr.name

@description('Application Insights connection string')
output appInsightsConnectionString string = applicationInsights.properties.ConnectionString

@description('Application Insights name')
output appInsightsName string = applicationInsights.name
