import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import { parseCookieInput, WANTED_SET } from '../src/lib/cookieParser';
import type { CookieAccount, LayerStatus, WatchdogRunRecord } from '../src/lib/types';
import { adminClient } from './adminClient';
import { store } from './store';
import { throttleProxy } from './throttleProxy';

const BRIDGE_DIR = path.join(process.cwd(), 'gemini-web-bridge');

interface ManagedProc {
  proc: ChildProcess;
  startedAt: number;
  logs: string[];
}

class BridgeOrchestrator {
  private procs = new Map<'engine' | 'bridge', ManagedProc>();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogRunning = false;
  private watchdogHistory: WatchdogRunRecord[] = [];

  constructor() {
    this.syncWatchdogSchedule();
  }

  private pushWatchdogRecord(rec: WatchdogRunRecord): void {
    this.watchdogHistory.unshift(rec);
    if (this.watchdogHistory.length > 40) this.watchdogHistory.length = 40;
  }

  getWatchdogState() {
    const s = store.getSettings();
    return {
      autoRun: s.watchdogAutoRun,
      intervalMin: s.watchdogIntervalMin,
      runningNow: this.watchdogRunning,
      sources: store.getWatchdogSources(),
      history: [...this.watchdogHistory],
    };
  }

  syncWatchdogSchedule(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    const s = store.getSettings();
    if (s.watchdogAutoRun) {
      this.watchdogTimer = setInterval(() => {
        void this.runAtomicWatchdogCycle();
      }, s.watchdogIntervalMin * 60_000);
    }
  }

  async getStackStatus(): Promise<LayerStatus[]> {
    const s = store.getSettings();
    const [enginePing, bridgePing] = await Promise.all([
      adminClient.pingEndpoint(`${s.gw2apiUrl.replace(/\/+$/, '')}/v1/models`),
      adminClient.pingEndpoint(`${s.bridgeUrl.replace(/\/+$/, '')}/v1/models`),
    ]);
    const t = throttleProxy.getTelemetry();

    return [
      {
        id: 'engine',
        name: 'موتور وب (gemini-web2api-go)',
        endpoint: s.gw2apiUrl,
        online: enginePing.online,
        latencyMs: enginePing.latencyMs,
        detail: enginePing.online ? `متصل (${enginePing.detail})` : 'آفلاین — اسکریپت 01 یا دکمه اجرا را بزنید',
        managedPid: this.procs.get('engine')?.proc.pid ?? null,
      },
      {
        id: 'bridge',
        name: 'پل Anthropic (CLIProxyAPI)',
        endpoint: s.bridgeUrl,
        online: bridgePing.online,
        latencyMs: bridgePing.latencyMs,
        detail: bridgePing.online ? `متصل (${bridgePing.detail})` : 'آفلاین — فقط برای Claude Code لازم است',
        managedPid: this.procs.get('bridge')?.proc.pid ?? null,
      },
      {
        id: 'throttle',
        name: 'پروکسی تراتل استریم ضدبن',
        endpoint: `http://127.0.0.1:${t.port}`,
        online: t.running,
        detail: t.running
          ? `فعال · صف: ${t.queueDepth} · Soft-Block: ${t.totalSoftBlocksDetected}`
          : 'متوقف است',
        managedPid: process.pid,
      },
      {
        id: 'watchdog',
        name: 'نگهبان اتمیک کوکی',
        endpoint: `هر ${s.watchdogIntervalMin} دقیقه`,
        online: s.watchdogAutoRun,
        detail: s.watchdogAutoRun
          ? `زمان‌بندی خودکار فعال (${store.getWatchdogSources().length} منبع مرورگر)`
          : `حالت دستی (${store.getWatchdogSources().length} منبع مرورگر ثبت‌شده)`,
        managedPid: null,
      },
    ];
  }

  startManagedBinary(target: 'engine' | 'bridge'): { ok: boolean; message: string; pid?: number } {
    if (this.procs.has(target)) {
      return { ok: true, message: 'این سرویس همین حالا در حال اجراست.', pid: this.procs.get(target)?.proc.pid };
    }

    const s = store.getSettings();
    const isWin = process.platform === 'win32';
    const exeName = target === 'engine'
      ? isWin ? 'gemini-web2api-go.exe' : 'gemini-web2api-go'
      : isWin ? 'cli-proxy-api.exe' : 'cli-proxy-api';

    const binPath = target === 'engine'
      ? path.join(BRIDGE_DIR, 'bin', exeName)
      : path.join(BRIDGE_DIR, 'bin-cpa', exeName);

    if (!fs.existsSync(binPath)) {
      return {
        ok: false,
        message: `فایل اجرایی در مسیر ${binPath} یافت نشد. ابتدا روی سیستم خود اسکریپت 01/02 را برای دانلود باینری اجرا کنید.`,
      };
    }

    const args = target === 'engine'
      ? [
          '--port',
          new URL(s.gw2apiUrl).port || '8093',
          '--admin-token',
          s.adminToken,
          '--db',
          path.join(BRIDGE_DIR, 'bin', 'gemini.db'),
        ]
      : ['--config', path.join(BRIDGE_DIR, 'bin-cpa', 'cfg', 'config.yaml')];

    const proc = spawn(binPath, args, {
      cwd: target === 'engine' ? path.join(BRIDGE_DIR, 'bin') : path.join(BRIDGE_DIR, 'bin-cpa'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const record: ManagedProc = { proc, startedAt: Date.now(), logs: [] };
    const append = (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').split(/\r?\n/).filter(Boolean);
      record.logs.push(...lines);
      if (record.logs.length > 80) record.logs.splice(0, record.logs.length - 80);
    };
    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);
    proc.on('exit', () => {
      this.procs.delete(target);
    });

    this.procs.set(target, record);
    return { ok: true, message: `سرویس ${target} با شناسه ${proc.pid} آغاز شد.`, pid: proc.pid };
  }

  stopManagedBinary(target: 'engine' | 'bridge'): { ok: boolean; message: string } {
    const entry = this.procs.get(target);
    if (!entry) {
      return { ok: false, message: 'این سرویس توسط کنترل‌سنتر اجرا نشده است.' };
    }
    entry.proc.kill('SIGTERM');
    this.procs.delete(target);
    return { ok: true, message: `سرویس ${target} متوقف شد.` };
  }

  async extractFromLocalChromeCDP(cdpPort?: number): Promise<{
    ok: boolean;
    cookieHeader?: string;
    foundCount?: number;
    warnings?: string[];
    error?: string;
  }> {
    const port = cdpPort || store.getSettings().cdpPort || 9333;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tabs = (await res.json()) as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>;
      const pages = tabs.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      const target = pages.find((t) => (t.url || '').includes('gemini')) || pages[0];
      if (!target?.webSocketDebuggerUrl) {
        return {
          ok: false,
          error: `هیچ تب بازی روی پورت دیباگ ${port} پیدا نشد. کروم را با --remote-debugging-port=${port} باز کنید.`,
        };
      }

      const rawCookies = await this.cdpGetCookies(target.webSocketDebuggerUrl);
      const filtered: Record<string, string> = {};
      for (const c of rawCookies) {
        if (WANTED_SET.has(c.name) && !(c.name in filtered)) {
          filtered[c.name] = c.value;
        }
      }
      const header = Object.keys(filtered)
        .sort()
        .map((k) => `${k}=${filtered[k]}`)
        .join('; ');
      const parsed = parseCookieInput(header);
      if (!parsed.valid) {
        return { ok: false, error: parsed.errors.join(' ') };
      }
      return {
        ok: true,
        cookieHeader: parsed.cookieHeader,
        foundCount: parsed.foundCount,
        warnings: parsed.warnings,
      };
    } catch (err) {
      return {
        ok: false,
        error: `اتصال به Chrome CDP روی پورت ${port} ممکن نیست: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private cdpGetCookies(wsUrl: string): Promise<Array<{ name: string; value: string }>> {
    return new Promise((resolve, reject) => {
      const u = new URL(wsUrl);
      const socket = net.createConnection({ host: u.hostname, port: Number(u.port) || 80 });
      const key = crypto.randomBytes(16).toString('base64');
      let handshakeDone = false;
      let buf = Buffer.alloc(0);

      const sendFrame = (text: string) => {
        const data = Buffer.from(text, 'utf-8');
        const mask = crypto.randomBytes(4);
        const len = data.length;
        let header: Buffer;
        if (len < 126) {
          header = Buffer.from([0x81, 0x80 | len]);
        } else if (len < 65536) {
          header = Buffer.alloc(4);
          header[0] = 0x81;
          header[1] = 0x80 | 126;
          header.writeUInt16BE(len, 2);
        } else {
          header = Buffer.alloc(10);
          header[0] = 0x81;
          header[1] = 0x80 | 127;
          header.writeBigUInt64BE(BigInt(len), 2);
        }
        const masked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
        socket.write(Buffer.concat([header, mask, masked]));
      };

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('CDP WebSocket timeout'));
      }, 8000);

      socket.on('connect', () => {
        socket.write(
          `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        );
      });

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (!handshakeDone) {
          const endIdx = buf.indexOf('\r\n\r\n');
          if (endIdx < 0) return;
          handshakeDone = true;
          buf = buf.subarray(endIdx + 4);
          sendFrame(
            JSON.stringify({
              id: 1,
              method: 'Network.getCookies',
              params: {
                urls: ['https://gemini.google.com', 'https://google.com', 'https://accounts.google.com'],
              },
            })
          );
        }

        while (buf.length >= 2) {
          const opcode = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let offset = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            offset = 4;
          } else if (len === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2));
            offset = 10;
          }
          if (buf.length < offset + len) return;
          const payload = buf.subarray(offset, offset + len);
          buf = buf.subarray(offset + len);

          if (opcode === 0x08) {
            clearTimeout(timeout);
            socket.destroy();
            return;
          }
          if (opcode === 0x01) {
            try {
              const msg = JSON.parse(payload.toString('utf-8')) as {
                id?: number;
                result?: { cookies?: Array<{ name: string; value: string }> };
              };
              if (msg.id === 1) {
                clearTimeout(timeout);
                socket.destroy();
                resolve(msg.result?.cookies || []);
                return;
              }
            } catch {
              // ignore non-json frame
            }
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Safe Atomic Watchdog Cycle:
   * 1. Check each account via /admin/api/cookies/:id/check
   * 2. If dead AND has a configured source, extract fresh cookie
   * 3. Verify-Before-Delete: POST new record preserving authuser/note → /check new record
   * 4. Only DELETE old dead record if new record passed /check!
   */
  async runAtomicWatchdogCycle(): Promise<{ ok: boolean; results: WatchdogRunRecord[]; error?: string }> {
    if (this.watchdogRunning) {
      return { ok: false, results: [], error: 'یک چرخه نگهبان هم‌اکنون در حال اجراست.' };
    }
    this.watchdogRunning = true;
    const results: WatchdogRunRecord[] = [];

    try {
      const listRes = await adminClient.request<{ items?: CookieAccount[] }>('GET', '/admin/api/cookies');
      if (!listRes.ok) {
        return { ok: false, results, error: listRes.error };
      }
      const items = listRes.data?.items || [];
      const sourcesByLabel = new Map(store.getWatchdogSources().map((s) => [s.label, s]));

      for (const acc of items) {
        const chk = await adminClient.request<{ ok?: boolean; detail?: string }>(
          'POST',
          `/admin/api/cookies/${acc.id}/check`
        );
        if (chk.ok && chk.data?.ok) {
          const rec: WatchdogRunRecord = {
            ts: Date.now(),
            label: acc.label,
            action: 'ok',
            detail: `اکانت #${acc.id} سالم است`,
          };
          results.push(rec);
          this.pushWatchdogRecord(rec);
          continue;
        }

        const src = sourcesByLabel.get(acc.label);
        if (!src) {
          const rec: WatchdogRunRecord = {
            ts: Date.now(),
            label: acc.label,
            action: 'no-source',
            detail: `اکانت #${acc.id} منقضی شد و منبع مرورگری برای تازه‌سازی خودکار ثبت نشده است`,
          };
          results.push(rec);
          this.pushWatchdogRecord(rec);
          continue;
        }

        const extracted = await this.extractFromLocalChromeCDP();
        if (!extracted.ok || !extracted.cookieHeader) {
          await adminClient.request('PATCH', `/admin/api/cookies/${acc.id}`, { status: 'disabled' });
          const rec: WatchdogRunRecord = {
            ts: Date.now(),
            label: acc.label,
            action: 'disabled',
            detail: `تازه‌سازی ناموفق (${extracted.error || 'خطای استخراج'}) — اکانت #${acc.id} بدون حذف غیرفعال شد`,
          };
          results.push(rec);
          this.pushWatchdogRecord(rec);
          continue;
        }

        // Atomic step 1: Create replacement preserving authuser & note
        const created = await adminClient.request<{ id?: number }>('POST', '/admin/api/cookies', {
          label: acc.label,
          cookie: extracted.cookieHeader,
          authuser: acc.authuser ?? src.authuser ?? 0,
          note: acc.note || src.note || 'atomic-watchdog-refresh',
        });

        if (!created.ok || !created.data?.id) {
          const rec: WatchdogRunRecord = {
            ts: Date.now(),
            label: acc.label,
            action: 'error',
            detail: `ثبت کوکی جایگزین ناموفق بود؛ رکورد قبلی #${acc.id} دست‌نخورده باقی ماند`,
          };
          results.push(rec);
          this.pushWatchdogRecord(rec);
          continue;
        }

        // Atomic step 2: Verify replacement BEFORE deleting old record
        const verifyNew = await adminClient.request<{ ok?: boolean; detail?: string }>(
          'POST',
          `/admin/api/cookies/${created.data.id}/check`
        );

        if (verifyNew.ok && verifyNew.data?.ok) {
          await adminClient.request('DELETE', `/admin/api/cookies/${acc.id}`);
          const rec: WatchdogRunRecord = {
            ts: Date.now(),
            label: acc.label,
            action: 'refreshed',
            detail: `جایگزینی اتمیک موفق: رکورد #${created.data.id} تأیید شد و رکورد منقضی #${acc.id} حذف گردید`,
          };
          results.push(rec);
          this.pushWatchdogRecord(rec);
        } else {
          // Rollback new invalid record & disable old record safely
          await adminClient.request('DELETE', `/admin/api/cookies/${created.data.id}`);
          await adminClient.request('PATCH', `/admin/api/cookies/${acc.id}`, { status: 'disabled' });
          const rec: WatchdogRunRecord = {
            ts: Date.now(),
            label: acc.label,
            action: 'disabled',
            detail: `کوکی تازه تأیید نشد؛ رول‌بک انجام شد و اکانت #${acc.id} غیرفعال گردید`,
          };
          results.push(rec);
          this.pushWatchdogRecord(rec);
        }
      }

      return { ok: true, results };
    } finally {
      this.watchdogRunning = false;
    }
  }
}

export const orchestrator = new BridgeOrchestrator();
