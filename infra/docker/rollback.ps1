<#
.SYNOPSIS
    Roll back to a previously-pushed image version.

.DESCRIPTION
    Lists recent ECR tags for the frontend repo (the two repos are deployed in
    lockstep, so a tag exists in both or neither), prompts for the tag to roll
    back to, rewrites infra/aws/versions.auto.tfvars, and runs `terraform apply`.

    No rebuild, no test re-run -- same exact image bytes that ran before.

    Required env (in infra/docker/.env or shell): same as build-and-push.ps1
      AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
      AWS_ACCOUNT_ID, BACKEND_REPO, FRONTEND_REPO

    Optional env:
      ROLLBACK_TAG    -- skip the prompt, use this tag directly
      SHOW_LIMIT      -- number of recent tags to list (default: 20)
      SKIP_TERRAFORM  -- set to 1 to write versions.auto.tfvars but skip apply
      TF_DIR          -- terraform directory (default: infra/aws)
#>

#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

function Log  { param($tag, $msg) Write-Host "[$tag] $msg" -ForegroundColor Cyan }
function Fail { param($tag, $msg) Write-Host "[$tag] $msg" -ForegroundColor Red }

function Require-Cmd {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Fail 'deps' "missing $Name"
        exit 127
    }
}

function Import-DotEnv {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { return }
        $key = $line.Substring(0, $eq).Trim()
        $val = $line.Substring($eq + 1).Trim()
        if ($val.Length -ge 2 -and (
              ($val.StartsWith('"') -and $val.EndsWith('"')) -or
              ($val.StartsWith("'") -and $val.EndsWith("'")))) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        if ([string]::IsNullOrEmpty((Get-Item "env:$key" -ErrorAction SilentlyContinue).Value)) {
            Set-Item -Path "env:$key" -Value $val
        }
    }
}

function Require-Env {
    param([string[]]$Names)
    $missing = @()
    foreach ($n in $Names) {
        $v = (Get-Item "env:$n" -ErrorAction SilentlyContinue).Value
        if ([string]::IsNullOrEmpty($v)) { $missing += $n }
    }
    if ($missing.Count -gt 0) {
        Fail 'env' ("missing required: " + ($missing -join ', '))
        exit 64
    }
}

Require-Cmd 'aws'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path

Import-DotEnv (Join-Path $ScriptDir '.env')
Require-Env @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION',
              'AWS_ACCOUNT_ID','BACKEND_REPO','FRONTEND_REPO')

$AwsRegion    = $env:AWS_REGION
$BackendRepo  = $env:BACKEND_REPO
$FrontendRepo = $env:FRONTEND_REPO
$EcrHost      = if ([string]::IsNullOrEmpty($env:ECR_HOST)) { "$($env:AWS_ACCOUNT_ID).dkr.ecr.$AwsRegion.amazonaws.com" } else { $env:ECR_HOST }
$ShowLimit    = if ([string]::IsNullOrEmpty($env:SHOW_LIMIT)) { 20 } else { [int]$env:SHOW_LIMIT }
$TfDir        = if ([string]::IsNullOrEmpty($env:TF_DIR)) { 'infra/aws' } else { $env:TF_DIR }

# ---------- 1. pick a tag ----------
if (-not [string]::IsNullOrEmpty($env:ROLLBACK_TAG)) {
    $Tag = $env:ROLLBACK_TAG
    Log 'tag' "using ROLLBACK_TAG=$Tag (skipping prompt)"
} else {
    Log 'list' "fetching last $ShowLimit $FrontendRepo tags from ECR..."
    $imagesJson = & aws ecr describe-images `
        --repository-name $FrontendRepo `
        --region $AwsRegion `
        --query 'sort_by(imageDetails,&imagePushedAt)[*].{tags:imageTags,pushed:imagePushedAt}' `
        --output json 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($imagesJson)) {
        Fail 'list' "aws ecr describe-images failed (rc=$LASTEXITCODE)"
        exit 1
    }
    $images = $imagesJson | ConvertFrom-Json

    Write-Host ''
    Write-Host ('  {0,-32}  {1,-22}' -f 'TAG', 'PUSHED (UTC)')
    Write-Host ('  {0,-32}  {1,-22}' -f '-------------------------------', '----------------------')
    # Newest first
    [array]::Reverse($images)
    $images | Select-Object -First $ShowLimit | ForEach-Object {
        $vTag = $_.tags | Where-Object { $_ -like 'v*' } | Select-Object -First 1
        if ($vTag) {
            $pushed = ($_.pushed -split '\.')[0]
            Write-Host ('  {0,-32}  {1,-22}' -f $vTag, $pushed)
        }
    }
    Write-Host ''
    $Tag = Read-Host 'Tag to roll back to (e.g. v2026-04-30-a1b2c3d)'
    if ([string]::IsNullOrEmpty($Tag)) {
        Fail 'tag' 'no tag entered -- aborting'
        exit 1
    }
}

# ---------- 2. verify tag exists in BOTH repos ----------
foreach ($repo in @($FrontendRepo, $BackendRepo)) {
    & aws ecr describe-images `
        --repository-name $repo `
        --region $AwsRegion `
        --image-ids "imageTag=$Tag" *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail 'verify' "tag $Tag not found in repo $repo -- aborting"
        exit 1
    }
}
Log 'verify' "tag $Tag exists in both repos"

# ---------- 3. rewrite versions.auto.tfvars ----------
$VersionsFile = Join-Path $RepoRoot 'infra/aws/versions.auto.tfvars'
Log 'tfvars' "rewriting $VersionsFile -> $Tag"
$nowUtc = [datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
$user   = if ([string]::IsNullOrEmpty($env:USERNAME)) { 'unknown' } else { $env:USERNAME }
$content = @"
# =============================================================================
# Image-tag manifest -- auto-generated by infra/docker/rollback.ps1
# (last run: $nowUtc by $user).
# This is a ROLLBACK to a previously-deployed tag.
# =============================================================================
frontend_image = "$EcrHost/${FrontendRepo}:${Tag}"
backend_image  = "$EcrHost/${BackendRepo}:${Tag}"
"@
[System.IO.File]::WriteAllText($VersionsFile, $content + "`n",
    (New-Object System.Text.UTF8Encoding $false))

# ---------- 4. terraform apply ----------
if ($env:SKIP_TERRAFORM -eq '1') {
    Log 'tf' 'SKIP_TERRAFORM=1 -- skipping apply (file written, not deployed)'
} else {
    Require-Cmd 'terraform'
    $TfPath = Join-Path $RepoRoot $TfDir
    Log 'tf' "running 'terraform apply' in $TfDir (you will be prompted to type 'yes')"
    Push-Location $TfPath
    try {
        & terraform apply
        $TfRc = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($TfRc -ne 0) {
        Fail 'tf' "terraform apply failed (rc=$TfRc)"
        exit 1
    }
}

# ---------- 5. append to deploy log ----------
$DeployLog = Join-Path $ScriptDir 'deployments.log'
$line = "{0}`t{1}`t{2}`t{3}`t{4}`n" -f $nowUtc, 'rollback', $Tag, $user, 'rolled back via rollback.ps1'
[System.IO.File]::AppendAllText($DeployLog, $line,
    (New-Object System.Text.UTF8Encoding $false))
Log 'audit' "appended rollback entry to $DeployLog"

Log 'done' "rollback to $Tag complete"
