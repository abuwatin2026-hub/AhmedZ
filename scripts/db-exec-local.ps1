Param(
  [string]$File,
  [string]$DbHost = "127.0.0.1",
  [int]$DbPort = 54322,
  [string]$DbName = "postgres",
  [string]$DbUser = "postgres",
  [string]$DbPassword = ""
)

function Get-DbPassword {
  param([string]$Provided)
  $plain = $Provided
  if (-not $plain -or -not $plain.Trim()) { $plain = $env:SUPABASE_DB_PASSWORD }
  if (-not $plain -or -not $plain.Trim()) { $plain = $env:SUPABASE_PASSWORD }
  if (-not $plain -or -not $plain.Trim()) { $plain = $env:VITE_SUPABASE_DB_PASSWORD }
  if (-not $plain -or -not $plain.Trim()) { $plain = $env:PGPASSWORD }
  if (-not $plain -or -not $plain.Trim()) { $plain = "postgres" }
  return $plain
}

function Ensure-Psql {
  $exists = $false
  try { & psql --version *> $null; if ($LASTEXITCODE -eq 0) { $exists = $true } } catch {}
  if (-not $exists) {
    Write-Error "psql not found in PATH. Please install PostgreSQL CLI or add psql to PATH."
    exit 1
  }
}

if (-not $File -or -not (Test-Path $File)) {
  Write-Error "SQL file not found: $File"
  exit 1
}

Ensure-Psql
$Global:PGPASS = Get-DbPassword -Provided $DbPassword
if (-not $Global:PGPASS -or -not $Global:PGPASS.Trim()) {
  Write-Error "Database password not found. Provide -DbPassword or set SUPABASE_DB_PASSWORD."
  exit 1
}

Write-Host "Executing SQL file: $File"
$env:PGPASSWORD = $Global:PGPASS
& psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -f $File
if ($LASTEXITCODE -ne 0) {
  Write-Error "psql returned non-zero exit code: $LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Host "SQL execution completed."
