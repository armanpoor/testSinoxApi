import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import crypto from 'node:crypto';
import { parseCookieInput, WANTED_SET } from '../src/lib/cookieParser';
import { shouldTriggerSelfHeal, type AutoSyncEvent } from '../src/lib/smartSync';
import type {
  AutoLoginState,
  CookieAccount,
  FirefoxProfileInfo,
  LayerStatus,
  LocalEnvironmentInfo,
  WatchdogRunRecord,
} from '../src/lib/types';
import { adminClient } from './adminClient';
import { emitLog } from './logHub';
import { store } from './store';
import { throttleProxy } from './throttleProxy';

const execFileAsync = promisify(execFile);
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
  private autoLoginState: AutoLoginState = { status: 'idle', message: '' };
  private autoLoginProc: ChildProcess | null = null;
  private autoLoginCancelled = false;
  private autoSyncEvents: AutoSyncEvent[] = [];
  private lastSelfHealAt = 0;
  private lastSmartSyncAt = 0;
  private smartSyncRunning = false;

  constructor() {
    this.syncWatchdogSchedule();
    throttleProxy.setSelfHealCallback((reason) => {
      void this.triggerReactiveSelfHeal(reason);
    });
    // Run an initial silent smart-sync pass shortly after startup
    setTimeout(() => {
      void this.runSmartAutoSync('startup');
    }, 1200);
  }

  private pushAutoSyncEvent(ev: Omit<AutoSyncEvent, 'ts'>): void {
    this.autoSyncEvents.unshift({ ts: Date.now(), ...ev });
    if (this.autoSyncEvents.length > 25) this.autoSyncEvents.length = 25;
    emitLog(ev.ok ? 'info' : 'warn', 'sync', ev.detail, ev.kind);
  }

  getAutoSyncState() {
    return {
      running: this.smartSyncRunning,
      lastSyncAt: this.lastSmartSyncAt,
      lastSelfHealAt: this.lastSelfHealAt,
      events: [...this.autoSyncEvents],
    };
  }

  async triggerReactiveSelfHeal(reason: string): Promise<void> {
    const now = Date.now();
    if (!shouldTriggerSelfHeal(this.lastSelfHealAt, now, 90_000)) return;
    this.lastSelfHealAt = now;
    await this.runSmartAutoSync(`reactive:${reason}`);
  }

  /**
   * Smart Zero-Config Sync:
   * 1) Discovers local config.yaml / scripts credentials automatically
   * 2) Auto-links local Firefox profile if no watchdog source exists yet
   * 3) Auto-authenticates admin token & auto-discovers/creates active API key on :8093
   * 4) Self-heals unhealthy cookies (rotate -> atomic verify-before-delete refresh)
   */
  async runSmartAutoSync(reason = 'manual'): Promise<{ ok: boolean; syncedCount: number; events: AutoSyncEvent[] }> {
    if (this.smartSyncRunning) {
      return { ok: true, syncedCount: 0, events: [...this.autoSyncEvents] };
    }
    this.smartSyncRunning = true;
    let syncedCount = 0;

    try {
      // 1. Local file discovery
      const disc = store.discoverLocalFiles();
      if (disc.discoveredAdminToken) {
        syncedCount++;
        this.pushAutoSyncEvent({ kind: 'token', ok: true, detail: 'توکن ادمین از اسکریپت محلی خودکار کشف و همگام شد' });
      }
      if (disc.discoveredBridgeKey) {
        syncedCount++;
        this.pushAutoSyncEvent({ kind: 'bridge-key', ok: true, detail: 'کلید پل Anthropic از config.yaml خودکار همگام شد' });
      }

      // 2. Auto-register detected Firefox profile for self-healing if none exist
      if (store.getWatchdogSources().length === 0) {
        const ffProfiles = this.detectFirefoxProfiles();
        if (ffProfiles.length > 0) {
          store.upsertWatchdogSource({
            label: 'firefox-pro',
            browserType: 'firefox',
            profileDir: ffProfiles[0].path,
            profileName: ffProfiles[0].name,
            authuser: 0,
            note: 'auto-discovered',
          });
          syncedCount++;
          this.pushAutoSyncEvent({
            kind: 'cookie-refresh',
            ok: true,
            detail: `پروفایل فایرفاکس (${ffProfiles[0].name}) به‌صورت خودکار به نگهبان متصل شد`,
          });
        }
      }

      // 3. Auto-discover working admin token + active API key on :8093
      const loginRes = await adminClient.login();
      if (loginRes.ok) {
        const keySync = await adminClient.autoSyncApiKey();
        if (keySync.synced) {
          syncedCount++;
          this.pushAutoSyncEvent({
            kind: 'api-key',
            ok: true,
            detail: keySync.created
              ? 'کلید API جدید روی موتور وب خودکار ساخته و همگام شد'
              : 'کلید API فعال موتور وب خودکار کشف و همگام شد',
          });
        }

        // 4. Reactive cookie self-healing when triggered by errors or manual sync
        if (reason.startsWith('reactive:') || reason === 'manual') {
          const wd = await this.runAtomicWatchdogCycle();
          if (wd.ok) {
            const healed = wd.results.filter((r) => r.action === 'refreshed').length;
            if (healed > 0) {
              syncedCount += healed;
              this.pushAutoSyncEvent({
                kind: 'cookie-refresh',
                ok: true,
                detail: `${healed} اکانت منقضی به‌صورت اتمیک و خودکار تازه‌سازی شد`,
              });
            }
          }
        }
      }

      this.lastSmartSyncAt = Date.now();
      return { ok: true, syncedCount, events: [...this.autoSyncEvents] };
    } finally {
      this.smartSyncRunning = false;
    }
  }

  getAutoLoginState(): AutoLoginState {
    return { ...this.autoLoginState };
  }

  detectChromeBinary(): string | null {
    const candidates: string[] = [];
    if (process.platform === 'win32') {
      const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
      const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const local = process.env['LOCALAPPDATA'] || '';
      candidates.push(
        path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pfx, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pfx, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
      );
    } else if (process.platform === 'darwin') {
      candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/Applications/Chromium.app/Contents/MacOS/Chromium'
      );
    } else {
      candidates.push(
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
        '/usr/bin/brave-browser'
      );
    }
    return candidates.find((p) => p && fs.existsSync(p)) || null;
  }

  detectFirefoxProfiles(): FirefoxProfileInfo[] {
    const roots: string[] = [];
    const home = os.homedir();
    if (process.platform === 'win32') {
      const appData = process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming');
      roots.push(path.join(appData, 'Mozilla', 'Firefox', 'Profiles'));
    } else if (process.platform === 'darwin') {
      roots.push(path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles'));
    } else {
      roots.push(
        path.join(home, '.mozilla', 'firefox'),
        path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox')
      );
    }

    const found: FirefoxProfileInfo[] = [];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      try {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const fullPath = path.join(root, entry.name);
          const dbPath = path.join(fullPath, 'cookies.sqlite');
          if (fs.existsSync(dbPath)) {
            found.push({ name: entry.name, path: fullPath, hasCookiesDb: true });
          }
        }
      } catch {
        // ignore unreadable dir
      }
    }
    // Prefer default-release profile first
    found.sort((a, b) => Number(b.name.includes('default-release')) - Number(a.name.includes('default-release')));
    return found;
  }

  private resolvePythonCommand(): string | null {
    const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
    for (const cmd of candidates) {
      const pathDirs = (process.env.PATH || '').split(path.delimiter);
      for (const dir of pathDirs) {
        const full = path.join(dir, process.platform === 'win32' ? `${cmd}.exe` : cmd);
        if (fs.existsSync(full)) return cmd;
      }
    }
    return null;
  }

  detectLocalEnvironment(): LocalEnvironmentInfo {
    const isWin = process.platform === 'win32';
    const engineBin = path.join(BRIDGE_DIR, 'bin', isWin ? 'gemini-web2api-go.exe' : 'gemini-web2api-go');
    const bridgeBin = path.join(BRIDGE_DIR, 'bin-cpa', isWin ? 'cli-proxy-api.exe' : 'cli-proxy-api');
    return {
      platform: process.platform,
      hasEngineBinary: fs.existsSync(engineBin),
      hasBridgeBinary: fs.existsSync(bridgeBin),
      detectedChromePath: this.detectChromeBinary(),
      firefoxProfiles: this.detectFirefoxProfiles(),
      pythonCommand: this.resolvePythonCommand(),
    };
  }

  async extractFromLocalFirefox(profileDir?: string): Promise<{
    ok: boolean;
    cookieHeader?: string;
    foundCount?: number;
    has1psidts?: boolean;
    profileUsed?: string;
    warnings?: string[];
    error?: string;
  }> {
    const py = this.resolvePythonCommand();
    if (!py) {
      return { ok: false, error: 'پایتون روی این سیستم یافت نشد؛ برای خواندن خودکار cookies.sqlite فایرفاکس نیاز به Python 3 است.' };
    }

    const profiles = profileDir
      ? [{ name: path.basename(profileDir), path: profileDir, hasCookiesDb: fs.existsSync(path.join(profileDir, 'cookies.sqlite')) }]
      : this.detectFirefoxProfiles();

    const candidates = profiles.filter((p) => p.hasCookiesDb);
    if (candidates.length === 0) {
      return {
        ok: false,
        error: 'پروفایل فایرفاکس محلی (cookies.sqlite) روی این ماشین پیدا نشد. اگر در پیش‌نمایش ابری هستید، باید پروژه را روی سیستم خودتان اجرا کنید.',
      };
    }

    const scriptsDir = path.join(BRIDGE_DIR, 'scripts');
    const inlinePy = `
import json, sys
sys.path.insert(0, sys.argv[1])
from bridge_lib import extract_firefox_sqlite, format_cookie_header
cookies = extract_firefox_sqlite(sys.argv[2])
print(json.dumps({"cookies": cookies, "header": format_cookie_header(cookies)}))
`;

    let lastError = 'کوکی لاگین گوگل (__Secure-1PSID) در پروفایل‌های فایرفاکس پیدا نشد. ابتدا در فایرفاکس به gemini.google.com وارد شوید.';
    for (const prof of candidates) {
      try {
        const { stdout } = await execFileAsync(py, ['-c', inlinePy, scriptsDir, prof.path], {
          timeout: 10_000,
        });
        const data = JSON.parse(stdout.trim()) as { cookies?: Record<string, string>; header?: string };
        const parsed = parseCookieInput(data.header || '');
        if (parsed.valid) {
          return {
            ok: true,
            cookieHeader: parsed.cookieHeader,
            foundCount: parsed.foundCount,
            has1psidts: parsed.has1PSIDTS,
            profileUsed: prof.path,
            warnings: parsed.warnings,
          };
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return { ok: false, error: lastError };
  }

  cancelAutoBrowserLogin(): { ok: boolean } {
    this.autoLoginCancelled = true;
    if (this.autoLoginProc && !this.autoLoginProc.killed) {
      try {
        this.autoLoginProc.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    this.autoLoginProc = null;
    this.autoLoginState = { status: 'idle', message: 'فرآیند اتصال خودکار لغو شد.' };
    return { ok: true };
  }

  async startAutoBrowserLogin(opts: {
    label?: string;
    authuser?: number;
    autoRegister?: boolean;
  }): Promise<{ ok: boolean; state: AutoLoginState }> {
    if (['launching', 'waiting_login', 'extracting', 'registering'].includes(this.autoLoginState.status)) {
      return { ok: true, state: this.getAutoLoginState() };
    }

    const chromePath = this.detectChromeBinary();
    if (!chromePath) {
      this.autoLoginState = {
        status: 'error',
        message: 'مرورگر Chrome/Edge/Brave روی این ماشین یافت نشد. برای استخراج خودکار باید برنامه را روی سیستم شخصی خودتان اجرا کنید.',
      };
      return { ok: false, state: this.getAutoLoginState() };
    }

    const port = store.getSettings().cdpPort || 9333;
    const label = (opts.label || `gemini-pro-${Math.floor(Date.now() / 1000) % 1000}`).trim();
    const authuser = Number(opts.authuser || 0);
    const autoRegister = opts.autoRegister !== false;
    const tempProfile = path.join(os.tmpdir(), `gemini-web-bridge-login-${Date.now()}`);

    this.autoLoginCancelled = false;
    this.autoLoginState = {
      status: 'launching',
      message: 'در حال باز کردن پنجره مرورگر ایزوله روی gemini.google.com...',
      startedAt: Date.now(),
      label,
    };

    try {
      const proc = spawn(
        chromePath,
        [
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${tempProfile}`,
          '--no-first-run',
          '--no-default-browser-check',
          'https://gemini.google.com/app',
        ],
        { stdio: 'ignore', detached: false }
      );
      this.autoLoginProc = proc;

      proc.on('exit', () => {
        if (this.autoLoginProc === proc) {
          this.autoLoginProc = null;
        }
      });

      // Run async watcher without blocking HTTP response
      void this.pollAndCompleteAutoLogin({ proc, port, label, authuser, autoRegister, tempProfile });
      return { ok: true, state: this.getAutoLoginState() };
    } catch (err) {
      this.autoLoginState = {
        status: 'error',
        message: `خطا در باز کردن مرورگر: ${err instanceof Error ? err.message : String(err)}`,
      };
      return { ok: false, state: this.getAutoLoginState() };
    }
  }

  private async pollAndCompleteAutoLogin(ctx: {
    proc: ChildProcess;
    port: number;
    label: string;
    authuser: number;
    autoRegister: boolean;
    tempProfile: string;
  }): Promise<void> {
    const deadline = Date.now() + 180_000; // 3 minutes for user to sign in
    let seen1PsidAt = 0;

    this.autoLoginState = {
      status: 'waiting_login',
      message: 'مرورگر باز شد — در پنجره بازشده وارد اکانت Google Gemini Pro خود شوید. به محض تکمیل ورود، کوکی‌ها خودکار استخراج و مرورگر بسته می‌شود.',
      startedAt: Date.now(),
      label: ctx.label,
    };

    const cleanupBrowser = () => {
      try {
        if (!ctx.proc.killed) ctx.proc.kill('SIGTERM');
      } catch {
        // ignore
      }
      if (this.autoLoginProc === ctx.proc) this.autoLoginProc = null;
      setTimeout(() => {
        try {
          fs.rmSync(ctx.tempProfile, { recursive: true, force: true });
        } catch {
          // ignore cleanup lock
        }
      }, 2500);
    };

    try {
      while (Date.now() < deadline) {
        if (this.autoLoginCancelled) return;
        if (ctx.proc.exitCode !== null) {
          this.autoLoginState = {
            status: 'error',
            message: 'پنجره مرورگر پیش از تکمیل ورود به جمنای بسته شد.',
          };
          return;
        }

        await new Promise((r) => setTimeout(r, 2000));
        if (this.autoLoginCancelled) return;

        const extracted = await this.extractFromLocalChromeCDP(ctx.port);
        if (!extracted.ok || !extracted.cookieHeader) continue;

        const parsed = parseCookieInput(extracted.cookieHeader);
        if (!parsed.valid) continue;

        // Wait up to 8s after __Secure-1PSID appears so __Secure-1PSIDTS also lands cleanly
        if (!parsed.has1PSIDTS) {
          if (!seen1PsidAt) seen1PsidAt = Date.now();
          if (Date.now() - seen1PsidAt < 8000) continue;
        }

        this.autoLoginState = {
          status: 'extracting',
          message: `${parsed.foundCount} کوکی با موفقیت استخراج شد؛ در حال بستن امن مرورگر...`,
          label: ctx.label,
          foundCount: parsed.foundCount,
          has1psidts: parsed.has1PSIDTS,
          cookieHeader: parsed.cookieHeader,
        };

        // Immediately close browser so Chrome does not fight token rotation
        cleanupBrowser();

        if (ctx.autoRegister) {
          this.autoLoginState = {
            ...this.autoLoginState,
            status: 'registering',
            message: 'در حال ثبت خودکار سشن در موتور gemini-web2api-go...',
          };
          const reg = await adminClient.request<{ id?: number }>('POST', '/admin/api/cookies', {
            label: ctx.label,
            cookie: parsed.cookieHeader,
            authuser: ctx.authuser,
            note: 'auto-browser-login',
          });
          if (reg.ok && reg.data?.id) {
            await adminClient.request('POST', `/admin/api/cookies/${reg.data.id}/check`);
            this.autoLoginState = {
              status: 'done',
              message: `اکانت «${ctx.label}» به‌صورت خودکار استخراج، ثبت و تأیید شد (${parsed.foundCount} کوکی). هارنس شما آماده اتصال است!`,
              label: ctx.label,
              foundCount: parsed.foundCount,
              has1psidts: parsed.has1PSIDTS,
              registeredId: reg.data.id,
              cookieHeader: parsed.cookieHeader,
            };
            return;
          }
        }

        this.autoLoginState = {
          status: 'done',
          message: `${parsed.foundCount} کوکی خودکار استخراج و مرورگر بسته شد (موتور 8093 آفلاین بود؛ به محض روشن شدن می‌توانید ذخیره کنید).`,
          label: ctx.label,
          foundCount: parsed.foundCount,
          has1psidts: parsed.has1PSIDTS,
          cookieHeader: parsed.cookieHeader,
        };
        return;
      }

      cleanupBrowser();
      this.autoLoginState = {
        status: 'error',
        message: 'مهلت ۳ دقیقه‌ای ورود به پایان رسید. دوباره تلاش کنید.',
      };
    } catch (err) {
      cleanupBrowser();
      this.autoLoginState = {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private pushWatchdogRecord(rec: WatchdogRunRecord): void {
    this.watchdogHistory.unshift(rec);
    if (this.watchdogHistory.length > 40) this.watchdogHistory.length = 40;
    const lvl = rec.action === 'error' ? 'error' : rec.action === 'disabled' || rec.action === 'no-source' ? 'warn' : 'info';
    emitLog(lvl, 'watchdog', `[${rec.label}] ${rec.detail}`, rec.action);
  }

  async runConnectivityProbe(): Promise<{ ok: boolean; layers: LayerStatus[] }> {
    const s = store.getSettings();
    emitLog('info', 'server', 'Running bridge connectivity diagnostics...', `engine=${s.gw2apiUrl} bridge=${s.bridgeUrl}`);
    const layers = await this.getStackStatus();
    for (const layer of layers) {
      const endpointClean = layer.id === 'watchdog' ? `every ${s.watchdogIntervalMin}m` : layer.endpoint;
      const metaParts: string[] = [];
      if (layer.latencyMs !== undefined) metaParts.push(`latency=${layer.latencyMs}ms`);
      if (layer.managedPid) metaParts.push(`pid=${layer.managedPid}`);
      if (layer.id === 'throttle') {
        const t = throttleProxy.getTelemetry();
        metaParts.push(`queue=${t.queueDepth}`, `forwarded=${t.totalForwarded}`, `softBlocks=${t.totalSoftBlocksDetected}`);
      }
      if (layer.id === 'watchdog') {
        metaParts.push(`autoRun=${s.watchdogAutoRun}`, `sources=${store.getWatchdogSources().length}`);
      }
      emitLog(
        layer.online ? 'info' : 'warn',
        layer.id,
        `${layer.id.toUpperCase()} ${layer.online ? 'ONLINE' : 'OFFLINE'} -> ${endpointClean}`,
        metaParts.join(' ') || undefined
      );
    }
    const env = this.detectLocalEnvironment();
    emitLog(
      'debug',
      'server',
      `Local environment scan (${env.platform})`,
      `engineBin=${env.hasEngineBinary} bridgeBin=${env.hasBridgeBinary} chrome=${Boolean(env.detectedChromePath)} firefoxProfiles=${env.firefoxProfiles.length}`
    );
    return { ok: true, layers };
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
      emitLog('error', target, `Binary not found at ${binPath}`);
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
    const append = (level: 'info' | 'warn') => (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').split(/\r?\n/).filter(Boolean);
      record.logs.push(...lines);
      if (record.logs.length > 80) record.logs.splice(0, record.logs.length - 80);
      for (const line of lines) {
        emitLog(level, target, line);
      }
    };
    proc.stdout?.on('data', append('info'));
    proc.stderr?.on('data', append('warn'));
    proc.on('exit', (code) => {
      this.procs.delete(target);
      emitLog(code === 0 ? 'info' : 'warn', target, `Process exited`, `code=${code ?? 'signal'}`);
    });

    this.procs.set(target, record);
    emitLog('info', target, `Started managed process ${exeName}`, `pid=${proc.pid}`);
    return { ok: true, message: `سرویس ${target} با شناسه ${proc.pid} آغاز شد.`, pid: proc.pid };
  }

  stopManagedBinary(target: 'engine' | 'bridge'): { ok: boolean; message: string } {
    const entry = this.procs.get(target);
    if (!entry) {
      return { ok: false, message: 'این سرویس توسط کنترل‌سنتر اجرا نشده است.' };
    }
    entry.proc.kill('SIGTERM');
    this.procs.delete(target);
    emitLog('warn', target, `Stopped managed ${target} process`);
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

        // Fast path: try in-engine cookie rotation first before launching browser extraction
        const rot = await adminClient.request('POST', `/admin/api/cookies/${acc.id}/rotate`);
        if (rot.ok) {
          const recheck = await adminClient.request<{ ok?: boolean }>(
            'POST',
            `/admin/api/cookies/${acc.id}/check`
          );
          if (recheck.ok && recheck.data?.ok) {
            const rec: WatchdogRunRecord = {
              ts: Date.now(),
              label: acc.label,
              action: 'refreshed',
              detail: `اکانت #${acc.id} با چرخش خودکار داخلی (/rotate) بدون نیاز به مرورگر احیا شد`,
            };
            this.pushAutoSyncEvent({
              kind: 'cookie-rotate',
              ok: true,
              detail: rec.detail,
            });
            results.push(rec);
            this.pushWatchdogRecord(rec);
            continue;
          }
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

        const extracted =
          src.browserType === 'firefox'
            ? await this.extractFromLocalFirefox(src.profileDir || undefined)
            : await this.extractFromLocalChromeCDP();
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
