import { useEffect, useState } from 'react';
import { Save, RefreshCw, CheckCircle2, Sparkles, ShieldCheck } from 'lucide-react';
import { maskSecret } from '../lib/smartSync';
import type { BridgeSettings } from '../lib/types';

interface ModelsSettingsViewProps {
  settings: BridgeSettings | null;
  upstreamModels: string[];
  upstreamConfig: Record<string, unknown> | null;
  online: boolean;
  autoSync?: {
    running: boolean;
    lastSyncAt: number;
    lastSelfHealAt: number;
    events: Array<{ ts: number; kind: string; ok: boolean; detail: string }>;
  };
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}

const MODEL_DESCRIPTIONS: Record<string, { role: string; tier: string }> = {
  'gemini-3.5-flash-lite': { role: 'سبک و سریع برای کارهای روزمره', tier: 'رایگان / ناشناس' },
  'gemini-4-hydrogen': { role: 'مدل اصلی سری ۴ — تعادل سرعت و دقت', tier: 'اکانت لاگین‌شده' },
  'gemini-4-hydrogen-thinking': { role: 'مدل اصلی همراه با زنجیره تفکر مجزا', tier: 'اکانت لاگین‌شده' },
  'gemini-4-neon': { role: 'تحلیل عمیق — جانشین 3.1 Pro', tier: 'Pro / Ultra' },
  'gemini-4-carbon': { role: 'کدنویسی پیچیده — جانشین 4 Argon', tier: 'Pro / Ultra' },
  'gemini-3.6-flash': { role: 'سازگار با فراخوانی‌های قدیمی‌تر', tier: 'اکانت لاگین‌شده' },
};

export function ModelsSettingsView({
  settings,
  upstreamModels,
  upstreamConfig,
  online,
  autoSync,
  onRefresh,
  onNotify,
}: ModelsSettingsViewProps) {
  const [conn, setConn] = useState({
    gw2apiUrl: 'http://127.0.0.1:8093',
    bridgeUrl: 'http://127.0.0.1:8094',
    cdpPort: 9333,
    watchdogIntervalMin: 10,
    watchdogAutoRun: true,
  });
  const [defaultModel, setDefaultModel] = useState('gemini-4-hydrogen');
  const [savingConn, setSavingConn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setConn({
      gw2apiUrl: settings.gw2apiUrl,
      bridgeUrl: settings.bridgeUrl,
      cdpPort: settings.cdpPort,
      watchdogIntervalMin: settings.watchdogIntervalMin,
      watchdogAutoRun: settings.watchdogAutoRun,
    });
  }, [settings]);

  useEffect(() => {
    if (typeof upstreamConfig?.default_model === 'string') {
      setDefaultModel(upstreamConfig.default_model);
    }
  }, [upstreamConfig]);

  const handleSaveConnection = async () => {
    setSavingConn(true);
    try {
      const r = await fetch('/api/control/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conn),
      });
      if (!r.ok) throw new Error('ذخیره تنظیمات محلی ناموفق بود');
      onNotify('تنظیمات سرویس‌ها و نگهبان ذخیره شد', 'ok');
      await onRefresh();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    } finally {
      setSavingConn(false);
    }
  };

  const handleSmartSync = async () => {
    setSyncing(true);
    try {
      const r = await fetch('/api/control/smart-sync', { method: 'POST' });
      const j = (await r.json()) as { ok?: boolean; syncedCount?: number };
      if (!r.ok || !j.ok) {
        onNotify('همگام‌سازی هوشمند ناموفق بود', 'err');
      } else {
        onNotify(
          j.syncedCount
            ? `همگام‌سازی هوشمند انجام شد (${j.syncedCount} مورد به‌روزرسانی/احیا شد)`
            : 'تمام مقادیر محلی همگام و به‌روز هستند',
          'ok'
        );
        await onRefresh();
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveDefaultModel = async () => {
    setSavingModel(true);
    try {
      const r = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_model: defaultModel }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) {
        onNotify(j.error || 'ذخیره مدل پیش‌فرض ناموفق بود', 'err');
      } else {
        onNotify(`مدل پیش‌فرض بدون دستکاری سایر تنظیمات روی ${defaultModel} ذخیره شد`, 'ok');
        await onRefresh();
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    } finally {
      setSavingModel(false);
    }
  };

  const displayedModels =
    upstreamModels.length > 0 ? upstreamModels : Object.keys(MODEL_DESCRIPTIONS);

  const dynamicCredentials = [
    {
      name: 'توکن نشست ادمین (Admin Token)',
      value: maskSecret(settings?.adminToken || ''),
      behavior: 'کشف خودکار از اسکریپت‌های محلی و ورود مجدد هوشمند روی خطای 401',
      ready: Boolean(settings?.adminToken),
      isMono: true,
    },
    {
      name: 'کلید API موتور وب (Engine Key)',
      value: settings?.gw2apiKey ? maskSecret(settings.gw2apiKey) : 'کشف/ساخت خودکار هنگام اتصال',
      behavior: 'به‌محض اتصال به 8093 خودکار خوانده یا ساخته شده و در config.yaml همگام می‌شود',
      ready: Boolean(settings?.gw2apiKey),
      isMono: Boolean(settings?.gw2apiKey),
    },
    {
      name: 'کلید محلی هارنس (Bridge Key)',
      value: maskSecret(settings?.bridgeKey || ''),
      behavior: 'تولید امن خودکار در اولین اجرا و همگام‌سازی با CLIProxyAPI',
      ready: Boolean(settings?.bridgeKey),
      isMono: true,
    },
    {
      name: 'کوکی‌های سشن گوگل (__Secure-1PSID / 1PSIDTS)',
      value: conn.watchdogAutoRun ? `نگهبان خودکار فعال (هر ${conn.watchdogIntervalMin} دقیقه)` : 'حالت دستی',
      behavior: 'چرخش خودکار (/rotate) و جایگزینی اتمیک هنگام 401/403 یا Soft-Block',
      ready: conn.watchdogAutoRun,
      isMono: false,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Smart Zero-Config Auto-Sync Section */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              <Sparkles className="h-4 w-4 text-blue-500" />
              مدیریت هوشمند و خودترمیم توکن‌ها و کوکی‌ها (بدون نیاز به ورود دستی)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              نیازی به تعریف Environment Variable یا وارد کردن دستی کلید نیست؛ تمام توکن‌ها، کلیدها و کوکی‌ها به‌صورت خودکار کشف، ساخته و هنگام تغییر تازه‌سازی می‌شوند.
            </p>
          </div>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void handleSmartSync()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'در حال همگام‌سازی...' : 'همگام‌سازی و خودترمیمی اکنون'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-6 py-3 font-medium">مؤلفه پویا</th>
                <th className="px-4 py-3 font-medium">وضعیت فعلی</th>
                <th className="px-6 py-3 font-medium">رفتار هوشمند خودکار</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {dynamicCredentials.map((item) => (
                <tr key={item.name} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-6 py-3.5 font-medium text-slate-900 dark:text-slate-100">{item.name}</td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200">
                      <ShieldCheck
                        className={`h-3.5 w-3.5 shrink-0 ${
                          item.ready ? 'text-emerald-500' : 'text-amber-500'
                        }`}
                      />
                      <span
                        dir={item.isMono ? 'ltr' : 'rtl'}
                        className={item.isMono ? 'font-mono tabular-nums' : ''}
                      >
                        {item.value}
                      </span>
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-500 dark:text-slate-400">{item.behavior}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(autoSync?.events?.length ?? 0) > 0 && (
          <div className="border-t border-slate-200 px-6 py-4 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              رویدادهای اخیر همگام‌سازی و خودترمیمی
            </h3>
            <ul className="mt-2.5 space-y-1.5">
              {autoSync?.events.slice(0, 6).map((ev, idx) => (
                <li key={`${ev.ts}-${idx}`} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-600 dark:text-slate-300">{ev.detail}</span>
                  <span className="shrink-0 font-mono tabular-nums text-slate-400" dir="ltr">
                    {new Date(ev.ts).toLocaleTimeString('en-GB')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Local Ports & Self-Healing Schedule */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              پورت‌های محلی و زمان‌بندی خودترمیمی
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              مقادیر پیش‌فرض بدون نیاز به تغییر آماده‌اند؛ تنها در صورت تداخل پورت ویرایش کنید
            </p>
          </div>
          <button
            type="button"
            disabled={savingConn}
            onClick={() => void handleSaveConnection()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            <Save className="h-3.5 w-3.5" />
            {savingConn ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2">
          <div>
            <label htmlFor="cfg-engine-url" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              آدرس موتور وب (gemini-web2api-go)
            </label>
            <input
              id="cfg-engine-url"
              type="url"
              dir="ltr"
              value={conn.gw2apiUrl}
              onChange={(e) => setConn({ ...conn, gw2apiUrl: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label htmlFor="cfg-bridge-url" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              آدرس پل Anthropic (CLIProxyAPI)
            </label>
            <input
              id="cfg-bridge-url"
              type="url"
              dir="ltr"
              value={conn.bridgeUrl}
              onChange={(e) => setConn({ ...conn, bridgeUrl: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label htmlFor="cfg-cdp" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              پورت دیباگ مرورگر (Chrome CDP)
            </label>
            <input
              id="cfg-cdp"
              type="number"
              value={conn.cdpPort}
              onChange={(e) => setConn({ ...conn, cdpPort: Number(e.target.value) || 9333 })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label htmlFor="cfg-wd-int" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              بازه بررسی و احیای خودکار کوکی (دقیقه)
            </label>
            <input
              id="cfg-wd-int"
              type="number"
              min={1}
              max={120}
              value={conn.watchdogIntervalMin}
              onChange={(e) => setConn({ ...conn, watchdogIntervalMin: Number(e.target.value) || 10 })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div className="sm:col-span-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={conn.watchdogAutoRun}
                onChange={(e) => setConn({ ...conn, watchdogAutoRun: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              اجرای خودکار نگهبان اتمیک و چرخش هوشمند کوکی‌ها در پس‌زمینه (پیشنهادی)
            </label>
          </div>
        </div>
      </section>

      {/* Models Catalog & Non-destructive Default Model */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              کاتالوگ مدل‌های Gemini Web ({displayedModels.length})
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              تغییر مدل پیش‌فرض با ادغام ایمن انجام می‌شود تا سایر تنظیمات ضدبن بازنویسی نشوند
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="انتخاب مدل پیش‌فرض"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              {displayedModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!online || savingModel}
              onClick={() => void handleSaveDefaultModel()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              ذخیره پیش‌فرض
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-6 py-3 font-medium">شناسه مدل در API</th>
                <th className="px-4 py-3 font-medium">کاربرد</th>
                <th className="px-6 py-3 font-medium">سطح دسترسی موردنیاز</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {displayedModels.map((m) => {
                const info = MODEL_DESCRIPTIONS[m] || { role: 'مدل کشف‌شده از موتور وب', tier: 'وابسته به کوکی' };
                return (
                  <tr key={m} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-6 py-3 font-mono text-xs font-medium text-slate-900 dark:text-slate-100">
                      {m}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{info.role}</td>
                    <td className="px-6 py-3 text-xs text-slate-500 dark:text-slate-400">{info.tier}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
