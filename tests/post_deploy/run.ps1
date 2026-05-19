# Post-deploy suite runner — Windows PowerShell.
# Usage: ./tests/post_deploy/run.ps1 [pytest args]

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
    Write-Error "tests/post_deploy/.env not found. Copy .env.example to .env and fill in values."
    exit 2
}

# Install deps if requirements.txt changed.
$reqHashFile = ".requirements.hash"
$currentHash = (Get-FileHash requirements.txt -Algorithm SHA256).Hash
if (-not (Test-Path $reqHashFile) -or ((Get-Content $reqHashFile) -ne $currentHash)) {
    Write-Host "[run.ps1] Installing post-deploy requirements..." -ForegroundColor Cyan
    python -m pip install --quiet -r requirements.txt
    $currentHash | Set-Content $reqHashFile
}

# Export .env key=value lines into $env:
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*#') { return }
    if ($_ -match '^\s*$') { return }
    $key, $value = $_.Split('=', 2)
    if ($key -and $value) {
        [Environment]::SetEnvironmentVariable($key.Trim(), $value.Trim(), 'Process')
    }
}

python -m pytest @args
exit $LASTEXITCODE
