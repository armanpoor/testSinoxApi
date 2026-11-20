# Gemini Web Bridge Control Center — Autonomous Claude Code Runbook

When the user asks you to **"bring the project up"**, **"run the app"**, or **"fix any connection issue"** (e.g. «پروژه رو بیار بالا و اگه مشکلی هست خودت حلش کن»), act **autonomously** — execute the checks and repairs yourself instead of telling the user to run manual commands.

Only ask the user to interact manually when Google interactive sign-in (2FA / account password) is strictly required in a browser window, and even then, **launch the automated login browser for them** via the API.

---

## 1. Architecture & Ports

| Layer | Purpose | Default Port | Binary / Runtime |
|---|---|---|---|
| Control Center (Express + React UI) | Dashboard, APIs, Auto-Healer, Logs SSE | `http://127.0.0.1:3000` | `npm run dev` (`tsx server.ts`) |
| Async SSE Throttle Proxy | Anti-ban jitter, queue, soft-block guard | `http://127.0.0.1:8095` | Embedded in `server.ts` |
| Web Engine (`gemini-web2api-go`) | Talks to `gemini.google.com` via cookies | `http://127.0.0.1:8093` | `gemini-web-bridge/bin/gemini-web2api-go(.exe)` |
| Anthropic Bridge (`CLIProxyAPI`) | Translates Anthropic `/v1/messages` -> `:8093` | `http://127.0.0.1:8094` | `gemini-web-bridge/bin-cpa/cli-proxy-api(.exe)` |

---

## 2. Standard Autonomous Startup & Repair Procedure

Follow these steps in order whenever starting or repairing the stack:

1. **Ensure dependencies are installed**:
   ```bash
   [ -d node_modules ] || npm install
   ```
2. **Run the built-in Autonomous Auto-Healer**:
   ```bash
   npm run heal -- --json
   ```
   - This automatically starts the Control Center on `:3000` if stopped.
   - Calls `POST http://127.0.0.1:3000/api/control/auto-heal` which:
     - Syncs local admin tokens, bridge keys, and `config.yaml` keys.
     - Starts the embedded Throttle Proxy on `:8095` and clears blocking cooldowns.
     - Starts `gemini-web2api-go` (`:8093`) and `CLIProxyAPI` (`:8094`) if binaries exist.
     - Routes Throttle Proxy directly to `:8093` if `:8094` is absent while `:8093` is online.
     - Extracts Firefox cookies automatically if `:8093` has 0 healthy cookies.
     - Hardens Anti-Ban config (`per_ip_concurrent=1`, `per_ip_rpm=3`, `strict_model=true`, `temporary_chat=true`).
3. **Inspect remaining findings** (if exit code is `2`):
   Read the JSON `result.diagnosisAfter.findings` array and resolve each code autonomously:

   - **`MISSING_BINARIES`**:
     - On Windows, run the project's bootstrap scripts (`gemini-web-bridge/scripts/01-start-proxy.ps1` and `02-start-bridge.ps1` or `gemini-web-bridge/start-all.ps1`) to download/prepare `gemini-web2api-go.exe` and `cli-proxy-api.exe`.
     - On Linux/macOS, check `gemini-web-bridge/README.md` / `RESEARCH.md` for release binaries and place them in `gemini-web-bridge/bin/gemini-web2api-go` and `gemini-web-bridge/bin-cpa/cli-proxy-api` with `chmod +x`.
     - Re-run `npm run heal -- --json`.

   - **`ENGINE_OFFLINE` or `BRIDGE_OFFLINE`**:
     - Check live logs via `curl -s http://127.0.0.1:3000/api/control/logs`.
     - Start explicitly via `curl -X POST http://127.0.0.1:3000/api/control/process/engine/start` (and `bridge/start` if needed).
     - Verify port bindings (`lsof -i :8093` or `netstat -ano | findstr 8093`) and resolve port conflicts.

   - **`NO_ACTIVE_COOKIES`**:
     - First try zero-click Firefox extraction:
       ```bash
       curl -s -X POST http://127.0.0.1:3000/api/control/cookies/auto-firefox \
         -H "Content-Type: application/json" \
         -d '{"label":"firefox-pro","autoRegister":true}'
       ```
     - If Firefox has no logged-in Google session, trigger automated Chrome/Edge login capture so the user only needs to sign in once:
       ```bash
       curl -s -X POST http://127.0.0.1:3000/api/control/cookies/auto-login/start \
         -H "Content-Type: application/json" \
         -d '{"label":"gemini-pro-main","autoRegister":true}'
       ```
       Poll `GET http://127.0.0.1:3000/api/control/cookies/auto-login/status` until `status === "done"`.

   - **`AUTH_OR_KEY_MISMATCH`**:
     - Trigger `curl -s -X POST http://127.0.0.1:3000/api/control/smart-sync` to auto-discover/create active API keys and sync `gemini-web-bridge/bin-cpa/cfg/config.yaml`.

   - **`HTML_INSTEAD_OF_JSON`**:
     - Verify `GET http://127.0.0.1:3000/api/control/diagnose` returns valid JSON (not HTML from a stale dev server or external proxy).
     - Restart `npm run dev` if port `:3000` is serving another process.

4. **Mandatory End-to-End Verification Before Reporting Done**:
   - Confirm `GET http://127.0.0.1:3000/api/control/diagnose` reports `"healthy": true`.
   - Run a real non-streaming smoke test:
     ```bash
     curl -s -X POST http://127.0.0.1:3000/api/control/playground/chat \
       -H "Content-Type: application/json" \
       -d '{"model":"gemini-4-hydrogen","stream":false,"useThrottle":true,"messages":[{"role":"user","content":"Reply with OK"}]}'
     ```
   - Confirm a valid JSON completion is returned, then report status concisely to the user.
