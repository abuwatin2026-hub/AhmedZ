Param(
  [string]$ProjectRef = "twcjjisnxmfpseksqnhb",
  [string]$ApiUrl,
  [string]$AnonKey,
  [string]$ServiceRoleKey,
  [string]$AllowedOrigins = "http://localhost:5174"
)

if (-not $ApiUrl -or -not $AnonKey -or -not $ServiceRoleKey) {
  Write-Error "Please provide -ApiUrl, -AnonKey, and -ServiceRoleKey parameters"
  exit 1
}

supabase link --project-ref $ProjectRef

supabase secrets set CATY_SUPABASE_URL=$ApiUrl
supabase secrets set CATY_SUPABASE_ANON_KEY=$AnonKey
supabase secrets set CATY_SUPABASE_SERVICE_ROLE_KEY=$ServiceRoleKey
supabase secrets set CATY_ALLOWED_ORIGINS=$AllowedOrigins

supabase secrets list

supabase functions deploy create-admin-user
supabase functions deploy reset-admin-password
supabase functions deploy delete-admin-user
