# Architecture (Technical Notes)

> The Persian README is the main documentation. This file is a compact English summary for developers.

## Stack

| Layer | Component | Port | Role |
|---|---|---|---|
| 3 | [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) v8.0.79 | 8094 | Anthropic `/v1/messages` ↔ OpenAI translation |
| 2 | [zexadev/gemini-web2api-go](https://github.com/zexadev/gemini-web2api-go) v4.31.0 | 8093 | Gemini web protocol engine, Chrome 146 TLS impersonation (uTLS), cookie pool with auto-rotation, per-IP rate limits, SQLite store |
| 1 | Real Chrome (disposable) | 9333 (CDP) | One-time login only; cookies extracted via CDP `Network.getCookies`, browser closed immediately after |

## Request flow

```
client → :8094/v1/messages (Anthropic)
       → translated to OpenAI /v1/chat/completions
       → :8093 → Gemini web batchexecute/WebChannel
       → wrb.fr frames → prefix-diff streaming → SSE
```

## Key design decisions

1. **Browserless inference.** The browser is used once for login. All subsequent traffic
   goes through the Go engine with a Chrome 146 JA3/JA4 + HTTP/2 SETTINGS fingerprint,
   avoiding CDP protocol leaks (`Runtime.enable`, etc.) and 200–500 MB of browser RAM.
2. **Single-writer cookie rotation.** Only the proxy rotates `__Secure-1PSIDTS`/`SIDCC`.
   The disposable login browser is killed immediately after cookie extraction to avoid
   rotation races that kill sessions within minutes.
3. **Dual protocol surface.** `/v1/chat/completions` (OpenAI) and `/v1/messages` (Anthropic)
   both served; tool calling is prompt-emulated (fenced ` ```tool_call``` ` blocks) with a
   streaming fence-buffer that holds tool blocks until complete.
4. **Model discovery** via `batchexecute?rpcids=otAQ7b`; model ids follow the web selector.
   As of 2026-11: 4 Hydrogen (free+paid), 4 Neon (ex 3.1 Pro), 4 Carbon (ex 4 Argon) (paid).
5. **Failure handling.** 402/1016 → cookie dead (quarantine, no retry); 429 → quota
   cooldown; 109x → Pro access missing (strict model error, no silent downgrade);
   card_content frames → filtered, clean stream close.

## Verified test results (2026-11-20, Windows 11, Google AI Pro account)

- Anonymous mode: works (3.5 Flash-Lite), 10/10 requests OK.
- Cookie via CDP clone: 9 cookies extracted, pool import OK.
- gemini-4-hydrogen: 200 OK (22 s). gemini-4-neon: 200 OK (9 s).
- gemini-4-carbon: 502 "no content frame" (2/2 attempts) — under investigation.
- hydrogen-thinking: `reasoning_content` separated. ✔
- Tool calls: OpenAI `tool_calls` ✔, Anthropic `tool_use` block ✔,
  Anthropic streaming `input_json_delta` ✔ (with `tool_choice` set).
- Anthropic SSE streaming end-to-end through CLIProxyAPI ✔.

## Safety rules (anti-ban)

- Secondary Google account only; residential IP; concurrency 1–2; ~2–3 RPM on Pro models;
  no open gemini.google.com tab while the proxy runs; back off on errors (no instant retries).
- Chrome ≥ recent versions bind `__Secure-1PSIDTS` via DBSC; prefer Firefox for cookie
  export, or incognito Chrome + immediate extraction + immediate close.

## Disclaimer

Unofficial use of the Gemini web app may violate Google ToS. Use a secondary account; the
user bears all risk.
