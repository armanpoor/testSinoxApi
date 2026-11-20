# نتایج تحقیق عمیق — اکوسیستم Gemini Web → API

> تاریخ تحقیق: ۲۰ نوامبر ۲۰۲۶ · روش: جستجوی گیت‌هاب (gh search/api) + وب‌سرچ · آمار به تاریخ همان روز
>
> این سند نتیجه یک جستجوی نظام‌مند در ریپوها، Issuesها و یوتیوب است. برای تکرار/به‌روزرسانی این تحقیق، پرامپت آماده در [docs/copilot-deep-research-prompt.md](docs/copilot-deep-research-prompt.md) هست.
>
> بخش آخر («ایده‌های قابل استفاده») چک‌لیست عملی برای توسعه آینده این پل است.

---

# Deep-Dive Findings — Gemini Web → OpenAI/Anthropic-compatible API ecosystem

Date: 2026-11-20. Method: `gh search repos/code/issues` + `gh api` README/issue reads + websearch.py fallback. All stats are as of 2026-11-20.

---

## 1. GitHub repos (2025–2026, active)

### Known repos (re-checked, updated stats)

| Repo | Stars | Last push | What it is |
|---|---|---|---|
| Sophomoresty/gemini-web2api | 3,615 | 2026-08-14 | Python single-file, OpenAI-compatible, tool calling, `@think=N`, Responses API for Codex, native `/v1beta` for Gemini CLI. The reference implementation. |
| zexadev/gemini-web2api-go | 941 | 2026-11-19 | Go, our upstream. Chrome 146 TLS fingerprint, cookie pool w/ auto-renew, proxy pool, admin panel, native Gemini API + MCP, `/v1/videos`. |
| HanaokaYuzu/Gemini-API | 3,832 | 2026-11-16 | Python `gemini_webapi` library — the protocol core most Python projects sit on. `rotate_1psidts.py` utility. |
| yeahhe365/Gemini-Nexus | 1,129 | 2026-11-13 | Browser-extension AI assistant (Gemini Web + API + OpenAI-compatible), not a server bridge. |
| zhiyu1998/Gemi2Api-Server | (README re-checked) | — | FastAPI server over HanaokaYuzu lib; admin panel, Render/HF one-click deploy, auto-delete chat, custom models YAML. |
| n0madic/go-gemini-web2api | 7 | 2026-06-01 | Minimal Go proxy, stale. |
| dsdanielpark/Gemini-API | — | — | Not re-fetched (documented previously). |

### NEW repos discovered this sweep (not in our docs before)

1. **Mag1cFall/Gemini-Web2API** — Go, **137 stars**, pushed 2026-11-18. The most complete multi-protocol bridge: OpenAI (`/v1/chat/completions`, `/v1/completions`, `/v1/responses`, `/v1/files`, `/v1/audio/*`, `/v1/videos`), Claude (`/v1/messages` + Files API), Gemini native (`generateContent`, `streamGenerateContent`, `predictLongRunning`). Thinking levels mapped to web UI Low/Medium/High, model-name suffixes `(high)/(low)`, structured output (JSON Schema) across all four protocols, tool-calling bridged via prompt, **retry with account switch on unparseable tool call**, web dashboard with logs/usage/accounts/playground. **Most direct architectural competitor to gemini-web2api-go.**
   - `internal/gemini/rotate.go` — separate rotation module.
2. **jianli9158/cpa-plugin-gemini-web2api** — Go, 6 stars, pushed 2026-11-19. **Exact port of Mag1cFall/Gemini-Web2API as a CLIProxyAPI native plugin (C ABI v1 / Schema v10)**, compiled to `.dll`/`.so`/`.dylib`. Chrome 142–157 TLS/HTTP2 fingerprint market-share-weighted via `bogdanfinn/tls-client` + `Mag1cFall/fhttp`; guest session pool; multi-account round-robin/fill. **This is the plug-in path for CLIProxyAPI that our stack (separate process + OpenAI-compat glue) does NOT use — a big integration idea.**
3. **azrinaldi/gemini-stealth-bridge** — Go, **152 stars**, pushed 2026-11-18. Browserless Chrome uTLS + HTTP/2 daemon, `/v1/chat/completions` + `/v1/responses`, account pooling, quota-aware failover, MCP server built in, Web control plane. Its `internal/cookies/rotate.go` is the **reference dual-path rotation** implementation (see §2). Explicitly states transport "does not guarantee protection from detection."
4. **xwteam/gemini2api** — Python, **155 stars**, pushed 2026-10-27. FastAPI + `curl_cffi` Chrome TLS, OpenAI/Claude/Gemini 3-SDK compatible, v1.6.52. Pairs with **xwteam/gemini2api-plugin** (8 stars) — a Chrome MV3 extension that pushes freshly rotated cookies from a residential-IP browser to the datacenter-IP server (see §2/§5 — key anti-ban insight).
5. **Guardinary/web2gem** — JS, **182 stars**, pushed 2026-08-10. Single Cloudflare Worker or Docker; lightweight main edition (one runtime cookie, refreshed in memory) plus **`gemini-account-pool` branch**: D1-persistent multi-account pool + admin console on Workers. Deploy-to-edge pattern is novel.
6. **ikhsan3adi/gemini-web2api** — Go, 61 stars, pushed 2026-10-25. Go rewrite of Sophomoresty; **TLS impersonation for WAF bypass** via `tls-client`, Scotty resumable-upload for images with built-in compression, single static binary.
7. **QuinnTang74/gemini-web2api-manage** — Python, 39 stars, v3.1.0. Full web manage console (React 19), agent tool loop in the playground, `at`/XSRF auto-extract with retry, SOCKS5 via local HTTP bridge, stable data-dir persistence. Includes `tools/gemini-cookie-sync`.
8. **LymtIcsh/gemini-web2api-go** — Go, 11 stars, pushed 2026-11-03. Fork of zexadev adding **browser account pool: one Camoufox (stealth Firefox) profile per account**, web login + keepalive inside real pages, per-account 5-hour/weekly quota tracking with recovery times, sticky vs round-robin scheduling. Architecture: `Go API → Node + Camoufox → Gemini web`.
9. **autumnsentiment/gemini-web2api-go-browser-login** — 6 stars, pushed 2026-10-14. Another zexadev fork: **full browser-login cookie supply chain** — log in once in a browser, cookies auto-enter the pool and stay alive; no DevTools copy-paste; model validation after capture.
10. **BUKOWSKIREAL/magpie-gemini-web** — JS, **227 stars**, pushed 2026-11-19. Magpie plugin that auto-runs AIStudio2API + gemini-web2api-go locally as providers; packages `4.30.0-magpie.1` backend. Shows the "embed our bridge inside another product" distribution model.
11. **zhu748/gemini-web-api-gateway** — TypeScript, pushed 2026-11-16, 0 stars. OpenAI-compatible reverse proxy with cookie auth, SOCKS/HTTP proxy, streaming SSE, model aliasing, live dashboard.
12. **FarisHijazi/gemini-web-api** ("gemini-scraper") — Python, 9 stars, pushed 2026-10-19. **Dual-backend design**: `webapi` (batchexecute cookies) AND `chrome` (a Chrome extension drives a logged-in tab, server relays over WebSocket). `auto` mode prefers the extension when a tab is connected — "if the tab can chat, so can the API." Media bytes always fetched through the tab because Google 403s server-side downloads.
13. **yanstd888/9routerx** — Go, **255 stars**, pushed 2026-11-19. Go single-binary 9router rewrite ("9R Next Generation"), 155 providers, includes `internal/proxy/executor/gemini_web_rotate.go` — a port of azrinaldi's rotation with measured evidence (see §2/§5).
14. **FakeOAI/tokens** — Shell/Docker, **446 stars**, pushed 2026-11-19. Token/account-pool management platform that schedules many accounts across AI platforms and exposes OpenAI/Anthropic/Gemini-standard APIs. Generalizes the pool concept beyond Gemini.
15. **Godde3s/omnirouter** — Go, 26 stars. **Persian-documented** router ("یک روتر، همه‌ی مدل‌ها") with custom providers, fallback combos, Persian dashboard; `internal/gbridge/accounts.go` shows cookie-account handling. Culturally relevant (our project is also Persian-first).
16. **router-for-me/CLIProxyAPI** — **59,026 stars**, pushed 2026-11-19. Our host. **Issue #6706 (2026-11): built-in `gemini-app` provider added upstream** — cookie-backed Gemini App text chat through existing OpenAI/Claude/Gemini text APIs, `--gemini-app-import cookies.json`, concurrent cookie-rotation persistence with epoch guards (401/429 still cool the account; old requests can't clobber re-imports). **Google is moving gemini-web support in-tree — affects our positioning.**
17. **div197/BOB-Gemini-Free** — 3 stars. Desktop (macOS) dual-path gateway: default web-session RPC path + explicit opt-in Developer API path; `docs/engineering/GEMINI-API-ROUTING.md` is a careful written engineering doc of the two-path split.
18. **RealMDstar/ghostbrain** — 5 stars, Persian README. Multi-profile browser token pool with round-robin + failover. Niche/personal.
19. **router-for-me/EasyCLIProxyAPI** — Rust, **3,702 stars**. Desktop GUI for CLIProxyAPI + auto-configuring agents — relevant to our "beginner-friendly" positioning.
20. **seakee/CPA-Manager-Plus** — Go, **4,096 stars**. Self-hosted CLIProxyAPI management/observability panel (usage, cost, quota, account health). Relevant as a UX benchmark.
21. **kaitranntt/ccs** — TypeScript, **2,906 stars**. Account switcher over CLIProxyAPI OAuth proxy with dashboard.
22. **HasanMfar/whats-up-google** — Python, 1 star, Persian description. Local V2Ray-subscription scanner that tests Google Search/Gemini(web+API)/Antigravity access per config and exports passing tiers; includes "local bridge." Interesting Iran-context tooling (proxy tier probing before attaching accounts).
23. **alexgaoth/awesome-reverse-engineered** — curated list (CLIProxyAPI, sub2api, Wei-Shaw, etc.) — good discovery index.
24. **Wei-Shaw/sub2api** — 46,310 stars (from the awesome list): relay exposing Claude/OpenAI/Gemini/Grok **subscriptions** as unified APIs — the same "subscription → API" thesis at larger scale.
25. Minor/derivatives seen but not promising: one880808/gemini-web2api (CF-worker port, 112 stars), goehou/gemini-web2api-launcher (Windows CMD launcher, 34 stars), py7hon/gemini-web-api (Rust, `cookie_pool.rs`, 1 star), Yoyo-514/GemRelay, Rafix4x/gemini-api, steathy/WebAI, billythekidz/WebAI-to-API-Camofox (Camoufox auto-auth), Amm1rr/WebAI-to-API (older original), vibecoder11200/9router (5-star fork with `geminiWebCookiePool.js`, max pool size 5, 15-min health checks, round-robin, auto-disable dead cookies, all-dead alert — a compact JS reference pool).

---

## 2. Multi-account cookie pooling techniques

**azrinaldi/gemini-stealth-bridge `internal/cookies/rotate.go` (the best public reference, ported by 9routerx too):**
- Dual-path rotation in one flow:
  1. **Sentinel POST** `https://accounts.google.com/RotateCookies` with body `[000,"-0000000000000000000"]` — renews `__Secure-1PSIDTS` / `__Secure-3PSIDTS` (~20–30 min TTL). Payload **must be sent verbatim with leading zeros, never `json.Marshal`ed**.
  2. **Iframe GET** `accounts.google.com/RotateCookiesPage?og_pid=658&rot=3&origin=...&exp_id=0` → parse `init('id', ...)` via regex → **POST /RotateCookies** with `[658,"<id>"]` — renews `SIDCC` / `__Secure-1PSIDCC` / `__Secure-3PSIDCC`.
- Send the **full canonical cookie jar** in rotation calls so both SIDCC and 1PSIDTS rotate together.
- `min1PSIDTSInterval = 60s` per-account rate-limit guard; default rotate interval **9 minutes**; `ClampRotateInterval` clamps to [60s, 3600s].
- Each account runs its own **isolated StealthClient** (per-account transport/fingerprint) — i.e., proxy/fingerprint pinning at the transport level.
- 9routerx port adds measured evidence (2026-10-21): a header with only `__Secure-1PSID` → Flash-Lite only, **no quota reported**; adding `__Secure-1PSIDTS` → Flash/Pro/Argon + 5-hour and weekly windows. **Without rotation the session degrades to one model within minutes.**

**zexadev/gemini-web2api-go (our upstream) — DeepWiki 4.2 summary:**
- XSRF token `at` extracted from `gemini.google.com/app` HTML via regex on `"SNlM0e":"<token>:<timestamp>"`; also `Push-ID` (`qKIAYe`) and `X-Client-Pctx` (`Ylro7b`). Token is session-bound; anonymous requests don't need it.
- `mergeSetCookie` integrates `Set-Cookie` from rotation endpoints into the stored jar (update-or-add, rebuild full string).
- PR #82 (open, 2026-11): **multi API keys** (`api_keys`/`api_key_accounts` tables; per-key account whitelist; 403 for login-only models on anonymous keys) + **cookie-to-exclusive-proxy-IP binding** (`accounts.proxy_exclusive`): a pinned IP serves only its bound cookie; during IP circuit-break cooldown requests return 429 `proxy_cooling` **without falling back**; keepalive/health-checks still run through the pinned IP; exclusive proxies refuse deletion (409); proxy-URL dedup.
- Issue #46 (closed): `quota_aware_pick` — pick account by remaining quota instead of "least-recently-used" (default off).
- Issue #51 (closed): video-quota endpoint + **auto account switch when video quota exhausted**.
- Issue #61 (closed): distinguish `proxy_unavailable` (HTTP 502) from real rate-limit exhaustion (429) so debuggers don't chase wrong limits.
- Issue #58 (closed): **Argon via StreamGenerate fails while processSession/WebChannel works with the same cookies** — transport fallback matters per model.
- Issue #73 (closed): SIDCC keepalive failure modes.
- Issue #40 (closed): dynamically adapt browser headers/UA per Firefox/Zen profile.

**vibecoder11200/9router fork `geminiWebCookiePool.js` (compact JS pattern):** in-memory pool, cap 5, validate on add (structure check then real bootstrap requiring `SNlM0e`), dedup by `SAPISID`, 15-min health-check timer, round-robin index, auto-disable dead entries, evict invalid-oldest, all-dead alert flag. Simple, no persistence.

**9router (upstream, open) issue #5336:** "quarantine invalidated credentials for re-authentication" — quarantine-on-invalid as a first-class pool state.

**HanaokaYuzu/Gemini-API:** `src/gemini_webapi/utils/rotate_1psidts.py` — the original Python rotation helper everyone references.

**Patterns summary:** (a) per-account isolated transport (fingerprint+proxy pinning), (b) single-writer rotation per account with min-interval guard (mutex + `lastPSIDTSAt` map), (c) full-jar merge from `Set-Cookie`, (d) quarantine/dead states + health checks, (e) quota-aware selection, (f) exclusive IP binding to stop cross-account IP contamination, (g) out-of-band cookie supply from a real browser (extension or Camoufox profile) when server-side rotation is unreliable.

---

## 3. 9router / CLIProxyAPI custom-provider integration

**9router (decolua/9router, 32,645 stars, JS, 2,892 open issues):**
- Custom OpenAI-compatible providers are a core feature: dashboard form with Name / **Prefix** / API type (`chat`) / Base URL; 9router auto-reads `/v1/models` and exposes models as `prefix/model-id`. Community guide: paraloncloud.com/resources/9router-custom-openai-compatible-provider (worked example, 9router 0.5.99, 2026-10-12; install `npm i -g 9router`, dashboard at `:20128/dashboard`, bind `--host 127.0.0.1`, change default password `123456`).
- feb-frmn/9router-add-provider — workflow for adding custom providers **without a rebuild** (6 stars).
- Relevant open issues/PRs: #5763 "Custom Providers Dont Use Prefix" (prefix ignored at call time); #5490 (PR) "allow explicitly keyless compatible endpoints" (fixes #1523 — **our local bridge needs this: empty API key support**); #5731 custom outbound headers for compatible nodes; #4929 custom JSON API endpoints; #4177 newly added local custom-provider models missing from Combo selector; #3699 local-network scan for custom endpoints; #4999 quota check for compatible providers; #5721 **validation probe fails instantly on high-RTT links** (`autoSelectFamilyAttemptTimeout: 250` in `proxyFetch.js` aborts connects before handshake — relevant for our Iran/high-RTT users adding a local or remote provider); #5336 quarantine invalidated credentials.
- A **fork exists that already embeds a Gemini-web cookie pool inside 9router itself** (vibecoder11200/9router) — evidence of demand for native integration.
- Persian ecosystem: Godde3s/omnirouter (26 stars, Persian docs, fallback combos, custom providers) — directly comparable Persian-first router.

**CLIProxyAPI (router-for-me, 59,026 stars, Go):**
- Plugin system exists: C ABI v1 / Schema v10 native dynamic-library plugins (`jianli9158/cpa-plugin-gemini-web2api` is a working Gemini-web example with full protocol stack ported).
- **Upstream now ships a first-party cookie-backed `gemini-app` provider** (#6706, 2026-11, open PR): `--gemini-app-import cookies.json`, stable account names replacing expired credentials, epoch-guarded concurrent rotation, sanitized 502 errors, truncated-stream handling that avoids replay and credential penalties.
- History: gemini-web support was previously **removed** (#1665 complains nano-banana fast calls lost, hundreds/day vs Antigravity single digits) and `--gemini-web-auth` disappeared from a release (#5138), then is returning as `gemini-app`. #89 (closed) requested proactive cookie refresh; #55 implemented proactive PSIDTS rotation.
- #4489: xAI/Grok got opt-in SSO-cookie re-auth "like grok2api" — the cookie-web pattern is being generalized across providers.
- Observability ecosystem: seakee/CPA-Manager-Plus (4,096★), EasyCLIProxyAPI GUI (3,702★), kaitranntt/ccs (2,906★).

**Implication for our stack (gemini-web2api-go + CLIProxyAPI):** our current topology is a separate gemini-web2api-go process wired into CLIProxyAPI/9router as a custom OpenAI-compatible provider. The ecosystem shows two alternative topologies we don't have: (a) native CLIProxyAPI plugin (no extra port/process), (b) in-router cookie pool (no separate service at all). Our differentiators to keep: Persian-first docs, beginner path, and any features upstream lacks (strict_model is now in zexadev; proxy_exclusive is open PR #82).

---

## 4. YouTube

- **"Turn Gemini Web Into an API | Gemini_Web2API Setup & Demo"** — Anoop Tiwari, Sep 15 2026, ~1.5K views. https://www.youtube.com/watch?v=hR2jboYu-hg — setup + demo walkthrough of Sophomoresty/gemini-web2api (LangChain/MCP tags).
- **"Unlimited Agentic Coding for FREE ft. Gemini Web2API + Cline Setup"** — Zangineer, Aug 5 2026, ~1.4K views. https://www.youtube.com/watch?v=6ha_NX3K5o8 — wiring gemini-web2api into **Cline** for free agentic coding (exactly our use case).
- **"Gemini Web as an OpenAI API"** — https://www.youtube.com/watch?v=AWrggw2-Nz4 (title-only verified; channel/date: needs further review).
- **"Gemini Web2API — free OpenAI-compatible API for Gemini (no keys, no limits)"** — https://www.youtube.com/watch?v=Rhu2GKVBGng (needs further review).
- **"Complete 9Router Tutorial — Install + Connect Provider"** — https://www.youtube.com/watch?v=wtEy4QoWx2E (needs further review; evidence 9router tutorial content exists).
- **"I Set Up Gemini 3.6 for Free in My AI Coding Agent (Here's How)"** — https://www.youtube.com/watch?v=A8Doq_4h6ug (needs further review).
- Related, generic (official-API not web-cookie): "Use Claude Code for FREE with Google's Gemini API" (XB6RDNH1-Ew), "How to Use Gemini 4 Neon for FREE in Claude Code" (75xvIwvsO24), "Claude Code,Codex + FREE Opus, Gemini API" (sYtNcR9zXvk) — shows a large "free Claude Code via Gemini" audience our project targets; none of these cover cookie-based web bridging (gap = content opportunity).
- Video metadata (channel/views/date) beyond the two marked was hard to extract via r.jina.ai; marked accordingly.

---

## 5. Anti-ban engineering (2026 evidence)

- **zexadev/gemini-web2api-go #44 (2026-10-15, closed):** ALL anonymous requests (empty cookie pool) began returning 200-with-refusal text ("Sorry, something went wrong…" / "I'm having a hard time fulfilling your request…") across 3 servers, different exit IPs, both `chrome_146` and `firefox_147` impersonation. Protocol layer was healthy (valid conv id/response id in `wrb.fr`), i.e., **Google soft-blocked at content level, not via 4xx/429**. Self-recovered by 2026-10-18 with no changes → judged a **temporary upstream risk-control/gray-release wave**, not a project bug. Lesson: refusals-with-200 are a distinct failure class needing detection ("refusal-to-error" switch — PR #75 adds exactly that).
- **zexadev/gemini-web2api-go #61:** proxy pool circuit-breaker exhaustion was misreported as RPH 429; fixed to return 502 `proxy_unavailable` and keep real 429s typed. Debugging lesson for ban diagnosis.
- **zexadev/gemini-web2api-go PR #82 (open):** per-cookie **exclusive egress IP** — rationale is that mixing many cookies through few datacenter IPs is the contamination risk; exclusive binding + no-fallback + 429 `proxy_cooling` is the containment strategy.
- **xwteam/gemini2api-plugin (the key datacenter-IP insight):** Google **forces ~2-hour session expiry for logins from datacenter IPs**, while the same account's session survives much longer from a **residential IP**. The extension (a) pushes browser-rotated cookies to the server within ~10 s of `chrome.cookies.onChanged` (debounced, ≥60 s between pushes), (b) acts as a firefighter: polls `/admin/status`, and on `expired`/`is_healthy=false` refreshes the session in the local (residential) browser and submits fresh cookies. With gemini2api ≥ v1.6.44 the server **stops self-rotating extension-managed accounts** to avoid the two writers fighting — **single-writer lock, enforced socially via version gating**. Explicitly warns it doesn't 100% beat the 2-hour limit.
- **azrinaldi/gemini-stealth-bridge README:** explicit disclaimer that the browserless transport "does not guarantee protection from detection or account restrictions" — no public project claims safety.
- **google-gemini/gemini-cli discussion #20626→20632 (2026):** Google ran **Antigravity ToS ban waves specifically targeting "3rd party tools or proxies" accessing Antigravity resources/quotas**; backend-layer bans also blocked Gemini CLI and Gemini Code Assist; Google then did a system-wide automated unban + a new self-service reinstatement flow (email + Google Form recertification, auto-unban in 1–2 days). **Direct precedent that Google actively bans proxy usage on the CLI/Antigravity side; gemini.google.com web is adjacent and not documented as swept, but the enforcement pattern exists.**
- **9router #2964:** Antigravity 429/400 waves broke downstream clients (Hermes, Cline) — ban waves propagate into routers/agents.
- Not found: any public writeup of a **gemini.google.com web account suspension wave** specifically in 2026 (uncertain; searches surfaced Antigravity bans and generic r/Gemini ban threads instead). Marked as needing further review.

---

## ایده‌های قابل استفاده (ideas we can adopt)

1. **رینگ دوبل کوکی (dual-path rotation)**: POST سنتینلی `[000,"-0000000000000000000"]` برای 1PSIDTS + مسیر iframe/RotateCookiesPage برای SIDCC، با فاصله حداقل 60 ثانیه و ارسال کل جار کوکی — دقیقاً مثل azrinaldi/gemini-stealth-bridge.
2. **ترافیک‌سنج چندنویسنده (single-writer lock)**: وقتی کوکی از مرورگر/افزونه تازه می‌آید، سرور چرخش خودش را برای همان حساب متوقف کند تا دو نویسنده همدیگر را نابود نکنند (الگوی xwteam v1.6.44).
3. **IP اختصاصی برای هر کوکی با عدم fallback**: اتصال `proxy_exclusive` هر کوکی به یک IP خروجی و برگرداندن 429 `proxy_cooling` به‌جای سوییچ IP — آلودگی IP بین حساب‌ها را قطع می‌کند (PR #82).
4. **تشخیص «ردِ با کد 200»**: پاسخ‌های "I'm having a hard time…" را به خطا ترجمه کن و به‌عنوان سیگنال قرنطینه حساب ببین، نه موفقیت (الگوی issue #44 و PR #75).
5. **سوخت‌رسانی کوکی از مرورگر مسکونی**: افزونه‌ای که کوکی چرخیده را در ~10 ثانیه به سرور برساند و در حالت expired در مرورگر با IP مسکونی نجاتش دهد — دور زدن محدودیت 2 ساعته IP دیتاسنتر (xwteam/gemini2api-plugin).
6. **پلاگین بومی CLIProxyAPI**: پرت کردن پروتکل به‌صورت کتابخانه بومی C ABI v1 به‌جای پروسس جدا + OpenAI-compat — یک پورت کم‌ساتن و بدون پورت اضافه (jianli9158/cpa-plugin-gemini-web2api).
7. **fallback ترنسپورت برای مدل‌های خاص**: وقتی StreamGenerate برای یک مدل (مثل Argon) شکست خورد، مسیر processSession/WebChannel را امتحان کن (zexadev #58).
8. **انتخاب حساب آگاه از سهمیه (quota_aware_pick)**: به‌جای «کمتر استفاده‌شده»، حسابی را بده که سهمیه آزاد دارد؛ برای ویدیو هم سوییچ خودکار بعد از اتمام سهمیه (#46 و #51).
9. **حمایت از کلید خالی در 9router**: مطمئن شو بریج ما روی 9router با `apiKey=""` هم سالم اضافه می‌شود (issue #1523/#5490) و خطای probe پرسرعتِ 250ms (#5721) را در مستندات فارسی هشدار بده.
10. **سنجش SLO مرجع با معیار 9routerx**: ادعای «بدون 1PSIDTS فقط Flash-Lite و بدون سهمیه» را مستند و تست‌پذیر کن — تست رگرسیون که وجود سهمیه را بعد از چرخش تأیید کند (9routerx 2026-10-21).
11. **تماشای رقیب درون‌شده**: CLIProxyAPI دیگر `gemini-app` را درون خودش می‌آورد (#6706) — تمایز ما باید فارسی‌زبان/تازه‌کار-پسند ماندن، پنل فارسی و تجربه راه‌اندازی باشد، نه خود پروتکل.
