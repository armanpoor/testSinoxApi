# -*- coding: utf-8 -*-
"""
نگهبان اتمیک کوکی — رصد سلامت اکانت‌ها و تازه‌سازی ایمن (Verify-Before-Delete).

بهبودهای کلیدی نسبت به نسخه قبلی:
  1. انتظار پویا برای آماده شدن پورت CDP به‌جای sleep ثابت ۸ ثانیه‌ای.
  2. پشتیبانی از منبع فایرفاکس (خواندن مستقیم cookies.sqlite بدون DBSC کروم) و کلون کروم.
  3. جایگزینی اتمیک: ابتدا کوکی تازه با حفظ authuser و note ثبت و با /check تأیید می‌شود؛
     تنها پس از تأیید سلامت رکورد جدید، رکورد منقضی قبلی حذف می‌گردد (عدم از دست رفتن اکانت).

استفاده:
  python scripts/08-cookie-watchdog.py                 # حلقه دائمی (هر ۱۰ دقیقه)
  python scripts/08-cookie-watchdog.py --once          # یک بار چک و خروج
  python scripts/08-cookie-watchdog.py --interval 5    # هر ۵ دقیقه
"""
import argparse
import io
import json
import os
import subprocess
import sys
import time
import urllib.request

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from bridge_lib import (
    WANTED_COOKIES,
    admin_api,
    admin_opener,
    cdp_call,
    extract_firefox_sqlite,
    format_cookie_header,
)

ADMIN_URL = os.environ.get("GW2API_ADMIN", "http://localhost:8093")
ADMIN_TOKEN = os.environ.get("GW2API_ADMIN_TOKEN", "change-me-123")
CDP_PORT = int(os.environ.get("CDP_PORT", "9333"))
SOURCES_FILE = os.path.join(SCRIPT_DIR, "cookie-sources.json")
CHROME = os.environ.get("CHROME_EXE", r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def wait_for_cdp_tabs(port: int, timeout_sec: float = 25.0):
    deadline = time.time() + timeout_sec
    last_err = None
    while time.time() < deadline:
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=3))
            gem = [t for t in tabs if t.get("type") == "page" and "gemini" in t.get("url", "")]
            if gem:
                return gem
        except Exception as e:
            last_err = e
        time.sleep(0.8)
    raise RuntimeError(f"تب جمنای ظرف {int(timeout_sec)} ثانیه روی پورت {port} آماده نشد ({last_err})")


def refresh_from_source(src: dict) -> str:
    browser_type = src.get("browser_type", "chrome-cdp")
    profile_dir = src.get("profile_dir", "")

    if browser_type == "firefox":
        cookies = extract_firefox_sqlite(profile_dir)
        if "__Secure-1PSID" not in cookies:
            raise RuntimeError("کوکی __Secure-1PSID در پروفایل فایرفاکس یافت نشد")
        return format_cookie_header(cookies)

    profile_name = src.get("profile_name", "Default")
    proc = subprocess.Popen([
        CHROME,
        f"--user-data-dir={profile_dir}",
        f"--profile-directory={profile_name}",
        f"--remote-debugging-port={CDP_PORT}",
        "--no-first-run",
        "--headless=new",
        "https://gemini.google.com/app",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        gem = wait_for_cdp_tabs(CDP_PORT)
        # فرصت کوتاه برای تکمیل چرخش __Secure-1PSIDTS در صفحه
        time.sleep(2.5)
        res = cdp_call(gem[0]["webSocketDebuggerUrl"], [
            ("Network.enable", {}),
            ("Network.getCookies", {"urls": [
                "https://gemini.google.com",
                "https://google.com",
                "https://accounts.google.com",
            ]}),
        ])
        cookies = res.get("Network.getCookies", {}).get("cookies", [])
        out = {}
        for c in cookies:
            if c.get("name") in WANTED_COOKIES and c.get("name") not in out:
                out[c["name"]] = c["value"]
        if "__Secure-1PSID" not in out:
            raise RuntimeError("کوکی __Secure-1PSID پیدا نشد — سشن مرورگر هم منقضی شده؛ لاگین دستی لازم است")
        return format_cookie_header(out)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def cycle(op, sources: dict):
    """یک دور کامل اتمیک: بررسی همه اکانت‌ها و جایگزینی امن (Verify-Before-Delete)."""
    items = admin_api(op, ADMIN_URL, "GET", "/admin/api/cookies").get("items", [])
    by_label = {s["label"]: s for s in sources.get("accounts", [])}

    for it in items:
        acc_id = it["id"]
        label = it.get("label", "")
        res = admin_api(op, ADMIN_URL, "POST", f"/admin/api/cookies/{acc_id}/check", timeout=60)
        if res.get("ok"):
            print(f"  ✅ #{acc_id} {label}: سالم")
            continue

        print(f"  ❌ #{acc_id} {label}: منقضی — {str(res.get('detail', ''))[:80]}")
        src = by_label.get(label)
        if not src:
            print(f"     ⚠ منبع مرورگر برای «{label}» در cookie-sources.json ثبت نشده است")
            continue

        try:
            fresh_cookie = refresh_from_source(src)
            authuser = it.get("authuser", src.get("authuser", 0))
            note = it.get("note") or src.get("note") or "atomic-watchdog-refresh"

            # گام ۱ اتمیک: ثبت رکورد جایگزین پیش از دست زدن به رکورد قدیمی
            created = admin_api(op, ADMIN_URL, "POST", "/admin/api/cookies", {
                "label": label,
                "cookie": fresh_cookie,
                "authuser": authuser,
                "note": note,
            })
            new_id = created.get("id")
            if not new_id:
                raise RuntimeError(f"ثبت رکورد جدید ناموفق بود: {created}")

            # گام ۲ اتمیک: تأیید سلامت رکورد جدید
            chk = admin_api(op, ADMIN_URL, "POST", f"/admin/api/cookies/{new_id}/check", timeout=60)
            if chk.get("ok"):
                # گام ۳ اتمیک: حذف رکورد منقضی قبلی پس از اطمینان کامل
                admin_api(op, ADMIN_URL, "DELETE", f"/admin/api/cookies/{acc_id}")
                print(f"     🔄 جایگزینی اتمیک موفق → اکانت جدید #{new_id} (authuser={authuser}) سالم و #{acc_id} حذف شد")
            else:
                # رول‌بک رکورد نامعتبر جدید و غیرفعال کردن ایمن رکورد قبلی
                admin_api(op, ADMIN_URL, "DELETE", f"/admin/api/cookies/{new_id}")
                admin_api(op, ADMIN_URL, "PATCH", f"/admin/api/cookies/{acc_id}", {"status": "disabled"})
                print(f"     ⚠ کوکی جدید تأیید نشد ({chk.get('detail', '')[:80]}) — رول‌بک انجام شد و #{acc_id} غیرفعال گردید")
        except Exception as e:
            print(f"     💥 تازه‌سازی شکست خورد: {e}")
            admin_api(op, ADMIN_URL, "PATCH", f"/admin/api/cookies/{acc_id}", {"status": "disabled"})
            print(f"     رکورد #{acc_id} بدون حذف غیرفعال شد")


def main():
    ap = argparse.ArgumentParser(description="نگهبان اتمیک تازه‌ساز کوکی")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=10, help="دقیقه بین هر دور")
    args = ap.parse_args()
    sources = json.load(open(SOURCES_FILE, encoding="utf-8")) if os.path.exists(SOURCES_FILE) else {"accounts": []}
    if not sources.get("accounts"):
        print(f"⚠ {SOURCES_FILE} خالی یا ناموجود است — فقط بررسی سلامت انجام می‌شود")
    while True:
        print(f"\n[{time.strftime('%H:%M:%S')}] دور نگهبان اتمیک")
        try:
            cycle(admin_opener(ADMIN_URL, ADMIN_TOKEN), sources)
        except Exception as e:
            print(f"خطای دور: {e}")
        if args.once:
            break
        time.sleep(args.interval * 60)


if __name__ == "__main__":
    main()
