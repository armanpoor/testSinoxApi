# -*- coding: utf-8 -*-
"""
مدیریت چند-اکانته Cookie Pool — افزودن/لیست/تست/حذف/فعال‌وغیرفعال کردن اکانت‌ها.

هر اکانت = یک کوکی جدا. پروکسی خودش بین اکانت‌ها می‌چرخد (round-robin بر اساس
«قدیمی‌ترین استفاده‌شده») و هر اکانت به خروجی (IP) خودش می‌چسبد.

استفاده:
  python scripts/05-manage-accounts.py add --label arman3 --cookie-file cookie-arman3.txt
  python scripts/05-manage-accounts.py add --label arman3 --cookie "SID=...; HSID=...; ..."
  python scripts/05-manage-accounts.py list
  python scripts/05-manage-accounts.py check            # تست همه اکانت‌ها (لاگین معتبر؟)
  python scripts/05-manage-accounts.py enable 2
  python scripts/05-manage-accounts.py disable 2
  python scripts/05-manage-accounts.py delete 2
  python scripts/05-manage-accounts.py authuser 2 1     # اکانت شماره ۲ از یک مرورگر چند-اکانته (/u/1)
"""
import argparse
import io
import json
import os
import sys
import urllib.request

# خروجی ویندوز را UTF-8 می‌کنیم تا متن فارسی خراب نشود
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ADMIN_URL = os.environ.get("GW2API_ADMIN", "http://localhost:8093")
ADMIN_TOKEN = os.environ.get("GW2API_ADMIN_TOKEN", "change-me-123")


def opener():
    """پنل ادمین با کوکی لاگین کار می‌کند — یک opener با cookiejar می‌سازیم."""
    import http.cookiejar
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    body = json.dumps({"token": ADMIN_TOKEN}).encode()
    req = urllib.request.Request(f"{ADMIN_URL}/admin/api/login", data=body,
                                 headers={"Content-Type": "application/json"})
    op.open(req, timeout=15)
    return op


def api(op, method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{ADMIN_URL}{path}", data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with op.open(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"error": f"HTTP {e.code}"}


def cmd_add(args):
    if args.cookie_file:
        cookie = open(args.cookie_file, encoding="utf-8").read().strip()
    elif args.cookie:
        cookie = args.cookie
    else:
        sys.exit("یا --cookie-file بده یا --cookie")
    p = {"label": args.label, "cookie": cookie, "note": args.note or ""}
    if args.authuser:
        p["authuser"] = args.authuser
    r = api(opener(), "POST", "/admin/api/cookies", p)
    if "id" in r:
        print(f"✅ اکانت #{r['id']} با نام «{args.label}» اضافه شد.")
        print("   با دستور check مطمئن شو لاگین معتبر است.")
    else:
        sys.exit(f"❌ {r}")


def cmd_list(args):
    r = api(opener(), "GET", "/admin/api/cookies")
    items = r.get("items", [])
    if not items:
        print("هیچ اکانتی در pool نیست. با add اولین اکانت را اضافه کن.")
        return
    print(f"مجموع {r.get('total')} اکانت، {r.get('enabled')} فعال:\n")
    for it in items:
        health = it.get("health", "?")
        flag = {"ok": "✅", "disabled": "⛔", "dead": "💀", "error": "⚠️"}.get(health, "·")
        status = it.get("status", "?")
        print(f"  {flag} #{it.get('id')}  {it.get('label','')!s:20}  "
              f"health={health} status={status} fail={it.get('fail_count','-')} "
              f"has_1psidts={it.get('has_1psidts')}")
        if it.get("last_error"):
            print(f"      last_error: {it['last_error'][:100]}")
    print("\nنکته: جزئیات کوکی عمداً مخفی است (امنیت). برای تست وضعیت: check")


def cmd_check(args):
    """برای هر اکانت، endpoint رسمی check را صدا می‌زند (تست لاگین بدون چت)."""
    r = api(opener(), "GET", "/admin/api/cookies")
    items = r.get("items", [])
    if not items:
        sys.exit("pool خالی است.")
    for it in items:
        name = it.get("label", "")
        res = api(opener(), "POST", f"/admin/api/cookies/{it['id']}/check")
        s = json.dumps(res, ensure_ascii=False)
        print(f"  #{it['id']} {name}: {s[:220]}")
    print("\nتفسیر: logged_in=true → سشن معتبر؛ expired/invalid → کوکی تازه لازم است")


def cmd_rotate(args):
    """بیدار کردن دستی چرخش کوکی (keep-alive) برای یک اکانت."""
    r = api(opener(), "POST", f"/admin/api/cookies/{args.id}/rotate")
    print(f"نتیجه: {json.dumps(r, ensure_ascii=False)[:200]}")


def cmd_toggle(args, enabled):
    """برای قطعیت از PATCH status استفاده می‌کنیم (toggle برعکس می‌کند)."""
    want = "enabled" if enabled else "disabled"
    r = api(opener(), "PATCH", f"/admin/api/cookies/{args.id}", {"status": want})
    print(f"نتیجه: {r}")


def cmd_delete(args):
    r = api(opener(), "DELETE", f"/admin/api/cookies/{args.id}")
    print(f"نتیجه: {r}")


def cmd_authuser(args):
    r = api(opener(), "PATCH", f"/admin/api/cookies/{args.id}",
            {"authuser": args.n})
    print(f"نتیجه: {r}")


def cmd_harden(args):
    """اعمال یک‌مرحله‌ای تنظیمات سخت‌شده ضدبن روی موتور 8093 (ادغام غیرمخرب)."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    from bridge_lib import ANTI_BAN_PRESET

    op = opener()
    cur = api(op, "GET", "/admin/api/config")
    cfg = cur.get("config", {})
    if not isinstance(cfg, dict):
        sys.exit(f"❌ خواندن تنظیمات فعلی ناموفق بود: {cur}")
    merged = {**cfg, **ANTI_BAN_PRESET}
    res = api(op, "PUT", "/admin/api/config", merged)
    if "error" in res:
        sys.exit(f"❌ خطا در اعمال پروفایل ضدبن: {res}")
    print("✅ پروفایل سخت‌شده ضدبن (concurrent=1, rpm=3, rph=40, strict_model=true, temporary_chat=true) اعمال شد.")


def main():
    ap = argparse.ArgumentParser(description="مدیریت Cookie Pool چند-اکانته و سخت‌سازی ضدبن")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add")
    p.add_argument("--label", required=True)
    p.add_argument("--cookie-file")
    p.add_argument("--cookie")
    p.add_argument("--note")
    p.add_argument("--authuser", type=int, default=0)
    p.set_defaults(fn=cmd_add)

    p = sub.add_parser("list"); p.set_defaults(fn=cmd_list)
    p = sub.add_parser("check"); p.set_defaults(fn=cmd_check)
    p = sub.add_parser("rotate"); p.add_argument("id", type=int)
    p.set_defaults(fn=cmd_rotate)

    p = sub.add_parser("enable"); p.add_argument("id", type=int)
    p.set_defaults(fn=lambda a: cmd_toggle(a, True))
    p = sub.add_parser("disable"); p.add_argument("id", type=int)
    p.set_defaults(fn=lambda a: cmd_toggle(a, False))
    p = sub.add_parser("delete"); p.add_argument("id", type=int)
    p.set_defaults(fn=cmd_delete)
    p = sub.add_parser("authuser"); p.add_argument("id", type=int)
    p.add_argument("n", type=int)
    p.set_defaults(fn=cmd_authuser)
    p = sub.add_parser("harden", help="اعمال پروفایل سخت‌شده ضدبن روی موتور 8093")
    p.set_defaults(fn=cmd_harden)

    args = ap.parse_args()
    if args.cmd in ("enable", "disable") and not hasattr(args, "id"):
        sys.exit("شناسه اکانت بده")
    args.fn(args)


if __name__ == "__main__":
    main()
