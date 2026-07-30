[CmdletBinding(DefaultParameterSetName = 'Plan')]
param(
  [Parameter(ParameterSetName = 'Plan')]
  [switch]$PlanOnly,
  [Parameter(Mandatory = $true, ParameterSetName = 'Execute')]
  [switch]$Execute,
  [ValidatePattern('^[a-z0-9./_-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$')]
  [string]$Image = 'prom/prometheus:v3.13.0@sha256:c6b27ea434f8389bfe233fbc7be381cf50587c286e871bc842008f5a1b1908a7',
  [string]$EvidenceDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'operations\lib\Operations.Common.ps1')

$rulesFile = Join-Path $PSScriptRoot 'studytube.rules.yml'
$testFile = Join-Path $PSScriptRoot 'studytube.rules.test.yml'
if (-not $EvidenceDirectory) {
  $EvidenceDirectory = Join-Path $repoRoot 'docs\evidence\operations\results'
}
foreach ($requiredFile in @($rulesFile, $testFile)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    throw "Required Prometheus rule file does not exist: $requiredFile"
  }
}

$containerArguments = @(
  'run',
  '--rm',
  '--network=none',
  '--read-only',
  '--tmpfs=/tmp:rw,noexec,nosuid,size=64m',
  '--cap-drop=ALL',
  '--security-opt=no-new-privileges',
  '--entrypoint=/bin/promtool',
  '--mount', "type=bind,source=$PSScriptRoot,target=/rules,readonly",
  $Image
)
$commands = @(
  [ordered]@{
    name = 'check-rules'
    arguments = @('check', 'rules', '/rules/studytube.rules.yml')
  },
  [ordered]@{
    name = 'test-rules'
    arguments = @('test', 'rules', '/rules/studytube.rules.test.yml')
  }
)
$plan = [ordered]@{
  schemaVersion = 'studytube.prometheus-rule-drill-plan.v1'
  mode = 'plan'
  requiresExecuteSwitch = $true
  image = $Image
  localDockerOnly = $true
  dockerContextPolicy = @('default', 'desktop-linux')
  readOnlyRulesMount = $true
  containerNetwork = 'none'
  ephemeralTemporaryStorage = $true
  containerCapabilitiesDropped = $true
  persistentServiceAdded = $false
  evidenceContainsSensitiveData = $false
  commands = @($commands | ForEach-Object { $_.name })
}

if ($PSCmdlet.ParameterSetName -eq 'Plan') {
  $plan | ConvertTo-Json -Depth 10
  exit 0
}

$startedAt = [DateTimeOffset]::UtcNow
$dockerContext = Assert-LocalDockerContext
$results = New-Object System.Collections.Generic.List[object]
foreach ($command in $commands) {
  $commandStartedAt = [DateTimeOffset]::UtcNow
  $result = Invoke-ExternalCommand -FilePath 'docker' -ArgumentList (
    $containerArguments + @($command.arguments)
  )
  $results.Add([ordered]@{
      name = $command.name
      status = 'passed'
      exitCode = $result.ExitCode
      durationMs = [int]([DateTimeOffset]::UtcNow - $commandStartedAt).TotalMilliseconds
    })
}

$completedAt = [DateTimeOffset]::UtcNow
$evidence = [ordered]@{
  schemaVersion = 'studytube.prometheus-rule-drill-result.v1'
  status = 'passed'
  image = $Image
  dockerContext = $dockerContext
  startedAt = $startedAt.ToString('o')
  completedAt = $completedAt.ToString('o')
  durationMs = [int]($completedAt - $startedAt).TotalMilliseconds
  results = @($results | ForEach-Object { $_ })
  executionBoundary = [ordered]@{
    localDockerOnly = $true
    rulesMountedReadOnly = $true
    containerNetwork = 'none'
    persistentServiceAdded = $false
  }
  retention = [ordered]@{
    credentialsRetained = $false
    metricSamplesRetained = $false
    commandOutputRetained = $false
  }
}
$evidencePath = Join-Path $EvidenceDirectory "prometheus-rules-$($completedAt.ToString('yyyyMMddTHHmmssZ')).json"
$writtenPath = Write-OperationsEvidence -Evidence $evidence -Path $evidencePath
$evidence.outputPath = $writtenPath
$evidence | ConvertTo-Json -Depth 10
