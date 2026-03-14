param(
  [string]$TaskName = "AhmedZ-Orders-SLA-Alert",
  [string]$RepoPath = "C:\nasrflash\AhmedZ",
  [string]$NodeExe = "node",
  [string]$StartTime = "08:00",
  [int]$RepeatMinutes = 15
)

$ErrorActionPreference = "Stop"

$probePath = Join-Path $RepoPath "scripts\orders-sla-probe-prod.mjs"
$alertPath = Join-Path $RepoPath "scripts\run-orders-sla-alert-prod.mjs"
if (!(Test-Path $probePath)) {
  throw "Script not found: $probePath"
}
if (!(Test-Path $alertPath)) { throw "Script not found: $alertPath" }

$cmd = "$NodeExe `"$probePath`"; $NodeExe `"$alertPath`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location '$RepoPath'; `$env:DBPW=`'$env:DBPW`'; $cmd`""

$trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$trigger.RepetitionInterval = (New-TimeSpan -Minutes $RepeatMinutes)
$trigger.RepetitionDuration = (New-TimeSpan -Hours 24)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Scheduled task '$TaskName' registered/updated successfully."
  Write-Host "Runs every $RepeatMinutes minutes starting at $StartTime."
} catch {
  Write-Warning "Register-ScheduledTask failed, trying schtasks fallback..."
  $tr = "powershell -NoProfile -ExecutionPolicy Bypass -Command `"Set-Location '$RepoPath'; `$env:DBPW=`'$env:DBPW`'; $cmd`""
  schtasks /Create /F /SC MINUTE /MO $RepeatMinutes /TN $TaskName /TR $tr | Out-Null
  Write-Host "Scheduled task '$TaskName' created via schtasks."
}
