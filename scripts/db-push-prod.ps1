$ErrorActionPreference = "Stop"

$projectRef = "twcjjisnxmfpseksqnhb"

function Require-Command {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Missing required command: $Name"
  }
}

Require-Command "node"

Write-Host "Target project ref: $projectRef"

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "SUPABASE_ACCESS_TOKEN is not set."
  Write-Host "Run one of the following, then re-run this script:"
  Write-Host "  npx supabase login"
  Write-Host "  or set SUPABASE_ACCESS_TOKEN in your environment"
  exit 1
}

$secure = Read-Host "Enter production DB password (will not be stored)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if (-not $plain -or -not $plain.Trim()) {
  throw "DB password is required."
}

Write-Host "Linking project..."
& npx supabase link --project-ref $projectRef --password $plain

Write-Host "Pushing migrations to production..."
& npx supabase db push

Write-Host "Done."
