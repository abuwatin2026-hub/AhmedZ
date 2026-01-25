Param(
  [string]$ProjectRef = "twcjjisnxmfpseksqnhb",
  [string]$ApiUrl,
  [string]$AnonKey,
  [string]$ServiceRoleKey,
  [string]$AllowedOrigins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
)

if (-not $ApiUrl -or -not $AnonKey -or -not $ServiceRoleKey) {
  Write-Error "Please provide -ApiUrl, -AnonKey, and -ServiceRoleKey parameters"
  exit 1
}

npx supabase link --project-ref $ProjectRef

npx supabase secrets set AZTA_SUPABASE_URL=$ApiUrl
npx supabase secrets set AZTA_SUPABASE_ANON_KEY=$AnonKey
npx supabase secrets set AZTA_SUPABASE_SERVICE_ROLE_KEY=$ServiceRoleKey
npx supabase secrets set AZTA_ALLOWED_ORIGINS=$AllowedOrigins

npx supabase secrets list

npx supabase functions deploy create-admin-user
npx supabase functions deploy reset-admin-password
npx supabase functions deploy delete-admin-user
