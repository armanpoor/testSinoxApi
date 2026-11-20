# -*- coding: utf-8 -*-
"""
تست سریع پل — هم فرمت OpenAI و هم فرمت Anthropic.

استفاده:
  python scripts/04-test-api.py                # همه تست‌ها
  python scripts/04-test-api.py --quick        # فقط یک درخواست ساده
"""
import json
import urllib.request
import sys

OPENAI_BASE = "http://localhost:8093/v1"
ANTHROPIC_BASE = "http://localhost:8094"
GW2API_KEY = "sk-gemini-REPLACE-ME"      # از پنل ادمین 8093
BRIDGE_KEY = "local-client-key-1"         # کلید access در config پل


def post(url, body, headers, timeout=180):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def test_openai(model="gemini-4-hydrogen"):
    d = post(f"{OPENAI_BASE}/chat/completions", {
        "model": model, "stream": False,
        "messages": [{"role": "user", "content": "فقط بنویس: تست-موفق"}],
    }, {"Authorization": f"Bearer {GW2API_KEY}"})
    print(f"[OpenAI] {model} → {d['choices'][0]['message']['content'][:80]}")


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


if __name__ == "__main__":
    quick = "--quick" in sys.argv
    try:
        test_openai()
        if not quick:
            test_anthropic()
            test_tool_call()
        print("\nهمه تست‌ها تمام شد.")
    except Exception as e:
        sys.exit(f"❌ خطا: {e} — سرورها روشن‌اند؟ (8093 و 8094)")
