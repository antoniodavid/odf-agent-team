#Requires -Version 5.1
# ODF Agent Team — Windows bootstrap for the portable Node installer.
#
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/antoniodavid/odf-agent-team/main/install.ps1 | iex
#   powershell -ExecutionPolicy Bypass -File install.ps1 --yes
#
# This script only locates a pack source (local checkout, $env:ODF_SOURCE_DIR,
# or a downloaded archive) and delegates to bin/odf.mjs. Every install step
# lives in Node (scripts/lib/install-core.mjs) and is shared with install.sh.

$ErrorActionPreference = 'Stop'

$Repo = if ($env:REPO) { $env:REPO } else { 'https://github.com/antoniodavid/odf-agent-team' }
$Branch = if ($env:BRANCH) { $env:BRANCH } else { 'main' }

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Fail 'Node.js is required. Please install Node.js 18+.'
}
$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 18) {
    Fail "Node.js $nodeMajor.x is too old. Node.js 18+ is required."
}

function Test-PackDir([string]$Dir) {
    if (-not $Dir) { return $false }
    return (Test-Path (Join-Path $Dir 'odf-registry.json')) -and (Test-Path (Join-Path $Dir 'package.json')) -and (Test-Path (Join-Path $Dir 'skills'))
}

# Resolve the pack source without downloading when a local checkout is present.
$Source = $null
if ($env:ODF_SOURCE_DIR) {
    if (-not (Test-Path -LiteralPath $env:ODF_SOURCE_DIR -PathType Container)) {
        Fail "ODF_SOURCE_DIR does not exist: $env:ODF_SOURCE_DIR"
    }
    $Source = (Resolve-Path -LiteralPath $env:ODF_SOURCE_DIR).Path
}
elseif ($PSScriptRoot -and (Test-PackDir $PSScriptRoot) -and (Test-Path (Join-Path $PSScriptRoot 'install.sh'))) {
    $Source = $PSScriptRoot
}
elseif ((Test-PackDir $PWD.Path) -and (Test-Path (Join-Path $PWD.Path 'install.sh'))) {
    $Source = $PWD.Path
}

if (-not $Source) {
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("odf-install-" + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        $archive = Join-Path $tmp 'pack.zip'
        Write-Host '⬇️  Downloading ODF Agent Team...'
        Invoke-WebRequest -Uri "$Repo/archive/$Branch.zip" -OutFile $archive -UseBasicParsing
        Expand-Archive -LiteralPath $archive -DestinationPath $tmp -Force

        $candidate = Join-Path $tmp "odf-agent-team-$Branch"
        if (-not (Test-Path $candidate)) {
            $dirs = Get-ChildItem -LiteralPath $tmp -Directory
            if ($dirs.Count -gt 0) { $candidate = $dirs[0].FullName }
        }
        if (-not (Test-Path (Join-Path $candidate 'bin/odf.mjs'))) {
            Fail "Download failed. Check: $Repo"
        }
        Write-Host '✅ Downloaded'

        & node (Join-Path $candidate 'bin/odf.mjs') install --source $candidate @args
        exit $LASTEXITCODE
    }
    finally {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

& node (Join-Path $Source 'bin/odf.mjs') install --source $Source @args
exit $LASTEXITCODE
