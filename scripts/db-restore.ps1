param(
  [Parameter(Mandatory = $true)]
  [string]$FilePath,
  [string]$DbName = "postgres",
  [string]$PgUser = "postgres"
)
if (!(Test-Path -Path $FilePath)) { throw "Backup file not found" }
$container = (& docker ps --format "{{.Names}}") | Where-Object { $_ -like "supabase_db_*" } | Select-Object -First 1
if (-not $container) { throw "Supabase DB container not found" }
$remotePath = "/tmp/restore.dump"
& docker cp "$FilePath" "$container:$remotePath"
if ($LASTEXITCODE -ne 0) { throw "docker cp failed" }
& docker exec $container pg_restore -U $PgUser -d $DbName --clean --if-exists $remotePath
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }
Write-Output "Restored: $FilePath"
