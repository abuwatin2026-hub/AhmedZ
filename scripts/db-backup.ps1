param(
  [string]$OutDir = ".\backups",
  [string]$DbName = "postgres",
  [string]$PgUser = "postgres"
)
if (!(Test-Path -Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$container = (& docker ps --format "{{.Names}}") | Where-Object { $_ -like "supabase_db_*" } | Select-Object -First 1
if (-not $container) { throw "Supabase DB container not found" }
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$remotePath = "/tmp/backup_$ts.dump"
$localPath = Join-Path $OutDir "backup_$ts.dump"
& docker exec $container pg_dump -U $PgUser -d $DbName -Fc -f $remotePath
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
& docker cp "$container:$remotePath" "$localPath"
if ($LASTEXITCODE -ne 0) { throw "docker cp failed" }
Write-Output $localPath
