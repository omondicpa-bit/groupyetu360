# tools/dump-live-schema.ps1
# Copies the STRUCTURE of the live database (tables, rules, functions,
# triggers) into live_schema.sql. No member data is copied. The file is
# ignored by git, so it cannot be committed by accident.
#
# Run from the groupyetu360 folder:
#   powershell -ExecutionPolicy Bypass -File tools\dump-live-schema.ps1

$pgdump = "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"
if (-not (Test-Path $pgdump)) {
  Write-Host "pg_dump was not found at $pgdump. Install PostgreSQL 17 first." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "1) Paste the Session pooler connection string from Supabase (live project)," -ForegroundColor Cyan
Write-Host "   exactly as copied, including [YOUR-PASSWORD], then press Enter:" -ForegroundColor Cyan
$url = (Read-Host).Trim()

# Remove the password placeholder (or any password) from the address
$url = $url -replace ':\[YOUR-PASSWORD\]@', '@'
$url = $url -replace '^(postgres(?:ql)?://[^:/@]+):[^@]*@', '$1@'

if ($url -match '@db\.[a-z0-9]+\.supabase\.co') {
  Write-Host "That is the 'Direct connection' address, which most home networks cannot reach." -ForegroundColor Yellow
  Write-Host "In Supabase > Connect > Direct, change Method to 'Session pooler' and copy that one instead." -ForegroundColor Yellow
  Write-Host "It contains 'pooler.supabase.com'. Then run this script again." -ForegroundColor Yellow
  exit 1
}
if ($url -notmatch 'eengldzvvgplgzvbutal') {
  Write-Host "That is not the live project's address (eengldzvvgplgzvbutal). Stopping." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "2) Type the LIVE database password (nothing shows as you type), then press Enter:" -ForegroundColor Cyan
$secure = Read-Host -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

Write-Host ""
Write-Host "Copying the structure..." -ForegroundColor Cyan
& $pgdump --schema-only --schema=public --no-owner -f live_schema.sql $url
$code = $LASTEXITCODE
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

if ($code -eq 0 -and (Test-Path live_schema.sql)) {
  $size = (Get-Item live_schema.sql).Length
  Write-Host ""
  Write-Host "Done. live_schema.sql is $size bytes. Attach it in the chat with Claude." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "It did not work. Copy the red message above into the chat with Claude." -ForegroundColor Red
}
