<#
.SYNOPSIS
  Local live run of the OLT accessibility scanner — mirrors olt-a11y-scan.yml.

.DESCRIPTION
  Pulls/runs the ACR scanner image with the captured Playwright storageState
  mounted read-only, runs the auth-expiry guard, then scans the 7 distinct
  OLT QA2 URLs and writes per-URL SARIF to ./results.

.PARAMETER AuthFile
  Path to the captured storageState JSON (default: playwright/.auth/user.json).

.PARAMETER ImageTag
  Scanner image tag in ACR (default: contents of .acr_image_tag.txt).

.EXAMPLE
  ./scripts/olt-local-run.ps1
#>
[CmdletBinding()]
param(
  [string]$AuthFile = 'playwright/.auth/user.json',
  [string]$ImageTag = (Get-Content '.acr_image_tag.txt' -ErrorAction SilentlyContinue),
  [string]$AcrName  = 'a11yscandemo7yt3mwgxp3wiyacr',
  [string]$BaseUrl  = 'https://jus-olt-qa2.powerappsportals.com',
  # Use a locally-built native image (e.g. arm64 on Apple/Windows ARM hosts) to
  # avoid QEMU emulation, which crashes Chromium. Skips ACR login + platform override.
  [string]$LocalImage
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $AuthFile)) { throw "Auth storageState not found at '$AuthFile'. Capture it first (Phase 2.2)." }

$authAbs = (Resolve-Path $AuthFile).Path
$platformArgs = @()

if ($LocalImage) {
  $image = $LocalImage
  Write-Host "Using local image $image (no ACR login, native platform)."
} else {
  if (-not $ImageTag) { throw "ImageTag not provided and .acr_image_tag.txt is missing." }
  $image = "$AcrName.azurecr.io/a11y-scan-demo:$ImageTag"
  $platformArgs = @('--platform','linux/amd64')
  Write-Host "Logging in to ACR $AcrName..."
  az acr login --name $AcrName | Out-Null
}

Write-Host "Removing any prior container..."
docker rm -f a11y 2>$null | Out-Null

Write-Host "Starting scanner container from $image ..."
docker run -d --name a11y @platformArgs -p 3000:3000 -v "${authAbs}:/secrets/user.json:ro" $image | Out-Null

try {
  Write-Host "Waiting for scanner readiness on http://localhost:3000 ..."
  $ready = $false
  for ($i = 1; $i -le 60; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000' -TimeoutSec 5 | Out-Null; $ready = $true; break }
    catch { Start-Sleep -Seconds 5 }
  }
  if (-not $ready) { docker logs a11y; throw "Scanner did not become ready." }

  New-Item -ItemType Directory -Force -Path results | Out-Null

  # Auth-expiry guard (DR-04): probe a gated URL; fail if redirected to login.
  $guardUrl = "$BaseUrl/en/userprofile/"
  Write-Host "Auth-expiry guard: probing $guardUrl ..."
  $guardBody = @{ url = $guardUrl; format = 'sarif'; storageStatePath = '/secrets/user.json' } | ConvertTo-Json
  $guard = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/ci/scan' -Method Post -ContentType 'application/json' -Body $guardBody -TimeoutSec 120
  if ($guard.Content -match 'stage\.signin\.ontario\.ca') {
    throw "OLT QA2 storageState expired — re-capture via Phase 2 (playwright.auth.config.ts)."
  }
  Write-Host "Auth guard passed."

  $paths = '/en/','/en/parties/','/en/submit/','/en/mydraftappeals/','/en/help/','/en/Invoicing/','/en/userprofile/'
  $n = 0; $failed = 0
  foreach ($p in $paths) {
    $n++
    $full = "$BaseUrl$p"
    $slug = ($p.Trim('/') -replace '/','_'); if (-not $slug) { $slug = 'root' }
    $out = "results/scan-$n-$slug.sarif"
    Write-Host "Scanning [$n/7] $full -> $out"
    $body = @{ url = $full; format = 'sarif'; storageStatePath = '/secrets/user.json' } | ConvertTo-Json
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/ci/scan' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 120
      Set-Content -Path $out -Value $resp.Content -NoNewline
      Write-Host "  OK ($($resp.Content.Length) bytes)"
    } catch {
      Write-Warning "  FAILED: $full — $($_.Exception.Message)"
      $failed = 1
    }
  }
  if ($failed) { throw "One or more URL scans failed." }
  Write-Host "All 7 scans complete. SARIF in ./results."
}
finally {
  Write-Host "Collecting logs and stopping container..."
  docker logs a11y 2>$null | Out-File -FilePath results/container.log -Encoding utf8
  docker rm -f a11y 2>$null | Out-Null
}
