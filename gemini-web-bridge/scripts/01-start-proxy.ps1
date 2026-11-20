# شروع سرور gemini-web2api-go روی پورت 8093
# استفاده: powershell -File scripts/01-start-proxy.ps1
$ErrorActionPreference = "Stop"

$ver = "v4.31.0"
$repo = "zexadev/gemini-web2api-go"
$binDir = Join-Path $PSScriptRoot "..\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$exe = Join-Path $binDir "gemini-web2api-go.exe"

if (-not (Test-Path $exe)) {
    Write-Host "در حال دانلود باینری نسخه $ver ..." -ForegroundColor Cyan
    $url = "https://github.com/$repo/releases/download/$ver/gemini-web2api-go_${ver}_windows_amd64.exe"
    Invoke-WebRequest -Uri $url -OutFile $exe
    Write-Host "دانلود شد: $exe" -ForegroundColor Green
}

$adminToken = if ($env:ADMIN_TOKEN) { $env:ADMIN_TOKEN } else { "change-me-123" }
$port = if ($env:PORT) { $env:PORT } else { "8093" }

Write-Host "شروع سرور روی پورت $port ..." -ForegroundColor Cyan
& $exe --port $port --admin-token $adminToken --db (Join-Path $binDir "gemini.db")
