# stop-local.ps1 - Stop the accessibility scan app
# Usage:
#   .\stop-local.ps1              # Stops npm dev process (default)
#   .\stop-local.ps1 -Mode local  # Same as above
#   .\stop-local.ps1 -Mode docker # Stops and removes Docker container
param(
    [ValidateSet('local', 'docker')]
    [string]$Mode = 'local'
)

if ($Mode -eq 'docker') {
    $ContainerName = "a11y-scan-demo-local"

    $existing = docker ps -aq --filter "name=$ContainerName" 2>$null
    if ($existing) {
        Write-Host "Stopping container '$ContainerName'..."
        docker rm -f $ContainerName | Out-Null
        Write-Host "Container stopped and removed."
    } else {
        Write-Host "No container named '$ContainerName' found."
    }
} else {
    # Stop any Next.js dev server running on port 3000
    $procs = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    if ($procs) {
        foreach ($procId in $procs) {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "Stopping process '$($proc.ProcessName)' (PID $procId) on port 3000..."
                Stop-Process -Id $procId -Force
            }
        }
        Write-Host "Local dev server stopped."
    } else {
        Write-Host "No process found listening on port 3000."
    }
}
