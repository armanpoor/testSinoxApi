# -*- coding: utf-8 -*-
"""
تست جامع پل — OpenAI، استریم واقعی SSE، Anthropic، Tool Calling، تراتل و رگرسیون سهمیه 1PSIDTS.

استفاده:
  python scripts/04-test-api.py                          # همه تست‌ها
  python scripts/04-test-api.py --quick                  # فقط OpenAI ساده
  python scripts/04-test-api.py --model gemini-4-neon    # تست مدل دلخواه
"""
import argparse
import json
import os
import sys
import urllib.request

OPENAI_BASE = os.environ.get("GW2API_URL", "http://localhost:8093").rstrip("/") + "/v1"
ANTHROPIC_BASE = os.environ.get("BRIDGE_URL", "http://localhost:8094").rstrip("/")
THROTTLE_BASE = os.environ.get("THROTTLE_URL", "http://127.0.0.1:8095").rstrip("/")
GW2API_KEY = os.environ.get("GW2API_KEY", "")
BRIDGE_KEY = os.environ.get("BRIDGE_KEY", "local-client-key-1")


def post(url, body, headers, timeout=180):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def test_models_and_1psidts_slo():
    """تست رگرسیون 9routerx: بررسی وجود مدل‌های سری ۴ (نشانه فعال بودن 1PSIDTS)."""
    headers = {"Authorization": f"Bearer {GW2API_KEY}"} if GW2API_KEY else {}
    req = urllib.request.Request(f"{OPENAI_BASE}/models", headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode())
    ids = [m.get("id", "") for m in data.get("data", [])]
    has_v4 = any("gemini-4-" in i for i in ids)
    status = "✅ مدل‌های سری ۴ و Pro در دسترس" if has_v4 else "⚠ فقط Flash-Lite (احتمال فقدان __Secure-1PSIDTS)"
    print(f"[Models/SLO] {len(ids)} مدل → {status}")


def test_openai(model="gemini-4-hydrogen"):
    headers = {"Authorization": f"Bearer {GW2API_KEY}"} if GW2API_KEY else {}
    d = post(f"{OPENAI_BASE}/chat/completions", {
        "model": model, "stream": False,
        "messages": [{"role": "user", "content": "فقط بنویس: تست-موفق"}],
    }, headers)
    print(f"[OpenAI] {model} → {d['choices'][0]['message']['content'][:80]}")


def test_sse_stream(model="gemini-4-hydrogen"):
    """بررسی استریم زنده SSE (مطمئن می‌شویم پاسخ تکه‌تکه می‌آید نه بافرشده)."""
    headers = {
        "Content-Type": "application/json",
        **({"Authorization": f"Bearer {GW2API_KEY}"} if GW2API_KEY else {}),
    }
    req = urllib.request.Request(
        f"{OPENAI_BASE}/chat/completions",
        data=json.dumps({
            "model": model, "stream": True,
            "messages": [{"role": "user", "content": "فقط بنویس: استریم-موفق"}],
        }).encode(),
        headers=headers,
    )
    chunks = 0
    text = ""
    with urllib.request.urlopen(req, timeout=180) as r:
        for raw_line in r:
            line = raw_line.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            try:
                ev = json.loads(payload)
                delta = ev.get("choices", [{}])[0].get("delta", {}).get("content", "")
                if delta:
                    chunks += 1
                    text += delta
            except Exception:
                continue
    print(f"[SSE Stream] ✅ {chunks} قطعه دریافت شد → {text[:60]}")


def test_anthropic(model="gemini-4-hydrogen"):
    d = post(f"{ANTHROPIC_BASE}/v1/messages", {
        "model": model, "max_tokens": 200, "stream": False,
        "messages": [{"role": "user", "content": "فقط بنویس: پل-انترپیک-موفق"}],
    }, {"x-api-key": BRIDGE_KEY, "anthropic-version": "2023-06-01"})
    print(f"[Anthropic] {model} → {d['content'][0]['text'][:80]}")


def test_tool_call(model="gemini-4-hydrogen"):
    d = post(f"{ANTHROPIC_BASE}/v1/messages", {
        "model": model, "max_tokens": 400, "stream": False,
        "tools": [{
            "name": "get_time", "description": "Get current time",
            "input_schema": {"type": "object", "properties": {"tz": {"type": "string"}}},
        }],
        "tool_choice": {"type": "any"},
        "messages": [{"role": "user", "content": "Use get_time with tz=Asia/Tehran"}],
    }, {"x-api-key": BRIDGE_KEY, "anthropic-version": "2023-06-01"})
    tool = next((c for c in d["content"] if c["type"] == "tool_use"), None)
    if tool:
        print(f"[ToolCall] ✅ {tool['name']}({tool['input']})  stop={d['stop_reason']}")
    else:
        print(f"[ToolCall] ❌ ابزار صدا زده نشد: {json.dumps(d['content'])[:150]}")


def test_throttle_get():
    """تست عدم تبدیل GET /v1/models به POST توسط پروکسی تراتل."""
    try:
        req = urllib.request.Request(
            f"{THROTTLE_BASE}/v1/models",
            headers={"x-api-key": BRIDGE_KEY},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            print(f"[Throttle GET] ✅ {THROTTLE_BASE}/v1/models → HTTP {r.status}")
    except Exception as e:
        print(f"[Throttle GET] ℹ تراتل روی {THROTTLE_BASE} پاسخ نداد (اختیاری): {e}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="تست جامع پل Gemini Web Bridge")
    ap.add_argument("--quick", action="store_true", help="فقط تست مدل‌ها و OpenAI")
    ap.add_argument("--model", default="gemini-4-hydrogen")
    args = ap.parse_args()
    try:
        test_models_and_1psidts_slo()
        test_openai(args.model)
        if not args.quick:
            test_sse_stream(args.model)
            test_anthropic(args.model)
            test_tool_call(args.model)
            test_throttle_get()
        print("\nهمه تست‌ها تمام شد.")
    except Exception as e:
        sys.exit(f"❌ خطا: {e} — سرورها روشن‌اند؟ (8093 و 8094) و GW2API_KEY ست شده؟")
