[CmdletBinding(DefaultParameterSetName = 'Plan')]
param(
  [Parameter(ParameterSetName = 'Plan')]
  [switch]$PlanOnly,
  [Parameter(Mandatory = $true, ParameterSetName = 'Execute')]
  [switch]$Execute,
  [string]$ComposeFile,
  [string]$DatabaseName = 'app_dev',
  [string]$DatabaseUser = 'app',
  [ValidateRange(1, 86400)]
  [int]$RpoObjectiveSeconds = 300,
  [ValidateRange(1, 86400)]
  [int]$RtoObjectiveSeconds = 900,
  [string]$EvidenceDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'operations\lib\Operations.Common.ps1')

if (-not $ComposeFile) {
  $ComposeFile = Join-Path $repoRoot 'docker-compose.yml'
}
if (-not $EvidenceDirectory) {
  $EvidenceDirectory = Join-Path $repoRoot 'docs\evidence\operations\results'
}

Assert-SafePostgresIdentifier -Value $DatabaseName -Name 'DatabaseName'
Assert-SafePostgresIdentifier -Value $DatabaseUser -Name 'DatabaseUser'
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
  throw "Compose file does not exist: $ComposeFile"
}

$runId = "restore-$([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ'))-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$restoreDatabase = "studytube_restore_verify_$([DateTimeOffset]::UtcNow.ToString('yyyyMMddHHmmss'))_$([Guid]::NewGuid().ToString('N').Substring(0, 6))"
Assert-SafePostgresIdentifier -Value $restoreDatabase -Name 'restore database'
if ($restoreDatabase -eq $DatabaseName) {
  throw 'Generated restore database unexpectedly equals the source database.'
}

$plan = [ordered]@{
  schemaVersion = 'studytube.restore-drill-plan.v1'
  mode = 'plan'
  requiresExecuteSwitch = $true
  sourceDatabase = $DatabaseName
  restoreDatabase = $restoreDatabase
  composeFile = [IO.Path]::GetFullPath($ComposeFile)
  dockerContextPolicy = @('default', 'desktop-linux')
  cleanupGuaranteed = $true
  evidenceContainsSensitiveData = $false
  integrityChecks = @('required_tables', 'row_counts', 'foreign_keys', 'orphan_rows')
  objectives = [ordered]@{
    rpoSeconds = $RpoObjectiveSeconds
    rtoSeconds = $RtoObjectiveSeconds
  }
}

if ($PSCmdlet.ParameterSetName -eq 'Plan') {
  $plan | ConvertTo-Json -Depth 10
  exit 0
}

$requiredTables = @(
  'users',
  'posts',
  'courses',
  'course_steps',
  'work_outbox_events',
  'work_job_results',
  'retrieval_embeddings'
)
$containerDump = "/tmp/$runId.dump"
$startedAt = [DateTimeOffset]::UtcNow
$backupStartedAt = $null
$backupCompletedAt = $null
$restoreStartedAt = $null
$validationCompletedAt = $null
$sourceSnapshot = $null
$restoredSnapshot = $null
$postgresOwned = $false
$restoreCleaned = $false
$dumpCleaned = $false
$failure = $null
$cleanupFailures = New-Object System.Collections.Generic.List[string]
$dockerContext = $null

function Get-IntegritySnapshot {
  param([Parameter(Mandatory = $true)][string]$TargetDatabase)

  Assert-SafePostgresIdentifier -Value $TargetDatabase -Name 'target database'
  $sql = @'
WITH required(name) AS (
  VALUES
    ('users'),
    ('posts'),
    ('courses'),
    ('course_steps'),
    ('work_outbox_events'),
    ('work_job_results'),
    ('retrieval_embeddings')
), missing AS (
  SELECT name
  FROM required
  WHERE to_regclass('public.' || name) IS NULL
), invalid_foreign_keys AS (
  SELECT count(*)::bigint AS total
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public'
    AND c.contype = 'f'
    AND NOT c.convalidated
)
SELECT jsonb_build_object(
  'capturedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'missingTables', COALESCE((SELECT jsonb_agg(name ORDER BY name) FROM missing), '[]'::jsonb),
  'rowCounts', jsonb_build_object(
    'users', (SELECT count(*) FROM users),
    'posts', (SELECT count(*) FROM posts),
    'courses', (SELECT count(*) FROM courses),
    'course_steps', (SELECT count(*) FROM course_steps),
    'work_outbox_events', (SELECT count(*) FROM work_outbox_events),
    'work_job_results', (SELECT count(*) FROM work_job_results),
    'retrieval_embeddings', (SELECT count(*) FROM retrieval_embeddings)
  ),
  'invalidForeignKeys', (SELECT total FROM invalid_foreign_keys),
  'orphanRows', jsonb_build_object(
    'postsWithoutUsers', (
      SELECT count(*) FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE u.id IS NULL
    ),
    'courseStepsWithoutCourses', (
      SELECT count(*) FROM course_steps s LEFT JOIN courses c ON c.id = s.course_id WHERE c.id IS NULL
    ),
    'jobResultsWithoutEvents', (
      SELECT count(*) FROM work_job_results r LEFT JOIN work_outbox_events e ON e.id = r.event_id WHERE e.id IS NULL
    )
  )
)::text;
'@
  $result = Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @(
    'exec', '-T', 'postgres',
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', $DatabaseUser, '-d', $TargetDatabase,
    '-A', '-t', '-c', $sql
  )
  if (-not $result.Output) {
    throw "Integrity query returned no output for database '$TargetDatabase'."
  }
  return $result.Output | ConvertFrom-Json
}

function Assert-RestoreIntegrity {
  param(
    [Parameter(Mandatory = $true)][object]$Source,
    [Parameter(Mandatory = $true)][object]$Restored
  )

  if (@($Source.missingTables).Count -ne 0 -or @($Restored.missingTables).Count -ne 0) {
    throw 'A required core table is missing from the source or restored database.'
  }
  foreach ($table in $requiredTables) {
    $sourceCount = [long]$Source.rowCounts.$table
    $restoredCount = [long]$Restored.rowCounts.$table
    if ($sourceCount -ne $restoredCount) {
      throw "Row count mismatch for '$table': source=$sourceCount restored=$restoredCount."
    }
  }
  if ([long]$Restored.invalidForeignKeys -ne 0) {
    throw 'The restored database contains an unvalidated foreign key.'
  }
  foreach ($property in $Restored.orphanRows.PSObject.Properties) {
    if ([long]$property.Value -ne 0) {
      throw "The restored database contains orphan rows for '$($property.Name)'."
    }
  }
}

try {
  $dockerContext = Assert-LocalDockerContext
  [void](Assert-ComposeServiceOwnership -ComposeFile $ComposeFile -Service 'postgres')
  $postgresOwned = $true
  $ready = Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @(
    'exec', '-T', 'postgres', 'pg_isready', '-U', $DatabaseUser, '-d', $DatabaseName
  )
  if ($ready.Output -notmatch 'accepting connections') {
    throw 'Source PostgreSQL is not accepting connections.'
  }

  $sourceSnapshot = Get-IntegritySnapshot -TargetDatabase $DatabaseName
  $backupStartedAt = [DateTimeOffset]::UtcNow
  [void](Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @(
      'exec', '-T', 'postgres',
      'pg_dump', '-U', $DatabaseUser, '-d', $DatabaseName,
      '--format=custom', '--no-owner', '--no-privileges', '--serializable-deferrable',
      '--file', $containerDump
    ))
  $backupCompletedAt = [DateTimeOffset]::UtcNow

  $restoreStartedAt = [DateTimeOffset]::UtcNow
  [void](Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @(
      'exec', '-T', 'postgres',
      'createdb', '-U', $DatabaseUser, '--template=template0', $restoreDatabase
    ))
  [void](Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @(
      'exec', '-T', 'postgres',
      'pg_restore', '-U', $DatabaseUser, '--dbname', $restoreDatabase,
      '--exit-on-error', '--no-owner', '--no-privileges', $containerDump
    ))
  $restoredSnapshot = Get-IntegritySnapshot -TargetDatabase $restoreDatabase
  Assert-RestoreIntegrity -Source $sourceSnapshot -Restored $restoredSnapshot
  $validationCompletedAt = [DateTimeOffset]::UtcNow
}
catch {
  $failure = Protect-OperationalText $_.Exception.Message
}
finally {
  if ($postgresOwned) {
    try {
      [void](Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @(
          'exec', '-T', 'postgres',
          'dropdb', '-U', $DatabaseUser, '--if-exists', $restoreDatabase
        ))
      $restoreCleaned = $true
    }
    catch {
      $cleanupFailures.Add((Protect-OperationalText $_.Exception.Message))
    }
    try {
      [void](Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @(
          'exec', '-T', 'postgres', 'rm', '-f', $containerDump
        ))
      $dumpCleaned = $true
    }
    catch {
      $cleanupFailures.Add((Protect-OperationalText $_.Exception.Message))
    }
  }
}

$completedAt = [DateTimeOffset]::UtcNow
if ($cleanupFailures.Count -gt 0 -and -not $failure) {
  $failure = 'Restore drill validation passed, but cleanup failed.'
}
$sourceCountsJson = if ($sourceSnapshot) { $sourceSnapshot.rowCounts | ConvertTo-Json -Compress } else { '{}' }
$restoredCountsJson = if ($restoredSnapshot) { $restoredSnapshot.rowCounts | ConvertTo-Json -Compress } else { '{}' }
$rpoUpperBound = if ($backupStartedAt -and $backupCompletedAt) {
  [Math]::Round(($backupCompletedAt - $backupStartedAt).TotalSeconds, 3)
} else { $null }
$observedRto = if ($restoreStartedAt -and $validationCompletedAt) {
  [Math]::Round(($validationCompletedAt - $restoreStartedAt).TotalSeconds, 3)
} else { $null }
$status = if (-not $failure -and $restoreCleaned -and $dumpCleaned) { 'passed' } else { 'failed' }
$evidence = [ordered]@{
  schemaVersion = 'studytube.restore-drill-evidence.v1'
  runId = $runId
  status = $status
  startedAt = $startedAt.ToString('o')
  completedAt = $completedAt.ToString('o')
  source = [ordered]@{
    service = 'postgres'
    database = $DatabaseName
    capturedAt = if ($sourceSnapshot) { $sourceSnapshot.capturedAt } else { $null }
    rowCounts = if ($sourceSnapshot) { $sourceSnapshot.rowCounts } else { $null }
    rowCountFingerprintSha256 = Get-TextSha256 $sourceCountsJson
  }
  restore = [ordered]@{
    database = $restoreDatabase
    isolated = $true
    capturedAt = if ($restoredSnapshot) { $restoredSnapshot.capturedAt } else { $null }
    rowCounts = if ($restoredSnapshot) { $restoredSnapshot.rowCounts } else { $null }
    rowCountFingerprintSha256 = Get-TextSha256 $restoredCountsJson
    invalidForeignKeys = if ($restoredSnapshot) { $restoredSnapshot.invalidForeignKeys } else { $null }
    orphanRows = if ($restoredSnapshot) { $restoredSnapshot.orphanRows } else { $null }
    databaseRemoved = $restoreCleaned
    dumpRemoved = $dumpCleaned
  }
  objectives = [ordered]@{
    rpoSeconds = $RpoObjectiveSeconds
    rtoSeconds = $RtoObjectiveSeconds
  }
  measurements = [ordered]@{
    observedRpoUpperBoundSeconds = $rpoUpperBound
    observedRtoSeconds = $observedRto
    rpoObjectiveMet = $null -ne $rpoUpperBound -and $rpoUpperBound -le $RpoObjectiveSeconds
    rtoObjectiveMet = $null -ne $observedRto -and $observedRto -le $RtoObjectiveSeconds
  }
  retention = [ordered]@{
    dumpRetained = $false
    rowDataRetained = $false
    credentialsRetained = $false
  }
  environment = [ordered]@{
    dockerContext = $dockerContext
    composeFileSha256 = Get-TextSha256 ([IO.File]::ReadAllText((Resolve-Path $ComposeFile).Path))
  }
  error = $failure
  cleanupErrors = @($cleanupFailures)
}

$evidencePath = Join-Path $EvidenceDirectory "$runId.json"
$writtenPath = Write-OperationsEvidence -Evidence $evidence -Path $evidencePath
$evidence['outputPath'] = $writtenPath
$evidence | ConvertTo-Json -Depth 20
if ($status -ne 'passed') {
  exit 1
}
