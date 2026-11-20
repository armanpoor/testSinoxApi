import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Play,
  Square,
  ShieldCheck,
  RefreshCw,
  ArrowUpLeft,
  Globe,
  Chrome,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';
import type {
  AntiBanAuditItem,
  AutoLoginState,
  CookieAccount,
  LayerStatus,
  LocalEnvironmentInfo,
  SystemResourcesSnapshot,
  ThrottleTelemetry,
} from '../lib/types';
import { SystemResourcesCard } from './SystemResourcesCard';
import { ThroughputMiniCard } from './ThroughputMiniCard';

export interface ControlStatusPayload {
  layers: LayerStatus[];
  localEnv?: LocalEnvironmentInfo;
  autoLogin?: AutoLoginState;
  autoSync?: {
    running: boolean;
    lastSyncAt: number;
    lastSelfHealAt: number;
    events: Array<{ ts: number; kind: string; ok: boolean; detail: string }>;
  };
  throttle: ThrottleTelemetry;
  systemResources?: SystemResourcesSnapshot;
  upstream: {
    online: boolean;
    stats: {
      total_requests?: number;
      success?: number;
      failures?: number;
      success_rate?: number;
      avg_ms?: number;
    } | null;
    cookies: { items?: CookieAccount[]; total?: number; enabled?: number } | null;
    models: string[];
    config: Record<string, unknown> | null;
    antiBanAudit: AntiBanAuditItem[];
  };
}

interface OverviewViewProps {
  data: ControlStatusPayload | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
  onNavigate: (tab: string) => void;
}

export function OverviewView({ data, loading, onRefresh, onNotify, onNavigate }: OverviewViewProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [autoLogin, setAutoLogin] = useState<AutoLoginState | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const isLocalHost =
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const hasAnyLocalBrowser = Boolean(
    data?.localEnv?.detectedChromePath || (data?.localEnv?.firefoxProfiles?.length ?? 0) > 0
  );
  const isCloudSandbox = !isLocalHost || !hasAnyLocalBrowser;

  useEffect(() => {
    if (data?.autoLogin && data.autoLogin.status !== 'idle') {
      setAutoLogin(data.autoLogin);
    }
  }, [data?.autoLogin]);

  useEffect(() => {
    if (!autoLogin || !['launching', 'waiting_login', 'extracting', 'registering'].includes(autoLogin.status)) {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const r = await fetch('/api/control/cookies/auto-login/status');
        if (!r.ok) return;
        const st = (await r.json()) as AutoLoginState;
        setAutoLogin(st);
        if (st.status === 'done') {
          onNotify(st.message, 'ok');
          void onRefresh();
        } else if (st.status === 'error') {
          onNotify(st.message, 'err');
        }
      } catch {
        // ignore transient poll error
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [autoLogin, onNotify, onRefresh]);

  const handleAutoFirefox = async () => {
    setBusyKey('auto-ff');
    try {
      const r = await fetch('/api/control/cookies/auto-firefox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'firefox-pro', autoRegister: true }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        foundCount?: number;
        registeredId?: number | null;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        onNotify(j.error || 'استخراج خودکار از فایرفاکس ناموفق بود', 'err');
      } else {
        onNotify(
          j.registeredId
            ? `${j.foundCount} کوکی از فایرفاکس استخراج و خودکار در موتور ثبت شد`
            : `${j.foundCount} کوکی از فایرفاکس استخراج شد (موتور 8093 آفلاین است)`,
          'ok'
        );
        await onRefresh();
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطای ارتباط', 'err');
    } finally {
      setBusyKey(null);
    }
  };

  const handleStartAutoBrowser = async () => {
    setBusyKey('auto-browser');
    try {
      const r = await fetch('/api/control/cookies/auto-login/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'gemini-pro-main', autoRegister: true }),
      });
      const j = (await r.json()) as { ok?: boolean; state?: AutoLoginState };
      if (j.state) setAutoLogin(j.state);
      if (!r.ok || !j.ok) {
        onNotify(j.state?.message || 'باز کردن مرورگر محلی ممکن نیست', 'err');
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطای ارتباط', 'err');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCancelAutoBrowser = async () => {
    await fetch('/api/control/cookies/auto-login/cancel', { method: 'POST' });
    setAutoLogin({ status: 'idle', message: '' });
  };

  const copyLocalCmd = async () => {
    const cmd = 'powershell -ExecutionPolicy Bypass -File .\\gemini-web-bridge\\start-all.ps1';
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(true);
      onNotify('دستور اجرای محلی کپی شد', 'ok');
      setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      onNotify('متن دستور را دستی کپی کنید', 'err');
    }
  };

  const handleProcessAction = async (target: 'engine' | 'bridge', action: 'start' | 'stop') => {
    setBusyKey(`${target}-${action}`);
    try {
      const r = await fetch(`/api/control/process/${target}/${action}`, { method: 'POST' });
      const j = (await r.json()) as { ok?: boolean; message?: string };
      onNotify(j.message || (j.ok ? 'انجام شد' : 'خطا'), j.ok ? 'ok' : 'err');
      await onRefresh();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطای ارتباط', 'err');
    } finally {
      setBusyKey(null);
    }
  };

  const handleThrottleToggle = async (enabled: boolean) => {
    setBusyKey('throttle');
    try {
      const r = await fetch('/api/control/throttle/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const j = (await r.json()) as { ok?: boolean; started?: boolean; error?: string };
      if (!j.ok) {
        onNotify(j.error || 'تغییر وضعیت تراتل ناموفق بود', 'err');
      } else {
        onNotify(enabled ? 'پروکسی تراتل استریم فعال شد' : 'پروکسی تراتل متوقف شد', 'ok');
      }
      await onRefresh();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    } finally {
      setBusyKey(null);
    }
  };

  const handleApplyAntiBan = async () => {
    setBusyKey('antiban');
    try {
      const r = await fetch('/api/control/anti-ban/apply', { method: 'POST' });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        onNotify(j.error || 'اعمال پروفایل ضدبن ناموفق بود — آیا موتور 8093 روشن است؟', 'err');
      } else {
        onNotify('پروفایل سخت‌شده ضدبن روی موتور وب اعمال شد', 'ok');
        await onRefresh();
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    } finally {
      setBusyKey(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]" />
      </div>
    );
  }

  const layers = data?.layers || [];
  const cookies = data?.upstream.cookies?.items || [];
  const healthyCookies = cookies.filter((c) => c.status === 'enabled' && c.health !== 'dead').length;
  const totalReq = data?.upstream.stats?.total_requests ?? 0;
  const successRate = data?.upstream.stats?.success_rate ?? 0;
  const audit = data?.upstream.antiBanAudit || [];
  const compliantCount = audit.filter((a) => a.compliant).length;

  return (
    <div className="space-y-8">
      {/* KPI Summary Strip */}
      <section aria-label="شاخص‌های کلیدی">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">وضعیت موتور وب</p>
            <p className={`mt-2 text-2xl font-semibold ${data?.upstream.online ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {data?.upstream.online ? 'متصل و آماده' : 'آفلاین'}
            </p>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono">{data?.upstream.models.length ?? 0}</span> مدل در دسترس
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">استخر کوکی فعال</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {healthyCookies} <span className="text-base font-normal text-slate-400">/ {cookies.length}</span>
            </p>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {healthyCookies > 0 ? 'چنداکانته آماده توزیع' : 'کوکی فعالی ثبت نشده یا موتور خاموش است'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">ترافیک ۲۴ ساعت (موتور + تراتل)</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {(totalReq + (data?.throttle.totalForwarded ?? 0)).toLocaleString('en-US')}
            </p>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              نرخ موفقیت <span className="font-mono tabular-nums" dir="ltr">{(successRate * 100).toFixed(1)}%</span>
              {' · '}
              Soft-Block <span className="font-mono tabular-nums">{data?.throttle.totalSoftBlocksDetected ?? 0}</span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">انطباق پروفایل ضدبن</p>
            <p className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${compliantCount === audit.length && audit.length > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-100'}`}>
              {data?.upstream.online ? `${compliantCount} / ${audit.length}` : '—'}
            </p>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {data?.upstream.online
                ? compliantCount === audit.length
                  ? 'تمامی قواعد ایمنی فعال است'
                  : 'برخی تنظیمات نیازمند سخت‌سازی است'
                : 'پس از اتصال به 8093 سنجیده می‌شود'}
            </p>
          </div>
        </div>
      </section>

      {/* 60-Minute Request Throughput & Error Rate Mini-Dashboard */}
      <ThroughputMiniCard
        recentLogs={data?.throttle.recentLogs || []}
        upstreamStats={data?.upstream.stats}
        throttlePort={data?.throttle.port ?? 8095}
      />

      {/* Server System Resources Summary (CPU, RAM & Node Process Memory) */}
      <SystemResourcesCard resources={data?.systemResources} />

      {/* Zero-Copy Auto-Connect to Harness Banner */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              اتصال خودکار اشتراک جمنای پرو (وب) به هارنس — بدون کپی دستی کوکی
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {isCloudSandbox
                ? 'این صفحه هم‌اکنون در پیش‌نمایش ابری باز شده است؛ مرورگر به دلایل امنیتی (Same-Origin / HttpOnly) به صفحات ابری اجازه خواندن کوکی‌های google.com سیستم شما را نمی‌دهد و برای جلوگیری از بن شدن اکانت هم ترافیک باید از IP خانگی خودتان ارسال شود. با اجرای دستور زیر روی سیستم شخصی، استخراج کوکی و اتصال به هارنس تماماً خودکار انجام می‌شود.'
                : 'روی سیستم محلی هستید: با یک کلیک کوکی سشن جمنای پرو مستقیماً از فایرفاکس خوانده می‌شود یا پنجره مرورگر برای ورود باز شده، پس از لاگین خودکار استخراج و بسته می‌شود و هارنس روی پورت 8095 آماده کار خواهد شد.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={busyKey === 'auto-ff' || (data?.localEnv?.firefoxProfiles?.length ?? 0) === 0}
              onClick={() => void handleAutoFirefox()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
            >
              <Globe className="h-3.5 w-3.5" />
              {busyKey === 'auto-ff'
                ? 'در حال اسکن...'
                : `استخراج خودکار فایرفاکس (${data?.localEnv?.firefoxProfiles?.length ?? 0})`}
            </button>
            <button
              type="button"
              disabled={
                busyKey === 'auto-browser' ||
                !data?.localEnv?.detectedChromePath ||
                ['launching', 'waiting_login', 'extracting', 'registering'].includes(autoLogin?.status || '')
              }
              onClick={() => void handleStartAutoBrowser()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Chrome className="h-3.5 w-3.5" />
              لاگین و استخراج خودکار (کروم/اج)
            </button>
            <button
              type="button"
              onClick={() => onNavigate('configs')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Terminal className="h-3.5 w-3.5" />
              کانفیگ هارنس‌ها
            </button>
          </div>
        </div>

        {/* Live Auto-Login Status Strip */}
        {autoLogin && autoLogin.status !== 'idle' && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs dark:border-blue-900/60 dark:bg-blue-950/30">
            <span className="text-slate-800 dark:text-slate-200">{autoLogin.message}</span>
            {['launching', 'waiting_login', 'extracting', 'registering'].includes(autoLogin.status) && (
              <button
                type="button"
                onClick={() => void handleCancelAutoBrowser()}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                لغو
              </button>
            )}
          </div>
        )}

        {/* 1-Command Local Runner (shown clearly when in Cloud Preview or missing binaries) */}
        {isCloudSandbox && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/70">
            <code dir="ltr" className="overflow-x-auto font-mono text-xs text-slate-800 dark:text-slate-200">
              powershell -ExecutionPolicy Bypass -File .\gemini-web-bridge\start-all.ps1
            </code>
            <button
              type="button"
              onClick={() => void copyLocalCmd()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {copiedCmd ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedCmd ? 'کپی شد' : 'کپی دستور اجرا'}
            </button>
          </div>
        )}
      </section>

      {/* 4-Layer Architecture Orchestrator */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">ارکستراتور چهار لایه پل</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              وضعیت زنده سرویس‌های محلی، پورت‌ها و کنترل مستقیم اجرا یا توقف
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            بررسی مجدد
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-6 py-3 font-medium">لایه سرویس</th>
                <th className="px-4 py-3 font-medium">آدرس / زمان‌بندی</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
                <th className="px-4 py-3 font-medium">جزئیات</th>
                <th className="px-6 py-3 text-left font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {layers.map((layer) => (
                <tr key={layer.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-6 py-3.5 font-medium text-slate-900 dark:text-slate-100">{layer.name}</td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-600 dark:text-slate-300" dir="ltr">
                    {layer.endpoint}
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                        layer.online
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {layer.online ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {layer.online ? 'فعال' : 'متوقف'}
                      {layer.latencyMs !== undefined && layer.online && (
                        <span className="font-mono text-slate-400">· {layer.latencyMs}ms</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-slate-500 dark:text-slate-400">{layer.detail}</td>
                  <td className="px-6 py-3.5 text-left">
                    {(layer.id === 'engine' || layer.id === 'bridge') && (
                      <div className="inline-flex items-center gap-2">
                        {!layer.online ? (
                          <button
                            type="button"
                            disabled={busyKey === `${layer.id}-start`}
                            onClick={() => void handleProcessAction(layer.id as 'engine' | 'bridge', 'start')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <Play className="h-3 w-3" />
                            اجرا
                          </button>
                        ) : layer.managedPid ? (
                          <button
                            type="button"
                            disabled={busyKey === `${layer.id}-stop`}
                            onClick={() => void handleProcessAction(layer.id as 'engine' | 'bridge', 'stop')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 whitespace-nowrap dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                          >
                            <Square className="h-3 w-3" />
                            توقف
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">پروسس خارجی</span>
                        )}
                      </div>
                    )}
                    {layer.id === 'throttle' && (
                      <button
                        type="button"
                        disabled={busyKey === 'throttle'}
                        onClick={() => void handleThrottleToggle(!layer.online)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {layer.online ? 'توقف تراتل' : 'فعال‌سازی تراتل'}
                      </button>
                    )}
                    {layer.id === 'watchdog' && (
                      <button
                        type="button"
                        onClick={() => onNavigate('cookies')}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-500 whitespace-nowrap dark:text-blue-400"
                      >
                        مدیریت نگهبان
                        <ArrowUpLeft className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Anti-Ban Hardening Checklist */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              ممیزی خودکار پروفایل سخت‌شده ضدبن
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              مقایسه تنظیمات فعلی موتور وب با استاندارد ایمنی مستندات ضدبن (Concurrent=1، RPM=3، Strict Model، چت موقت)
            </p>
          </div>
          <button
            type="button"
            disabled={busyKey === 'antiban' || !data?.upstream.online}
            onClick={() => void handleApplyAntiBan()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="h-4 w-4" />
            {busyKey === 'antiban' ? 'در حال اعمال...' : 'اعمال یک‌کلیک پروفایل ضدبن'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-6 py-3 font-medium">پارامتر</th>
                <th className="px-4 py-3 font-medium">مقدار ایمن پیشنهادی</th>
                <th className="px-4 py-3 font-medium">مقدار فعلی موتور</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
                <th className="px-6 py-3 font-medium">علت مهندسی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {audit.map((item) => (
                <tr key={item.key} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-6 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {item.label}
                    <span className="mr-2 font-mono text-xs font-normal text-slate-400">{item.key}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-200">
                    {String(item.recommended)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                    {item.current === null ? '—' : String(item.current)}
                  </td>
                  <td className="px-4 py-3">
                    {item.current === null ? (
                      <span className="text-xs text-slate-400">در انتظار اتصال</span>
                    ) : item.compliant ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        ایمن
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                        <XCircle className="h-3.5 w-3.5" />
                        نیاز به اصلاح
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-xs text-slate-500 dark:text-slate-400">{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
