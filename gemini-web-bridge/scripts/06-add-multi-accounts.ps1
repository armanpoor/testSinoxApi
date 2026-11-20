<#
.SYNOPSIS
افزودن چند اکانت با یک مرورگر واحد + راهنمای چرخشی

.DESCRIPTION
سه راه برای چند-اکانته کردن پل:
  راه ۱ (پیشنهادی): هر اکانت را در یک مرورگر موقت جدا لاگین کن و کوکی بگیر — با اسکریپت 03.
  راه ۲: در یک کروم که چند اکانت گوگل دارد، با پارامتر authuser اکانت را مشخص کن.
  راه ۳: برای هر اکانت یک نمونه پروکسی جدا با DB جدا (ایزوله کامل — برای کنترل دستی در 9router).

راه ۲ در همین اسکریپت خودکار شده: مرورگر موقت را باز می‌کند، لاگین‌های متوالی انجام می‌دهی،
برای هر اکانت جدا کوکی می‌گیرد (authuser=0,1,2,...) و همه را یک‌جا به pool می‌فرستد.
#>
param(
    [int]$CDPPort = 9333,
    [string]$AdminUrl = $(if ($env:GW2API_ADMIN) { $env:GW2API_ADMIN } else { "http://localhost:8093" }),
    [string]$AdminToken = $(if ($env:GW2API_ADMIN_TOKEN) { $env:GW2API_ADMIN_TOKEN } else { "change-me-123" }),
    [int]$Accounts = 2   # چند اکانت می‌خواهی اضافه کنی
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "=== افزودن $Accounts اکانت با مرورگر موقت واحد ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "قواعد:" -ForegroundColor Yellow
Write-Host " 1. کروم موقت باز می‌شود؛ برای اکانت اول لاگین کن و صبر کن صفحه چت بیاید."
Write-Host " 2. Enter بزن تا کوکی اکانت اول گرفته شود."
Write-Host " 3. بدون بستن مرورگر، از آواتار → Add account → اکانت دوم را وارد کن."
Write-Host "    (URL جمنای را به /u/1/app می‌برد — نرمال است)"
Write-Host " 4. دوباره Enter و تا تعداد $Accounts ادامه بده."
Write-Host " 5. آخر که تمام شد مرورگر را ببند."

$chrome = if ($env:CHROME_EXE) { $env:CHROME_EXE } else { "C:\Program Files\Google\Chrome\Application\chrome.exe" }
$profile = Join-Path $env:TEMP "gemini-multi-login"
Start-Process $chrome -ArgumentList @(
    "--user-data-dir=$profile",
    "--remote-debugging-port=$CDPPort",
    "--no-first-run",
    "https://gemini.google.com/app"
)
Start-Sleep -Seconds 6

for ($i = 0; $i -lt $Accounts; $i++) {
    Write-Host ""
    Write-Host "=== اکانت $($i + 1) از $Accounts — اکنون لاگین کن (اگر هنوز) ===" -ForegroundColor Green
    Read-Host "آماده‌ای؟ Enter بزن تا کوکی شماره $i گرفته شود"

    $tempCookie = Join-Path $env:TEMP "cookie-multi-$i.txt"
    $env:CDP_PORT = "$CDPPort"
    $env:COOKIE_OUT = $tempCookie
    python -I (Join-Path $root "scripts\03-extract-cookies.py")
    if ($LASTEXITCODE -ne 0) { Write-Host "استخراج ناموفق — ادامه بده." -ForegroundColor Red; continue }

    $label = Read-Host "اسم (label) این اکانت (مثلا arman3)"
    if (-not $label) { $label = "account-$i" }
    $authuser = $i   # اکانت nاُم در همان مرورگر = /u/n

    try {
        $cookie = Get-Content $tempCookie -Raw
        $body = @{ label = $label; cookie = $cookie.Trim(); authuser = $authuser; note = "multi-login $i" } | ConvertTo-Json -Compress

        # login to admin then POST
        $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        Invoke-RestMethod -Uri "$AdminUrl/admin/api/login" -Method Post -Body (@{token=$AdminToken} | ConvertTo-Json -Compress) -ContentType "application/json" -WebSession $sess | Out-Null
        $r = Invoke-RestMethod -Uri "$AdminUrl/admin/api/cookies" -Method Post -Body $body -ContentType "application/json" -WebSession $sess
        Write-Host "✅ اکانت #$($r.id) با label=[$label] authuser=$authuser اضافه شد" -ForegroundColor Green
    } finally {
        # حذف فایل کوکی موقت برای جلوگیری از ماندن نشست متنی روی دیسک
        Remove-Item -Path $tempCookie -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "=== تمام. حالا مرورگر را ببند! ===" -ForegroundColor Yellow
Write-Host "لیست نهایی:"
$env:GW2API_ADMIN = $AdminUrl
$env:GW2API_ADMIN_TOKEN = $AdminToken
python -I (Join-Path $root "scripts\05-manage-accounts.py") list
