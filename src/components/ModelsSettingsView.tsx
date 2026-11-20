import { useEffect, useState } from 'react';
import { Save, PlugZap, CheckCircle2 } from 'lucide-react';
import type { BridgeSettings } from '../lib/types';

interface ModelsSettingsViewProps {
  settings: BridgeSettings | null;
  upstreamModels: string[];
  upstreamConfig: Record<string, unknown> | null;
  online: boolean;
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
  onRefresh,
  onNotify,
}: ModelsSettingsViewProps) {
  const [conn, setConn] = useState({
    gw2apiUrl: 'http://127.0.0.1:8093',
    bridgeUrl: 'http://127.0.0.1:8094',
    adminToken: '',
    gw2apiKey: '',
    bridgeKey: 'local-client-key-1',
    cdpPort: 9333,
    watchdogIntervalMin: 10,
    watchdogAutoRun: false,
  });
  const [defaultModel, setDefaultModel] = useState('gemini-4-hydrogen');
  const [savingConn, setSavingConn] = useState(false);
  const [testingAuth, setTestingAuth] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setConn({
      gw2apiUrl: settings.gw2apiUrl,
      bridgeUrl: settings.bridgeUrl,
      adminToken: settings.adminToken,
      gw2apiKey: settings.gw2apiKey,
      bridgeKey: settings.bridgeKey,
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
      if (!r.ok) throw new Error('ذخیره تنظیمات اتصال ناموفق بود');
      onNotify('تنظیمات اتصال و سرویس‌ها ذخیره شد', 'ok');
      await onRefresh();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    } finally {
      setSavingConn(false);
    }
  };

  const handleTestAuth = async () => {
    setTestingAuth(true);
    try {
      const r = await fetch('/api/control/auth/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gw2apiUrl: conn.gw2apiUrl, adminToken: conn.adminToken }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        onNotify(j.error || 'احراز هویت با موتور وب ناموفق بود', 'err');
      } else {
        onNotify('احراز هویت واقعی با /admin/api/login موفق بود', 'ok');
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    } finally {
      setTestingAuth(false);
    }
  };

  const handleSaveDefaultModel = async () => {
    setSavingModel(true);
    try {
      // Backend performs non-destructive merge with full upstream config
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

  return (
    <div className="space-y-8">
      {/* Connection & Real Auth */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              تنظیمات اتصال محلی و احراز هویت واقعی
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              جایگزین امن مقادیر هاردکدشده قبلی — نشست ادمین مستقیماً در سمت سرور کنترل‌سنتر مدیریت می‌شود
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={testingAuth}
              onClick={() => void handleTestAuth()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <PlugZap className="h-3.5 w-3.5" />
              {testingAuth ? 'در حال تست...' : 'تست اتصال و ورود'}
            </button>
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
            <label htmlFor="cfg-admin-tok" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              توکن ادمین موتور (ADMIN_TOKEN)
            </label>
            <input
              id="cfg-admin-tok"
              type="password"
              dir="ltr"
              value={conn.adminToken}
              onChange={(e) => setConn({ ...conn, adminToken: e.target.value })}
              placeholder="change-me-123"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label htmlFor="cfg-gw-key" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              کلید API موتور (sk-gemini-...)
            </label>
            <input
              id="cfg-gw-key"
              type="password"
              dir="ltr"
              value={conn.gw2apiKey}
              onChange={(e) => setConn({ ...conn, gw2apiKey: e.target.value })}
              placeholder="sk-gemini-..."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label htmlFor="cfg-br-key" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              کلید دسترسی پل Anthropic
            </label>
            <input
              id="cfg-br-key"
              type="text"
              dir="ltr"
              value={conn.bridgeKey}
              onChange={(e) => setConn({ ...conn, bridgeKey: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="cfg-cdp" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                پورت Chrome CDP
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
                بازه نگهبان (دقیقه)
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
          </div>

          <div className="sm:col-span-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={conn.watchdogAutoRun}
                onChange={(e) => setConn({ ...conn, watchdogAutoRun: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              اجرای زمان‌بندی‌شده نگهبان اتمیک در پس‌زمینه سرور
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
