$projectUrl = "http://127.0.0.1:54321"
$serviceKey = "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz"

$userId = "c4069a4d-5d4a-4261-9a0e-656ca6058089"
$newPassword = "Nasr#123456"

Invoke-RestMethod `
  -Method Patch `
  -Uri "$projectUrl/auth/v1/admin/users/$userId" `
  -Headers @{
    apikey = $serviceKey
    Authorization = "Bearer $serviceKey"
  } `
  -ContentType "application/json" `
  -Body (@{ password = $newPassword } | ConvertTo-Json)