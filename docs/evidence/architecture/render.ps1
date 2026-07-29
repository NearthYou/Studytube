[CmdletBinding()]
param(
  [switch]$Check
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$cliVersion = '11.16.0'
$sourceRoot = $PSScriptRoot
$configPath = Join-Path $sourceRoot 'mermaid.config.json'
$sources = @(
  Get-ChildItem -LiteralPath $sourceRoot -Filter '*.mmd' -File |
    Sort-Object Name
)

if ($sources.Count -lt 7) {
  throw "Expected at least 7 Mermaid sources, found $($sources.Count)."
}
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw "Mermaid configuration is missing: $configPath"
}

$expectedSvgNames = @($sources | ForEach-Object { "$($_.BaseName).svg" })
$orphanedSvgNames = @(
  Get-ChildItem -LiteralPath $sourceRoot -Filter '*.svg' -File |
    Where-Object { $_.Name -notin $expectedSvgNames } |
    ForEach-Object Name
)
if ($orphanedSvgNames.Count -gt 0) {
  throw "SVG artifacts without Mermaid sources: $($orphanedSvgNames -join ', ')"
}

$npx = Get-Command 'npx.cmd' -ErrorAction SilentlyContinue
if (-not $npx) {
  $npx = Get-Command 'npx' -ErrorAction Stop
}

$outputRoot = $sourceRoot
$temporaryRoot = $null
if ($Check) {
  $temporaryRoot = Join-Path (
    [IO.Path]::GetTempPath()
  ) ("studytube-architecture-{0}" -f [Guid]::NewGuid().ToString('N'))
  [void](New-Item -ItemType Directory -Path $temporaryRoot)
  $outputRoot = $temporaryRoot
}

try {
  foreach ($source in $sources) {
    $targetName = "{0}.svg" -f $source.BaseName
    $targetPath = Join-Path $outputRoot $targetName
    $arguments = @(
      '--yes',
      '--package', "@mermaid-js/mermaid-cli@$cliVersion",
      'mmdc',
      '--input', $source.FullName,
      '--output', $targetPath,
      '--configFile', $configPath,
      '--backgroundColor', 'transparent'
    )

    & $npx.Source @arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Mermaid render failed for $($source.Name)."
    }
    if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
      throw "Mermaid did not create $targetPath."
    }
    $svg = Get-Content -LiteralPath $targetPath -Raw -Encoding UTF8
    if ($svg -notmatch '<svg\b' -or $svg -notmatch '</svg>') {
      throw "Rendered output is not a complete SVG: $targetPath"
    }

    if ($Check) {
      $committedPath = Join-Path $sourceRoot $targetName
      if (-not (Test-Path -LiteralPath $committedPath -PathType Leaf)) {
        throw "Rendered pair is missing: $committedPath"
      }
      $expectedHash = (Get-FileHash -LiteralPath $committedPath -Algorithm SHA256).Hash
      $actualHash = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash
      if ($actualHash -ne $expectedHash) {
        throw "Rendered SVG is stale for $($source.Name). Run render.ps1 without -Check."
      }
    }
  }

  "Verified {0} Mermaid source and SVG pairs with mermaid-cli {1}." -f (
    $sources.Count
  ), $cliVersion
}
finally {
  if ($temporaryRoot -and (Test-Path -LiteralPath $temporaryRoot)) {
    $resolved = [IO.Path]::GetFullPath($temporaryRoot)
    $requiredPrefix = [IO.Path]::GetFullPath(
      (Join-Path ([IO.Path]::GetTempPath()) 'studytube-architecture-')
    )
    if (-not $resolved.StartsWith(
        $requiredPrefix,
        [StringComparison]::OrdinalIgnoreCase
      )) {
      throw "Refusing to remove unexpected temporary path: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
