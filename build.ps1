<#
.SYNOPSIS
  Builds, tests and publishes DreamCanvas.

.DESCRIPTION
  1. Builds the web renderer (TypeScript type-check, Vite bundle, presets.json, thumbnails).
  2. Runs the renderer tests (Vitest), the editor end-to-end checks (headless Edge) and the .NET tests (xUnit).
  3. Publishes the installed layout to artifacts\DreamCanvas:
       app\DreamCanvas.exe            WinUI 3 application (self-contained)
       engine\DreamCanvas.Engine.exe  wallpaper engine + tray (self-contained)
       engine\DreamCanvas.scr         Windows screensaver (+ DreamCanvas.Screensaver.exe for idle display / export)
       engine\dreamcanvas-cli.exe     command-line control / diagnostics
       web\renderer\                  renderer bundle shared by all of them

.EXAMPLE
  .\build.ps1                 # full build + tests + publish
  .\build.ps1 -SkipTests      # faster iteration
  .\build.ps1 -SkipPublish    # build and test only
  .\build.ps1 -Installer      # ...and artifacts\installer\DreamCanvasSetup-<version>.exe (needs Inno Setup 6)
#>
param(
    [switch]$SkipTests,
    [switch]$SkipPublish,
    [switch]$SkipThumbnails,
    [switch]$Installer,
    [ValidateSet('Debug', 'Release')] [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

# Prefer the workspace-local SDK (see README), fall back to a global install.
$localDotnet = Join-Path $root '..\.tools\dotnet\dotnet.exe'
$dotnet = if (Test-Path $localDotnet) { (Resolve-Path $localDotnet).Path } else { 'dotnet' }

function Step([string]$name, [scriptblock]$action) {
    Write-Host "`n=== $name ===" -ForegroundColor Cyan
    # Steps that run no native command must not inherit an exit code from an earlier one.
    $global:LASTEXITCODE = 0
    # Native tools are judged by exit code; Windows PowerShell would otherwise abort on any stderr line.
    $ErrorActionPreference = 'Continue'
    & $action
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "$name failed (exit code $LASTEXITCODE)" }
}

$renderer = Join-Path $root 'web\renderer'

Step 'Renderer: install dependencies' {
    Push-Location $renderer
    try { if (-not (Test-Path node_modules)) { npm ci } } finally { Pop-Location }
}

Step 'Renderer: build' {
    Push-Location $renderer
    try { if ($SkipThumbnails) { npm run build:fast } else { npm run build } } finally { Pop-Location }
}

if (-not $SkipTests) {
    Step 'Renderer: tests' {
        Push-Location $renderer
        try { npm test } finally { Pop-Location }
    }
    # Drives the built editor in headless Edge (keyframes, timeline, movements, path drawing).
    Step 'Renderer: editor end-to-end' {
        Push-Location $renderer
        try { npm run e2e } finally { Pop-Location }
    }
    Step '.NET: tests' { & $dotnet test (Join-Path $root 'tests\DreamCanvas.Core.Tests') -c $Configuration }
}

if (-not $SkipPublish) {
    $out = Join-Path $root 'artifacts\DreamCanvas'
    Step 'Publish: clean output' { if (Test-Path $out) { Remove-Item $out -Recurse -Force }; New-Item -ItemType Directory $out | Out-Null }
    Step 'Publish: app' { & $dotnet publish (Join-Path $root 'src\DreamCanvas.App') -c $Configuration -o (Join-Path $out 'app') }
    # Engine, screensaver player and CLI are all self-contained WinForms apps built from the same
    # SDK, so they share one runtime copy in the engine folder (each keeps its own deps/runtimeconfig).
    $engineDir = Join-Path $out 'engine'
    Step 'Publish: engine' { & $dotnet publish (Join-Path $root 'src\DreamCanvas.Engine') -c $Configuration -o $engineDir }
    Step 'Publish: screensaver' { & $dotnet publish (Join-Path $root 'src\DreamCanvas.Screensaver') -c $Configuration -o $engineDir }
    Step 'Publish: cli' { & $dotnet publish (Join-Path $root 'tools\DreamCanvas.Cli') -c $Configuration -o $engineDir }
    Step 'Publish: check outputs' {
        if (-not (Test-Path (Join-Path $engineDir 'DreamCanvas.scr'))) { throw 'DreamCanvas.scr was not produced' }
        # WinUI pages load from compiled resources; a publish without them starts and immediately fails.
        $appDir = Join-Path $out 'app'
        # (With MSIX tooling enabled the compiled XAML is embedded in this .pri.)
        if (-not (Test-Path (Join-Path $appDir 'DreamCanvas.pri'))) { throw 'app\DreamCanvas.pri is missing (WinUI resources and compiled XAML)' }
    }
    Step 'Publish: renderer' {
        $dest = Join-Path $out 'web\renderer'
        New-Item -ItemType Directory $dest -Force | Out-Null
        Copy-Item (Join-Path $renderer 'dist\*') $dest -Recurse
    }
    $size = (Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
    Write-Host ("`nPublished to {0} ({1:N0} MB)" -f $out, $size) -ForegroundColor Green
    Write-Host "Run: $out\app\DreamCanvas.exe"
}

if ($Installer) {
    # Inno Setup 6: the workspace copy (see README) or a normal installation.
    $iscc = @((Join-Path $root '..\.tools\innosetup\ISCC.exe'), "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $iscc) { throw 'Inno Setup 6 (ISCC.exe) was not found; see README "Building the installer".' }
    $version = ([xml](Get-Content (Join-Path $root 'Directory.Build.props'))).Project.PropertyGroup.Version
    Step 'Installer' { & $iscc /Q "/DAppVersion=$version" (Join-Path $root 'installer\DreamCanvas.iss') }
    $setup = Join-Path $root "artifacts\installer\DreamCanvasSetup-$version.exe"
    Write-Host ("Installer: {0} ({1:N0} MB)" -f $setup, ((Get-Item $setup).Length / 1MB)) -ForegroundColor Green
}
