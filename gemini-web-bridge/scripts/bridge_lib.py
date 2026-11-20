# -*- coding: utf-8 -*-
"""
ماژول مشترک ابزارهای خط فرمان Gemini Web Bridge (بدون وابستگی خارجی):
- کلاینت مقاوم WebSocket برای Chrome CDP (پشتیبانی از خوانش ناقص، فریم چندتکه و Ping/Pong)
- پارسر کوکی فایرفاکس (Cookie-Editor JSON، Netscape و فایل cookies.sqlite)
- کلاینت نشست احراز هویت پنل ادمین موتور وب (8093)
- پروفایل آماده سخت‌سازی ضدبن (Anti-Ban Hardening Preset)
"""
import base64
import http.cookiejar
import json
import os
import shutil
import socket
import sqlite3
import struct
import tempfile
import urllib.error
import urllib.request

WANTED_COOKIES = {
    "SID", "HSID", "SSID", "APISID", "SAPISID",
    "__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC", "NID",
}

ANTI_BAN_PRESET = {
    "per_ip_concurrent": 1,
    "per_ip_rpm": 3,
    "per_ip_rph": 40,
    "retry_attempts": 2,
    "retry_delay_sec": 8,
    "retry_on_timeout": False,
    "temporary_chat": True,
    "anon_first": True,
    "strict_model": True,
    "fallback_direct": False,
    "stream_idle_timeout_sec": 120,
}


def _recv_exact(sock: socket.socket, count: int) -> bytes:
    buf = bytearray()
    while len(buf) < count:
        chunk = sock.recv(count - len(buf))
        if not chunk:
            raise EOFError("اتصال WebSocket پیش از دریافت کامل فریم بسته شد")
        buf.extend(chunk)
    return bytes(buf)


def cdp_call(ws_url: str, msgs, timeout: float = 15.0):
    """کلاینت کامل‌تر WebSocket برای CDP با پشتیبانی از فریم‌های چندتکه و Ping/Pong."""
    u = ws_url.replace("ws://", "").split("/")
    host, port = u[0].split(":")
    path = "/" + "/".join(u[1:])
    s = socket.create_connection((host, int(port)), timeout=timeout)
    s.settimeout(timeout)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((
        f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
        f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ).encode())

    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = s.recv(4096)
        if not chunk:
            raise RuntimeError("پاسخ handshake از CDP دریافت نشد")
        resp += chunk

    def send_frame(opcode: int, data: bytes):
        h = bytearray([0x80 | opcode])
        n = len(data)
        if n < 126:
            h.append(0x80 | n)
        elif n < 65536:
            h.append(0x80 | 126)
            h += struct.pack(">H", n)
        else:
            h.append(0x80 | 127)
            h += struct.pack(">Q", n)
        mask = os.urandom(4)
        h += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        s.sendall(bytes(h) + masked)

    def recv_message() -> str:
        fragments = bytearray()
        while True:
            hdr = _recv_exact(s, 2)
            fin = (hdr[0] & 0x80) != 0
            opcode = hdr[0] & 0x0F
            masked = (hdr[1] & 0x80) != 0
            n = hdr[1] & 0x7F
            if n == 126:
                n = struct.unpack(">H", _recv_exact(s, 2))[0]
            elif n == 127:
                n = struct.unpack(">Q", _recv_exact(s, 8))[0]
            mask_key = _recv_exact(s, 4) if masked else None
            payload = _recv_exact(s, n) if n else b""
            if mask_key:
                payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))

            if opcode == 0x9:  # Ping -> send Pong
                send_frame(0xA, payload)
                continue
            if opcode == 0xA:  # Pong
                continue
            if opcode == 0x8:  # Close
                return ""
            fragments.extend(payload)
            if fin:
                return fragments.decode("utf-8", "replace")

    results = {}
    try:
        for i, (method, params) in enumerate(msgs, 1):
            send_frame(0x1, json.dumps({"id": i, "method": method, "params": params or {}}).encode())
            while True:
                raw = recv_message()
                if not raw:
                    break
                try:
                    d = json.loads(raw)
                except Exception:
                    continue
                if d.get("id") == i:
                    results[method] = d.get("result", d)
                    break
    finally:
        s.close()
    return results


def parse_firefox_json(path: str) -> dict:
    """خواندن خروجی JSON افزونه Cookie-Editor فایرفاکس."""
    data = json.load(open(path, encoding="utf-8"))
    items = data if isinstance(data, list) else data.get("cookies", [])
    out = {}
    for c in items:
        if not isinstance(c, dict):
            continue
        domain = str(c.get("domain", "")).lower()
        name = str(c.get("name", "")).strip()
        val = str(c.get("value", "")).strip()
        if domain and "google.com" not in domain:
            continue
        if name in WANTED_COOKIES and val and name not in out:
            out[name] = val
    return out


def extract_firefox_sqlite(profile_dir: str) -> dict:
    """خواندن مستقیم کوکی‌های گوگل از فایل cookies.sqlite پروفایل فایرفاکس (کپی موقت بدون قفل فایل)."""
    src = os.path.join(profile_dir, "cookies.sqlite")
    if not os.path.exists(src):
        raise FileNotFoundError(f"فایل cookies.sqlite در {profile_dir} یافت نشد")
    tmp_fd, tmp_path = tempfile.mkstemp(prefix="ff_cookies_", suffix=".sqlite")
    os.close(tmp_fd)
    try:
        shutil.copy2(src, tmp_path)
        conn = sqlite3.connect(tmp_path)
        try:
            cur = conn.execute(
                "SELECT name, value, host FROM moz_cookies WHERE host LIKE '%google.com%'"
            )
            out = {}
            for name, value, _host in cur.fetchall():
                if name in WANTED_COOKIES and value and name not in out:
                    out[name] = value
            return out
        finally:
            conn.close()
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


def format_cookie_header(cookies: dict) -> str:
    return "; ".join(f"{k}={v}" for k, v in sorted(cookies.items()))


def admin_opener(admin_url: str, admin_token: str):
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    body = json.dumps({"token": admin_token}).encode()
    req = urllib.request.Request(
        f"{admin_url.rstrip('/')}/admin/api/login",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    op.open(req, timeout=15)
    return op


def admin_api(op, admin_url: str, method: str, path: str, payload=None, timeout: int = 30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{admin_url.rstrip('/')}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with op.open(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"error": f"HTTP {e.code}"}
