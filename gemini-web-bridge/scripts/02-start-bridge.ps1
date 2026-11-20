# شروع پل Anthropic (/v1/messages) روی پورت 8094 — برای Claude Code
$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot ".."
$cpaDir = Join-Path $root "bin-cpa"
New-Item -ItemType Directory -Force -Path $cpaDir, (Join-Path $cpaDir "cfg"), (Join-Path $cpaDir "auths") | Out-Null

$apiKey = if ($env:GW2API_KEY) { $env:GW2API_KEY } else { throw "متغیر GW2API_KEY را ست کنید (کلید سرور 8093 از پنل ادمین)" }
$port = if ($env:BRIDGE_PORT) { $env:BRIDGE_PORT } else { "8094" }

$config = @"
port: $port
auth-dir: "./auths"
remote-management:
  secret-key: "change-me-management"
  allow-remote: false
access:
  api-keys:
    - "local-client-key-1"
api-keys:
  openai-compatibility:
    - name: "gw2api"
      base-url: "http://localhost:8093/v1"
      keys:
        - api-key: "$apiKey"
      models:
        - name: "gemini-4-hydrogen"
          alias: "gemini-4-hydrogen"
        - name: "gemini-4-hydrogen-thinking"
          alias: "gemini-4-hydrogen-thinking"
        - name: "gemini-4-neon"
          alias: "gemini-4-neon"
        - name: "gemini-4-carbon"
          alias: "gemini-4-carbon"
        - name: "gemini-3.6-flash"
          alias: "gemini-3.6-flash"
        - name: "gemini-3.5-flash-lite"
          alias: "gemini-3.5-flash-lite"
"@
$ver = "8.0.79"
$cfgPath = Join-Path $cpaDir "cfg\config.yaml"
Set-Content -Path $cfgPath -Value $config -Encoding UTF8

$exe = Join-Path $cpaDir "cli-proxy-api.exe"
if (-not (Test-Path $exe)) {
    Write-Host "در حال دانلود CLIProxyAPI نسخه v$ver ..." -ForegroundColor Cyan
    $zip = Join-Path $env:TEMP "cpa-$ver.zip"
    $url = "https://github.com/router-for-me/CLIProxyAPI/releases/download/v$ver/CLIProxyAPI_${ver}_windows_amd64.zip"
    Invoke-WebRequest -Uri $url -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $cpaDir -Force
    Remove-Item -Path $zip -Force -ErrorAction SilentlyContinue
}

Write-Host "پل Anthropic روی پورت $port" -ForegroundColor Green
Push-Location $cpaDir
try {
    & $exe --config $cfgPath
} finally {
    Pop-Location
}
