#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Sets up OIDC federation for GitHub Actions to authenticate with Azure.

.DESCRIPTION
    Creates or retrieves an Azure AD app registration, federated credential,
    service principal, and Contributor role assignment for the accessibility-scan-demo-app
    repository and 5 a11y demo app repositories. Idempotent — safe to run multiple times.

.EXAMPLE
    ./scripts/setup-oidc.ps1
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AppName = 'gh-a11y-scanner-github-actions'
$RepoOwner = 'devopsabcs-engineering'
$ScannerRepo = 'accessibility-scan-demo-app'
$Issuer = 'https://token.actions.githubusercontent.com'
$Audience = 'api://AzureADTokenExchange'

# Rename legacy app registration to new prefixed name (preserves appId, credentials, and role assignments)
$oldApp = az ad app list --display-name "a11y-scanner-github-actions" --query "[0].id" -o tsv
if ($oldApp) {
    az ad app update --id $oldApp --display-name $AppName
    Write-Host "Renamed existing app registration to $AppName"
}

# All repos that need federated credentials (scanner + 5 demo apps)
# Each repo gets a main branch credential; demo apps get deploy-NNN and teardown-NNN environment credentials
# Azure AD limit: 20 federated credentials per app registration (current count: 17)
$FederatedRepos = @(
    @{ Repo = $ScannerRepo;        CredName = 'github-actions-scanner-main';          Subject = "repo:${RepoOwner}/${ScannerRepo}:ref:refs/heads/main";                    Description = "OIDC for $RepoOwner/$ScannerRepo main branch" }
    @{ Repo = $ScannerRepo;        CredName = 'github-actions-scanner-teardown-env';   Subject = "repo:${RepoOwner}/${ScannerRepo}:environment:teardown";                   Description = "OIDC for $RepoOwner/$ScannerRepo teardown environment" }
    @{ Repo = 'a11y-demo-app-001'; CredName = 'github-actions-demo-001-main';         Subject = "repo:${RepoOwner}/a11y-demo-app-001:ref:refs/heads/main";                 Description = "OIDC for $RepoOwner/a11y-demo-app-001 main branch" }
    @{ Repo = 'a11y-demo-app-001'; CredName = 'github-actions-demo-001-deploy-env';   Subject = "repo:${RepoOwner}/a11y-demo-app-001:environment:deploy-001";              Description = "OIDC for $RepoOwner/a11y-demo-app-001 deploy environment" }
    @{ Repo = 'a11y-demo-app-001'; CredName = 'github-actions-demo-001-teardown-env'; Subject = "repo:${RepoOwner}/a11y-demo-app-001:environment:teardown-001";            Description = "OIDC for $RepoOwner/a11y-demo-app-001 teardown environment" }
    @{ Repo = 'a11y-demo-app-002'; CredName = 'github-actions-demo-002-main';         Subject = "repo:${RepoOwner}/a11y-demo-app-002:ref:refs/heads/main";                 Description = "OIDC for $RepoOwner/a11y-demo-app-002 main branch" }
    @{ Repo = 'a11y-demo-app-002'; CredName = 'github-actions-demo-002-deploy-env';   Subject = "repo:${RepoOwner}/a11y-demo-app-002:environment:deploy-002";              Description = "OIDC for $RepoOwner/a11y-demo-app-002 deploy environment" }
    @{ Repo = 'a11y-demo-app-002'; CredName = 'github-actions-demo-002-teardown-env'; Subject = "repo:${RepoOwner}/a11y-demo-app-002:environment:teardown-002";            Description = "OIDC for $RepoOwner/a11y-demo-app-002 teardown environment" }
    @{ Repo = 'a11y-demo-app-003'; CredName = 'github-actions-demo-003-main';         Subject = "repo:${RepoOwner}/a11y-demo-app-003:ref:refs/heads/main";                 Description = "OIDC for $RepoOwner/a11y-demo-app-003 main branch" }
    @{ Repo = 'a11y-demo-app-003'; CredName = 'github-actions-demo-003-deploy-env';   Subject = "repo:${RepoOwner}/a11y-demo-app-003:environment:deploy-003";              Description = "OIDC for $RepoOwner/a11y-demo-app-003 deploy environment" }
    @{ Repo = 'a11y-demo-app-003'; CredName = 'github-actions-demo-003-teardown-env'; Subject = "repo:${RepoOwner}/a11y-demo-app-003:environment:teardown-003";            Description = "OIDC for $RepoOwner/a11y-demo-app-003 teardown environment" }
    @{ Repo = 'a11y-demo-app-004'; CredName = 'github-actions-demo-004-main';         Subject = "repo:${RepoOwner}/a11y-demo-app-004:ref:refs/heads/main";                 Description = "OIDC for $RepoOwner/a11y-demo-app-004 main branch" }
    @{ Repo = 'a11y-demo-app-004'; CredName = 'github-actions-demo-004-deploy-env';   Subject = "repo:${RepoOwner}/a11y-demo-app-004:environment:deploy-004";              Description = "OIDC for $RepoOwner/a11y-demo-app-004 deploy environment" }
    @{ Repo = 'a11y-demo-app-004'; CredName = 'github-actions-demo-004-teardown-env'; Subject = "repo:${RepoOwner}/a11y-demo-app-004:environment:teardown-004";            Description = "OIDC for $RepoOwner/a11y-demo-app-004 teardown environment" }
    @{ Repo = 'a11y-demo-app-005'; CredName = 'github-actions-demo-005-main';         Subject = "repo:${RepoOwner}/a11y-demo-app-005:ref:refs/heads/main";                 Description = "OIDC for $RepoOwner/a11y-demo-app-005 main branch" }
    @{ Repo = 'a11y-demo-app-005'; CredName = 'github-actions-demo-005-deploy-env';   Subject = "repo:${RepoOwner}/a11y-demo-app-005:environment:deploy-005";              Description = "OIDC for $RepoOwner/a11y-demo-app-005 deploy environment" }
    @{ Repo = 'a11y-demo-app-005'; CredName = 'github-actions-demo-005-teardown-env'; Subject = "repo:${RepoOwner}/a11y-demo-app-005:environment:teardown-005";            Description = "OIDC for $RepoOwner/a11y-demo-app-005 teardown environment" }
)

# Stale credentials to remove (legacy prod-env entries no longer used by any workflow)
$StaleCreds = @(
    'github-actions-demo-001-prod-env'
    'github-actions-demo-002-prod-env'
    'github-actions-demo-003-prod-env'
    'github-actions-demo-004-prod-env'
    'github-actions-demo-005-prod-env'
)

Write-Host '=== OIDC Federation Setup ===' -ForegroundColor Cyan

# Step 1: Get or create app registration
Write-Host "`n[1/6] Checking for existing app registration '$AppName'..."
$existingApp = az ad app list --display-name $AppName --query '[0]' -o json 2>$null | ConvertFrom-Json

if ($existingApp) {
    $appId = $existingApp.appId
    $objectId = $existingApp.id
    Write-Host "  Found existing app: $appId" -ForegroundColor Green
} else {
    Write-Host "  Creating app registration..."
    $newApp = az ad app create --display-name $AppName -o json | ConvertFrom-Json
    $appId = $newApp.appId
    $objectId = $newApp.id
    Write-Host "  Created app: $appId" -ForegroundColor Green
}

# Step 2: Remove stale federated credentials (legacy prod-env entries)
Write-Host "`n[2/6] Removing stale federated credentials..."
foreach ($staleName in $StaleCreds) {
    $staleCred = az ad app federated-credential list --id $objectId --query "[?name=='$staleName']" -o json 2>$null | ConvertFrom-Json
    if ($staleCred -and $staleCred.Count -gt 0) {
        Write-Host "  Removing stale credential '$staleName'..."
        az ad app federated-credential delete --id $objectId --federated-credential-id $staleCred[0].id -o none
        Write-Host "    Removed" -ForegroundColor Green
    } else {
        Write-Host "  '$staleName' not found, skipping" -ForegroundColor Gray
    }
}

# Step 3: Create or verify federated credentials for all repos
Write-Host "`n[3/6] Configuring federated credentials for $($FederatedRepos.Count) entries..."
foreach ($fedRepo in $FederatedRepos) {
    $credName = $fedRepo.CredName
    $subject = $fedRepo.Subject
    Write-Host "  Checking credential '$credName' (subject: $subject)..."

    $existingCred = az ad app federated-credential list --id $objectId --query "[?name=='$credName']" -o json 2>$null | ConvertFrom-Json

    if ($existingCred -and $existingCred.Count -gt 0) {
        Write-Host "    Already exists" -ForegroundColor Green
    } else {
        # Also check if a credential with the same subject already exists under a different name
        $subjectMatch = az ad app federated-credential list --id $objectId --query "[?subject=='$subject']" -o json 2>$null | ConvertFrom-Json
        if ($subjectMatch -and $subjectMatch.Count -gt 0) {
            Write-Host "    Already exists (as '$($subjectMatch[0].name)')" -ForegroundColor Green
        } else {
            Write-Host "    Creating..."
            $credBody = @{
                name        = $credName
                issuer      = $Issuer
                subject     = $subject
                audiences   = @($Audience)
                description = $fedRepo.Description
            } | ConvertTo-Json -Compress

            $credBody | az ad app federated-credential create --id $objectId --parameters "@-" -o none
            Write-Host "    Created" -ForegroundColor Green
        }
    }
}

# Step 4: Create or get service principal
Write-Host "`n[4/6] Checking for existing service principal..."
$existingSp = az ad sp list --filter "appId eq '$appId'" --query '[0]' -o json 2>$null | ConvertFrom-Json

if ($existingSp) {
    $spObjectId = $existingSp.id
    Write-Host "  Service principal exists: $spObjectId" -ForegroundColor Green
} else {
    Write-Host "  Creating service principal..."
    $newSp = az ad sp create --id $appId -o json | ConvertFrom-Json
    $spObjectId = $newSp.id
    Write-Host "  Created service principal: $spObjectId" -ForegroundColor Green
}

# Step 5: Assign Contributor role on subscription (required for deployments)
Write-Host "`n[5/6] Checking Contributor role assignment..."
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

# Step 6: Output configuration
$tenantId = az account show --query 'tenantId' -o tsv

Write-Host "`n[6/6] Configuration for GitHub Secrets:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AZURE_CLIENT_ID:       $appId"
Write-Host "  AZURE_TENANT_ID:       $tenantId"
Write-Host "  AZURE_SUBSCRIPTION_ID: $subscriptionId"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nFederated credentials configured for:" -ForegroundColor Yellow
foreach ($fedRepo in $FederatedRepos) {
    Write-Host "  - $RepoOwner/$($fedRepo.Repo)" -ForegroundColor Yellow
}
Write-Host "`nAdd these as repository secrets via the bootstrap script:" -ForegroundColor Yellow
Write-Host "  ./scripts/bootstrap-demo-apps.ps1" -ForegroundColor Yellow
