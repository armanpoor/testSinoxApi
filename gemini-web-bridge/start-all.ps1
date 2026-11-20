#Requires -Version 5.1
<#
.SYNOPSIS
  راه‌انداز تک‌دستوری Gemini Web Bridge:
  1) موتور وب (gemini-web2api-go :8093) و پل Anthropic (CLIProxyAPI :8094) را خودکار بالا می‌آورد
  2) کنترل‌سنتر وب + پروکسی تراتل استریم ضدبن (:3000 و :8095) را اجرا می‌کند
  3) کنترل‌سنتر را در مرورگر باز می‌کند تا با یک کلیک کوکی جمنای پرو خودکار استخراج و به هارنس متصل شود
#>
param(
  [int]$EnginePort = 8093,
  [int]$BridgePort = 8094,
  [int]$ControlPort = 3000,
  [switch]$SkipBridge
)

$ErrorActionPreference = 'Stop'
$BridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent $BridgeDir

function Test-PortOpen([int]$Port) {
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok  = $iar.AsyncWaitHandle.WaitOne(400)
    $tcp.Close()
    return $ok
  } catch { return $false }
}

Write-Host "=== Gemini Web Bridge — راه‌انداز یک‌کلیک محلی ===" -ForegroundColor Cyan

# 1. Start Engine (:8093) in background window if not running
if (-not (Test-PortOpen $EnginePort)) {
  Write-Host "[1/3] در حال اجرای موتور وب روی پورت $EnginePort ..." -ForegroundColor Yellow
  Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$BridgeDir\scripts\01-start-proxy.ps1`"", "-Port", "$EnginePort"
  Start-Sleep -Seconds 3
} else {
  Write-Host "[1/3] موتور وب روی پورت $EnginePort از قبل فعال است." -ForegroundColor Green
}

# 2. Start Anthropic Bridge (:8094) for Claude Code
if (-not $SkipBridge) {
  if (-not (Test-PortOpen $BridgePort)) {
    Write-Host "[2/3] در حال اجرای پل Anthropic (CLIProxyAPI) روی پورت $BridgePort ..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$BridgeDir\scripts\02-start-bridge.ps1`"", "-Port", "$BridgePort"
    Start-Sleep -Seconds 2
  } else {
    Write-Host "[2/3] پل Anthropic روی پورت $BridgePort از قبل فعال است." -ForegroundColor Green
  }
}

# 3. Install Node deps if needed and launch Control Center (:3000) + Async Throttle Proxy (:8095)
Push-Location $RootDir
try {
  if (-not (Test-Path (Join-Path $RootDir "node_modules"))) {
    Write-Host "[3/3] نصب وابستگی‌های Node.js ..." -ForegroundColor Yellow
    npm install
  }
  Write-Host ""
  Write-Host "==========================================================" -ForegroundColor Green
  Write-Host "  کنترل‌سنتر آماده است: http://localhost:$ControlPort" -ForegroundColor Green
  Write-Host "  پروکسی تراتل هارنس:   http://127.0.0.1:8095" -ForegroundColor Green
  Write-Host "  در کنترل‌سنتر روی «اتصال خودکار به جمنای وب» کلیک کنید." -ForegroundColor Cyan
  Write-Host "==========================================================" -ForegroundColor Green
  Start-Process "http://localhost:$ControlPort"
  npm run dev
} finally {
  Pop-Location
}
