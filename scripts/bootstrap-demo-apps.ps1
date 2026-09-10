<#
.SYNOPSIS
    Bootstrap 5 a11y demo app repositories under the devopsabcs-engineering organization.

.DESCRIPTION
    Creates a11y-demo-app-001 through a11y-demo-app-005 using GitHub CLI.
    Idempotent: skips repos that already exist.
    Enables code scanning, sets topics, and configures OIDC secrets.

.NOTES
    Prerequisites:
    - GitHub CLI (gh) installed and authenticated with org admin permissions
    - Environment variables or prompted input for OIDC secrets
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$Org = 'devopsabcs-engineering',

    [Parameter()]
    [string]$ScannerRepo = 'accessibility-scan-demo-app'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DemoApps = @(
    @{ Name = 'a11y-demo-app-001'; Port = 8001; Lang = 'Rust';   Theme = 'Travel Agency';     Description = 'A11y demo app 001 - Rust travel booking with WCAG violations' }
    @{ Name = 'a11y-demo-app-002'; Port = 8002; Lang = 'C#';     Theme = 'E-Commerce';        Description = 'A11y demo app 002 - C# e-commerce with WCAG violations' }
    @{ Name = 'a11y-demo-app-003'; Port = 8003; Lang = 'Java';   Theme = 'Learning Platform'; Description = 'A11y demo app 003 - Java learning platform with WCAG violations' }
    @{ Name = 'a11y-demo-app-004'; Port = 8004; Lang = 'Python'; Theme = 'Recipe Sharing';    Description = 'A11y demo app 004 - Python recipe site with WCAG violations' }
    @{ Name = 'a11y-demo-app-005'; Port = 8005; Lang = 'Go';     Theme = 'Fitness Tracker';   Description = 'A11y demo app 005 - Go fitness tracker with WCAG violations' }
)

$Topics = @('accessibility', 'a11y', 'wcag', 'aoda')

# Collect OIDC values from environment variables or prompt
$AzureClientId = $env:AZURE_CLIENT_ID
$AzureTenantId = $env:AZURE_TENANT_ID
$AzureSubscriptionId = $env:AZURE_SUBSCRIPTION_ID

if (-not $AzureClientId) {
    $AzureClientId = Read-Host -Prompt 'Enter AZURE_CLIENT_ID (or press Enter to skip secret configuration)'
}
if ($AzureClientId -and -not $AzureTenantId) {
    $AzureTenantId = Read-Host -Prompt 'Enter AZURE_TENANT_ID'
}
if ($AzureClientId -and -not $AzureSubscriptionId) {
    $AzureSubscriptionId = Read-Host -Prompt 'Enter AZURE_SUBSCRIPTION_ID'
}

$ConfigureSecrets = [bool]$AzureClientId

$script:wikiInitNeeded = @()

$OrgAdminToken = $env:ORG_ADMIN_TOKEN
if ($null -eq $OrgAdminToken) {
    $OrgAdminToken = Read-Host -Prompt 'Enter ORG_ADMIN_TOKEN for wiki push (or press Enter to skip)'
}

# Resolve scanner URL from Azure deployment or environment variable
$ScannerUrl = $env:SCANNER_URL
if (-not $ScannerUrl) {
    $null = az account show 2>&1
    if ($LASTEXITCODE -eq 0) {
        $ScannerUrl = az deployment group show --resource-group rg-a11y-scan-demo --name infra-deploy --query 'properties.outputs.webAppUrl.value' -o tsv 2>$null
    }
}
if (-not $ScannerUrl) {
    $ScannerUrl = Read-Host -Prompt 'Enter SCANNER_URL (scanner app base URL, or press Enter to skip)'
}

# Run OIDC setup if Azure CLI is logged in and secrets are being configured
if ($ConfigureSecrets) {
    $null = az account show 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nAzure CLI is logged in. Running OIDC federation setup..." -ForegroundColor Cyan
        $oidcScript = Join-Path $PSScriptRoot 'setup-oidc.ps1'
        if (Test-Path $oidcScript) {
            & $oidcScript
        }
        else {
            Write-Host "  setup-oidc.ps1 not found at $oidcScript, skipping OIDC setup." -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "`nAzure CLI not logged in. Skipping OIDC setup." -ForegroundColor Yellow
        Write-Host "  Run 'az login' then './scripts/setup-oidc.ps1' manually to configure federated credentials." -ForegroundColor Yellow
    }
}

foreach ($app in $DemoApps) {
    $repoName = $app.Name
    $fullRepo = "$Org/$repoName"

    Write-Host "Processing $fullRepo..." -ForegroundColor Cyan

    # Check if repo already exists (use $LASTEXITCODE since gh is a native command)
    $null = gh repo view $fullRepo --json name 2>&1
    $repoExists = ($LASTEXITCODE -eq 0)

    if ($repoExists) {
        Write-Host "  Repo $fullRepo already exists, skipping creation." -ForegroundColor Yellow
    }
    else {
        Write-Host "  Creating $fullRepo..." -ForegroundColor Green
        gh repo create $fullRepo `
            --public `
            --description $app.Description
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ERROR: Failed to create $fullRepo. Skipping." -ForegroundColor Red
            continue
        }
    }

    # Check if repo has any commits
    $localAppDir = Join-Path $PSScriptRoot "..\$($app.Name)"
    $commitCount = gh api "repos/$fullRepo/commits?per_page=1" --jq 'length' 2>&1
    $repoIsEmpty = ($LASTEXITCODE -ne 0) -or ($commitCount -eq '0') -or ([string]::IsNullOrWhiteSpace($commitCount))

    if ($repoIsEmpty -and (Test-Path $localAppDir)) {
        Write-Host "  Repo is empty. Pushing demo app content from $localAppDir..." -ForegroundColor Green
        $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "$($app.Name)-$(Get-Random)"
        try {
            # Initialize a new git repo and point it at the remote
            New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
            Push-Location $tempDir
            git init -b main 2>&1 | Out-Null
            git remote add origin "https://github.com/$fullRepo.git"
            # Copy all files (including hidden dirs like .github)
            $resolvedAppDir = (Resolve-Path $localAppDir).Path
            Get-ChildItem -Path $resolvedAppDir -Force | ForEach-Object {
                if ($_.PSIsContainer) {
                    Copy-Item -Path $_.FullName -Destination (Join-Path $tempDir $_.Name) -Recurse -Force
                }
                else {
                    Copy-Item -Path $_.FullName -Destination $tempDir -Force
                }
            }
            git add -A
            git commit -m "feat: add a11y demo app $($app.Name) with intentional WCAG violations"
            git push -u origin main 2>&1
            if ($LASTEXITCODE -ne 0) {
                Pop-Location
                Write-Host "  ERROR: Push failed. Repo may already have content." -ForegroundColor Red
            }
            else {
                Pop-Location
                Write-Host "  Demo app content pushed successfully." -ForegroundColor Green
            }
        }
        catch {
            Write-Host "  Warning: Could not push demo app content: $_" -ForegroundColor Yellow
            if ((Get-Location).Path -ne $PSScriptRoot) { Pop-Location }
        }
        finally {
            if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
    elseif ($repoIsEmpty) {
        Write-Host "  Repo is empty but no local content found at $localAppDir. Skipping push." -ForegroundColor Yellow
        Write-Host "  Topics, code scanning, and secrets require at least one commit. Skipping..." -ForegroundColor Yellow
        continue
    }

    # Set topics (requires repo to have at least one commit)
    Write-Host "  Setting topics..." -ForegroundColor Gray
    foreach ($topic in $Topics) {
        gh repo edit $fullRepo --add-topic $topic 2>$null
    }
    # Add language-specific topic
    $langTopic = $app.Lang.ToLower().Replace('#', 'sharp')
    gh repo edit $fullRepo --add-topic $langTopic 2>$null

    # Enable code scanning default setup
    Write-Host "  Enabling code scanning default setup..." -ForegroundColor Gray
    try {
        $result = gh api "repos/$fullRepo/code-scanning/default-setup" `
            -X PATCH `
            -f state=configured 2>&1
        if ($result -match '"message"') {
            Write-Host "  Could not enable code scanning (may require GHAS license or repo visibility change)." -ForegroundColor Yellow
        }
        else {
            Write-Host "  Code scanning enabled." -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  Could not enable code scanning (may require GHAS license)." -ForegroundColor Yellow
    }

    # Configure OIDC secrets (requires repo to have at least one commit)
    if ($ConfigureSecrets) {
        Write-Host "  Configuring OIDC secrets..." -ForegroundColor Gray
        try {
            gh secret set AZURE_CLIENT_ID --repo $fullRepo --body $AzureClientId
            gh secret set AZURE_TENANT_ID --repo $fullRepo --body $AzureTenantId
            gh secret set AZURE_SUBSCRIPTION_ID --repo $fullRepo --body $AzureSubscriptionId
            Write-Host "  OIDC secrets configured." -ForegroundColor Green
        }
        catch {
            Write-Host "  Warning: Could not configure secrets: $_" -ForegroundColor Yellow
        }
    }

    # Create 'production' environment (required for teardown workflow approval gate)
    Write-Host "  Creating 'production' environment..." -ForegroundColor Gray
    $null = gh api "repos/$fullRepo/environments/production" --method PUT 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    Environment created." -ForegroundColor Green
    }
    else {
        Write-Host "    Could not create environment (may need admin access)." -ForegroundColor Yellow
    }

    if ($OrgAdminToken) {
        Write-Host "  Configuring ORG_ADMIN_TOKEN for wiki push..." -ForegroundColor Gray
        try {
            gh secret set ORG_ADMIN_TOKEN --repo $fullRepo --body $OrgAdminToken
            Write-Host "  ORG_ADMIN_TOKEN configured." -ForegroundColor Green
        }
        catch {
            Write-Host "  Warning: Could not configure ORG_ADMIN_TOKEN: $_" -ForegroundColor Yellow
        }
    }

    if ($ScannerUrl) {
        Write-Host "  Configuring SCANNER_URL for a11y scan workflow..." -ForegroundColor Gray
        try {
            gh secret set SCANNER_URL --repo $fullRepo --body $ScannerUrl
            Write-Host "  SCANNER_URL configured." -ForegroundColor Green
        }
        catch {
            Write-Host "  Warning: Could not configure SCANNER_URL: $_" -ForegroundColor Yellow
        }
    }

    # Resolve and set APP_URL from Azure deployment (if deployed)
    $rg = "rg-$($app.Name)"
    $appUrl = az deployment group show --resource-group $rg --name infra-deploy --query 'properties.outputs.webAppUrl.value' -o tsv 2>$null
    if ($appUrl) {
        Write-Host "  Configuring APP_URL ($appUrl)..." -ForegroundColor Gray
        try {
            gh secret set APP_URL --repo $fullRepo --body $appUrl
            Write-Host "  APP_URL configured." -ForegroundColor Green
        }
        catch {
            Write-Host "  Warning: Could not configure APP_URL: $_" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  APP_URL: app not deployed yet, skipping." -ForegroundColor Gray
    }

    # Initialize wiki (required before workflows can push to it)
    if ($OrgAdminToken) {
        Write-Host "  Initializing wiki..." -ForegroundColor Gray
        # Enable wiki feature on the repo
        gh repo edit $fullRepo --enable-wiki 2>$null
        $wikiUrl = "https://x-access-token:${OrgAdminToken}@github.com/${fullRepo}.wiki.git"
        $wikiTempDir = Join-Path ([System.IO.Path]::GetTempPath()) "wiki-init-$($app.Name)-$(Get-Random)"
        $null = git clone --depth 1 $wikiUrl $wikiTempDir 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    Wiki already initialized." -ForegroundColor Green
        }
        else {
            # Wiki git repo doesn't exist until the first page is created via the web UI.
            # Collect repos that need manual wiki init.
            $script:wikiInitNeeded += $fullRepo
            Write-Host "    Wiki needs manual initialization (will show link at end)." -ForegroundColor Yellow
        }
        if (Test-Path $wikiTempDir) { Remove-Item -Recurse -Force $wikiTempDir -ErrorAction SilentlyContinue }
    }
}

# Create 'teardown' environment on scanner repo (required for deploy-all teardown approval gate)
Write-Host "Creating 'teardown' environment on $Org/$ScannerRepo..." -ForegroundColor Cyan
$null = gh api "repos/$Org/$ScannerRepo/environments/teardown" --method PUT 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Teardown environment created." -ForegroundColor Green
}
else {
    Write-Host "  Could not create teardown environment (may need admin access)." -ForegroundColor Yellow
}

# Configure OIDC secrets on the scanner repo (needed for Azure access)
$scannerFullRepo = "$Org/$ScannerRepo"
if ($ConfigureSecrets) {
    Write-Host "Configuring OIDC secrets on $scannerFullRepo..." -ForegroundColor Cyan
    gh secret set AZURE_CLIENT_ID --repo $scannerFullRepo --body $AzureClientId
    gh secret set AZURE_TENANT_ID --repo $scannerFullRepo --body $AzureTenantId
    gh secret set AZURE_SUBSCRIPTION_ID --repo $scannerFullRepo --body $AzureSubscriptionId
    Write-Host "OIDC secrets configured on scanner repo." -ForegroundColor Green
}

# Configure ORG_ADMIN_TOKEN on the scanner repo
if ($OrgAdminToken) {
    Write-Host "Configuring ORG_ADMIN_TOKEN on $scannerFullRepo..." -ForegroundColor Cyan
    gh secret set ORG_ADMIN_TOKEN --repo $scannerFullRepo --body $OrgAdminToken
    Write-Host "ORG_ADMIN_TOKEN configured." -ForegroundColor Green

    # Initialize scanner repo wiki
    Write-Host "Initializing scanner repo wiki..." -ForegroundColor Cyan
    gh repo edit $scannerFullRepo --enable-wiki 2>$null
    $scannerWikiUrl = "https://x-access-token:${OrgAdminToken}@github.com/${scannerFullRepo}.wiki.git"
    $scannerWikiDir = Join-Path ([System.IO.Path]::GetTempPath()) "wiki-scanner-$(Get-Random)"
    $null = git clone --depth 1 $scannerWikiUrl $scannerWikiDir 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Scanner wiki already initialized." -ForegroundColor Green
    }
    else {
        $script:wikiInitNeeded += $scannerFullRepo
        Write-Host "  Scanner wiki needs manual initialization." -ForegroundColor Yellow
    }
    if (Test-Path $scannerWikiDir) { Remove-Item -Recurse -Force $scannerWikiDir -ErrorAction SilentlyContinue }
}

# Configure DISPATCH_PAT on the scanner repo (needed for cross-repo dispatches)
$DispatchPat = $env:DISPATCH_PAT
if (-not $DispatchPat -and $OrgAdminToken) {
    # Fall back to ORG_ADMIN_TOKEN if DISPATCH_PAT not set
    $DispatchPat = $OrgAdminToken
}
if ($DispatchPat) {
    Write-Host "Configuring DISPATCH_PAT on $scannerFullRepo..." -ForegroundColor Cyan
    gh secret set DISPATCH_PAT --repo $scannerFullRepo --body $DispatchPat
    Write-Host "DISPATCH_PAT configured." -ForegroundColor Green
}

# Print wiki initialization instructions if needed
if ($script:wikiInitNeeded.Count -gt 0) {
    Write-Host "`n========================================" -ForegroundColor Yellow
    Write-Host "MANUAL STEP REQUIRED: Initialize wikis" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "GitHub requires the first wiki page to be created via the web UI." -ForegroundColor Yellow
    Write-Host "Click each link below, then click 'Save page' (default content is fine):`n" -ForegroundColor Yellow
    foreach ($repo in $script:wikiInitNeeded) {
        Write-Host "  https://github.com/$repo/wiki/_new" -ForegroundColor Cyan
    }
    Write-Host ""
}

Write-Host "`nBootstrap complete. Created/verified $($DemoApps.Count) demo app repos." -ForegroundColor Cyan
