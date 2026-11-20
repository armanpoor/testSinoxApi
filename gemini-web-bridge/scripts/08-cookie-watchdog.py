# -*- coding: utf-8 -*-
"""
نگهبان کوکی — رصد سلامت اکانت‌ها و تازه‌سازی خودکار از مرورگر لاگین‌شده.

مشکل: کوکی‌های کروم با DBSC بعد از ~۳۰ دقیقه می‌میرند (تجربه واقعی ما) و پروکسی
بی‌صدا به حالت ناشناس می‌افتد. این نگهبان:
  1. هر N دقیقه همه اکانت‌ها را با endpoint رسمی check می‌سنجد (بدون مصرف چت).
  2. اگر اکانتی مرده بود، مرورگر کلون‌شده همان اکانت را با CDP باز می‌کند
     (سشن در خود مرورگر زنده است)، کوکی تازه می‌گیرد، مرورگر را فوراً می‌بندد
     و کوکی pool را جایگزین می‌کند.
  3. اگر تازه‌سازی شکست خورد، اکانت را disable می‌کند (نه حذف) و هشدار می‌دهد.

استفاده:
  python scripts/08-cookie-watchdog.py                 # حلقه دائمی (هر ۱۰ دقیقه)
  python scripts/08-cookie-watchdog.py --once          # یک بار چک و خروج
  python scripts/08-cookie-watchdog.py --interval 5    # هر ۵ دقیقه

نگاشت اکانت→پروفایل مرورگر در فایل cookie-sources.json کنار اسکریپت:
  {"accounts": [{"label": "arman2", "profile_dir": "E:/.../chrome-clone-arman2",
                 "profile_name": "Profile 5"}]}
"""
import argparse
import io
import json
import os
import socket
import struct
import base64
import subprocess
import sys
import time
import urllib.request

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ADMIN_URL = os.environ.get("GW2API_ADMIN", "http://localhost:8093")
ADMIN_TOKEN = os.environ.get("GW2API_ADMIN_TOKEN", "change-me-123")
CDP_PORT = int(os.environ.get("CDP_PORT", "9333"))
SOURCES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookie-sources.json")
CHROME = os.environ.get("CHROME_EXE", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
WANTED = {"SID", "HSID", "SSID", "APISID", "SAPISID",
          "__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC", "NID"}


def admin_opener():
    import http.cookiejar
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    body = json.dumps({"token": ADMIN_TOKEN}).encode()
    op.open(urllib.request.Request(f"{ADMIN_URL}/admin/api/login", data=body,
                                   headers={"Content-Type": "application/json"}), timeout=15)
    return op


def api(op, method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{ADMIN_URL}{path}", data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    with op.open(req, timeout=60) as r:
        return json.loads(r.read().decode())


def cdp_call(ws_url, msgs):
    """کلاینت مینیمال WebSocket برای CDP (کپی‌شده از 03-extract-cookies.py)."""
    u = ws_url.replace("ws://", "").split("/")
    host, port = u[0].split(":")
    path = "/" + "/".join(u[1:])
    s = socket.create_connection((host, int(port)))
    key = base64.b64encode(os.urandom(16)).decode()
    s.send((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n").encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        resp += s.recv(4096)

    def send(payload):
        data = payload.encode()
        h = bytearray([0x81])
        n = len(data)
        if n < 126:
            h.append(0x80 | n)
        elif n < 65536:
            h.append(0x80 | 126); h += struct.pack(">H", n)
        else:
            h.append(0x80 | 127); h += struct.pack(">Q", n)
        mask = os.urandom(4); h += mask
        s.send(bytes(h) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv():
        hdr = s.recv(2)
        n = hdr[1] & 0x7F
        if n == 126: n = struct.unpack(">H", s.recv(2))[0]
        elif n == 127: n = struct.unpack(">Q", s.recv(8))[0]
        data = b""
        while len(data) < n: data += s.recv(n - len(data))
        return data.decode("utf-8", "replace")

    results = {}
    for i, (method, params) in enumerate(msgs, 1):
        send(json.dumps({"id": i, "method": method, "params": params or {}}))
        while True:
            try: d = json.loads(recv())
            except Exception: break
            if d.get("id") == i:
                results[method] = d.get("result", d)
                break
    s.close()
    return results


def refresh_from_browser(profile_dir, profile_name):
    """مرورگر کلون‌شده را باز می‌کند، کوکی تازه می‌گیرد، فوراً می‌بندد."""
    proc = subprocess.Popen([
        CHROME, f"--user-data-dir={profile_dir}",
        f"--profile-directory={profile_name}",
        f"--remote-debugging-port={CDP_PORT}",
        "--no-first-run", "--headless=new", "https://gemini.google.com/app",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(8)
        tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=10))
        gem = [t for t in tabs if "gemini" in t.get("url", "")]
        if not gem:
            raise RuntimeError("تب جمنای باز نشد")
        res = cdp_call(gem[0]["webSocketDebuggerUrl"], [
            ("Network.enable", {}),
            ("Network.getCookies", {"urls": [
                "https://gemini.google.com", "https://google.com",
                "https://accounts.google.com",
            ]}),
        ])
        cookies = res.get("Network.getCookies", {}).get("cookies", [])
        out = {}
        for c in cookies:
            if c["name"] in WANTED and c["name"] not in out:
                out[c["name"]] = c["value"]
        if "__Secure-1PSID" not in out:
            raise RuntimeError("کوکی 1PSID پیدا نشد — سشن مرورگر هم مرده؛ لاگین دستی لازم است")
        return "; ".join(f"{k}={v}" for k, v in sorted(out.items()))
    finally:
        proc.terminate()
        try: proc.wait(timeout=10)
        except subprocess.TimeoutExpired: proc.kill()


def cycle(op, sources):
    """یک دور کامل: چک همه اکانت‌ها، تازه‌سازی مرده‌ها."""
    items = api(op, "GET", "/admin/api/cookies").get("items", [])
    by_label = {s["label"]: s for s in sources.get("accounts", [])}
    for it in items:
        label = it.get("label", "")
        res = api(op, "POST", f"/admin/api/cookies/{it['id']}/check")
        if res.get("ok"):
            print(f"  ✅ #{it['id']} {label}: سالم")
            continue
        print(f"  ❌ #{it['id']} {label}: مرده — {res.get('detail','')[:80]}")
        src = by_label.get(label)
        if not src:
            print(f"     ⚠ منبع مرورگر برای «{label}» در cookie-sources.json نیست؛ دستی لاگین کنید")
            continue
        try:
            cookie = refresh_from_browser(src["profile_dir"], src["profile_name"])
            api(op, "DELETE", f"/admin/api/cookies/{it['id']}")
            new = api(op, "POST", "/admin/api/cookies",
                      {"label": label, "cookie": cookie, "note": "watchdog-refresh"})
            chk = api(op, "POST", f"/admin/api/cookies/{new['id']}/check")
            if chk.get("ok"):
                print(f"     🔄 تازه‌سازی شد → اکانت #{new['id']} سالم")
            else:
                print(f"     ⚠ کوکی جدید هم نامعتبر است: {chk.get('detail','')[:80]}")
        except Exception as e:
            print(f"     💥 تازه‌سازی شکست خورد: {e}")
            api(op, "PATCH", f"/admin/api/cookies/{it['id']}", {"status": "disabled"})
            print("     اکانت disable شد تا ترافیک روی سشن مرده نرود")


def main():
    ap = argparse.ArgumentParser(description="نگهبان تازه‌ساز کوکی")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=10, help="دقیقه بین هر دور")
    args = ap.parse_args()
    sources = json.load(open(SOURCES_FILE, encoding="utf-8")) if os.path.exists(SOURCES_FILE) else {"accounts": []}
    if not sources["accounts"]:
        print(f"⚠ {SOURCES_FILE} خالی یا ناموجود است — فقط چک انجام می‌شود، تازه‌سازی خودکار نه")
    while True:
        print(f"\n[{time.strftime('%H:%M:%S')}] دور نگهبان")
        try:
            cycle(admin_opener(), sources)
        except Exception as e:
            print(f"خطای دور: {e}")
        if args.once:
            break
        time.sleep(args.interval * 60)


if __name__ == "__main__":
    main()
