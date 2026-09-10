# start-local.ps1 - Start the accessibility scan app locally
# Usage:
#   .\start-local.ps1              # Runs with npm dev (fast, default)
#   .\start-local.ps1 -Mode local  # Same as above
#   .\start-local.ps1 -Mode docker # Builds and runs in Docker (closer to prod)
param(
    [ValidateSet('local', 'docker')]
    [string]$Mode = 'local'
)

$ErrorActionPreference = "Stop"
$Port = 3000

if ($Mode -eq 'docker') {
    $ImageName = "a11y-scan-demo"
    $ContainerName = "a11y-scan-demo-local"

    # Stop existing container if running
    $existing = docker ps -aq --filter "name=$ContainerName" 2>$null
    if ($existing) {
        Write-Host "Stopping existing container..."
        docker rm -f $ContainerName | Out-Null
    }

    Write-Host "Building Docker image..."
    docker build -t ${ImageName}:local .

    Write-Host "Starting container on http://localhost:$Port ..."
    docker run -d --name $ContainerName -p ${Port}:3000 ${ImageName}:local

    Write-Host "Container '$ContainerName' is running at http://localhost:$Port"
} else {
    Write-Host "Installing dependencies..."
    npm install

    Write-Host "Starting Next.js dev server on http://localhost:$Port ..."
    npm run dev
}
