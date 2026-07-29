[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backupScript = Join-Path $repoRoot 'operations\backup\Invoke-PostgresRestoreDrill.ps1'
$failureScript = Join-Path $repoRoot 'operations\resilience\Invoke-ServiceFailureDrill.ps1'
$loadScript = Join-Path $repoRoot 'operations\load\studytube-core.js'
$composeFile = Join-Path $repoRoot 'docker-compose.yml'
$failures = New-Object System.Collections.Generic.List[string]
$passes = 0

function Assert-True {
  param(
    [Parameter(Mandatory = $true)]
    [bool]$Condition,
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  if (-not $Condition) {
    $script:failures.Add($Message)
    return
  }
  $script:passes += 1
}

function Invoke-JsonPlan {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $hostExecutable = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  $output = & $hostExecutable -NoLogo -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Plan command failed with exit code $LASTEXITCODE`: $($output -join [Environment]::NewLine)"
  }
  return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}

function Test-ScriptRejected {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $hostExecutable = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $null = & $hostExecutable -NoLogo -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1
    return $LASTEXITCODE -ne 0
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
}

try {
  $backupPlan = Invoke-JsonPlan -ScriptPath $backupScript -Arguments @(
    '-PlanOnly',
    '-ComposeFile', $composeFile,
    '-DatabaseName', 'app_dev',
    '-DatabaseUser', 'app'
  )
  Assert-True ($backupPlan.mode -eq 'plan') 'Backup drill must expose a plan-only mode.'
  Assert-True ($backupPlan.restoreDatabase -match '^studytube_restore_verify_[a-z0-9_]+$') 'Restore database must use the isolated allowlisted prefix.'
  Assert-True ($backupPlan.sourceDatabase -ne $backupPlan.restoreDatabase) 'Restore database must never equal the source database.'
  Assert-True ([bool]$backupPlan.cleanupGuaranteed) 'Backup drill must guarantee temporary database and dump cleanup.'
  Assert-True ($backupPlan.evidenceContainsSensitiveData -eq $false) 'Backup evidence must not contain row data or credentials.'
  Assert-True (($backupPlan.integrityChecks -contains 'row_counts') -and ($backupPlan.integrityChecks -contains 'foreign_keys')) 'Backup drill must plan row count and foreign key checks.'
  Assert-True (Test-ScriptRejected -ScriptPath $backupScript -Arguments @(
      '-PlanOnly', '-ComposeFile', $composeFile, '-DatabaseName', 'app-dev;drop'
    )) 'Backup drill must reject unsafe PostgreSQL identifiers before execution.'

  $failurePlan = Invoke-JsonPlan -ScriptPath $failureScript -Arguments @(
    '-PlanOnly',
    '-Scenario', 'All',
    '-ComposeFile', $composeFile,
    '-ApiBaseUrl', 'http://127.0.0.1:3000',
    '-AiBaseUrl', 'http://127.0.0.1:8000'
  )
  Assert-True ($failurePlan.mode -eq 'plan') 'Failure drill must expose a plan-only mode.'
  Assert-True ([bool]$failurePlan.requiresAcknowledgement) 'Failure drill must require explicit interruption acknowledgement.'
  Assert-True ([bool]$failurePlan.localTargetsOnly) 'Failure drill must restrict targets to the local host.'
  Assert-True ([bool]$failurePlan.recoveryGuaranteed) 'Failure drill must always schedule recovery.'
  $scenarioNames = @($failurePlan.scenarios | ForEach-Object { $_.name })
  foreach ($name in @('Valkey', 'Worker', 'AI', 'Database')) {
    Assert-True ($scenarioNames -contains $name) "Failure drill plan is missing scenario $name."
  }
  Assert-True (Test-ScriptRejected -ScriptPath $failureScript -Arguments @(
      '-PlanOnly', '-ComposeFile', $composeFile, '-ApiBaseUrl', 'https://example.com'
    )) 'Failure drill must reject non-loopback service targets before execution.'

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $node) {
    & $node.Source --check $loadScript
    Assert-True ($LASTEXITCODE -eq 0) 'k6 workload must pass JavaScript syntax validation.'
  }
  else {
    Write-Warning 'node is unavailable; JavaScript syntax validation was skipped.'
  }
}
catch {
  $failures.Add($_.Exception.Message)
}

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { Write-Error $_ -ErrorAction Continue }
  Write-Host "Operations contract tests failed: $($failures.Count) failure(s), $passes pass(es)."
  exit 1
}

Write-Host "Operations contract tests passed: $passes assertion(s)."
