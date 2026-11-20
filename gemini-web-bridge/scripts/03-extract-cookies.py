# -*- coding: utf-8 -*-
"""
استخراج کوکی‌های گوگل از یک مرورگر کروم در حال اجرا با پورت دیباگ (CDP).

پیش‌نیاز: کروم را با این دستور باز کنید (پروفایل موقت پیشنهاد می‌شود):
  chrome.exe --user-data-dir="%TEMP%\gemini-login" --remote-debugging-port=9333 https://gemini.google.com/app

بعد از لاگین، این اسکریپت را اجرا کنید. مرورگر را بلافاصله ببندید.
"""
import json
import socket
import struct
import os
import base64
import urllib.request
import sys

CDP_PORT = int(os.environ.get("CDP_PORT", "9333"))
OUT_FILE = os.environ.get("COOKIE_OUT", "cookie.txt")

WANTED = {
    "SID", "HSID", "SSID", "APISID", "SAPISID",
    "__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC", "NID",
}


def cdp_call(ws_url, msgs):
    """کلاینت مینیمال WebSocket برای CDP — بدون هیچ وابستگی خارجی."""
    u = ws_url.replace("ws://", "").split("/")
    host, port = u[0].split(":")
    path = "/" + "/".join(u[1:])
    s = socket.create_connection((host, int(port)))
    key = base64.b64encode(os.urandom(16)).decode()
    s.send((
        f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
        f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ).encode())
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
            h.append(0x80 | 126)
            h += struct.pack(">H", n)
        else:
            h.append(0x80 | 127)
            h += struct.pack(">Q", n)
        mask = os.urandom(4)
        h += mask
        s.send(bytes(h) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv():
        hdr = s.recv(2)
        n = hdr[1] & 0x7F
        if n == 126:
            n = struct.unpack(">H", s.recv(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", s.recv(8))[0]
        data = b""
        while len(data) < n:
            data += s.recv(n - len(data))
        return data.decode("utf-8", "replace")

    results = {}
    for i, (method, params) in enumerate(msgs, 1):
        send(json.dumps({"id": i, "method": method, "params": params or {}}))
        while True:
            try:
                d = json.loads(recv())
            except Exception:
                break
            if d.get("id") == i:
                results[method] = d.get("result", d)
                break
    s.close()
    return results


def main():
    tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json"))
    pages = [t for t in tabs if t.get("type") == "page"]
    gem = [t for t in pages if "gemini" in t.get("url", "")] or pages
    if not gem:
        sys.exit("هیچ تب بازی پیدا نشد. اول کروم را با --remote-debugging-port=9333 باز کنید.")
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
        if c["name"] in WANTED and c["name"] not in out:
            out[c["name"]] = c["value"]
    if "__Secure-1PSID" not in out:
        sys.exit("کوکی __Secure-1PSID پیدا نشد — یعنی لاگین نکرده‌اید.")
    cookie_str = "; ".join(f"{k}={v}" for k, v in sorted(out.items()))
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        f.write(cookie_str)
    print(f"✅ {len(out)} کوکی ذخیره شد در {OUT_FILE}")
    print("حالا مرورگر را فوراً ببندید تا چرخش کوکی خراب نشود.")
    print("بعد محتوای فایل را در پنل ادمین (Cookie Pool → Add) بچسبانید.")


if __name__ == "__main__":
    main()
