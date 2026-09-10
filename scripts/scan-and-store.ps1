<#
.SYNOPSIS
    Scans sites via the accessibility scanner API and uploads results to Azure Blob Storage.

.DESCRIPTION
    Calls POST /api/ci/crawl for each site URL, transforms results into the
    Fact_A11yViolations schema, and uploads to Blob Storage with date-partitioned paths.

.PARAMETER ScannerUrl
    Base URL of the accessibility scanner (e.g. https://a11y-scan-demo-app.azurewebsites.net).

.PARAMETER StorageAccount
    Azure Storage account name for scan result storage.

.PARAMETER ContainerName
    Blob container name (default: a11y-scan-results).

.PARAMETER SiteUrls
    Comma-separated list of site URLs to scan.

.PARAMETER SiteKeys
    Comma-separated list of site keys matching the SiteUrls order.
#>
param(
    [Parameter(Mandatory)]
    [string]$ScannerUrl,

    [Parameter(Mandatory)]
    [string]$StorageAccount,

    [string]$ContainerName = 'a11y-scan-results',

    [Parameter(Mandatory)]
    [string]$SiteUrls,

    [Parameter(Mandatory)]
    [string]$SiteKeys
)

$ErrorActionPreference = 'Stop'

$urls = $SiteUrls -split ','
$keys = $SiteKeys -split ','

if ($urls.Count -ne $keys.Count) {
    throw "SiteUrls and SiteKeys must have the same number of entries."
}

$scanDate = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'
$datePath = Get-Date -Format 'yyyy/MM/dd'
$scanRunId = [guid]::NewGuid().ToString()

# WCAG criterion lookup for common axe-core rule IDs
$wcagLookup = @{
    'image-alt'        = @{ CriterionKey = '1.1.1'; PrincipleKey = '1' }
    'color-contrast'   = @{ CriterionKey = '1.4.3'; PrincipleKey = '1' }
    'link-name'        = @{ CriterionKey = '2.4.4'; PrincipleKey = '2' }
    'button-name'      = @{ CriterionKey = '4.1.2'; PrincipleKey = '4' }
    'label'            = @{ CriterionKey = '3.3.2'; PrincipleKey = '3' }
    'html-has-lang'    = @{ CriterionKey = '3.1.1'; PrincipleKey = '3' }
    'heading-order'    = @{ CriterionKey = '2.4.6'; PrincipleKey = '2' }
    'bypass'           = @{ CriterionKey = '2.4.1'; PrincipleKey = '2' }
    'focus-visible'    = @{ CriterionKey = '2.4.7'; PrincipleKey = '2' }
    'target-size'      = @{ CriterionKey = '2.5.8'; PrincipleKey = '2' }
    'aria-hidden-focus' = @{ CriterionKey = '4.1.2'; PrincipleKey = '4' }
    'duplicate-id'     = @{ CriterionKey = '4.1.2'; PrincipleKey = '4' }
    'meta-viewport'    = @{ CriterionKey = '1.4.4'; PrincipleKey = '1' }
}

function Get-ViolationId {
    param(
        [string]$RuleId,
        [string]$PageUrl,
        [string]$TargetElement
    )
    $raw = "$RuleId|$PageUrl|$TargetElement"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($raw)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = $sha.ComputeHash($bytes)
    return [BitConverter]::ToString($hash).Replace('-', '').Substring(0, 32).ToLower()
}

for ($i = 0; $i -lt $urls.Count; $i++) {
    $siteUrl = $urls[$i].Trim()
    $siteKey = $keys[$i].Trim()

    Write-Host "Scanning $siteKey ($siteUrl)..."

    $body = @{ url = $siteUrl } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$ScannerUrl/api/ci/crawl" `
        -Method Post `
        -ContentType 'application/json' `
        -Body $body `
        -TimeoutSec 300

    $violations = @()

    foreach ($violation in $response.violations) {
        $ruleId = $violation.ruleId
        $impact = $violation.impact
        $wcag = $wcagLookup[$ruleId]
        $criterionKey = if ($wcag) { $wcag.CriterionKey } else { 'unknown' }
        $principleKey = if ($wcag) { $wcag.PrincipleKey } else { 'unknown' }

        $violationId = Get-ViolationId -RuleId $ruleId -PageUrl $siteUrl -TargetElement ''

        $violations += @{
            ViolationId      = $violationId
            RuleId           = $ruleId
            RuleName         = $violation.description
            Description      = $violation.description
            HelpUrl          = $violation.helpUrl
            Impact           = $impact
            WcagCriterionKey = $criterionKey
            PrincipleKey     = $principleKey
            StateKey         = 'active'
            SiteKey          = $siteKey
            SiteName         = $siteKey
            SiteUrl          = $siteUrl
            Organization     = 'AODA WCAG compliance'
            EngineKey        = 'axe-core'
            PageUrl          = $siteUrl
            TargetElement    = ''
            ElementCount     = [int]$violation.instanceCount
            ScanDate         = $scanDate
            FixedDate        = $null
            ScanRunId        = $scanRunId
        }
    }

    if ($violations.Count -eq 0) {
        $jsonContent = '[]'
    } elseif ($violations.Count -eq 1) {
        $jsonContent = ConvertTo-Json @($violations) -Depth 10
    } else {
        $jsonContent = $violations | ConvertTo-Json -Depth 10
    }
    $tempFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $tempFile -Value $jsonContent -Encoding UTF8

    $blobPath = "$datePath/$siteKey.json"
    Write-Host "Uploading $($violations.Count) violations to $blobPath..."

    az storage blob upload `
        --account-name $StorageAccount `
        --container-name $ContainerName `
        --name $blobPath `
        --file $tempFile `
        --overwrite `
        --auth-mode login

    Remove-Item $tempFile -Force
    Write-Host "Completed ${siteKey}: $($violations.Count) violations uploaded."
}

Write-Host "All scans complete. Run ID: $scanRunId"
