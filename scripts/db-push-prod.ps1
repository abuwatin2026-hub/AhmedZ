param(
  [switch]$Repair,
  [string]$RepairSchema = "public",
  [string]$ProjectRef,
  [string]$AccessToken,
  [string]$DbPassword
)

$ErrorActionPreference = "Stop"

$projectRef = if ($ProjectRef -and $ProjectRef.Trim()) { $ProjectRef } else { $env:SUPABASE_PROJECT_REF }
if (-not $projectRef -or -not $projectRef.Trim()) { $projectRef = "twcjjisnxmfpseksqnhb" }

function Require-Command {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Missing required command: $Name"
  }
}

Require-Command "node"
Require-Command "npx"

Write-Host "Target project ref: $projectRef"

if ($AccessToken -and $AccessToken.Trim()) { $env:SUPABASE_ACCESS_TOKEN = $AccessToken }
elseif (-not $env:SUPABASE_ACCESS_TOKEN -and $env:VITE_SUPABASE_ACCESS_TOKEN) { $env:SUPABASE_ACCESS_TOKEN = $env:VITE_SUPABASE_ACCESS_TOKEN }
elseif (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "SUPABASE_ACCESS_TOKEN is not set. Trying Supabase CLI stored login..."
  try {
    & npx supabase projects list | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "not logged in" }
    Write-Host "Supabase CLI login detected."
  } catch {
    Write-Host "Supabase CLI login not detected."
    Write-Host "Run one of the following, then re-run this script:"
    Write-Host "  npx supabase login"
    Write-Host "  or set SUPABASE_ACCESS_TOKEN in your environment"
    exit 1
  }
}

$plain = if ($DbPassword -and $DbPassword.Trim()) { $DbPassword } else { $env:SUPABASE_DB_PASSWORD }
if (-not $plain -or -not $plain.Trim()) { $plain = $env:SUPABASE_PASSWORD }
if (-not $plain -or -not $plain.Trim()) { $plain = $env:VITE_SUPABASE_DB_PASSWORD }
if (-not $plain -or -not $plain.Trim()) {
  Write-Error "DB password is required. Set -DbPassword or SUPABASE_DB_PASSWORD (or SUPABASE_PASSWORD/VITE_SUPABASE_DB_PASSWORD)."
  exit 1
}

if (-not $plain -or -not $plain.Trim()) {
  throw "DB password is required."
}

Write-Host "Linking project..."
& npx supabase link --project-ref $projectRef --password $plain

if ($Repair) {
  $ts = Get-Date -Format "yyyyMMddHHmmss"
  $migName = "${ts}_repair_prod.sql"
  $migPath = Join-Path "supabase\\migrations" $migName
  Write-Host "Generating repair migration: $migPath"
  & npx supabase db diff --linked --schema $RepairSchema --file $migPath
}

Write-Host "Pushing migrations to production..."
& npx supabase db push --include-all

Write-Host "Done."
