<#
.SYNOPSIS
لایه تراتل ضدبن — یک پروکسی معکوس محلی با Jitter تصادفی بین درخواست‌ها.

.DESCRIPTION
بین ابزار شما (Claude Code / 9router) و پل 8094 قرار می‌گیرد:
  ابزار → این تراتل (:8095) → پل (:8094) → موتور (:8093) → گوگل
کارها:
  1. الگوی زمانی رباتیک را می‌شکند: تاخیر تصادفی ۲ تا ۷ ثانیه بین درخواست‌ها (Jitter).
  2. صف FIFO تک‌نویسنده: هرگز بیش از یک درخواست همزمان به گوگل نمی‌رود.
  3. بازگشت هوشمند خطا: روی 429/502، یک cooldown سراسری می‌گذارد تا ابزارها خودشان صبر کنند.
  4. پراکندگی فاصله‌ها (بامپینگ منظم = امضای ربات).

استفاده:
  powershell -File scripts/07-throttle-proxy.ps1
  بعد: $env:ANTHROPIC_BASE_URL = "http://localhost:8095"
#>
param(
    [int]$Port = 8095,
    [int]$TargetPort = 8094,
    [int]$MinDelayMs = 2000,   # حداقل تاخیر بین درخواست‌ها
    [int]$MaxDelayMs = 7000    # حداکثر تاخیر (Jitter)
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Web

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "تراتل فعال: 127.0.0.1:$Port → localhost:$TargetPort (Jitter $MinDelayMs-$MaxDelayMs ms)" -ForegroundColor Green

$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(600)
$script:lastRequestAt = [DateTime]::MinValue
$script:cooldownUntil = [DateTime]::MinValue
$script:queueLock = [object]::new()

$script:burstCount = 0
$script:burstLimit = Get-Random -Minimum 3 -Maximum 8

function Get-Delayed {
    # human-like rhythm: bursts of 3-7 requests, then a longer pause; quiet at night
    $sinceLast = ((Get-Date) - $script:lastRequestAt).TotalMilliseconds
    $script:burstCount++
    if ($script:burstCount -ge $script:burstLimit) {
        # end of a burst: human stops to read the answer (8-25s pause)
        $jitter = Get-Random -Minimum 8000 -Maximum 25000
        $script:burstCount = 0
        $script:burstLimit = Get-Random -Minimum 3 -Maximum 8
    } else {
        $jitter = Get-Random -Minimum $MinDelayMs -Maximum $MaxDelayMs
    }
    $hour = (Get-Date).Hour
    if ($hour -ge 1 -and $hour -lt 6) {
        # deep night: extra spacing (a real person rarely codes at 3am nonstop)
        $jitter = [int]($jitter * 2.5)
    }
    if ($sinceLast -lt $jitter) {
        $wait = [int]($jitter - $sinceLast)
        Write-Host "  … صبر $($wait)ms (jitter)" -ForegroundColor DarkGray
        Start-Sleep -Milliseconds $wait
    }
}

while ($true) {
    $ctx = $listener.GetContext()
    try {
        $now = Get-Date
        if ($now -lt $script:cooldownUntil) {
            $remain = [int]($script:cooldownUntil - $now).TotalSeconds
            $body = [System.Text.Encoding]::UTF8.GetBytes(
                "{`"error`":{`"type`":`"rate_limit_error`",`"message`":`"global cooldown active, retry in ${remain}s`"}}")
            $ctx.Response.StatusCode = 429
            $ctx.Response.Headers["Retry-After"] = "$remain"
            $ctx.Response.ContentType = "application/json"
            $ctx.Response.OutputStream.Write($body, 0, $body.Length)
            $ctx.Response.Close()
            continue
        }

        $req = $ctx.Request
        $httpMethod = [System.Net.Http.HttpMethod]::new($req.HttpMethod)
        $isChatReq = ($req.HttpMethod -eq "POST") -and ($req.Url.AbsolutePath -match "/(chat/completions|messages|responses)")

        if ($isChatReq) {
            Get-Delayed
            $script:lastRequestAt = Get-Date
        }

        $upstream = "http://localhost:$TargetPort$($req.Url.PathAndQuery)"
        $msg = [System.Net.Http.HttpRequestMessage]::new($httpMethod, $upstream)

        if ($req.HasEntityBody) {
            $ms = [System.IO.MemoryStream]::new()
            $req.InputStream.CopyTo($ms)
            $content = [System.Net.Http.ByteArrayContent]::new($ms.ToArray())
            if ($req.ContentType) {
                $content.Headers.TryAddWithoutValidation("Content-Type", $req.ContentType) | Out-Null
            }
            $msg.Content = $content
        }

        foreach ($h in $req.Headers.AllKeys) {
            if ($h -in @("Host","Connection","Accept-Encoding","Content-Length","Content-Type")) { continue }
            $msg.Headers.TryAddWithoutValidation($h, $req.Headers[$h]) | Out-Null
        }

        # ResponseHeadersRead ensures SSE chunks stream immediately without full buffering
        $resp = $client.SendAsync($msg, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()

        if ([int]$resp.StatusCode -in 429, 502) {
            $script:cooldownUntil = (Get-Date).AddSeconds(60)
            Write-Host "  ⚠ خطا $($resp.StatusCode) از بالادست — cooldown 60s فعال شد" -ForegroundColor Yellow
        }

        $ctx.Response.StatusCode = [int]$resp.StatusCode
        $ct = $resp.Content.Headers.ContentType
        $ctStr = if ($ct) { $ct.ToString() } else { "application/json" }
        $ctx.Response.ContentType = $ctStr
        if ($ctStr -match "text/event-stream") {
            $ctx.Response.SendChunked = $true
            $ctx.Response.Headers["Cache-Control"] = "no-cache"
        }

        $upStream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $buffer = New-Object byte[] 4096
        $sample = ""
        while (($read = $upStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $ctx.Response.OutputStream.Write($buffer, 0, $read)
            $ctx.Response.OutputStream.Flush()
            if ([int]$resp.StatusCode -eq 200 -and $sample.Length -lt 2048) {
                $sample += [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
            }
        }
        if ([int]$resp.StatusCode -eq 200 -and $sample -match "having a hard time fulfilling|Sorry, something went wrong|no content frame") {
            $script:cooldownUntil = (Get-Date).AddSeconds(60)
            Write-Host "  ⚠ تشخیص Soft-Block در پاسخ 200 — cooldown 60s فعال شد" -ForegroundColor Yellow
        }
        $ctx.Response.Close()
        Write-Host "  ✔ $($req.HttpMethod) $($req.Url.AbsolutePath) → $([int]$resp.StatusCode)" -ForegroundColor DarkGray
    }
    catch {
        Write-Host "  ✘ خطا: $_" -ForegroundColor Red
        try { $ctx.Response.StatusCode = 502; $ctx.Response.Close() } catch {}
    }
}
