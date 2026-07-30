[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backupScript = Join-Path $repoRoot 'operations\backup\Invoke-PostgresRestoreDrill.ps1'
$failureScript = Join-Path $repoRoot 'operations\resilience\Invoke-ServiceFailureDrill.ps1'
$loadScript = Join-Path $repoRoot 'operations\load\studytube-core.js'
$loadContractScript = Join-Path $repoRoot 'operations\tests\studytube-core.contract.mjs'
$writeLoadScript = Join-Path $repoRoot 'operations\load\studytube-progress-write.js'
$writeLoadContractScript = Join-Path $repoRoot 'operations\tests\studytube-progress-write.contract.mjs'
$writeLoadSmokeScript = Join-Path $repoRoot 'operations\tests\Invoke-K6ProgressWriteSmoke.ps1'
$prometheusDrill = Join-Path $repoRoot 'operations\monitoring\Invoke-PrometheusRuleDrill.ps1'
$operationsCommon = Join-Path $repoRoot 'operations\lib\Operations.Common.ps1'
$composeFile = Join-Path $repoRoot 'docker-compose.yml'
$ciWorkflow = Join-Path $repoRoot '.github\workflows\ci-cd.yml'
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

function Invoke-ApiSocketProbeContract {
  $tokens = $null
  $parseErrors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile(
    $failureScript,
    [ref]$tokens,
    [ref]$parseErrors
  )
  if ($parseErrors.Count -gt 0) {
    throw "Failure drill has PowerShell parse errors: $($parseErrors -join '; ')"
  }
  $functionAst = $ast.Find({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq 'Get-ApiReadinessProbe'
    }, $true)
  if ($null -eq $functionAst) {
    throw 'Failure drill must define Get-ApiReadinessProbe for the runtime API boundary.'
  }

  $module = New-Module -ArgumentList $functionAst.Extent.Text -ScriptBlock {
    param([string]$Definition)

    $script:LastExternalInvocation = $null
    function Invoke-ExternalCommand {
      param(
        [string]$FilePath,
        [string[]]$ArgumentList = @(),
        [switch]$AllowFailure
      )

      $script:LastExternalInvocation = [pscustomobject]@{
        FilePath = $FilePath
        ArgumentList = @($ArgumentList)
        AllowFailure = [bool]$AllowFailure
      }
      return [pscustomobject]@{ ExitCode = 0; Output = '200' }
    }
    function Get-HttpProbe {
      throw 'The TCP HTTP probe must not be used when a Unix socket is configured.'
    }
    function Protect-OperationalText {
      param([AllowNull()][string]$Value)
      return $Value
    }
    . ([scriptblock]::Create($Definition))
  }

  try {
    return & $module {
      $probe = Get-ApiReadinessProbe `
        -Uri ([Uri]'http://localhost/health/ready') `
        -SocketPath '/run/studytube/api.sock' `
        -TimeoutSeconds 7
      [pscustomobject]@{
        Probe = $probe
        Invocation = $script:LastExternalInvocation
      }
    }
  }
  finally {
    Remove-Module $module
  }
}

function Test-DockerContextRejected {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ContextName,
    [Parameter(Mandatory = $true)]
    [string]$ContextEndpoint,
    [string]$DockerHost = ''
  )

  $tokens = $null
  $parseErrors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile(
    $operationsCommon,
    [ref]$tokens,
    [ref]$parseErrors
  )
  if ($parseErrors.Count -gt 0) {
    throw "Operations common helpers have PowerShell parse errors: $($parseErrors -join '; ')"
  }
  $functionAst = $ast.Find({
      param($node)
      $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq 'Assert-LocalDockerContext'
    }, $true)
  if ($null -eq $functionAst) {
    throw 'Operations common helpers must define Assert-LocalDockerContext.'
  }

  $module = New-Module -ArgumentList @(
    $functionAst.Extent.Text,
    $ContextName,
    $ContextEndpoint,
    $DockerHost
  ) -ScriptBlock {
    param(
      [string]$Definition,
      [string]$FakeContextName,
      [string]$FakeContextEndpoint,
      [string]$FakeDockerHost
    )

    function Invoke-ExternalCommand {
      param(
        [string]$FilePath,
        [string[]]$ArgumentList = @(),
        [switch]$AllowFailure
      )

      if ($ArgumentList -contains 'show') {
        return [pscustomobject]@{ ExitCode = 0; Output = $FakeContextName }
      }
      if ($ArgumentList -contains 'inspect') {
        return [pscustomobject]@{ ExitCode = 0; Output = $FakeContextEndpoint }
      }
      throw "Unexpected fake Docker invocation: $($ArgumentList -join ' ')"
    }

    . ([scriptblock]::Create($Definition))
  }

  try {
    return & $module {
      $previousDockerHost = $env:DOCKER_HOST
      $env:DOCKER_HOST = $FakeDockerHost
      try {
        $null = Assert-LocalDockerContext
        return $false
      }
      catch {
        return $true
      }
      finally {
        $env:DOCKER_HOST = $previousDockerHost
      }
    }
  }
  finally {
    Remove-Module $module
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
  Assert-True (Test-ScriptRejected -ScriptPath $failureScript -Arguments @(
      '-PlanOnly', '-Scenario', 'Database', '-ComposeFile', $composeFile,
      '-ApiSocketPath', '/tmp/api.sock'
    )) 'Failure drill must reject Unix sockets outside /run/studytube.'

  $socketFailurePlan = Invoke-JsonPlan -ScriptPath $failureScript -Arguments @(
    '-PlanOnly',
    '-Scenario', 'Database',
    '-ComposeFile', $composeFile,
    '-ApiSocketPath', '/run/studytube/api.sock',
    '-AiBaseUrl', 'http://127.0.0.1:8000'
  )
  Assert-True ($socketFailurePlan.apiTransport -eq 'unix-socket') 'Database failure drill must plan the production Unix socket transport.'
  Assert-True ($socketFailurePlan.apiSocketPath -eq '/run/studytube/api.sock') 'Database failure drill must preserve the selected local Unix socket path.'
  Assert-True ($socketFailurePlan.apiReadinessUrl -eq 'http://localhost/health/ready') 'Unix socket readiness must use the production runtime health path without a TCP proxy.'

  $apiSocketProbe = Invoke-ApiSocketProbeContract
  Assert-True ([bool]$apiSocketProbe.Probe.Success) 'Unix socket readiness must accept a successful HTTP response.'
  Assert-True ($apiSocketProbe.Probe.StatusCode -eq 200) 'Unix socket readiness must report the HTTP status code.'
  Assert-True ($apiSocketProbe.Invocation.FilePath -eq 'curl') 'Unix socket readiness must call curl directly rather than a temporary TCP proxy.'
  Assert-True ($apiSocketProbe.Invocation.ArgumentList -contains '--unix-socket') 'Unix socket readiness must pass curl the Unix socket option.'
  Assert-True ($apiSocketProbe.Invocation.ArgumentList -contains '/run/studytube/api.sock') 'Unix socket readiness must pass curl the configured socket path.'
  Assert-True ($apiSocketProbe.Invocation.ArgumentList -contains 'http://localhost/health/ready') 'Unix socket readiness must probe the runtime readiness endpoint.'
  Assert-True ($apiSocketProbe.Invocation.ArgumentList -contains '/dev/null') 'Unix socket readiness must discard the response body.'

  $prometheusPlan = Invoke-JsonPlan -ScriptPath $prometheusDrill -Arguments @('-PlanOnly')
  Assert-True ($prometheusPlan.mode -eq 'plan') 'Prometheus rule drill must expose a plan-only mode.'
  Assert-True ([bool]$prometheusPlan.localDockerOnly) 'Prometheus rule tests must reject remote Docker contexts.'
  Assert-True ([bool]$prometheusPlan.readOnlyRulesMount) 'Prometheus rule tests must mount rule files read-only.'
  Assert-True ($prometheusPlan.persistentServiceAdded -eq $false) 'Prometheus rule tests must not add a persistent service to the production host.'
  Assert-True ($prometheusPlan.image -match '@sha256:[a-f0-9]{64}$') 'Prometheus rule tests must use a digest-pinned image.'
  Assert-True (@($prometheusPlan.commands).Count -eq 2) 'Prometheus rule drill must check syntax and execute unit tests.'

  $k6SmokePlan = Invoke-JsonPlan -ScriptPath $writeLoadSmokeScript -Arguments @('-PlanOnly')
  Assert-True ($k6SmokePlan.mode -eq 'plan') 'The actual k6 smoke must expose a side-effect-free plan mode.'
  Assert-True ([bool]$k6SmokePlan.loopbackFixtureOnly) 'The actual k6 smoke must restrict its mutable fixture to loopback.'
  Assert-True ($k6SmokePlan.k6Version -match '^\d+\.\d+\.\d+$') 'The actual k6 smoke must pin a concrete k6 version.'
  Assert-True ($k6SmokePlan.k6ArchiveSha256 -match '^[a-f0-9]{64}$') 'The actual k6 smoke must pin the downloaded archive checksum.'
  Assert-True (@($k6SmokePlan.phases) -join ',' -eq 'inspect,setup,write,duplicate,readback,teardown,summary') 'The actual k6 smoke must cover the full bounded progress-write lifecycle.'
  $ciWorkflowText = Get-Content -LiteralPath $ciWorkflow -Raw -Encoding UTF8
  Assert-True (
    $ciWorkflowText -match '(?s)Invoke-K6ProgressWriteSmoke\.ps1\s+-Execute'
  ) 'CI must execute the original progress-write workload through the actual pinned k6 runtime.'

  Assert-True (
    Test-DockerContextRejected `
      -ContextName 'default' `
      -ContextEndpoint 'tcp://remote.example:2376'
  ) 'Operations drills must reject a remote endpoint even when its Docker context is named default.'
  Assert-True (-not (
      Test-DockerContextRejected `
        -ContextName 'desktop-linux' `
        -ContextEndpoint 'npipe:////./pipe/dockerDesktopLinuxEngine'
    )) 'Operations drills must accept the inspected local Docker Desktop engine endpoint.'
  Assert-True (
    Test-DockerContextRejected `
      -ContextName 'desktop-linux' `
      -ContextEndpoint 'npipe:////./pipe/dockerDesktopLinuxEngine' `
      -DockerHost 'file://C:/remote-docker-endpoint'
  ) 'Operations drills must reject file-based DOCKER_HOST overrides.'
  Assert-True (
    Test-DockerContextRejected `
      -ContextName 'desktop-linux' `
      -ContextEndpoint 'npipe:////remote-builder/pipe/docker_engine'
  ) 'Operations drills must reject a remote named pipe from an inspected Docker context.'
  Assert-True (
    Test-DockerContextRejected `
      -ContextName 'desktop-linux' `
      -ContextEndpoint 'npipe:////./pipe/dockerDesktopLinuxEngine' `
      -DockerHost 'npipe:////remote-builder/pipe/docker_engine'
  ) 'Operations drills must reject a remote named pipe supplied through DOCKER_HOST.'
  Assert-True (
    Test-DockerContextRejected `
      -ContextName 'default' `
      -ContextEndpoint 'unix://remote-builder/run/docker.sock'
  ) 'Operations drills must reject a Unix endpoint with a remote authority.'
  Assert-True (-not (
      Test-DockerContextRejected `
        -ContextName 'default' `
        -ContextEndpoint 'unix:///var/run/docker.sock'
    )) 'Operations drills must accept an authority-free absolute local Unix socket.'

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $node) {
    & $node.Source --check $loadScript
    Assert-True ($LASTEXITCODE -eq 0) 'k6 workload must pass JavaScript syntax validation.'
    & $node.Source $loadContractScript
    Assert-True ($LASTEXITCODE -eq 0) 'k6 workload must reuse a pre-provisioned session across isolated VUs and use a separately configured safe readiness URL.'
    & $node.Source --check $writeLoadScript
    Assert-True ($LASTEXITCODE -eq 0) 'k6 progress write workload must pass JavaScript syntax validation.'
    & $node.Source $writeLoadContractScript
    Assert-True ($LASTEXITCODE -eq 0) 'k6 progress write workload must require deliberate write acknowledgement and retain no credentials or raw data identifiers.'
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
