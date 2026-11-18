<#
.SYNOPSIS
    Installer for AntiGravity-Skills plugins (Windows PowerShell).

.EXAMPLE
    # Install all 6 plugins into ~/.gemini/config/plugins (and install doc-viewer npm deps)
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -All

    # Install selected plugins only
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Plugin doc-viewer,local-office-suite,project-onboard

    # Link plugins via NTFS Junctions (no Admin required) so `git pull` updates live!
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -All -Link

    # List available plugins
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -List
#>
param(
    [switch]$All,
    [string[]]$Plugin = @(),
    [switch]$Link,
    [switch]$List,
    [switch]$CodexSkills,
    [string]$TargetDir = (Join-Path $HOME ".gemini\config\plugins")
)

$ErrorActionPreference = "Stop"
$RepoPluginsDir = Join-Path $PSScriptRoot "plugins"

$AvailablePlugins = Get-ChildItem -Path $RepoPluginsDir -Directory | Sort-Object Name

if ($List -or (-not $All -and $Plugin.Count -eq 0)) {
    Write-Host "`nAvailable plugins in AntiGravity-Skills:" -ForegroundColor Cyan
    foreach ($p in $AvailablePlugins) {
        $manifestPath = Join-Path $p.FullName "plugin.json"
        $desc = ""
        if (Test-Path $manifestPath) {
            $json = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
            $desc = $json.description
        }
        Write-Host ("  - {0,-24} {1}" -f $p.Name, $desc)
    }
    Write-Host "`nUsage:" -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -All"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -All -Link"
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Plugin doc-viewer,project-onboard`n"
    exit 0
}

# Support comma-separated string passed as single argument
$SelectedNames = @()
if ($All) {
    $SelectedNames = $AvailablePlugins | ForEach-Object { $_.Name }
} else {
    foreach ($item in $Plugin) {
        $SelectedNames += ($item -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
    }
}

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

foreach ($name in $SelectedNames) {
    $src = Join-Path $RepoPluginsDir $name
    if (-not (Test-Path $src)) {
        Write-Warning "Plugin '$name' not found under $RepoPluginsDir (skipped)."
        continue
    }
    $dst = Join-Path $TargetDir $name
    if (Test-Path $dst) {
        $item = Get-Item -Force $dst
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            cmd /c rmdir "$dst" | Out-Null
        } else {
            Write-Host "[Update] Removing existing directory: $dst" -ForegroundColor DarkGray
            Remove-Item -Recurse -Force $dst
        }
    }

    if ($Link) {
        New-Item -ItemType Junction -Path $dst -Target $src | Out-Null
        Write-Host "[Linked]    $name -> $dst" -ForegroundColor Green
    } else {
        Copy-Item -Recurse -Force -Path $src -Destination $dst
        Write-Host "[Installed] $name -> $dst" -ForegroundColor Green
    }

    if ($name -eq "doc-viewer") {
        $sidecarDir = Join-Path $dst "sidecars\doc_viewer"
        if ((Test-Path (Join-Path $sidecarDir "package.json")) -and -not (Test-Path (Join-Path $sidecarDir "node_modules"))) {
            if (Get-Command npm -ErrorAction SilentlyContinue) {
                Write-Host "  -> Installing npm dependencies for doc-viewer sidecar..." -ForegroundColor Cyan
                Push-Location $sidecarDir
                try {
                    npm install --no-audit --no-fund
                } finally {
                    Pop-Location
                }
            } else {
                Write-Warning "npm not found on PATH. Run 'npm install' inside $sidecarDir manually."
            }
        }
    }

    if ($CodexSkills) {
        $skillsDir = Join-Path $src "skills"
        if (Test-Path $skillsDir) {
            $codexRoot = Join-Path $HOME ".codex\skills"
            New-Item -ItemType Directory -Force -Path $codexRoot | Out-Null
            Get-ChildItem -Path $skillsDir -Directory | ForEach-Object {
                $sDst = Join-Path $codexRoot $_.Name
                if (Test-Path $sDst) { Remove-Item -Recurse -Force $sDst }
                Copy-Item -Recurse -Force -Path $_.FullName -Destination $sDst
                Write-Host "  -> Exported skill '$($_.Name)' to $sDst" -ForegroundColor DarkCyan
            }
        }
    }
}

Write-Host "`nDone! Plugins are ready in Antigravity ($TargetDir)." -ForegroundColor Cyan
Write-Host "Start a new turn or open Customizations in Antigravity IDE to manage them.`n"
