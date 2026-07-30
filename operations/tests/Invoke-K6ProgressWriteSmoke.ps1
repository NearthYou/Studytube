[CmdletBinding()]
param(
  [switch]$PlanOnly,
  [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$k6Version = '0.57.0'
$runningOnWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$platform = if ($runningOnWindows) { 'windows-amd64' } else { 'linux-amd64' }
$archiveExtension = if ($runningOnWindows) { 'zip' } else { 'tar.gz' }
$archiveName = "k6-v$k6Version-$platform.$archiveExtension"
$archiveSha256 = if ($runningOnWindows) {
  '18bfe5a9c443088f912b5cfded713fb85e2865477a768adbdab0c3cdcd39790d'
}
else {
  '49b1072c29d3682a1ea2ec98df9d17f2bd1cfabb27c1c5e01050766848925c74'
}
$plan = [ordered]@{
  mode = 'plan'
  loopbackFixtureOnly = $true
  remoteMutationsAllowed = $false
  k6Version = $k6Version
  k6Archive = $archiveName
  k6ArchiveSha256 = $archiveSha256
  phases = @('inspect', 'setup', 'write', 'duplicate', 'readback', 'teardown', 'summary')
  credentialsRetained = $false
  rawDataIdentifiersRetained = $false
}

if ($PlanOnly) {
  $plan | ConvertTo-Json -Depth 5
  exit 0
}

if (-not $Execute) {
  throw 'Specify -PlanOnly or -Execute.'
}

if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'The pinned k6 smoke archive supports x64 runners only.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$workloadPath = (Resolve-Path (Join-Path $repoRoot 'operations\load\studytube-progress-write.js')).Path
$fixturePath = (Resolve-Path (Join-Path $PSScriptRoot 'studytube-progress-write.fixture.mjs')).Path
$nodeCommand = Get-Command node -ErrorAction Stop
$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temporaryRoot = Join-Path $temporaryBase "studytube-k6-smoke-$([Guid]::NewGuid().ToString('N'))"
$temporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
$temporaryPrefix = $temporaryBase.TrimEnd(
  [IO.Path]::DirectorySeparatorChar,
  [IO.Path]::AltDirectorySeparatorChar
) + [IO.Path]::DirectorySeparatorChar
if (
  -not $temporaryRoot.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase) -or
  [IO.Path]::GetFileName($temporaryRoot) -cnotmatch '^studytube-k6-smoke-[a-f0-9]{32}$'
) {
  throw 'Refusing to use an unexpected temporary directory for the k6 smoke.'
}

$sessionCanary = 'CANARY_k6_session_cookie_7cR9kN4p'
$sessionCookie = "__Host-studytube_session=$sessionCanary"
$courseStepCanary = '918273645019283746'
$responseCanary = 'CANARY_k6_response_body_M8q2Vm5s'
$runId = 'k6-runtime-smoke'
$fixtureProcess = $null
$environmentBackup = New-Object 'System.Collections.Generic.Dictionary[string,object]' `
  -ArgumentList ([StringComparer]::Ordinal)

function Protect-SmokeText {
  param([AllowNull()][string]$Value)

  if ($null -eq $Value) {
    return ''
  }
  $protected = $Value
  foreach ($sensitiveValue in @(
      $script:sessionCanary,
      $script:sessionCookie,
      $script:courseStepCanary,
      $script:responseCanary
    )) {
    $protected = $protected -replace [Regex]::Escape($sensitiveValue), '[redacted]'
  }
  if ($protected.Length -gt 2000) {
    return $protected.Substring($protected.Length - 2000)
  }
  return $protected
}

function Invoke-CapturedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList,
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,
    [Parameter(Mandatory = $true)]
    [string]$OutputPrefix
  )

  $stdoutPath = Join-Path $temporaryRoot "$OutputPrefix.stdout.log"
  $stderrPath = Join-Path $temporaryRoot "$OutputPrefix.stderr.log"
  $startArguments = @{
    FilePath = $FilePath
    ArgumentList = $ArgumentList
    WorkingDirectory = $WorkingDirectory
    RedirectStandardOutput = $stdoutPath
    RedirectStandardError = $stderrPath
    PassThru = $true
    Wait = $true
  }
  if ($runningOnWindows) {
    $startArguments.WindowStyle = 'Hidden'
  }
  $process = Start-Process @startArguments
  $stdout = if (Test-Path -LiteralPath $stdoutPath) {
    Get-Content -LiteralPath $stdoutPath -Raw -Encoding UTF8
  }
  else {
    ''
  }
  $stderr = if (Test-Path -LiteralPath $stderrPath) {
    Get-Content -LiteralPath $stderrPath -Raw -Encoding UTF8
  }
  else {
    ''
  }
  return [pscustomobject]@{
    ExitCode = [int]$process.ExitCode
    Stdout = $stdout
    Stderr = $stderr
  }
}

function Set-SmokeEnvironment {
  param([Parameter(Mandatory = $true)][Collections.IDictionary]$Values)

  foreach ($entry in $Values.GetEnumerator()) {
    $existing = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
    [void]($environmentBackup[$entry.Key] = [pscustomobject]@{
      WasPresent = $null -ne $existing
      Value = $existing
    })
    [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, 'Process')
  }
}

function Restore-SmokeEnvironment {
  foreach ($entry in $environmentBackup.GetEnumerator()) {
    $value = if ($entry.Value.WasPresent) { $entry.Value.Value } else { $null }
    [Environment]::SetEnvironmentVariable($entry.Key, $value, 'Process')
  }
}

try {
  [void](New-Item -ItemType Directory -Path $temporaryRoot)
  $archivePath = Join-Path $temporaryRoot $archiveName
  $archiveUrl = "https://github.com/grafana/k6/releases/download/v$k6Version/$archiveName"
  Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
  $actualArchiveSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualArchiveSha256 -cne $archiveSha256) {
    throw 'The downloaded k6 archive did not match the pinned SHA-256 digest.'
  }

  $extractPath = Join-Path $temporaryRoot 'k6'
  [void](New-Item -ItemType Directory -Path $extractPath)
  if ($runningOnWindows) {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
  }
  else {
    $tarResult = Invoke-CapturedProcess `
      -FilePath 'tar' `
      -ArgumentList @('-xzf', $archivePath, '-C', $extractPath) `
      -WorkingDirectory $temporaryRoot `
      -OutputPrefix 'extract'
    if ($tarResult.ExitCode -ne 0) {
      throw "The pinned k6 archive could not be extracted: $(Protect-SmokeText $tarResult.Stderr)"
    }
  }
  $k6Executable = Join-Path $extractPath "k6-v$k6Version-$platform"
  $k6Executable = Join-Path $k6Executable $(if ($runningOnWindows) { 'k6.exe' } else { 'k6' })
  if (-not (Test-Path -LiteralPath $k6Executable -PathType Leaf)) {
    throw 'The pinned k6 archive did not contain the expected executable.'
  }

  $versionResult = Invoke-CapturedProcess `
    -FilePath $k6Executable `
    -ArgumentList @('version') `
    -WorkingDirectory $temporaryRoot `
    -OutputPrefix 'k6-version'
  if (
    $versionResult.ExitCode -ne 0 -or
    "$($versionResult.Stdout)`n$($versionResult.Stderr)" -notmatch '(?i)\bv0\.57\.0\b'
  ) {
    throw "The extracted k6 executable did not report the pinned version: $(Protect-SmokeText "$($versionResult.Stdout)`n$($versionResult.Stderr)")"
  }

  $readyFile = Join-Path $temporaryRoot 'fixture-ready.json'
  $fixtureStdout = Join-Path $temporaryRoot 'fixture.stdout.log'
  $fixtureStderr = Join-Path $temporaryRoot 'fixture.stderr.log'
  $fixtureArguments = @(
    $fixturePath,
    '--ready-file', $readyFile,
    '--session-cookie', $sessionCookie,
    '--course-step-id', $courseStepCanary,
    '--response-canary', $responseCanary
  )
  $fixtureStartArguments = @{
    FilePath = $nodeCommand.Source
    ArgumentList = $fixtureArguments
    WorkingDirectory = $temporaryRoot
    RedirectStandardOutput = $fixtureStdout
    RedirectStandardError = $fixtureStderr
    PassThru = $true
  }
  if ($runningOnWindows) {
    $fixtureStartArguments.WindowStyle = 'Hidden'
  }
  $fixtureProcess = Start-Process @fixtureStartArguments

  $readyDeadline = [DateTimeOffset]::UtcNow.AddSeconds(10)
  while (-not (Test-Path -LiteralPath $readyFile)) {
    if ($fixtureProcess.HasExited) {
      $fixtureError = if (Test-Path -LiteralPath $fixtureStderr) {
        Get-Content -LiteralPath $fixtureStderr -Raw -Encoding UTF8
      }
      else {
        ''
      }
      throw "The loopback fixture exited before readiness: $(Protect-SmokeText $fixtureError)"
    }
    if ([DateTimeOffset]::UtcNow -ge $readyDeadline) {
      throw 'Timed out waiting for the loopback k6 fixture.'
    }
    Start-Sleep -Milliseconds 100
  }

  $ready = Get-Content -LiteralPath $readyFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $fixturePort = [int]$ready.port
  if ($fixturePort -lt 1024 -or $fixturePort -gt 65535) {
    throw 'The loopback fixture reported an invalid local port.'
  }
  $baseUrl = "http://127.0.0.1:$fixturePort"
  [void](Set-SmokeEnvironment -Values @{
    K6_BASE_URL = $baseUrl
    K6_READINESS_URL = "$baseUrl/health/live"
    K6_ACKNOWLEDGE_WRITES = 'true'
    K6_ACKNOWLEDGE_TARGET = $baseUrl
    K6_ACKNOWLEDGE_DEDICATED_DATA = 'true'
    K6_SESSION_COOKIE = $sessionCookie
    K6_COURSE_STEP_ID = $courseStepCanary
    K6_ACKNOWLEDGE_COURSE_STEP_ID = $courseStepCanary
    STUDYTUBE_K6_RUN_ID = $runId
    K6_WRITE_VUS = '1'
    K6_WRITE_ITERATIONS = '1'
    K6_NO_USAGE_REPORT = 'true'
    K6_NO_COLOR = 'true'
    HTTP_PROXY = ''
    HTTPS_PROXY = ''
    ALL_PROXY = ''
    NO_PROXY = '127.0.0.1,localhost,::1'
  })
  if (-not $runningOnWindows) {
    [void](Set-SmokeEnvironment -Values @{
        http_proxy = ''
        https_proxy = ''
        all_proxy = ''
        no_proxy = '127.0.0.1,localhost,::1'
      })
  }

  $inspectResult = Invoke-CapturedProcess `
    -FilePath $k6Executable `
    -ArgumentList @('inspect', '--include-system-env-vars', $workloadPath) `
    -WorkingDirectory $temporaryRoot `
    -OutputPrefix 'k6-inspect'
  if ($inspectResult.ExitCode -ne 0) {
    throw "Actual k6 inspection failed: $(Protect-SmokeText "$($inspectResult.Stdout)`n$($inspectResult.Stderr)")"
  }

  [void](New-Item `
      -ItemType Directory `
      -Path (Join-Path $temporaryRoot 'docs\evidence\operations\results') `
      -Force)
  $runResult = Invoke-CapturedProcess `
    -FilePath $k6Executable `
    -ArgumentList @('run', $workloadPath) `
    -WorkingDirectory $temporaryRoot `
    -OutputPrefix 'k6-run'
  if ($runResult.ExitCode -ne 0) {
    throw "Actual k6 execution failed: $(Protect-SmokeText "$($runResult.Stdout)`n$($runResult.Stderr)")"
  }

  $fixtureResultResponse = Invoke-WebRequest `
    -Uri "$baseUrl/__fixture__/result" `
    -Method Get `
    -TimeoutSec 5 `
    -UseBasicParsing
  $fixtureResult = $fixtureResultResponse.Content | ConvertFrom-Json
  if (
    [int]$fixtureResult.readinessRequests -ne 1 -or
    [int]$fixtureResult.baselineReads -ne 1 -or
    [int]$fixtureResult.postWriteReads -ne 2 -or
    [int]$fixtureResult.writeRequests -ne 1 -or
    [int]$fixtureResult.duplicateRequests -ne 1 -or
    [int]$fixtureResult.uniqueMutations -ne 1 -or
    [int]$fixtureResult.authenticationFailures -ne 0 -or
    [int]$fixtureResult.protocolFailures -ne 0
  ) {
    throw 'The actual k6 run did not complete the expected bounded lifecycle.'
  }

  $evidenceCandidates = @(
    Get-ChildItem -LiteralPath $temporaryRoot -Recurse -File -Filter "$runId.json"
  )
  if ($evidenceCandidates.Count -ne 1) {
    throw "The actual k6 run did not produce exactly one summary evidence file: $(Protect-SmokeText "$($runResult.Stdout)`n$($runResult.Stderr)")"
  }
  $evidencePath = $evidenceCandidates[0].FullName
  $evidenceText = Get-Content -LiteralPath $evidencePath -Raw -Encoding UTF8
  $evidence = $evidenceText | ConvertFrom-Json
  if (
    $evidence.schemaVersion -cne 'studytube.progress-write-evidence.v1' -or
    $evidence.status -cne 'passed' -or
    -not [bool]$evidence.completeness.complete -or
    [int]$evidence.configuration.virtualUsers -ne 1 -or
    [int]$evidence.configuration.iterationsPerVirtualUser -ne 1 -or
    -not [bool]$evidence.configuration.duplicateRequestPerIteration
  ) {
    throw 'The actual k6 summary evidence was incomplete or failed.'
  }

  $fixtureOutput = ''
  foreach ($fixtureLog in @($fixtureStdout, $fixtureStderr)) {
    if (Test-Path -LiteralPath $fixtureLog) {
      $fixtureOutput += Get-Content -LiteralPath $fixtureLog -Raw -Encoding UTF8
    }
  }
  $retainedOutput = @(
    $inspectResult.Stdout,
    $inspectResult.Stderr,
    $runResult.Stdout,
    $runResult.Stderr,
    $fixtureOutput,
    $fixtureResultResponse.Content,
    $evidenceText
  ) -join [Environment]::NewLine
  foreach ($canary in @($sessionCanary, $sessionCookie, $courseStepCanary, $responseCanary)) {
    if ($retainedOutput.Contains($canary)) {
      throw 'The actual k6 smoke retained a protected canary in stdout, stderr, or evidence.'
    }
  }

  Write-Host 'Actual k6 progress-write smoke passed: inspect and bounded loopback lifecycle.'
}
finally {
  Restore-SmokeEnvironment
  if ($null -ne $fixtureProcess -and -not $fixtureProcess.HasExited) {
    Stop-Process -Id $fixtureProcess.Id -Force -ErrorAction SilentlyContinue
    try {
      [void]$fixtureProcess.WaitForExit(5000)
    }
    catch {
    }
  }
  if (Test-Path -LiteralPath $temporaryRoot) {
    $cleanupTarget = [IO.Path]::GetFullPath($temporaryRoot)
    if (
      $cleanupTarget.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase) -and
      [IO.Path]::GetFileName($cleanupTarget) -cmatch '^studytube-k6-smoke-[a-f0-9]{32}$'
    ) {
      Remove-Item -LiteralPath $cleanupTarget -Recurse -Force
    }
    else {
      Write-Warning 'The temporary k6 smoke directory did not match the cleanup allowlist.'
    }
  }
}
