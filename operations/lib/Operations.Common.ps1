Set-StrictMode -Version Latest

function Assert-SafePostgresIdentifier {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if ($Value -cnotmatch '^[a-z_][a-z0-9_]{0,62}$') {
    throw "$Name must be a lowercase PostgreSQL identifier no longer than 63 characters."
  }
}

function Assert-LocalHttpUri {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $uri = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri)) {
    throw "$Name must be an absolute HTTP URL."
  }
  if ($uri.Scheme -notin @('http', 'https')) {
    throw "$Name must use HTTP or HTTPS."
  }
  if ($uri.UserInfo) {
    throw "$Name must not contain credentials."
  }
  if ($uri.Host -notin @('127.0.0.1', 'localhost', '::1', '[::1]')) {
    throw "$Name must target the local loopback interface."
  }
  return $uri
}

function Invoke-ExternalCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$ArgumentList = @(),
    [switch]$AllowFailure
  )

  $output = & $FilePath @ArgumentList 2>&1
  $exitCode = $LASTEXITCODE
  $text = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
  $result = [pscustomobject]@{
    ExitCode = [int]$exitCode
    Output = $text.Trim()
  }
  if (-not $AllowFailure -and $result.ExitCode -ne 0) {
    $safeOutput = Protect-OperationalText $result.Output
    throw "$FilePath failed with exit code $($result.ExitCode): $safeOutput"
  }
  return $result
}

function Invoke-DockerCompose {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ComposeFile,
    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList,
    [switch]$AllowFailure
  )

  $arguments = @('compose', '-f', (Resolve-Path $ComposeFile).Path) + $ArgumentList
  return Invoke-ExternalCommand -FilePath 'docker' -ArgumentList $arguments -AllowFailure:$AllowFailure
}

function Assert-LocalDockerContext {
  $dockerHost = [string]$env:DOCKER_HOST
  if (
    $dockerHost -and
    $dockerHost -notmatch '^(npipe:|unix:|file:)'
  ) {
    throw 'Remote DOCKER_HOST values are refused by operations drills.'
  }

  $context = Invoke-ExternalCommand -FilePath 'docker' -ArgumentList @('context', 'show')
  if ($context.Output -notin @('default', 'desktop-linux')) {
    throw "Docker context '$($context.Output)' is not an allowlisted local context."
  }
  return $context.Output
}

function Get-ComposeContainerId {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ComposeFile,
    [Parameter(Mandatory = $true)]
    [ValidateSet('postgres', 'valkey')]
    [string]$Service
  )

  $result = Invoke-DockerCompose -ComposeFile $ComposeFile -ArgumentList @('ps', '-q', $Service)
  if (-not $result.Output) {
    throw "Compose service '$Service' has no container."
  }
  return $result.Output.Trim()
}

function Assert-ComposeServiceOwnership {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ComposeFile,
    [Parameter(Mandatory = $true)]
    [ValidateSet('postgres', 'valkey')]
    [string]$Service
  )

  $composePath = (Resolve-Path $ComposeFile).Path
  $containerId = Get-ComposeContainerId -ComposeFile $composePath -Service $Service
  $label = Invoke-ExternalCommand -FilePath 'docker' -ArgumentList @(
    'inspect',
    '--format',
    '{{ index .Config.Labels "com.docker.compose.project.config_files" }}',
    $containerId
  )
  $configuredFiles = @($label.Output -split ',' | ForEach-Object {
      try { [IO.Path]::GetFullPath($_.Trim()) } catch { $_.Trim() }
    })
  if ($configuredFiles -notcontains [IO.Path]::GetFullPath($composePath)) {
    throw "Compose service '$Service' was not created from the requested compose file."
  }
  return $containerId
}

function Wait-OperationsCondition {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Condition,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds,
    [string]$Description = 'condition'
  )

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      if (& $Condition) {
        return
      }
    }
    catch {
    }
    Start-Sleep -Seconds 1
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Timed out waiting for $Description after $TimeoutSeconds seconds."
}

function Get-HttpProbe {
  param(
    [Parameter(Mandatory = $true)]
    [Uri]$Uri,
    [int]$TimeoutSeconds = 5
  )

  try {
    $response = Invoke-WebRequest -Uri $Uri -Method Get -TimeoutSec $TimeoutSeconds -UseBasicParsing
    return [pscustomobject]@{
      Success = $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
      StatusCode = [int]$response.StatusCode
      Error = $null
    }
  }
  catch {
    $statusCode = 0
    if ($null -ne $_.Exception.Response) {
      try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { $statusCode = 0 }
    }
    return [pscustomobject]@{
      Success = $false
      StatusCode = $statusCode
      Error = Protect-OperationalText $_.Exception.Message
    }
  }
}

function Protect-OperationalText {
  param([AllowNull()][string]$Value)

  if ($null -eq $Value) {
    return $null
  }
  return $Value `
    -replace '(?i)(postgres(?:ql)?://)[^\s/@?#]+@', '$1[redacted]@' `
    -replace '(?i)([?&][^=&#\s]*(?:password|token|secret)[^=&#\s]*=)[^&#\s]*', '$1[redacted]' `
    -replace '(?i)(password|token|secret)\s*[:=]\s*[^\s,;]+', '$1=[redacted]'
}

function Write-OperationsEvidence {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Evidence,
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $fullPath = [IO.Path]::GetFullPath($Path)
  $directory = Split-Path -Parent $fullPath
  [void](New-Item -ItemType Directory -Path $directory -Force)
  $temporaryPath = "$fullPath.$([Guid]::NewGuid().ToString('N')).tmp"
  $json = $Evidence | ConvertTo-Json -Depth 20
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($temporaryPath, $json + [Environment]::NewLine, $utf8WithoutBom)
  Move-Item -LiteralPath $temporaryPath -Destination $fullPath -Force
  return $fullPath
}

function Get-TextSha256 {
  param([Parameter(Mandatory = $true)][string]$Value)

  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $sha.Dispose()
  }
}
