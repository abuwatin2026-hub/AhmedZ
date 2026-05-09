param(
  [string]$TaskName = "AhmedZ-Orders-Integrity-Alert",
  [string]$RepoPath = "C:\nasrflash\AhmedZ",
  [string]$NodeExe = "node",
  [string]$StartTime = "08:00",
  [int]$RepeatMinutes = 15
)

$ErrorActionPreference = "Stop"

$probePath = Join-Path $RepoPath "scripts\orders-integrity-probe-prod.mjs"
$alertPath = Join-Path $RepoPath "scripts\run-orders-integrity-alert-prod.mjs"
$cyclePath = Join-Path $RepoPath "scripts\run-orders-integrity-cycle.ps1"
if (!(Test-Path $probePath)) { throw "Script not found: $probePath" }
if (!(Test-Path $alertPath)) { throw "Script not found: $alertPath" }
if (!(Test-Path $cyclePath)) { throw "Script not found: $cyclePath" }

$cmd = "$NodeExe `"$probePath`"; $NodeExe `"$alertPath`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$cyclePath`" -RepoPath `"$RepoPath`" -NodeExe `"$NodeExe`""

try {
$trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
  try {
    $trigger.RepetitionInterval = (New-TimeSpan -Minutes $RepeatMinutes)
    $trigger.RepetitionDuration = (New-TimeSpan -Hours 24)
  } catch {
    throw "Repetition properties are not supported on this host"
  }
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Scheduled task '$TaskName' registered/updated successfully."
  Write-Host "Runs every $RepeatMinutes minutes starting at $StartTime."
} catch {
  Write-Warning "Register-ScheduledTask failed, trying schtasks fallback..."
  $tr = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$cyclePath`" -RepoPath `"$RepoPath`" -NodeExe `"$NodeExe`""
  schtasks /Create /F /SC MINUTE /MO $RepeatMinutes /TN $TaskName /TR $tr | Out-Null
  Write-Host "Scheduled task '$TaskName' created via schtasks."
}
