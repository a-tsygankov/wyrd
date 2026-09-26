#!/usr/bin/env pwsh
# Workstation deploy helper (PowerShell). CI handles main-branch deploys
# (.github/workflows/deploy.yml); this is for one-offs and the first
# deploy. Needs `wrangler login` (or CLOUDFLARE_API_TOKEN +
# CLOUDFLARE_ACCOUNT_ID in the environment) and `pnpm install`.
#
# Usage:
#   ./scripts/deploy.ps1 -Api     # D1 migrations + wrangler deploy
#   ./scripts/deploy.ps1 -Web     # build + wrangler pages deploy
#   ./scripts/deploy.ps1 -All
[CmdletBinding()]
param(
    [switch]$Api,
    [switch]$Web,
    [switch]$All
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Invoke-Step([string]$Label, [scriptblock]$Command) {
    # Reset first: a stale non-zero code from an earlier native call must
    # not fail a step whose last statement is not native.
    $global:LASTEXITCODE = 0
    # $ErrorActionPreference = 'Stop' does not cover native executables:
    # a failed pnpm call would otherwise fall through to the next step.
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)" }
}

if ($All) { $Api = $true; $Web = $true }
if (-not ($Api -or $Web)) {
    Write-Error 'Pick at least one: -Api, -Web, or -All'
}

if ($Api) {
    Write-Host '-- api --' -ForegroundColor Cyan
    Invoke-Step 'db:migrate:remote' { pnpm --filter @wyrd/api db:migrate:remote }
    Invoke-Step 'api deploy' { pnpm --filter @wyrd/api run deploy }
}
if ($Web) {
    Write-Host '-- web --' -ForegroundColor Cyan
    Invoke-Step 'web build' { pnpm build:web }
    Invoke-Step 'web deploy' { pnpm --filter @wyrd/web run deploy }
}
