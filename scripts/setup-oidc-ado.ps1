#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Sets up Azure AD app registration for ADO Workload Identity Federation.

.DESCRIPTION
    Creates or retrieves an Azure AD app registration, service principal,
    and Contributor role assignment for ADO WIF service connections in the
    MngEnvMCAP675646/AODA WCAG compliance project. Idempotent — safe to run multiple times.

    NOTE: Federated credentials are NOT created here because ADO auto-generates
    the issuer and subject when service connections are created. The bootstrap
    script (bootstrap-demo-apps-ado.ps1) handles federated credential creation
    after creating each service connection.

.EXAMPLE
    ./scripts/setup-oidc-ado.ps1
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AppName = 'ado-a11y-scanner-pipelines'

Write-Host '=== ADO OIDC Setup ===' -ForegroundColor Cyan

# Step 1: Get or create app registration
Write-Host "`n[1/4] Checking for existing app registration '$AppName'..."
$existingApp = az ad app list --display-name $AppName --query '[0]' -o json 2>$null | ConvertFrom-Json

if ($existingApp) {
    $appId    = $existingApp.appId
    $objectId = $existingApp.id
    Write-Host "  Found existing app: $appId" -ForegroundColor Green
} else {
    Write-Host "  Creating app registration..."
    $newApp = az ad app create --display-name $AppName -o json | ConvertFrom-Json
    if (-not $newApp -or -not $newApp.appId) {
        Write-Error "Failed to create app registration '$AppName'. Run 'az login' to refresh your token and try again."
    }
    $appId    = $newApp.appId
    $objectId = $newApp.id
    Write-Host "  Created app: $appId" -ForegroundColor Green
}

# Step 2: Create or get service principal
Write-Host "`n[2/4] Checking for existing service principal..."
$existingSp = az ad sp list --filter "appId eq '$appId'" --query '[0]' -o json 2>$null | ConvertFrom-Json

if ($existingSp) {
    $spObjectId = $existingSp.id
    Write-Host "  Service principal exists: $spObjectId" -ForegroundColor Green
} else {
    Write-Host "  Creating service principal..."
    $newSp      = az ad sp create --id $appId -o json | ConvertFrom-Json
    $spObjectId = $newSp.id
    Write-Host "  Created service principal: $spObjectId" -ForegroundColor Green
}

# Step 3: Assign Contributor role on subscription
Write-Host "`n[3/4] Checking Contributor role assignment..."
$subscriptionId = az account show --query 'id' -o tsv
$existingRole = az role assignment list `
    --assignee $appId `
    --role 'Contributor' `
    --scope "/subscriptions/$subscriptionId" `
    --query '[0]' -o json 2>$null | ConvertFrom-Json

if ($existingRole) {
    Write-Host "  Contributor role already assigned" -ForegroundColor Green
} else {
    Write-Host "  Assigning Contributor role on subscription..."
    az role assignment create `
        --assignee $appId `
        --role 'Contributor' `
        --scope "/subscriptions/$subscriptionId" `
        -o none
    Write-Host "  Contributor role assigned" -ForegroundColor Green
}

# Step 4: Output configuration
$tenantId = az account show --query 'tenantId' -o tsv

Write-Host "`n[4/4] Configuration for ADO Variable Group:" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  AZURE_CLIENT_ID:       $appId"
Write-Host "  AZURE_TENANT_ID:       $tenantId"
Write-Host "  AZURE_SUBSCRIPTION_ID: $subscriptionId"
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "`nNext step: run ./scripts/bootstrap-demo-apps-ado.ps1" -ForegroundColor Yellow
Write-Host "The bootstrap script creates service connections and configures" -ForegroundColor Yellow
Write-Host "federated credentials automatically." -ForegroundColor Yellow
