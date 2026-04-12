# =============================================================================
# Coasty — Pre-Deployment Test Suite (PowerShell)
#
# Runs all tests across frontend, backend, and electron layers.
# Exit code is non-zero if ANY suite fails.
#
# Usage:
#   .\scripts\run-all-tests.ps1           # run all
#   .\scripts\run-all-tests.ps1 frontend  # run only frontend
#   .\scripts\run-all-tests.ps1 backend   # run only backend
#   .\scripts\run-all-tests.ps1 electron  # run only electron
# =============================================================================

param(
    [string]$Filter = "all"
)

$ErrorActionPreference = "Continue"
$RootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $RootDir) { $RootDir = (Get-Location).Path }

$Failed = 0
$Results = @()

function Write-Banner($text) {
    Write-Host ""
    Write-Host "===========================================================" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "===========================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Run-Suite($Name, $Command) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host ">> Running $Name..." -ForegroundColor Yellow

    Invoke-Expression $Command
    $exitCode = $LASTEXITCODE
    $sw.Stop()
    $elapsed = $sw.Elapsed.TotalSeconds.ToString("F0")

    if ($exitCode -eq 0) {
        Write-Host "  PASS  $Name (${elapsed}s)" -ForegroundColor Green
        $script:Results += "  PASS  $Name (${elapsed}s)"
    } else {
        Write-Host "  FAIL  $Name (${elapsed}s)" -ForegroundColor Red
        $script:Results += "  FAIL  $Name (${elapsed}s)"
        $script:Failed = 1
    }
    Write-Host ""
}

# -----------------------------------------------
# 1. Frontend Tests (Vitest)
# -----------------------------------------------
if ($Filter -eq "all" -or $Filter -eq "frontend") {
    Write-Banner "FRONTEND TESTS (Vitest)"
    Push-Location $RootDir
    Run-Suite "Frontend Unit Tests" "npx vitest run --reporter=verbose"
    Pop-Location
}

# -----------------------------------------------
# 2. Backend Tests (pytest)
# -----------------------------------------------
if ($Filter -eq "all" -or $Filter -eq "backend") {
    Write-Banner "BACKEND TESTS (pytest)"
    Push-Location "$RootDir\backend"

    # Activate venv if it exists
    if (Test-Path "venv\Scripts\Activate.ps1") {
        & "venv\Scripts\Activate.ps1"
    }

    Run-Suite "Backend Unit & Integration Tests" "python -m pytest tests/ -v --tb=short"
    Pop-Location
}

# -----------------------------------------------
# 3. Electron Tests (Vitest)
# -----------------------------------------------
if ($Filter -eq "all" -or $Filter -eq "electron") {
    Write-Banner "ELECTRON TESTS (Vitest)"
    Push-Location "$RootDir\electron"
    Run-Suite "Electron Unit Tests" "npx vitest run --reporter=verbose"
    Pop-Location
}

# -----------------------------------------------
# 4. Type Checking (TypeScript)
# -----------------------------------------------
if ($Filter -eq "all" -or $Filter -eq "typecheck") {
    Write-Banner "TYPE CHECKING"
    Push-Location $RootDir
    Run-Suite "TypeScript Type Check" "npx tsc --noEmit"
    Pop-Location
}

# -----------------------------------------------
# Summary
# -----------------------------------------------
Write-Banner "TEST RESULTS SUMMARY"
foreach ($r in $Results) {
    Write-Host $r
}
Write-Host ""

if ($Failed -ne 0) {
    Write-Host "Some test suites failed. Fix issues before deploying." -ForegroundColor Red
    exit 1
} else {
    Write-Host "All test suites passed! Ready for deployment." -ForegroundColor Green
    exit 0
}
