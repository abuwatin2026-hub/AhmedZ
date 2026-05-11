$serviceToken = "sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd"
$projectRef = "pmhivhtaoydfolseelyc"
$mgmtBase = "https://api.supabase.com"
$anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec"
$restBase  = "https://pmhivhtaoydfolseelyc.supabase.co"

$mgmtHeaders = @{
    "Authorization" = "Bearer $serviceToken"
    "Content-Type"  = "application/json"
}

function Deploy-Sql {
    param([string]$label, [string]$sql)
    $obj = [PSCustomObject]@{ query = $sql }
    $body = $obj | ConvertTo-Json -Depth 3 -Compress
    try {
        $result = Invoke-RestMethod `
            -Uri "$mgmtBase/v1/projects/$projectRef/database/query" `
            -Method POST `
            -Headers $mgmtHeaders `
            -Body $body `
            -ErrorAction Stop
        Write-Host "  [$label] DEPLOYED OK"
    } catch {
        Write-Host "  [$label] FAILED: $($_.ErrorDetails.Message)"
        throw $_
    }
}

Write-Host "=== Deployment Phase ==="
$purgeSql = [IO.File]::ReadAllText(
    "c:\Users\nasrn\Documents\GitHub\AhmedZ\supabase\migrations\20260509204000_admin_purge_uat_tests.sql",
    [Text.Encoding]::UTF8
)
Deploy-Sql "Purge UAT Tests RPC" $purgeSql

Start-Sleep 2

# Auth
Write-Host "=== Authenticating ==="
$hAuth = @{ "apikey" = $anonKey; "Content-Type" = "application/json" }
$authR  = Invoke-RestMethod -Uri "$restBase/auth/v1/token?grant_type=password" -Method POST -Headers $hAuth -Body '{"email":"owner@azta.com","password":"AhmedZ#123456"}'
$jwt    = $authR.access_token
$restH  = @{ "apikey" = $anonKey; "Authorization" = "Bearer $jwt"; "Content-Type" = "application/json" }

Write-Host "=== Executing RPC ==="
try {
    $purgeResult = Invoke-RestMethod -Uri "$restBase/rest/v1/rpc/admin_purge_uat_tests_20260509" -Method POST -Headers $restH -ErrorAction Stop
    Write-Host "  Purge Result:"
    $purgeResult | ConvertTo-Json -Depth 5 | Write-Host
} catch {
    Write-Host "  FAILED: $($_.ErrorDetails.Message)"
}
Write-Host "Done."
