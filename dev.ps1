#requires -Version 5.1
<#
    dev.ps1 - Run frontend (Next.js) and backend (FastAPI) together.
    Ctrl+C stops both and frees ports 3000/8001. No new windows for the frontend;
    the backend gets its own window so uvicorn's reload doesn't kill this script.

    Every line from each process is timestamped and teed into:
        logs/frontend.log
        logs/backend.log
    Logs are reset at the start of each run, so each file == one dev session.
#>

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$script:processes = @()

$logsDir     = Join-Path $root 'logs'
$frontendLog = Join-Path $logsDir 'frontend.log'
$backendLog  = Join-Path $logsDir 'backend.log'

if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

function ConvertTo-EncodedCmd {
    param([Parameter(Mandatory)][string]$Command)
    # powershell.exe -EncodedCommand expects Base64 of the UTF-16 LE bytes.
    # Using this avoids the command-line quote-stripping that mangles nested " and [].
    [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($Command))
}

function Stop-DevServers {
    Write-Host ""
    Write-Host "[dev] Stopping servers..." -ForegroundColor Yellow

    foreach ($p in $script:processes) {
        if ($null -ne $p -and -not $p.HasExited) {
            # /T kills the entire child tree (npm -> node -> next dev), /F = force
            & taskkill.exe /F /T /PID $p.Id 2>&1 | Out-Null
        }
    }

    foreach ($port in 3000, 8001) {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host "[dev] Stopped." -ForegroundColor Green
    Write-Host "[dev] Logs saved:" -ForegroundColor DarkGray
    Write-Host "[dev]   frontend -> $frontendLog" -ForegroundColor DarkGray
    Write-Host "[dev]   backend  -> $backendLog"  -ForegroundColor DarkGray
}

try {
    $venvPython = Join-Path $root 'backend\venv\Scripts\python.exe'
    if (-not (Test-Path $venvPython)) {
        Write-Host "[dev] venv missing at $venvPython" -ForegroundColor Red
        Write-Host "[dev] Run backend\run_backend.bat once to create it, then re-run dev.ps1." -ForegroundColor Red
        exit 1
    }

    if (-not $env:DEBUG)       { $env:DEBUG = 'true' }
    if (-not $env:ENVIRONMENT) { $env:ENVIRONMENT = 'development' }
    # Force Python to flush stdout/stderr per line so logs stream live (Tee-Object is line-based).
    $env:PYTHONUNBUFFERED = '1'

    $sessionStart = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    # Reset both log files with a session header. Encoding 'Unicode' (UTF-16 LE BOM)
    # matches Tee-Object's default in PS 5.1 so appended lines render correctly.
    Set-Content -Path $backendLog  -Value "===== Coasty BACKEND  session started $sessionStart =====" -Encoding Unicode
    Set-Content -Path $frontendLog -Value "===== Coasty FRONTEND session started $sessionStart =====" -Encoding Unicode

    Write-Host "[dev] Logs (tailing also works: Get-Content -Wait -Tail 50 <path>):" -ForegroundColor DarkGray
    Write-Host "[dev]   frontend -> $frontendLog" -ForegroundColor DarkGray
    Write-Host "[dev]   backend  -> $backendLog"  -ForegroundColor DarkGray
    Write-Host ""

    Write-Host "[dev] Starting backend  (FastAPI on :8001) in its own window..." -ForegroundColor Cyan
    # Backend runs in a separate console so uvicorn's reload (CTRL_C_EVENT to its
    # own process group) doesn't tear down the frontend or this dev script.
    # Output is timestamped and teed to logs/backend.log while still showing in the window.
    $backendInner = @"
`$Host.UI.RawUI.WindowTitle = 'Coasty Backend'
& "$venvPython" main.py 2>&1 | ForEach-Object { "[`$(Get-Date -Format 'HH:mm:ss.fff')] `$_" } | Tee-Object -FilePath "$backendLog" -Append
"@
    $backend = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList '-NoProfile','-NoExit','-EncodedCommand',(ConvertTo-EncodedCmd $backendInner) `
        -WorkingDirectory (Join-Path $root 'backend') `
        -PassThru
    $script:processes += $backend

    Start-Sleep -Milliseconds 400

    Write-Host "[dev] Starting frontend (Next.js on :3000)..." -ForegroundColor Cyan
    # Frontend stays in this console (-NoNewWindow); same timestamp+tee pattern.
    $frontendInner = @"
& npm.cmd run dev 2>&1 | ForEach-Object { "[`$(Get-Date -Format 'HH:mm:ss.fff')] `$_" } | Tee-Object -FilePath "$frontendLog" -Append
"@
    $frontend = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList '-NoProfile','-EncodedCommand',(ConvertTo-EncodedCmd $frontendInner) `
        -WorkingDirectory $root `
        -NoNewWindow -PassThru
    $script:processes += $frontend

    Write-Host ""
    Write-Host "[dev]  Frontend  http://localhost:3000" -ForegroundColor Green
    Write-Host "[dev]  Backend   http://localhost:8001" -ForegroundColor Green
    Write-Host "[dev]  Ctrl+C to stop both." -ForegroundColor Yellow
    Write-Host ""

    while (-not $backend.HasExited -and -not $frontend.HasExited) {
        Start-Sleep -Seconds 1
    }

    if ($backend.HasExited)  { Write-Host "[dev] Backend exited (code $($backend.ExitCode))."   -ForegroundColor Red }
    if ($frontend.HasExited) { Write-Host "[dev] Frontend exited (code $($frontend.ExitCode))." -ForegroundColor Red }
}
finally {
    Stop-DevServers
}
