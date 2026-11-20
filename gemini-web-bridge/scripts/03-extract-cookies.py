# -*- coding: utf-8 -*-
"""
استخراج کوکی‌های گوگل از کروم (CDP) یا فایرفاکس (Cookie-Editor JSON / cookies.sqlite).

استفاده:
  python scripts/03-extract-cookies.py                            # استخراج از Chrome CDP
  python scripts/03-extract-cookies.py --firefox-json export.json # ورود از Cookie-Editor فایرفاکس
  python scripts/03-extract-cookies.py --firefox-profile <dir>    # خواندن مستقیم cookies.sqlite فایرفاکس
"""
import argparse
import json
import os
import sys
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from bridge_lib import (
    WANTED_COOKIES,
    cdp_call,
    extract_firefox_sqlite,
    format_cookie_header,
    parse_firefox_json,
)

CDP_PORT = int(os.environ.get("CDP_PORT", "9333"))
OUT_FILE = os.environ.get("COOKIE_OUT", "cookie.txt")


def extract_from_cdp(port: int) -> dict:
    tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=10))
    pages = [t for t in tabs if t.get("type") == "page"]
    gem = [t for t in pages if "gemini" in t.get("url", "")] or pages
    if not gem:
        sys.exit(f"هیچ تب بازی پیدا نشد. اول کروم را با --remote-debugging-port={port} باز کنید.")
    ws = gem[0]["webSocketDebuggerUrl"]
    res = cdp_call(ws, [
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
    return out


def main():
    ap = argparse.ArgumentParser(description="استخراج کوکی‌های گوگل (Chrome CDP / Firefox)")
    ap.add_argument("--cdp-port", type=int, default=CDP_PORT)
    ap.add_argument("--firefox-json", help="مسیر فایل JSON خروجی افزونه Cookie-Editor")
    ap.add_argument("--firefox-profile", help="مسیر پوشه پروفایل فایرفاکس (حاوی cookies.sqlite)")
    ap.add_argument("--out", default=OUT_FILE, help="فایل خروجی کوکی")
    args = ap.parse_args()

    if args.firefox_json:
        out = parse_firefox_json(args.firefox_json)
        source = "Firefox JSON"
    elif args.firefox_profile:
        out = extract_firefox_sqlite(args.firefox_profile)
        source = "Firefox cookies.sqlite"
    else:
        out = extract_from_cdp(args.cdp_port)
        source = f"Chrome CDP :{args.cdp_port}"

    if "__Secure-1PSID" not in out:
        sys.exit("کوکی __Secure-1PSID پیدا نشد — یعنی لاگین گوگل انجام نشده است.")

    cookie_str = format_cookie_header(out)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(cookie_str)

    print(f"✅ {len(out)} کوکی از {source} ذخیره شد در {args.out}")
    if "__Secure-1PSIDTS" not in out:
        print("⚠ هشدار: __Secure-1PSIDTS یافت نشد — بدون آن مدل‌های Pro به Flash-Lite تنزل می‌یابند.")
    if not args.firefox_json and not args.firefox_profile:
        print("حالا مرورگر کروم را فوراً ببندید تا چرخش کوکی خراب نشود.")


if __name__ == "__main__":
    main()
