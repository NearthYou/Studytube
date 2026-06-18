$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backDir = Join-Path $repoRoot 'back'
$aiBackDir = Join-Path $repoRoot 'ai-back'
$frontDir = Join-Path $repoRoot 'front\my-app'
$logDir = Join-Path $repoRoot '.codex'

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$powerShellExe = Join-Path $PSHOME 'powershell.exe'
$originalPath = $env:Path
$nodeExe = (Get-Command node.exe).Source
$pythonExe = Join-Path $aiBackDir '.venv\Scripts\python.exe'
$npmCli = Join-Path (Split-Path $nodeExe -Parent) 'node_modules\npm\bin\npm-cli.js'

# Work around environments that expose both Path and PATH, which breaks Start-Process.
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $originalPath, 'Process')

if (-not (Test-Path $pythonExe)) {
    throw "Python venv not found: $pythonExe"
}

if (-not (Test-Path $nodeExe)) {
    throw "Node executable not found: $nodeExe"
}

if (-not (Test-Path $npmCli)) {
    throw "npm-cli.js not found: $npmCli"
}

function Start-ServerWindow {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [string]$Command
    )

    $windowCommand = @"
`$host.UI.RawUI.WindowTitle = '$Title'
Set-Location '$WorkingDirectory'
$Command
"@

    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($windowCommand))

    Start-Process -FilePath $powerShellExe -ArgumentList @(
        '-NoExit',
        '-EncodedCommand',
        $encodedCommand
    ) | Out-Null
}

Start-ServerWindow `
    -Title 'Tripy Back' `
    -WorkingDirectory $backDir `
    -Command "& `"$nodeExe`" `"$npmCli`" run start:dev"

Start-ServerWindow `
    -Title 'Tripy AI Back' `
    -WorkingDirectory $aiBackDir `
    -Command "& `"$pythonExe`" -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

Start-ServerWindow `
    -Title 'Tripy Front' `
    -WorkingDirectory $frontDir `
    -Command "& `"$nodeExe`" `"$npmCli`" run dev -- --host 127.0.0.1 --port 5173"

Write-Host ''
Write-Host 'Started 3 server windows:' -ForegroundColor Green
Write-Host '  back    -> http://127.0.0.1:3000/api/posts'
Write-Host '  ai-back -> http://127.0.0.1:8000/health'
Write-Host '  front   -> http://127.0.0.1:5173'
Write-Host ''
Write-Host 'Quick checks:' -ForegroundColor Cyan
Write-Host '  Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/posts | Select-Object -ExpandProperty StatusCode'
Write-Host '  Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health | Select-Object -ExpandProperty StatusCode'
Write-Host '  Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173 | Select-Object -ExpandProperty StatusCode'
