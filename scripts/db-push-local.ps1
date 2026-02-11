Param(
  [string]$DbHost = "127.0.0.1",
  [int]$DbPort = 54322,
  [string]$DbName = "postgres",
  [string]$DbUser = "postgres",
  [string]$DbPassword = "",
  [switch]$DryRun
)

function Get-DbPassword {
  param([string]$Provided)
  $plain = $Provided
  if (-not $plain -or -not $plain.Trim()) { $plain = $env:SUPABASE_DB_PASSWORD }
  if (-not $plain -or -not $plain.Trim()) { $plain = $env:SUPABASE_PASSWORD }
  if (-not $plain -or -not $plain.Trim()) { $plain = $env:VITE_SUPABASE_DB_PASSWORD }
  if (-not $plain -or -not $plain.Trim()) { $plain = $env:PGPASSWORD }
  if (-not $plain -or -not $plain.Trim()) { $plain = "postgres" } # افتراضي بيئة Supabase المحلية
  return $plain
}

function Ensure-Psql {
  $exists = $false
  try {
    $v = & psql --version 2>$null
    if ($LASTEXITCODE -eq 0) { $exists = $true }
  } catch { $exists = $false }
  if (-not $exists) {
    Write-Error "psql is not available in PATH. Please install PostgreSQL CLI or add psql to PATH."
    exit 1
  }
}

function Invoke-Psql {
  param(
    [string]$Sql,
    [string]$FilePath
  )
  $env:PGPASSWORD = $Global:PGPASS
  $args = @("-h", $DbHost, "-p", $DbPort, "-U", $DbUser, "-d", $DbName, "-v", "ON_ERROR_STOP=1")
  if ($FilePath) {
    Write-Host "تشغيل ملف: $FilePath"
    & psql @args -f $FilePath
  } else {
    & psql @args -c $Sql
  }
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    throw "Failed to run SQL/file (exit=$code)"
  }
}

function Ensure-MigrationsTable {
  Write-Host "Initialize migrations tracking table..."
  $sql = @"
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  name text,
  applied_at timestamptz not null default now()
);
"@
  Invoke-Psql -Sql $sql
}

function Get-AppliedVersions {
  try {
    $tmp = New-TemporaryFile
    & psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -A -t -c "select version from supabase_migrations.schema_migrations order by version;" > $tmp
    $versions = Get-Content $tmp | Where-Object { $_ -match '^\d{8,}' } | ForEach-Object { $_.Trim() }
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    return ,$versions
  } catch {
    return @()
  }
}

function Add-AppliedVersion {
  param([string]$Version, [string]$Name)
  $sql = "insert into supabase_migrations.schema_migrations(version,name) values ('$Version', '$Name') on conflict (version) do nothing;"
  Invoke-Psql -Sql $sql
}

Write-Host "Preparing local database connection (no data deletion)..."
Ensure-Psql
$Global:PGPASS = Get-DbPassword -Provided $DbPassword
if (-not $Global:PGPASS -or -not $Global:PGPASS.Trim()) {
  Write-Error "Database password not found. Use -DbPassword or set SUPABASE_DB_PASSWORD."
  exit 1
}

Invoke-Psql -Sql "\conninfo" | Out-Null

Ensure-MigrationsTable
$applied = New-Object System.Collections.Generic.HashSet[string]
foreach ($v in Get-AppliedVersions) { $applied.Add($v) | Out-Null }

$migrationsDir = Join-Path (Get-Location) "supabase\migrations"
if (-not (Test-Path $migrationsDir)) {
  Write-Error "لم يتم العثور على مجلد الهجرات: $migrationsDir"
  exit 1
}

$files = Get-ChildItem -Path $migrationsDir -Filter "*.sql" | Sort-Object Name
if ($files.Count -eq 0) {
  Write-Host "لا توجد ملفات هجرات في $migrationsDir"
  exit 0
}

foreach ($f in $files) {
  $name = $f.Name
  $version = ($name -split "_")[0]
  if (-not ($version -match '^\d{8,}$')) { $version = $name } # fallback
  if ($applied.Contains($version)) {
    Write-Host "Skip: $name (already applied)"
    continue
  }
  Write-Host "Applying migration: $name"
  if ($DryRun) {
    Write-Host "DryRun: file will not be executed."
    continue
  }
  Invoke-Psql -FilePath $f.FullName
  Add-AppliedVersion -Version $version -Name $name
  Write-Host "Applied: $name"
}

Write-Host "Completed pushing updates to local database without deleting data."
