param(
  [string]$RepoPath = "C:\nasrflash\AhmedZ",
  [string]$NodeExe = "node"
)

$ErrorActionPreference = "Stop"
Set-Location $RepoPath

if (-not $env:DBPW -or [string]::IsNullOrWhiteSpace($env:DBPW)) {
  throw "DBPW is required in environment for orders integrity cycle."
}

& $NodeExe ".\scripts\orders-integrity-probe-prod.mjs"
& $NodeExe ".\scripts\run-orders-integrity-alert-prod.mjs"
