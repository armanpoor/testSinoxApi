import { ANTI_BAN_PRESET, evaluateAntiBanAudit } from '../src/lib/configGenerator';
import {
  diagnoseStackState,
  type AutoHealReport,
  type AutoHealStepResult,
  type DiagnosisReport,
} from '../src/lib/diagnostics';
import type { CookieAccount } from '../src/lib/types';
import { adminClient } from './adminClient';
import { emitLog } from './logHub';
import { orchestrator } from './orchestrator';
import { store } from './store';
import { throttleProxy } from './throttleProxy';

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForLayerOnline(layerId: 'engine' | 'bridge', timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const layers = await orchestrator.getStackStatus();
    if (layers.find((l) => l.id === layerId)?.online) return true;
    await sleep(600);
  }
  return false;
}

/**
 * Inspects the full live stack and returns a structured root-cause DiagnosisReport.
 */
export async function buildLiveDiagnosis(context?: {
  error?: string;
  source?: string;
}): Promise<DiagnosisReport> {
  const layers = await orchestrator.getStackStatus();
  const localEnv = orchestrator.detectLocalEnvironment();
  const settings = store.getSettings();
  const throttle = throttleProxy.getTelemetry();

  const engineOnline = Boolean(layers.find((l) => l.id === 'engine')?.online);
  let upstreamConfig: Record<string, unknown> | null = null;
  let healthyCookiesCount = 0;
  let totalCookiesCount = 0;

  if (engineOnline) {
    const [cfgRes, ckRes] = await Promise.all([
      adminClient.request<{ config?: Record<string, unknown> }>('GET', '/admin/api/config'),
      adminClient.request<{ items?: CookieAccount[] }>('GET', '/admin/api/cookies'),
    ]);
    if (cfgRes.ok && cfgRes.data) {
      upstreamConfig = cfgRes.data.config || null;
    }
    if (ckRes.ok && ckRes.data?.items) {
      totalCookiesCount = ckRes.data.items.length;
      healthyCookiesCount = ckRes.data.items.filter(
        (c) => c.status === 'enabled' && c.health !== 'dead'
      ).length;
    }
  }

  return diagnoseStackState({
    layers,
    localEnv,
    throttle,
    settings,
    upstream: {
      online: engineOnline,
      healthyCookiesCount,
      totalCookiesCount,
      antiBanAudit: evaluateAntiBanAudit(upstreamConfig),
    },
    contextError: context?.error,
    contextSource: context?.source,
  });
}

/**
 * Autonomous multi-step self-healing pipeline:
 * Actually starts stopped local binaries, syncs credentials, unblocks throttle proxy,
 * routes around missing bridge if engine is available, extracts Firefox cookies, and hardens anti-ban.
 */
export async function runAutonomousAutoHeal(context?: {
  error?: string;
  source?: string;
}): Promise<AutoHealReport> {
  emitLog('info', 'sync', 'Autonomous auto-heal pipeline started', context?.source || 'manual');
  const steps: AutoHealStepResult[] = [];
  let healedCount = 0;

  const pushStep = (step: AutoHealStepResult) => {
    steps.push(step);
    if (step.status === 'fixed') healedCount++;
    emitLog(
      step.status === 'failed' ? 'error' : step.status === 'blocked' ? 'warn' : 'info',
      'sync',
      `[Auto-Heal] ${step.label}: ${step.detail}`,
      `status=${step.status} ${step.durationMs}ms`
    );
  };

  // Step 1: Smart credential & file sync
  {
    const t0 = Date.now();
    try {
      const res = await orchestrator.runSmartAutoSync('auto-heal');
      pushStep({
        id: 'smart-sync',
        label: 'همگام‌سازی خودکار کلیدها و توکن‌ها',
        status: res.syncedCount > 0 ? 'fixed' : 'ok',
        detail:
          res.syncedCount > 0
            ? `${res.syncedCount} مورد کلید/توکن/پروفایل به‌صورت خودکار همگام‌سازی شد.`
            : 'تنظیمات محلی و کلیدها از قبل همگام بودند.',
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      pushStep({
        id: 'smart-sync',
        label: 'همگام‌سازی خودکار کلیدها و توکن‌ها',
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      });
    }
  }

  // Step 2: Ensure Throttle Proxy is running and clear blocking cooldowns
  {
    const t0 = Date.now();
    const s = store.getSettings();
    const tel = throttleProxy.getTelemetry();
    const hadCooldown = tel.activeCooldowns.length > 0;
    if (hadCooldown) {
      throttleProxy.clearCooldowns();
    }
    if (!s.throttleEnabled || !tel.running) {
      store.updateSettings({ throttleEnabled: true });
      const started = await throttleProxy.start();
      pushStep({
        id: 'throttle-proxy',
        label: `راه‌اندازی پروکسی تراتل استریم (:${s.throttlePort})`,
        status: started.started ? 'fixed' : 'failed',
        detail: started.started
          ? `پروکسی تراتل روی پورت ${started.port} فعال شد${hadCooldown ? ' و قفل Cooldown پاک شد' : ''}.`
          : `راه‌اندازی تراتل ناموفق بود: ${started.error || 'پورت اشغال است'}`,
        durationMs: Date.now() - t0,
      });
    } else if (hadCooldown) {
      pushStep({
        id: 'throttle-proxy',
        label: 'پاک‌سازی قفل Cooldown تراتل',
        status: 'fixed',
        detail: 'قفل موقت ضدبن پاک شد و پروکسی تراتل آماده عبور درخواست است.',
        durationMs: Date.now() - t0,
      });
    } else {
      pushStep({
        id: 'throttle-proxy',
        label: `بررسی پروکسی تراتل استریم (:${tel.port})`,
        status: 'ok',
        detail: `پروکسی تراتل روی پورت ${tel.port} فعال و بدون قفل است.`,
        durationMs: Date.now() - t0,
      });
    }
  }

  // Step 3: Ensure Engine (:8093) is online (auto-start if binary exists)
  const localEnv = orchestrator.detectLocalEnvironment();
  let layers = await orchestrator.getStackStatus();
  let engineOnline = Boolean(layers.find((l) => l.id === 'engine')?.online);

  {
    const t0 = Date.now();
    if (engineOnline) {
      pushStep({
        id: 'engine',
        label: 'بررسی موتور وب (gemini-web2api-go)',
        status: 'ok',
        detail: 'موتور وب روی پورت 8093 آنلاین و در دسترس است.',
        durationMs: Date.now() - t0,
      });
    } else if (localEnv.hasEngineBinary) {
      const startOut = orchestrator.startManagedBinary('engine');
      if (startOut.ok) {
        engineOnline = await waitForLayerOnline('engine', 5000);
        pushStep({
          id: 'engine',
          label: 'راه‌اندازی خودکار موتور وب (:8093)',
          status: engineOnline ? 'fixed' : 'failed',
          detail: engineOnline
            ? `موتور وب با موفقیت اجرا و متصل شد (PID ${startOut.pid ?? 'active'}).`
            : 'پروسس موتور اجرا شد اما ظرف ۵ ثانیه روی پورت 8093 پاسخ نداد — لاگ‌های زنده را بررسی کنید.',
          durationMs: Date.now() - t0,
        });
      } else {
        pushStep({
          id: 'engine',
          label: 'راه‌اندازی خودکار موتور وب (:8093)',
          status: 'failed',
          detail: startOut.message,
          durationMs: Date.now() - t0,
        });
      }
    } else {
      pushStep({
        id: 'engine',
        label: 'بررسی باینری موتور وب (:8093)',
        status: 'blocked',
        detail:
          'فایل اجرایی gemini-web2api-go روی این ماشین موجود نیست (احتمالاً در پیش‌نمایش ابری هستید یا باینری هنوز نصب نشده؛ Claude Code با دستور npm run heal می‌تواند آن را روی سیستم شخصی شما نصب و اجرا کند).',
        durationMs: Date.now() - t0,
      });
    }
  }

  // Step 4: Ensure Bridge (:8094) or smartly route throttle to Engine (:8093)
  layers = await orchestrator.getStackStatus();
  let bridgeOnline = Boolean(layers.find((l) => l.id === 'bridge')?.online);
  {
    const t0 = Date.now();
    const s = store.getSettings();
    if (s.throttleTarget === 'bridge' && !bridgeOnline) {
      if (localEnv.hasBridgeBinary) {
        const startOut = orchestrator.startManagedBinary('bridge');
        if (startOut.ok) {
          bridgeOnline = await waitForLayerOnline('bridge', 4000);
          pushStep({
            id: 'bridge',
            label: 'راه‌اندازی خودکار پل Anthropic (:8094)',
            status: bridgeOnline ? 'fixed' : 'failed',
            detail: bridgeOnline
              ? 'پل CLIProxyAPI روی پورت 8094 اجرا و متصل شد.'
              : 'پروسس پل اجرا شد اما روی پورت 8094 پاسخ نداد.',
            durationMs: Date.now() - t0,
          });
        } else {
          pushStep({
            id: 'bridge',
            label: 'راه‌اندازی خودکار پل Anthropic (:8094)',
            status: 'failed',
            detail: startOut.message,
            durationMs: Date.now() - t0,
          });
        }
      } else if (engineOnline) {
        store.updateSettings({ throttleTarget: 'engine' });
        pushStep({
          id: 'bridge-route',
          label: 'تغییر مسیر هوشمند تراتل به موتور مستقیم (:8093)',
          status: 'fixed',
          detail: 'چون پل 8094 نصب/روشن نبود اما موتور 8093 آنلاین است، مسیر تراتل خودکار به 8093 تغییر یافت.',
          durationMs: Date.now() - t0,
        });
      } else {
        pushStep({
          id: 'bridge',
          label: 'بررسی پل Anthropic (:8094)',
          status: 'skipped',
          detail: 'پل 8094 روی این سیستم نصب نیست (فقط برای Claude Code محلی لازم است).',
          durationMs: Date.now() - t0,
        });
      }
    } else {
      pushStep({
        id: 'bridge',
        label: 'بررسی مسیر مقصد تراتل',
        status: 'ok',
        detail:
          s.throttleTarget === 'engine'
            ? 'تراتل مستقیماً به موتور وب (:8093) متصل است.'
            : 'پل Anthropic (:8094) آنلاین و آماده است.',
        durationMs: Date.now() - t0,
      });
    }
  }

  // Step 5: If engine came online, sync API key + self-heal cookies + harden anti-ban
  if (engineOnline) {
    // 5a. Ensure admin auth & API key synced
    {
      const t0 = Date.now();
      const login = await adminClient.login();
      if (login.ok) {
        const keySync = await adminClient.autoSyncApiKey();
        pushStep({
          id: 'api-key-sync',
          label: 'احراز هویت و همگام‌سازی کلید API موتور',
          status: keySync.synced ? 'fixed' : 'ok',
          detail: keySync.synced
            ? keySync.created
              ? 'کلید API جدید ساخته شد و در تنظیمات و config.yaml همگام شد.'
              : 'کلید API فعال موتور کشف و همگام‌سازی شد.'
            : 'احراز هویت ادمین و کلید API موتور معتبر است.',
          durationMs: Date.now() - t0,
        });
      } else {
        pushStep({
          id: 'api-key-sync',
          label: 'احراز هویت ادمین موتور وب',
          status: 'failed',
          detail: login.error || 'ورود به پنل ادمین موتور 8093 ناموفق بود.',
          durationMs: Date.now() - t0,
        });
      }
    }

    // 5b. Cookie self-healing (watchdog -> local Firefox auto-extract)
    {
      const t0 = Date.now();
      const ckRes = await adminClient.request<{ items?: CookieAccount[] }>('GET', '/admin/api/cookies');
      const items = ckRes.ok && ckRes.data?.items ? ckRes.data.items : [];
      const healthyCount = items.filter((c) => c.status === 'enabled' && c.health !== 'dead').length;

      if (healthyCount > 0) {
        pushStep({
          id: 'cookies',
          label: 'بررسی استخر کوکی‌های جمنای',
          status: 'ok',
          detail: `${healthyCount} اکانت کوکی سالم در موتور فعال است.`,
          durationMs: Date.now() - t0,
        });
      } else {
        // Try atomic watchdog first
        const wd = await orchestrator.runAtomicWatchdogCycle();
        const wdRefreshed = wd.results.filter((r) => r.action === 'refreshed').length;
        if (wdRefreshed > 0) {
          pushStep({
            id: 'cookies',
            label: 'تازه‌سازی اتمیک کوکی‌ها توسط نگهبان',
            status: 'fixed',
            detail: `${wdRefreshed} کوکی منقضی به‌صورت خودکار بازیابی شد.`,
            durationMs: Date.now() - t0,
          });
        } else if (localEnv.firefoxProfiles.length > 0) {
          const ff = await orchestrator.extractFromLocalFirefox();
          if (ff.ok && ff.cookieHeader) {
            const reg = await adminClient.request<{ id?: number }>('POST', '/admin/api/cookies', {
              label: 'firefox-auto-heal',
              cookie: ff.cookieHeader,
              authuser: 0,
              note: 'auto-heal-firefox',
            });
            pushStep({
              id: 'cookies',
              label: 'استخراج و ثبت خودکار کوکی از فایرفاکس',
              status: reg.ok ? 'fixed' : 'failed',
              detail: reg.ok
                ? `${ff.foundCount} کوکی از فایرفاکس محلی خوانده و خودکار در موتور ثبت شد.`
                : reg.error || 'ثبت کوکی استخراج‌شده در موتور ناموفق بود.',
              durationMs: Date.now() - t0,
            });
          } else {
            pushStep({
              id: 'cookies',
              label: 'استخراج خودکار کوکی از فایرفاکس',
              status: 'blocked',
              detail: ff.error || 'کوکی لاگین گوگل در فایرفاکس پیدا نشد — یک‌بار در مرورگر وارد gemini.google.com شوید.',
              durationMs: Date.now() - t0,
            });
          }
        } else {
          pushStep({
            id: 'cookies',
            label: 'بررسی کوکی‌های سشن گوگل',
            status: 'blocked',
            detail: 'هیچ کوکی فعالی ثبت نشده و پروفایل فایرفاکس محلی هم یافت نشد؛ از دکمه «لاگین و استخراج خودکار» استفاده کنید.',
            durationMs: Date.now() - t0,
          });
        }
      }
    }

    // 5c. Auto-harden anti-ban preset if non-compliant
    {
      const t0 = Date.now();
      const cfgRes = await adminClient.request<{ config?: Record<string, unknown> }>('GET', '/admin/api/config');
      const currentCfg = cfgRes.ok && cfgRes.data?.config ? cfgRes.data.config : null;
      const audit = evaluateAntiBanAudit(currentCfg);
      const nonCompliant = audit.filter((a) => a.current !== null && !a.compliant);
      if (currentCfg && nonCompliant.length > 0) {
        const put = await adminClient.request('PUT', '/admin/api/config', {
          ...currentCfg,
          ...ANTI_BAN_PRESET,
        });
        pushStep({
          id: 'anti-ban',
          label: 'سخت‌سازی خودکار پروفایل ضدبن',
          status: put.ok ? 'fixed' : 'failed',
          detail: put.ok
            ? `${nonCompliant.length} پارامتر ضدبن روی موتور وب ایمن‌سازی شد.`
            : put.error || 'اعمال پروفایل ضدبن ناموفق بود.',
          durationMs: Date.now() - t0,
        });
      }
    }
  }

  const diagnosisAfter = await buildLiveDiagnosis();
  const remainingIssues = diagnosisAfter.findings.filter((f) => f.severity === 'critical').length;

  return {
    ok: diagnosisAfter.healthy || remainingIssues === 0,
    healedCount,
    remainingIssues,
    steps,
    diagnosisAfter,
  };
}
