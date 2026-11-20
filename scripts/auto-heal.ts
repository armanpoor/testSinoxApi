#!/usr/bin/env tsx
/**
 * Autonomous Doctor & Self-Healer CLI for Gemini Web Bridge Control Center.
 * Designed for both local users and Claude Code (`npm run heal` / `npm run doctor`).
 *
 * Usage:
 *   npm run doctor          # Inspect health only (JSON with --json)
 *   npm run heal            # Actively repair stack via Control Center auto-heal API
 *   npm run heal -- --json  # Machine-readable JSON output for Claude Code
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CONTROL_URL = process.env.CONTROL_URL || 'http://127.0.0.1:3000';
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const jsonOut = args.has('--json');
const autoStartServer = args.has('--start-server') || !checkOnly;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function isServerAlive(): Promise<boolean> {
  try {
    const r = await fetch(`${CONTROL_URL}/api/control/status`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureControlServerRunning(): Promise<{ startedByScript: boolean; alive: boolean }> {
  if (await isServerAlive()) {
    return { startedByScript: false, alive: true };
  }
  if (!autoStartServer) {
    return { startedByScript: false, alive: false };
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCmd, ['run', 'dev'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  for (let i = 0; i < 25; i++) {
    await sleep(500);
    if (await isServerAlive()) {
      return { startedByScript: true, alive: true };
    }
  }
  return { startedByScript: true, alive: false };
}

async function main() {
  const srv = await ensureControlServerRunning();
  if (!srv.alive) {
    const out = {
      ok: false,
      error: `Control Center server is not reachable at ${CONTROL_URL}.`,
      hint: 'Start server with `npm run dev` and inspect port 3000.',
    };
    if (jsonOut) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.error(`[FAIL] ${out.error}`);
      console.error(`       Hint: ${out.hint}`);
    }
    process.exit(1);
  }

  const endpoint = checkOnly ? '/api/control/diagnose' : '/api/control/auto-heal';
  const r = await fetch(`${CONTROL_URL}${endpoint}`, {
    method: checkOnly ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: checkOnly ? undefined : JSON.stringify({ source: 'cli-auto-heal' }),
    signal: AbortSignal.timeout(30_000),
  });

  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = (await r.text()).slice(0, 200);
    console.error(`[FAIL] Expected JSON from ${endpoint}, got HTTP ${r.status} (${ct}): ${text}`);
    process.exit(1);
  }

  const payload = await r.json();
  const rootDir = process.cwd();
  const isWin = process.platform === 'win32';
  const binaryCheck = {
    engineBinaryPath: path.join(rootDir, 'gemini-web-bridge', 'bin', isWin ? 'gemini-web2api-go.exe' : 'gemini-web2api-go'),
    bridgeBinaryPath: path.join(rootDir, 'gemini-web-bridge', 'bin-cpa', isWin ? 'cli-proxy-api.exe' : 'cli-proxy-api'),
  };

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          controlUrl: CONTROL_URL,
          startedServer: srv.startedByScript,
          binariesOnDisk: {
            engine: fs.existsSync(binaryCheck.engineBinaryPath),
            bridge: fs.existsSync(binaryCheck.bridgeBinaryPath),
          },
          result: payload,
        },
        null,
        2
      )
    );
  } else {
    console.log(`\n=== Gemini Web Bridge ${checkOnly ? 'Doctor' : 'Auto-Heal'} (${CONTROL_URL}) ===`);
    if (srv.startedByScript) {
      console.log('[FIXED] Control Center dev server was offline — started automatically on :3000.');
    }
    if (!checkOnly && Array.isArray(payload.steps)) {
      console.log('\nAuto-Heal Steps Executed:');
      for (const s of payload.steps) {
        console.log(`  [${String(s.status).toUpperCase().padEnd(7)}] ${s.label} — ${s.detail} (${s.durationMs}ms)`);
      }
    }
    const diag = checkOnly ? payload : payload.diagnosisAfter;
    console.log(`\nOverall Healthy: ${diag?.healthy ? 'YES' : 'NO'} (env: ${diag?.environment})`);
    console.log(`Summary: ${diag?.summary}`);
    if (Array.isArray(diag?.findings) && diag.findings.length > 0) {
      console.log('\nRemaining Findings:');
      for (const f of diag.findings) {
        console.log(`  - [${f.code}] (${f.severity}) ${f.title}`);
        console.log(`    Claude/CLI Action: ${f.claudeHint}`);
      }
    }
  }

  const healthy = checkOnly ? Boolean(payload.healthy) : Boolean(payload.diagnosisAfter?.healthy);
  process.exit(healthy ? 0 : 2);
}

main().catch((err) => {
  console.error('[ERROR]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
