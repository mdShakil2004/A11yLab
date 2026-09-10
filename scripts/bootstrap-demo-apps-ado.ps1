<#
.SYNOPSIS
    Bootstrap ADO resources for the a11y demo apps and scanner in Azure DevOps.

.DESCRIPTION
    Creates Azure Repos, variable groups, WIF service connections, environments,
    pipelines, and a project wiki for the accessibility-scan-demo-app project.
    Idempotent: skips resources that already exist.

.NOTES
    Prerequisites:
    - Azure CLI with azure-devops extension (`az extension add --name azure-devops`)
    - PowerShell 7+
    - Azure CLI authenticated (`az login`)
    - Azure DevOps PAT or `az devops login` with project admin permissions
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$Org = 'MngEnvMCAP675646',

    [Parameter()]
    [string]$Project = 'AODA WCAG compliance'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
$OrgUrl      = "https://dev.azure.com/$Org"
$AdoResource = '499b84ac-1321-427f-aa17-267ca6975798'

$ScannerRepoName = 'accessibility-scan-demo-app'

$DemoApps = @(
    @{ Number = '001'; Language = 'Rust';   Description = 'A11y demo app 001 - Rust travel booking with WCAG violations' }
    @{ Number = '002'; Language = 'C#';     Description = 'A11y demo app 002 - C# e-commerce with WCAG violations' }
    @{ Number = '003'; Language = 'Java';   Description = 'A11y demo app 003 - Java learning platform with WCAG violations' }
    @{ Number = '004'; Language = 'Python'; Description = 'A11y demo app 004 - Python recipe site with WCAG violations' }
    @{ Number = '005'; Language = 'Go';     Description = 'A11y demo app 005 - Go fitness tracker with WCAG violations' }
)

$ServiceConnectionNames = @('a11y-scanner-ado') + ($DemoApps | ForEach-Object { "a11y-demo-app-$($_.Number)" })

$ScannerPipelines = @(
    @{ Name = 'scanner-ci';             YmlPath = '.azuredevops/pipelines/ci.yml' }
    @{ Name = 'scanner-deploy';         YmlPath = '.azuredevops/pipelines/deploy.yml' }
    @{ Name = 'scanner-a11y-scan';      YmlPath = '.azuredevops/pipelines/a11y-scan.yml' }
    @{ Name = 'scanner-deploy-all';     YmlPath = '.azuredevops/pipelines/deploy-all.yml' }
    @{ Name = 'scanner-scan-all';       YmlPath = '.azuredevops/pipelines/scan-all.yml' }
    @{ Name = 'scanner-scan-and-store'; YmlPath = '.azuredevops/pipelines/scan-and-store.yml' }
)

# ---------------------------------------------------------------------------
# Helper: check if a variable group exists by name
# ---------------------------------------------------------------------------
function Get-VariableGroupByName {
    param([string]$GroupName)
    $groups = az pipelines variable-group list --query "[?name=='$GroupName']" -o json 2>$null | ConvertFrom-Json
    if ($groups -and $groups.Count -gt 0) { return $groups[0] }
    return $null
}

# ---------------------------------------------------------------------------
# Helper: check if a service connection exists by name
# ---------------------------------------------------------------------------
function Get-ServiceEndpointByName {
    param([string]$EndpointName)
    $apiUrl = "$OrgUrl/$Project/_apis/serviceendpoint/endpoints?endpointNames=$EndpointName&api-version=7.1"
    $result = az rest -u $apiUrl -m GET --resource $AdoResource -o json 2>$null | ConvertFrom-Json
    if ($result -and $result.value -and $result.value.Count -gt 0) { return $result.value[0] }
    return $null
}

# ---------------------------------------------------------------------------
# Helper: check if an environment exists by name
# ---------------------------------------------------------------------------
function Get-EnvironmentByName {
    param([string]$EnvName)
    $apiUrl = "$OrgUrl/$Project/_apis/pipelines/environments?name=$EnvName&api-version=7.1"
    $result = az rest -u $apiUrl -m GET --resource $AdoResource -o json 2>$null | ConvertFrom-Json
    if ($result -and $result.value -and $result.value.Count -gt 0) { return $result.value[0] }
    return $null
}

# ---------------------------------------------------------------------------
# Step 1: Set default org and project
# ---------------------------------------------------------------------------
Write-Host '=== ADO Bootstrap ===' -ForegroundColor Cyan
Write-Host "`n[1/10] Configuring Azure DevOps CLI defaults..." -ForegroundColor Cyan
az devops configure --defaults organization=$OrgUrl project=$Project
Write-Host "  Defaults set: org=$OrgUrl project=$Project" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Step 2: Run OIDC setup if Azure CLI is logged in
# ---------------------------------------------------------------------------
Write-Host "`n[2/10] Checking Azure CLI login for OIDC setup..." -ForegroundColor Cyan
$null = az account show 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host '  Azure CLI is logged in. Running OIDC federation setup...' -ForegroundColor Cyan
    $oidcScript = Join-Path $PSScriptRoot 'setup-oidc-ado.ps1'
    if (Test-Path $oidcScript) {
        & $oidcScript
    }
    else {
        Write-Host "  setup-oidc-ado.ps1 not found at $oidcScript, skipping OIDC setup." -ForegroundColor Yellow
    }
}
else {
    Write-Host '  Azure CLI not logged in. Skipping OIDC setup.' -ForegroundColor Yellow
    Write-Host "  Run 'az login' then './scripts/setup-oidc-ado.ps1' manually." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Step 3: Create Azure Repos for demo apps
# ---------------------------------------------------------------------------
Write-Host "`n[3/10] Creating Azure Repos for demo apps..." -ForegroundColor Cyan

$allRepos = @($ScannerRepoName) + ($DemoApps | ForEach-Object { "a11y-demo-app-$($_.Number)" })
$encodedProject = [uri]::EscapeDataString($Project)

foreach ($repoName in $allRepos) {
    $existingRepo = az repos show --repository $repoName -o json 2>$null | ConvertFrom-Json
    if ($existingRepo) {
        Write-Host "  Repo '$repoName' already exists." -ForegroundColor Yellow
    }
    else {
        Write-Host "  Creating repo '$repoName'..."
        az repos create --name $repoName -o none 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Warning: could not create repo '$repoName'." -ForegroundColor Yellow
            continue
        }
        Write-Host "  Repo '$repoName' created." -ForegroundColor Green
    }

    # Check if repo has content (push to empty repos regardless of whether just created)
    $refs = az repos ref list --repository $repoName --query '[].name' -o tsv 2>$null
    $repoHasContent = ($LASTEXITCODE -eq 0) -and ($refs -and $refs.Trim().Length -gt 0)

    if ($repoHasContent) {
        Write-Host "  Repo '$repoName' already has content, skipping push." -ForegroundColor Yellow
        continue
    }

    # Determine local source directory
    if ($repoName -eq $ScannerRepoName) {
        $localAppDir = Join-Path $PSScriptRoot '..'
    }
    else {
        $localAppDir = Join-Path $PSScriptRoot "..\$repoName"
    }

    if (-not (Test-Path $localAppDir)) {
        Write-Host "  No local content found for '$repoName', skipping push." -ForegroundColor Yellow
        continue
    }

    Write-Host "  Pushing content to '$repoName'..."
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "ado-$repoName-$(Get-Random)"
    try {
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        Push-Location $tempDir
        git init -b main 2>&1 | Out-Null
        $remoteUrl = "$OrgUrl/$encodedProject/_git/$repoName"
        git remote add origin $remoteUrl

        $resolvedAppDir = (Resolve-Path $localAppDir).Path
        Get-ChildItem -Path $resolvedAppDir -Force | Where-Object { $_.Name -ne '.git' } | ForEach-Object {
            if ($_.PSIsContainer) {
                Copy-Item -Path $_.FullName -Destination (Join-Path $tempDir $_.Name) -Recurse -Force
            }
            else {
                Copy-Item -Path $_.FullName -Destination $tempDir -Force
            }
        }
        git add -A
        git commit -m "feat: add $repoName with intentional WCAG violations" 2>&1 | Out-Null
        git push -u origin main 2>&1
        if ($LASTEXITCODE -eq 0) {
            Pop-Location
            Write-Host "  Content pushed to '$repoName'." -ForegroundColor Green
        }
        else {
            Pop-Location
            Write-Host "  Warning: could not push content to '$repoName'." -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "  Warning: could not push demo app content: $_" -ForegroundColor Yellow
        if ((Get-Location).Path -ne $PSScriptRoot) { Pop-Location }
    }
    finally {
        if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

# ---------------------------------------------------------------------------
# Step 4: Collect OIDC and secret values
# ---------------------------------------------------------------------------
Write-Host "`n[4/10] Collecting configuration values..." -ForegroundColor Cyan

$AzureClientId       = $env:AZURE_CLIENT_ID
$AzureTenantId       = $env:AZURE_TENANT_ID
$AzureSubscriptionId = $env:AZURE_SUBSCRIPTION_ID

# Auto-detect from Azure CLI and app registration if not set
if (-not $AzureClientId) {
    $null = az account show 2>&1
    if ($LASTEXITCODE -eq 0) {
        $autoApp = az ad app list --display-name 'ado-a11y-scanner-pipelines' --query '[0].appId' -o tsv 2>$null
        if ($autoApp) {
            $AzureClientId = $autoApp
            Write-Host "  Auto-detected AZURE_CLIENT_ID from app registration: $AzureClientId" -ForegroundColor Green
        }
    }
}
if (-not $AzureTenantId) {
    $AzureTenantId = az account show --query 'tenantId' -o tsv 2>$null
    if ($AzureTenantId) {
        Write-Host "  Auto-detected AZURE_TENANT_ID: $AzureTenantId" -ForegroundColor Green
    }
}
if (-not $AzureSubscriptionId) {
    $AzureSubscriptionId = az account show --query 'id' -o tsv 2>$null
    if ($AzureSubscriptionId) {
        Write-Host "  Auto-detected AZURE_SUBSCRIPTION_ID: $AzureSubscriptionId" -ForegroundColor Green
    }
}

if (-not $AzureClientId) {
    $AzureClientId = Read-Host -Prompt 'Enter AZURE_CLIENT_ID (or press Enter to skip variable group creation)'
}
if ($AzureClientId -and -not $AzureTenantId) {
    $AzureTenantId = Read-Host -Prompt 'Enter AZURE_TENANT_ID'
}
if ($AzureClientId -and -not $AzureSubscriptionId) {
    $AzureSubscriptionId = Read-Host -Prompt 'Enter AZURE_SUBSCRIPTION_ID'
}

$ConfigureVariables = [bool]$AzureClientId

# ---------------------------------------------------------------------------
# Step 5: Create variable groups
# ---------------------------------------------------------------------------
Write-Host "`n[5/10] Creating variable groups..." -ForegroundColor Cyan

if ($ConfigureVariables) {
    # --- a11y-oidc-config ---
    $oidcGroup = Get-VariableGroupByName -GroupName 'a11y-oidc-config'
    if ($oidcGroup) {
        Write-Host "  Variable group 'a11y-oidc-config' already exists (id=$($oidcGroup.id)), skipping." -ForegroundColor Yellow
    }
    else {
        Write-Host '  Creating a11y-oidc-config variable group...'
        az pipelines variable-group create `
            --name 'a11y-oidc-config' `
            --variables "AZURE_CLIENT_ID=$AzureClientId" "AZURE_TENANT_ID=$AzureTenantId" "AZURE_SUBSCRIPTION_ID=$AzureSubscriptionId" `
            --authorize true `
            -o none
        Write-Host '  a11y-oidc-config created.' -ForegroundColor Green
    }

    # --- a11y-scan-config ---
    $scanGroup = Get-VariableGroupByName -GroupName 'a11y-scan-config'
    if ($scanGroup) {
        Write-Host "  Variable group 'a11y-scan-config' already exists (id=$($scanGroup.id)), skipping." -ForegroundColor Yellow
    }
    else {
        Write-Host '  Creating a11y-scan-config variable group...'
        az pipelines variable-group create `
            --name 'a11y-scan-config' `
            --variables SCANNER_URL='https://placeholder.azurewebsites.net' `
            --authorize true `
            -o none
        Write-Host '  a11y-scan-config created.' -ForegroundColor Green
    }

    # --- a11y-app-urls ---
    $urlGroup = Get-VariableGroupByName -GroupName 'a11y-app-urls'
    if ($urlGroup) {
        Write-Host "  Variable group 'a11y-app-urls' already exists (id=$($urlGroup.id)), skipping." -ForegroundColor Yellow
    }
    else {
        Write-Host '  Creating a11y-app-urls variable group...'
        az pipelines variable-group create `
            --name 'a11y-app-urls' `
            --variables `
                APP_URL_001='https://placeholder-001.azurewebsites.net' `
                APP_URL_002='https://placeholder-002.azurewebsites.net' `
                APP_URL_003='https://placeholder-003.azurewebsites.net' `
                APP_URL_004='https://placeholder-004.azurewebsites.net' `
                APP_URL_005='https://placeholder-005.azurewebsites.net' `
            --authorize true `
            -o none
        Write-Host '  a11y-app-urls created.' -ForegroundColor Green
    }

    # --- wiki-access ---
    $wikiGroup = Get-VariableGroupByName -GroupName 'wiki-access'
    if ($wikiGroup) {
        Write-Host "  Variable group 'wiki-access' already exists (id=$($wikiGroup.id)), skipping." -ForegroundColor Yellow
    }
    else {
        $wikiPat = $env:WIKI_PAT
        if (-not $wikiPat) {
            $wikiPat = Read-Host -Prompt 'Enter WIKI_PAT for wiki push (ADO PAT with Code Read/Write, or press Enter to skip)'
        }
        if ($wikiPat) {
            Write-Host '  Creating wiki-access variable group...'
            az pipelines variable-group create `
                --name 'wiki-access' `
                --variables 'PLACEHOLDER=temp' `
                --authorize true `
                -o json | Out-Null

            $newWikiGroup = Get-VariableGroupByName -GroupName 'wiki-access'
            $wikiGroupId = $newWikiGroup.id

            az pipelines variable-group variable delete --group-id $wikiGroupId --name 'PLACEHOLDER' --yes -o none 2>$null
            az pipelines variable-group variable create --group-id $wikiGroupId --name 'WIKI_PAT' --value $wikiPat --secret true -o none
            Write-Host '  wiki-access created with WIKI_PAT.' -ForegroundColor Green
        }
        else {
            Write-Host '  Skipping wiki-access (no WIKI_PAT provided). Wiki screenshots will not work.' -ForegroundColor Yellow
        }
    }
}
else {
    Write-Host '  Skipping variable group creation (no AZURE_CLIENT_ID provided).' -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Step 5b: Grant Build Service Administrator permissions on variable groups
# ---------------------------------------------------------------------------
Write-Host "`n[5b/10] Granting Build Service permissions on variable groups..." -ForegroundColor Cyan

if ($ConfigureVariables) {
    # Get project ID
    $projectInfo = az devops project show --project $Project -o json 2>$null | ConvertFrom-Json
    $projectId = $projectInfo.id

    # Try multiple Build Service identity formats
    $buildServiceNames = @(
        "$Project Build Service ($Org)",
        "Project Collection Build Service ($Org)"
    )

    # Collect ALL Build Service identity IDs to grant on variable groups
    $buildServiceIds = @()

    foreach ($serviceName in $buildServiceNames) {
        Write-Host "  Resolving identity: $serviceName" -ForegroundColor Cyan

        $identitySearchUrl = "$OrgUrl/_apis/identities?searchFilter=General&filterValue=$([uri]::EscapeDataString($serviceName))&api-version=7.1"
        $identityResult = az rest -u $identitySearchUrl -m GET --resource $AdoResource -o json 2>$null | ConvertFrom-Json

        if ($identityResult -and $identityResult.value -and $identityResult.value.Count -gt 0) {
            $id = $identityResult.value[0].id
            $buildServiceIds += $id
            Write-Host "    Found: $serviceName (id: $id)" -ForegroundColor Green
            continue
        }

        # Fallback: look up by reading current role assignments on any existing variable group
        # The Build Service appears in inherited Reader assignments automatically
        $existingGroup = Get-VariableGroupByName -GroupName 'a11y-scan-config'
        if (-not $existingGroup) { $existingGroup = Get-VariableGroupByName -GroupName 'a11y-app-urls' }
        if ($existingGroup) {
            $rolesUrl = "$OrgUrl/_apis/securityroles/scopes/distributedtask.variablegroup/roleassignments/resources/$projectId`$$($existingGroup.id)?api-version=7.1-preview.1"
            $rolesResult = az rest -u $rolesUrl -m GET --resource $AdoResource -o json 2>$null | ConvertFrom-Json
            if ($rolesResult -and $rolesResult.value) {
                $match = $rolesResult.value | Where-Object { $_.identity.displayName -eq $serviceName }
                if ($match) {
                    $id = $match.identity.id
                    $buildServiceIds += $id
                    Write-Host "    Found via role assignments: $serviceName (id: $id)" -ForegroundColor Green
                    continue
                }
            }
        }

        # Fallback: graph API
        $graphUrl = "$OrgUrl/_apis/graph/users?api-version=7.1-preview.1"
        $graphResult = az rest -u $graphUrl -m GET --resource $AdoResource -o json 2>$null | ConvertFrom-Json

        if ($graphResult -and $graphResult.value) {
            $matchingUser = $graphResult.value | Where-Object { $_.displayName -eq $serviceName -or $_.principalName -like "*Build Service*" }
            if ($matchingUser) {
                $descriptorUrl = "$OrgUrl/_apis/identities?subjectDescriptors=$($matchingUser.descriptor)&api-version=7.1"
                $descriptorResult = az rest -u $descriptorUrl -m GET --resource $AdoResource -o json 2>$null | ConvertFrom-Json

                if ($descriptorResult -and $descriptorResult.value) {
                    $id = $descriptorResult.value[0].id
                    $buildServiceIds += $id
                    Write-Host "    Found via graph API: $($matchingUser.displayName) (id: $id)" -ForegroundColor Green
                }
            }
        }
    }

    if ($buildServiceIds.Count -gt 0) {
        # Grant Administrator role on variable groups that need pipeline updates
        $groupsToUpdate = @('a11y-scan-config', 'a11y-app-urls')

        foreach ($groupName in $groupsToUpdate) {
            $group = Get-VariableGroupByName -GroupName $groupName
            if (-not $group) { continue }

            Write-Host "  Granting Administrator role on '$groupName' to Build Service identities..." -ForegroundColor Cyan

            # Build role assignment array with all discovered identities
            $roleAssignments = $buildServiceIds | ForEach-Object {
                @{ roleName = 'Administrator'; userId = $_ }
            }
            $roleBody = ConvertTo-Json -InputObject @($roleAssignments) -Depth 3

            # Correct API: Security Roles scope for variable groups
            # Resource ID format: {projectId}${variableGroupId}
            $roleUrl = "$OrgUrl/_apis/securityroles/scopes/distributedtask.variablegroup/roleassignments/resources/$projectId`$$($group.id)?api-version=7.1-preview.1"
            $result = $roleBody | az rest -u $roleUrl -m PUT --body '@-' --headers "Content-Type=application/json" --resource $AdoResource -o json 2>&1

            if ($LASTEXITCODE -eq 0) {
                Write-Host "    ✓ Build Service granted Administrator on '$groupName'." -ForegroundColor Green
            }
            else {
                Write-Host "    Warning: Security Roles API failed for '$groupName': $result" -ForegroundColor Yellow
                Write-Host "    Manual grant required: Pipelines > Library > '$groupName' > Security" -ForegroundColor Yellow
            }
        }
    }
    else {
        Write-Host "  Could not automatically find any Build Service identity." -ForegroundColor Yellow
        Write-Host "  Grant permissions manually:" -ForegroundColor Yellow
        Write-Host "    1. Go to Pipelines > Library > Security for each group" -ForegroundColor Yellow
        Write-Host "    2. Add one of these identities as Administrator:" -ForegroundColor Yellow
        foreach ($name in $buildServiceNames) {
            Write-Host "       - $name" -ForegroundColor Yellow
        }
        Write-Host "    3. Groups to update: a11y-scan-config, a11y-app-urls" -ForegroundColor Yellow
    }
}
else {
    Write-Host '  Skipping Build Service permissions (no variable groups created).' -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Step 6: Create WIF service connections via REST API
# ---------------------------------------------------------------------------
Write-Host "`n[6/10] Creating WIF service connections..." -ForegroundColor Cyan

if ($ConfigureVariables) {
    # Get the ADO project ID (required for service endpoint references)
    $projectInfo = az devops project show --project $Project -o json | ConvertFrom-Json
    $projectId   = $projectInfo.id

    # Get subscription name
    $subscriptionName = az account show --query 'name' -o tsv

    # Get app registration object ID for federated credential creation
    $appObjectId = (az ad app list --display-name 'ado-a11y-scanner-pipelines' --query '[0].id' -o tsv 2>$null)

    foreach ($scName in $ServiceConnectionNames) {
        $existing = Get-ServiceEndpointByName -EndpointName $scName
        if ($existing) {
            Write-Host "  Service connection '$scName' already exists (id=$($existing.id)), skipping." -ForegroundColor Yellow
            continue
        }

        Write-Host "  Creating service connection '$scName'..."
        $body = @{
            data          = @{
                subscriptionId   = $AzureSubscriptionId
                subscriptionName = $subscriptionName
                environment      = 'AzureCloud'
                scopeLevel       = 'Subscription'
                creationMode     = 'Manual'
            }
            name          = $scName
            type          = 'AzureRM'
            url           = 'https://management.azure.com/'
            authorization = @{
                parameters = @{
                    tenantid           = $AzureTenantId
                    serviceprincipalid = $AzureClientId
                }
                scheme     = 'WorkloadIdentityFederation'
            }
            isShared      = $false
            isReady       = $true
            serviceEndpointProjectReferences = @(
                @{
                    projectReference = @{
                        id   = $projectId
                        name = $Project
                    }
                    name             = $scName
                }
            )
        } | ConvertTo-Json -Depth 5

        $apiUrl = "$OrgUrl/_apis/serviceendpoint/endpoints?api-version=7.1"
        $result = $body | az rest -u $apiUrl -m POST --body '@-' --headers "Content-Type=application/json" --resource $AdoResource -o json 2>&1

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Service connection '$scName' created." -ForegroundColor Green

            # Read back auto-generated issuer and subject, then create federated credential
            if ($appObjectId) {
                $scData = $result | ConvertFrom-Json
                $wifIssuer  = $scData.authorization.parameters.workloadIdentityFederationIssuer
                $wifSubject = $scData.authorization.parameters.workloadIdentityFederationSubject

                if ($wifIssuer -and $wifSubject) {
                    $credName = "ado-$($scName -replace 'a11y-', '')"
                    $existingCred = az ad app federated-credential list --id $appObjectId --query "[?name=='$credName']" -o json 2>$null | ConvertFrom-Json

                    if ($existingCred -and $existingCred.Count -gt 0) {
                        Write-Host "    Federated credential '$credName' already exists." -ForegroundColor Green
                    } else {
                        $credBody = @{
                            name      = $credName
                            issuer    = $wifIssuer
                            subject   = $wifSubject
                            audiences = @('api://AzureADTokenExchange')
                            description = "WIF credential for ADO service connection '$scName'"
                        } | ConvertTo-Json -Compress

                        $credBody | az ad app federated-credential create --id $appObjectId --parameters '@-' -o none 2>$null
                        if ($LASTEXITCODE -eq 0) {
                            Write-Host "    Federated credential '$credName' created." -ForegroundColor Green
                        } else {
                            Write-Host "    Warning: could not create federated credential '$credName'." -ForegroundColor Yellow
                        }
                    }
                }
            }
        }
        else {
            Write-Host "  Warning: could not create service connection '$scName': $result" -ForegroundColor Yellow
        }
    }
}
else {
    Write-Host '  Skipping service connection creation (no AZURE_CLIENT_ID provided).' -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Step 7: Create ADO environments
# ---------------------------------------------------------------------------
Write-Host "`n[7/10] Creating ADO environments..." -ForegroundColor Cyan

$environmentNames = @('deploy', 'deploy-scanner', 'teardown')
for ($i = 1; $i -le 5; $i++) {
    $suffix = $i.ToString('000')
    $environmentNames += "deploy-$suffix"
    $environmentNames += "teardown-$suffix"
}

foreach ($envName in $environmentNames) {
    $existing = Get-EnvironmentByName -EnvName $envName
    if ($existing) {
        Write-Host "  Environment '$envName' already exists (id=$($existing.id)), skipping." -ForegroundColor Yellow
        continue
    }

    Write-Host "  Creating '$envName' environment..."
    $envBody = @{ name = $envName; description = "Environment for a11y scan demo" } | ConvertTo-Json
    $apiUrl  = "$OrgUrl/$Project/_apis/pipelines/environments?api-version=7.1"
    $result  = $envBody | az rest -u $apiUrl -m POST --body '@-' --headers "Content-Type=application/json" --resource $AdoResource -o json 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Environment '$envName' created." -ForegroundColor Green
    }
    else {
        Write-Host "  Warning: could not create environment '$envName': $result" -ForegroundColor Yellow
    }
}

Write-Host "`n  NOTE: Add approval checks manually in Project Settings > Environments." -ForegroundColor Yellow

# ---------------------------------------------------------------------------
# Step 8: Register ADO pipelines
# ---------------------------------------------------------------------------
Write-Host "`n[8/10] Registering ADO pipelines..." -ForegroundColor Cyan

# 8a. Scanner pipelines
Write-Host "`n  Scanner pipelines:" -ForegroundColor Cyan
foreach ($p in $ScannerPipelines) {
    $null = az pipelines show --name $p.Name -o json 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    Pipeline '$($p.Name)' already exists, skipping." -ForegroundColor Yellow
    }
    else {
        Write-Host "    Creating pipeline '$($p.Name)'..."
        az pipelines create `
            --name $p.Name `
            --yml-path $p.YmlPath `
            --repository $ScannerRepoName `
            --repository-type tfsgit `
            --branch main `
            --folder-path '\Scanner' `
            --skip-first-run `
            -o none 2>&1

        if ($LASTEXITCODE -eq 0) {
            Write-Host "    Pipeline '$($p.Name)' created." -ForegroundColor Green
        }
        else {
            Write-Host "    Warning: could not create pipeline '$($p.Name)'." -ForegroundColor Yellow
        }
    }
}

# 8b. Demo app pipelines
Write-Host "`n  Demo app pipelines:" -ForegroundColor Cyan
foreach ($app in $DemoApps) {
    $appName = "a11y-demo-app-$($app.Number)"

    foreach ($suffix in @('ci-cd', 'a11y-scan')) {
        $pName = "$suffix-$appName"
        $null = az pipelines show --name $pName -o json 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    Pipeline '$pName' already exists, skipping." -ForegroundColor Yellow
        }
        else {
            Write-Host "    Creating pipeline '$pName'..."
            az pipelines create `
                --name $pName `
                --yml-path ".azuredevops/pipelines/$suffix.yml" `
                --repository $appName `
                --repository-type tfsgit `
                --branch main `
                --folder-path '\Demo Apps' `
                --skip-first-run `
                -o none 2>&1

            if ($LASTEXITCODE -eq 0) {
                Write-Host "    Pipeline '$pName' created." -ForegroundColor Green
            }
            else {
                Write-Host "    Warning: could not create pipeline '$pName'." -ForegroundColor Yellow
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Step 9: Create project wiki
# ---------------------------------------------------------------------------
Write-Host "`n[9/10] Creating project wiki..." -ForegroundColor Cyan

$wikiList = az devops wiki list -o json 2>$null | ConvertFrom-Json
$wikiExists = $wikiList | Where-Object { $_.name -eq 'AODA WCAG Wiki' }

if ($wikiExists) {
    Write-Host "  Wiki 'AODA WCAG Wiki' already exists, skipping." -ForegroundColor Yellow
}
else {
    $null = az devops wiki create --name 'AODA WCAG Wiki' --type projectWiki -o json 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Wiki 'AODA WCAG Wiki' created." -ForegroundColor Green
    }
    else {
        Write-Host '  Warning: could not create wiki (may already exist or require permissions).' -ForegroundColor Yellow
    }
}

Write-Host '  NOTE: If wiki updates return 401, grant Contribute permission manually:' -ForegroundColor Yellow
Write-Host "    1. Go to Project Settings > Repos > select the wiki repo (.wiki)" -ForegroundColor Yellow
Write-Host "    2. Under Security, find '$Project Build Service ($Org)'" -ForegroundColor Yellow
Write-Host "    3. Set Contribute = Allow" -ForegroundColor Yellow

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host "`n=== Bootstrap Summary ===" -ForegroundColor Cyan
Write-Host "Organization: $OrgUrl" -ForegroundColor Green
Write-Host "Project:      $Project" -ForegroundColor Green
Write-Host ''
Write-Host 'Azure Repos:' -ForegroundColor Green
Write-Host "  - $ScannerRepoName"
foreach ($app in $DemoApps) {
    Write-Host "  - a11y-demo-app-$($app.Number)"
}
Write-Host ''
Write-Host 'Variable Groups:' -ForegroundColor Green
Write-Host '  - a11y-oidc-config  (AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID)'
Write-Host '  - a11y-scan-config  (SCANNER_URL)'
Write-Host '  - a11y-app-urls     (APP_URL_001..005)'
Write-Host '  - wiki-access       (WIKI_PAT - secret)'
Write-Host ''
Write-Host 'Service Connections (WIF):' -ForegroundColor Green
foreach ($scName in $ServiceConnectionNames) {
    Write-Host "  - $scName"
}
Write-Host ''
Write-Host 'Pipelines:' -ForegroundColor Green
foreach ($p in $ScannerPipelines) {
    Write-Host "  - $($p.Name) -> $($p.YmlPath)"
}
foreach ($app in $DemoApps) {
    Write-Host "  - ci-cd-a11y-demo-app-$($app.Number)"
    Write-Host "  - a11y-scan-a11y-demo-app-$($app.Number)"
}
Write-Host ''
Write-Host 'Environments:' -ForegroundColor Green
foreach ($envName in $environmentNames) {
    Write-Host "  - $envName"
}
Write-Host ''
Write-Host 'Wiki:' -ForegroundColor Green
Write-Host '  - AODA WCAG Wiki'

Write-Host "`n--- Manual Steps Required ---" -ForegroundColor Yellow
Write-Host '1. Add approval checks to deploy and teardown environments:' -ForegroundColor Yellow
Write-Host '   Project Settings > Environments > select environment > Approvals and checks' -ForegroundColor Yellow
Write-Host '2. Update variable group values with actual URLs after deployment:' -ForegroundColor Yellow
Write-Host '   Pipelines > Library > a11y-scan-config > update SCANNER_URL' -ForegroundColor Yellow
Write-Host '3. Verify service connections can authenticate to Azure:' -ForegroundColor Yellow
Write-Host '   Project Settings > Service connections > Select > Verify' -ForegroundColor Yellow

Write-Host "`nBootstrap complete." -ForegroundColor Cyan
