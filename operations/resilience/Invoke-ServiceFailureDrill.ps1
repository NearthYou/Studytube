[CmdletBinding(DefaultParameterSetName = 'Plan')]
param(
  [Parameter(ParameterSetName = 'Plan')]
  [switch]$PlanOnly,
  [Parameter(Mandatory = $true, ParameterSetName = 'Execute')]
  [switch]$Execute,
  [Parameter(Mandatory = $true, ParameterSetName = 'Execute')]
  [switch]$AcknowledgeServiceInterruption,
  [ValidateSet('Valkey', 'Worker', 'AI', 'Database', 'All')]
  [string]$Scenario = 'All',
  [string]$ComposeFile,
  [string]$ApiBaseUrl = 'http://127.0.0.1:3000',
  [string]$AiBaseUrl = 'http://127.0.0.1:8000',
  [string]$DatabaseName = 'app_dev',
  [string]$DatabaseUser = 'app',
  [ValidatePattern('^[A-Za-z0-9@_.-]+\.service$')]
  [string]$WorkerServiceName = 'studytube-worker.service',
  [ValidatePattern('^[A-Za-z0-9@_.-]+\.service$')]
  [string]$AiServiceName = 'studytube-ai.service',
  [ValidateRange(10, 600)]
  [int]$RecoveryTimeoutSeconds = 120,
  [string]$EvidenceDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'operations\lib\Operations.Common.ps1')

if (-not $ComposeFile) {
  $ComposeFile = Join-Path $repoRoot 'infra\production.compose.yml'
}
if (-not $EvidenceDirectory) {
  $EvidenceDirectory = Join-Path $repoRoot 'docs\evidence\operations\results'
}
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
  throw "Compose file does not exist: $ComposeFile"
}
Assert-SafePostgresIdentifier -Value $DatabaseName -Name 'DatabaseName'
Assert-SafePostgresIdentifier -Value $DatabaseUser -Name 'DatabaseUser'

$apiUri = Assert-LocalHttpUri -Value $ApiBaseUrl -Name 'ApiBaseUrl'
$aiUri = Assert-LocalHttpUri -Value $AiBaseUrl -Name 'AiBaseUrl'
$scenarioDefinitions = @(
  [ordered]@{
    name = 'Valkey'
    hypothesis = 'The queue store becomes unavailable, then returns with AOF healthy and the worker active.'
    fault = 'Stop only the allowlisted local compose valkey service.'
    recovery = 'Start valkey, wait for PONG and verify AOF write status.'
  },
  [ordered]@{
    name = 'Worker'
    hypothesis = 'systemd restarts a killed worker with a different process id and durable job uniqueness remains valid.'
    fault = 'Send SIGKILL only to the allowlisted worker service main process.'
    recovery = 'Wait for automatic restart, or start the same service in cleanup.'
  },
  [ordered]@{
    name = 'AI'
    hypothesis = 'The direct AI health endpoint fails while the service is stopped and recovers after restart.'
    fault = 'Stop only the allowlisted AI systemd service.'
    recovery = 'Start the service and wait for its loopback health endpoint.'
  },
  [ordered]@{
    name = 'Database'
    hypothesis = 'API readiness fails during a database outage and recovers after PostgreSQL accepts connections.'
    fault = 'Stop only the allowlisted local compose postgres service.'
    recovery = 'Start postgres, wait for pg_isready and API readiness.'
  }
)

$selectedDefinitions = if ($Scenario -eq 'All') {
  $scenarioDefinitions
} else {
  @($scenarioDefinitions | Where-Object { $_.name -eq $Scenario })
}
$plan = [ordered]@{
  schemaVersion = 'studytube.failure-drill-plan.v1'
  mode = 'plan'
  selectedScenario = $Scenario
  requiresExecuteSwitch = $true
  requiresAcknowledgement = $true
  localTargetsOnly = $true
  recoveryGuaranteed = $true
  composeFile = [IO.Path]::GetFullPath($ComposeFile)
  apiBaseUrl = $apiUri.GetLeftPart([UriPartial]::Authority)
  aiBaseUrl = $aiUri.GetLeftPart([UriPartial]::Authority)
  scenarios = $selectedDefinitions
}

if ($PSCmdlet.ParameterSetName -eq 'Plan') {
  $plan | ConvertTo-Json -Depth 10
  exit 0
}

if (-not $Execute -or -not $AcknowledgeServiceInterruption) {
  throw 'Execution requires both -Execute and -AcknowledgeServiceInterruption.'
}

function Get-SystemdProperty {
  param(
    [Parameter(Mandatory = $true)][string]$Service,
    [Parameter(Mandatory = $true)][string]$Property
  )

  $result = Invoke-ExternalCommand -FilePath 'systemctl' -ArgumentList @(
    'show', '--property', $Property, '--value', $Service
  )
  return $result.Output.Trim()
}

function Test-SystemdActive {
  param([Parameter(Mandatory = $true)][string]$Service)

  $result = Invoke-ExternalCommand -FilePath 'systemctl' -ArgumentList @(
    'is-active', '--quiet', $Service
  ) -AllowFailure
  return $result.ExitCode -eq 0
}

function Test-ValkeyReady {
  $result = Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @(
    'exec', '-T', 'valkey', 'valkey-cli', 'ping'
  ) -AllowFailure
  return $result.ExitCode -eq 0 -and $result.Output.Trim() -eq 'PONG'
}

function Test-PostgresReady {
  $result = Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @(
    'exec', '-T', 'postgres', 'pg_isready', '-U', $DatabaseUser, '-d', $DatabaseName
  ) -AllowFailure
  return $result.ExitCode -eq 0 -and $result.Output -match 'accepting connections'
}

function Test-WorkerResultUniqueness {
  $sql = @'
SELECT CASE
  WHEN count(*) = count(DISTINCT (event_id, handler_version)) THEN 'true'
  ELSE 'false'
END
FROM work_job_results;
'@
  $result = Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @(
    'exec', '-T', 'postgres',
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', $DatabaseUser, '-d', $DatabaseName,
    '-A', '-t', '-c', $sql
  ) -AllowFailure
  return $result.ExitCode -eq 0 -and $result.Output.Trim() -eq 'true'
}

function New-ScenarioEvidence {
  param([Parameter(Mandatory = $true)][object]$Definition)

  return [ordered]@{
    name = $Definition.name
    hypothesis = $Definition.hypothesis
    startedAt = [DateTimeOffset]::UtcNow.ToString('o')
    completedAt = $null
    status = 'running'
    baselineHealthy = $false
    faultObserved = $false
    recoveryObserved = $false
    recoverySeconds = $null
    integrityCheck = $null
    error = $null
  }
}

function Invoke-ValkeyFailure {
  param([Parameter(Mandatory = $true)][object]$Definition)

  $result = New-ScenarioEvidence $Definition
  $wasHealthy = $false
  $faultAttempted = $false
  $recoveryStartedAt = $null
  try {
    [void](Assert-ComposeServiceOwnership -ComposeFile $ComposeFile -Service 'valkey')
    $wasHealthy = Test-ValkeyReady
    if (-not $wasHealthy) { throw 'Valkey baseline health failed before fault injection.' }
    $result.baselineHealthy = $true

    $recoveryStartedAt = [DateTimeOffset]::UtcNow
    $faultAttempted = $true
    [void](Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @('stop', '--timeout', '10', 'valkey'))
    $running = Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @('ps', '--status', 'running', '-q', 'valkey') -AllowFailure
    $result.faultObserved = -not [bool]$running.Output
    if (-not $result.faultObserved) { throw 'Valkey remained running after the stop command.' }
  }
  catch {
    $result.error = Protect-OperationalText $_.Exception.Message
  }
  finally {
    if ($faultAttempted -and $wasHealthy) {
      try {
        if (-not $recoveryStartedAt) { $recoveryStartedAt = [DateTimeOffset]::UtcNow }
        [void](Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @('up', '-d', '--no-deps', 'valkey'))
        Wait-OperationsCondition -TimeoutSeconds $RecoveryTimeoutSeconds -Description 'Valkey PONG' -Condition { Test-ValkeyReady }
        $persistence = Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @(
          'exec', '-T', 'valkey', 'valkey-cli', 'info', 'persistence'
        )
        $result.integrityCheck = [ordered]@{
          name = 'aof_persistence_and_worker'
          aofHealthy = $persistence.Output -match '(?m)^aof_enabled:1\r?$' -and $persistence.Output -match '(?m)^aof_last_write_status:ok\r?$'
          workerActive = Test-SystemdActive $WorkerServiceName
        }
        $result.integrityCheck['passed'] = $result.integrityCheck.aofHealthy -and $result.integrityCheck.workerActive
        $result.recoveryObserved = Test-ValkeyReady -and $result.integrityCheck.passed
      }
      catch {
        $result.error = Protect-OperationalText $_.Exception.Message
      }
    }
  }
  if ($recoveryStartedAt -and $result.recoveryObserved) {
    $result.recoverySeconds = [Math]::Round(([DateTimeOffset]::UtcNow - $recoveryStartedAt).TotalSeconds, 3)
  }
  $result.completedAt = [DateTimeOffset]::UtcNow.ToString('o')
  $result.status = if ($result.baselineHealthy -and $result.faultObserved -and $result.recoveryObserved -and -not $result.error) { 'passed' } else { 'failed' }
  return [pscustomobject]$result
}

function Invoke-WorkerFailure {
  param([Parameter(Mandatory = $true)][object]$Definition)

  $result = New-ScenarioEvidence $Definition
  $wasHealthy = $false
  $faultAttempted = $false
  $beforePid = $null
  $recoveryStartedAt = $null
  try {
    $wasHealthy = Test-SystemdActive $WorkerServiceName
    if (-not $wasHealthy) { throw 'Worker baseline health failed before fault injection.' }
    if (-not (Test-PostgresReady) -or -not (Test-ValkeyReady)) {
      throw 'Worker dependencies are not healthy before fault injection.'
    }
    $result.baselineHealthy = $true
    $beforePid = Get-SystemdProperty -Service $WorkerServiceName -Property 'MainPID'
    if (-not $beforePid -or $beforePid -eq '0') { throw 'Worker main process id is unavailable.' }

    $recoveryStartedAt = [DateTimeOffset]::UtcNow
    $faultAttempted = $true
    [void](Invoke-ExternalCommand -FilePath 'systemctl' -ArgumentList @(
        'kill', '--kill-who=main', '--signal=SIGKILL', $WorkerServiceName
      ))
    Wait-OperationsCondition -TimeoutSeconds $RecoveryTimeoutSeconds -Description 'worker automatic restart' -Condition {
      if (-not (Test-SystemdActive $WorkerServiceName)) { return $false }
      $afterPid = Get-SystemdProperty -Service $WorkerServiceName -Property 'MainPID'
      return $afterPid -and $afterPid -ne '0' -and $afterPid -ne $beforePid
    }
    $afterPid = Get-SystemdProperty -Service $WorkerServiceName -Property 'MainPID'
    $result.faultObserved = $faultAttempted -and $afterPid -ne $beforePid
    $result.integrityCheck = [ordered]@{
      name = 'durable_job_result_uniqueness'
      passed = Test-WorkerResultUniqueness
    }
    $result.recoveryObserved = Test-SystemdActive $WorkerServiceName -and $result.integrityCheck.passed
  }
  catch {
    $result.error = Protect-OperationalText $_.Exception.Message
  }
  finally {
    if ($faultAttempted -and $wasHealthy -and -not (Test-SystemdActive $WorkerServiceName)) {
      try {
        [void](Invoke-ExternalCommand -FilePath 'systemctl' -ArgumentList @('start', $WorkerServiceName))
        Wait-OperationsCondition -TimeoutSeconds $RecoveryTimeoutSeconds -Description 'worker cleanup recovery' -Condition {
          Test-SystemdActive $WorkerServiceName
        }
      }
      catch {
        $result.error = Protect-OperationalText $_.Exception.Message
      }
    }
  }
  if ($recoveryStartedAt -and $result.recoveryObserved) {
    $result.recoverySeconds = [Math]::Round(([DateTimeOffset]::UtcNow - $recoveryStartedAt).TotalSeconds, 3)
  }
  $result.completedAt = [DateTimeOffset]::UtcNow.ToString('o')
  $result.status = if ($result.baselineHealthy -and $result.faultObserved -and $result.recoveryObserved -and -not $result.error) { 'passed' } else { 'failed' }
  return [pscustomobject]$result
}

function Invoke-AiFailure {
  param([Parameter(Mandatory = $true)][object]$Definition)

  $result = New-ScenarioEvidence $Definition
  $wasHealthy = $false
  $faultAttempted = $false
  $recoveryStartedAt = $null
  $healthUri = [Uri]::new($aiUri, '/health')
  try {
    $wasHealthy = Test-SystemdActive $AiServiceName
    $baseline = Get-HttpProbe -Uri $healthUri
    if (-not $wasHealthy -or -not $baseline.Success) { throw 'AI baseline health failed before fault injection.' }
    $result.baselineHealthy = $true

    $recoveryStartedAt = [DateTimeOffset]::UtcNow
    $faultAttempted = $true
    [void](Invoke-ExternalCommand -FilePath 'systemctl' -ArgumentList @('stop', $AiServiceName))
    Wait-OperationsCondition -TimeoutSeconds 15 -Description 'AI outage observation' -Condition {
      -not (Get-HttpProbe -Uri $healthUri -TimeoutSeconds 2).Success
    }
    $result.faultObserved = $true
  }
  catch {
    $result.error = Protect-OperationalText $_.Exception.Message
  }
  finally {
    if ($faultAttempted -and $wasHealthy) {
      try {
        [void](Invoke-ExternalCommand -FilePath 'systemctl' -ArgumentList @('start', $AiServiceName))
        Wait-OperationsCondition -TimeoutSeconds $RecoveryTimeoutSeconds -Description 'AI health recovery' -Condition {
          (Get-HttpProbe -Uri $healthUri).Success
        }
        $result.integrityCheck = [ordered]@{ name = 'ai_health'; passed = $true }
        $result.recoveryObserved = $true
      }
      catch {
        $result.error = Protect-OperationalText $_.Exception.Message
      }
    }
  }
  if ($recoveryStartedAt -and $result.recoveryObserved) {
    $result.recoverySeconds = [Math]::Round(([DateTimeOffset]::UtcNow - $recoveryStartedAt).TotalSeconds, 3)
  }
  $result.completedAt = [DateTimeOffset]::UtcNow.ToString('o')
  $result.status = if ($result.baselineHealthy -and $result.faultObserved -and $result.recoveryObserved -and -not $result.error) { 'passed' } else { 'failed' }
  return [pscustomobject]$result
}

function Invoke-DatabaseFailure {
  param([Parameter(Mandatory = $true)][object]$Definition)

  $result = New-ScenarioEvidence $Definition
  $wasHealthy = $false
  $faultAttempted = $false
  $recoveryStartedAt = $null
  $readinessUri = [Uri]::new($apiUri, '/health/ready')
  try {
    [void](Assert-ComposeServiceOwnership -ComposeFile $ComposeFile -Service 'postgres')
    $wasHealthy = Test-PostgresReady
    $baseline = Get-HttpProbe -Uri $readinessUri
    if (-not $wasHealthy -or -not $baseline.Success) { throw 'Database or API readiness baseline failed before fault injection.' }
    $result.baselineHealthy = $true

    $recoveryStartedAt = [DateTimeOffset]::UtcNow
    $faultAttempted = $true
    [void](Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @('stop', '--timeout', '10', 'postgres'))
    Wait-OperationsCondition -TimeoutSeconds 20 -Description 'API database outage response' -Condition {
      -not (Get-HttpProbe -Uri $readinessUri -TimeoutSeconds 3).Success
    }
    $result.faultObserved = $true
  }
  catch {
    $result.error = Protect-OperationalText $_.Exception.Message
  }
  finally {
    if ($faultAttempted -and $wasHealthy) {
      try {
        [void](Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @('up', '-d', '--no-deps', 'postgres'))
        Wait-OperationsCondition -TimeoutSeconds $RecoveryTimeoutSeconds -Description 'PostgreSQL recovery' -Condition { Test-PostgresReady }
        Wait-OperationsCondition -TimeoutSeconds $RecoveryTimeoutSeconds -Description 'API readiness recovery' -Condition {
          (Get-HttpProbe -Uri $readinessUri).Success
        }
        $result.integrityCheck = [ordered]@{
          name = 'database_query_and_api_readiness'
          passed = (Test-PostgresReady) -and (Get-HttpProbe -Uri $readinessUri).Success
        }
        $result.recoveryObserved = $result.integrityCheck.passed
      }
      catch {
        $result.error = Protect-OperationalText $_.Exception.Message
      }
    }
  }
  if ($recoveryStartedAt -and $result.recoveryObserved) {
    $result.recoverySeconds = [Math]::Round(([DateTimeOffset]::UtcNow - $recoveryStartedAt).TotalSeconds, 3)
  }
  $result.completedAt = [DateTimeOffset]::UtcNow.ToString('o')
  $result.status = if ($result.baselineHealthy -and $result.faultObserved -and $result.recoveryObserved -and -not $result.error) { 'passed' } else { 'failed' }
  return [pscustomobject]$result
}

$runId = "failure-$([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ'))-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$startedAt = [DateTimeOffset]::UtcNow
$dockerContext = $null
$results = New-Object System.Collections.Generic.List[object]
$preflightError = $null

try {
  $dockerContext = Assert-LocalDockerContext
  if (-not (Get-Command systemctl -ErrorAction SilentlyContinue)) {
    throw 'systemctl is required for the worker and AI recovery drills.'
  }
}
catch {
  $preflightError = Protect-OperationalText $_.Exception.Message
}

if (-not $preflightError) {
  foreach ($definition in $selectedDefinitions) {
    $scenarioResult = switch ($definition.name) {
      'Valkey' { Invoke-ValkeyFailure $definition }
      'Worker' { Invoke-WorkerFailure $definition }
      'AI' { Invoke-AiFailure $definition }
      'Database' { Invoke-DatabaseFailure $definition }
    }
    $results.Add($scenarioResult)
    if ($scenarioResult.status -ne 'passed' -and -not $scenarioResult.recoveryObserved) {
      break
    }
  }
}

$status = if (
  -not $preflightError -and
  $results.Count -eq $selectedDefinitions.Count -and
  @($results | Where-Object { $_.status -ne 'passed' }).Count -eq 0
) { 'passed' } else { 'failed' }
$evidence = [ordered]@{
  schemaVersion = 'studytube.failure-drill-evidence.v1'
  runId = $runId
  status = $status
  startedAt = $startedAt.ToString('o')
  completedAt = [DateTimeOffset]::UtcNow.ToString('o')
  selectedScenario = $Scenario
  safety = [ordered]@{
    localTargetsOnly = $true
    explicitInterruptionAcknowledgement = [bool]$AcknowledgeServiceInterruption
    composeFile = [IO.Path]::GetFullPath($ComposeFile)
    dockerContext = $dockerContext
  }
  scenarios = @($results)
  preflightError = $preflightError
  credentialsRetained = $false
  requestBodiesRetained = $false
}
$evidencePath = Join-Path $EvidenceDirectory "$runId.json"
$writtenPath = Write-OperationsEvidence -Evidence $evidence -Path $evidencePath
$evidence['outputPath'] = $writtenPath
$evidence | ConvertTo-Json -Depth 20
if ($status -ne 'passed') {
  exit 1
}
