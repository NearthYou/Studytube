$ErrorActionPreference = 'Stop'

$targetPorts = @(3000, 8000, 5173)

function Get-PortProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $connections) {
        return @()
    }

    $processIds = $connections |
        Select-Object -ExpandProperty OwningProcess -Unique |
        Where-Object { $_ -and $_ -gt 0 }

    $results = foreach ($processId in $processIds) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        [PSCustomObject]@{
            Port        = $Port
            ProcessId   = $processId
            ProcessName = if ($process) { $process.ProcessName } else { 'Unknown' }
        }
    }

    return $results
}

$portProcesses = foreach ($port in $targetPorts) {
    Get-PortProcesses -Port $port
}

if (-not $portProcesses) {
    Write-Host 'No processes are listening on ports 3000, 8000, or 5173.' -ForegroundColor Yellow
    exit 0
}

Write-Host ''
Write-Host 'Stopping processes on target ports...' -ForegroundColor Cyan

$uniqueProcesses = $portProcesses | Sort-Object ProcessId -Unique

foreach ($entry in $uniqueProcesses) {
    Write-Host ("  Port {0} -> PID {1} ({2})" -f $entry.Port, $entry.ProcessId, $entry.ProcessName)
}

foreach ($entry in $uniqueProcesses) {
    Stop-Process -Id $entry.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 500

Write-Host ''
Write-Host 'Remaining listeners:' -ForegroundColor Cyan

$remaining = foreach ($port in $targetPorts) {
    Get-PortProcesses -Port $port
}

if ($remaining) {
    foreach ($entry in ($remaining | Sort-Object Port, ProcessId -Unique)) {
        Write-Host ("  Port {0} -> PID {1} ({2})" -f $entry.Port, $entry.ProcessId, $entry.ProcessName) -ForegroundColor Yellow
    }
    exit 1
}

Write-Host '  none' -ForegroundColor Green
