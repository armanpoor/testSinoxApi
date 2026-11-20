import { useEffect, useState } from 'react';
import { Save, RotateCcw, Shield, Activity } from 'lucide-react';
import type { BridgeSettings, ThrottleTelemetry } from '../lib/types';

interface ThrottleAntiBanViewProps {
  settings: BridgeSettings | null;
  telemetry: ThrottleTelemetry | null;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}

export function ThrottleAntiBanView({
  settings,
  telemetry,
  onRefresh,
  onNotify,
}: ThrottleAntiBanViewProps) {
  const [form, setForm] = useState({
    throttleEnabled: true,
    throttlePort: 8095,
    throttleTarget: 'bridge' as 'bridge' | 'engine',
    minDelayMs: 2000,
    maxDelayMs: 7000,
    burstMin: 3,
    burstMax: 7,
    burstPauseMinMs: 8000,
    burstPauseMaxMs: 25000,
    nightMultiplier: 2.5,
    cooldownSec: 60,
    detectSoftBlock: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      throttleEnabled: settings.throttleEnabled,
      throttlePort: settings.throttlePort,
      throttleTarget: settings.throttleTarget,
      minDelayMs: settings.minDelayMs,
      maxDelayMs: settings.maxDelayMs,
      burstMin: settings.burstMin,
      burstMax: settings.burstMax,
      burstPauseMinMs: settings.burstPauseMinMs,
      burstPauseMaxMs: settings.burstPauseMaxMs,
      nightMultiplier: settings.nightMultiplier,
      cooldownSec: settings.cooldownSec,
      detectSoftBlock: settings.detectSoftBlock,
    });
  }, [settings]);

  const handleSave = async () => {
    if (form.minDelayMs > form.maxDelayMs) {
      onNotify('حداقل تاخیر Jitter نمی‌تواند از حداکثر آن بیشتر باشد', 'err');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/control/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error('ذخیره تنظیمات تراتل ناموفق بود');
      onNotify('تنظیمات پروکسی تراتل استریم ذخیره و اعمال شد', 'ok');
      await onRefresh();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    } finally {
      setSaving(false);
    }
  };

  const clearCooldown = async (scope?: string) => {
    try {
      await fetch('/api/control/throttle/clear-cooldown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      onNotify(scope ? `Cooldown مدل ${scope} پاک شد` : 'تمام Cooldownها پاک شدند', 'ok');
      await onRefresh();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    }
  };

  return (
    <div className="space-y-8">
      {/* Live Telemetry Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <p className="text-xs text-slate-500 dark:text-slate-400">پورت تراتل استریم (SSE)</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            <span dir="ltr" className="inline-block">:{telemetry?.port ?? form.throttlePort}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {telemetry?.running ? 'فعال · حفظ کامل متدها و استریم' : 'متوقف'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <p className="text-xs text-slate-500 dark:text-slate-400">صف تک‌نویسنده (FIFO)</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {telemetry?.queueDepth ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {telemetry?.inFlight ? 'یک درخواست در حال ارسال' : 'آزاد و آماده'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <p className="text-xs text-slate-500 dark:text-slate-400">درخواست‌های عبوری</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {telemetry?.totalForwarded ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            رد شده در Cooldown: <span className="font-mono">{telemetry?.totalCooldownRejected ?? 0}</span>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <p className="text-xs text-slate-500 dark:text-slate-400">تشخیص Soft-Block (کد ۲۰۰)</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {telemetry?.totalSoftBlocksDetected ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            پایش خودکار پیام‌های رد گوگل
          </p>
        </div>
      </div>

      {/* Active Cooldowns */}
      {(telemetry?.activeCooldowns.length ?? 0) > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50/60 p-5 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <Shield className="h-4 w-4" />
              Cooldown فعال برای حفاظت از اکانت
            </div>
            <button
              type="button"
              onClick={() => void clearCooldown()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              پاکسازی همه
            </button>
          </div>
          <div className="mt-3 divide-y divide-amber-200/70 dark:divide-amber-900/40">
            {telemetry?.activeCooldowns.map((cd) => (
              <div key={cd.scope} className="flex items-center justify-between py-2 text-xs">
                <div>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{cd.scope}</span>
                  <span className="mx-2 text-slate-400">·</span>
                  <span className="text-slate-600 dark:text-slate-300">{cd.reason}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono tabular-nums text-amber-700 dark:text-amber-300">
                    {cd.remainingSec}s باقی‌مانده
                  </span>
                  <button
                    type="button"
                    onClick={() => void clearCooldown(cd.scope)}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    رفع
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Configuration Form */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              پیکربندی ریتم انسانی و تراتل ضدبن
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              جایگزین ناهمگام و استریم‌محور اسکریپت 07 — درخواست‌های <span className="font-mono">GET /v1/models</span> بدون معطلی عبور می‌کنند و SSE بدون بافر استریم می‌شود.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات تراتل'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="th-port" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              پورت شنود تراتل
            </label>
            <input
              id="th-port"
              type="number"
              value={form.throttlePort}
              onChange={(e) => setForm({ ...form, throttlePort: Number(e.target.value) || 8095 })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label htmlFor="th-target" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              مقصد بالادست تراتل
            </label>
            <select
              id="th-target"
              value={form.throttleTarget}
              onChange={(e) => setForm({ ...form, throttleTarget: e.target.value as 'bridge' | 'engine' })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="bridge">پل Anthropic (پورت 8094 — مناسب Claude Code)</option>
              <option value="engine">مستقیم موتور وب (پورت 8093 — مناسب Cline)</option>
            </select>
          </div>

          <div>
            <label htmlFor="th-cooldown" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              مدت Cooldown پس از 429/502 (ثانیه)
            </label>
            <input
              id="th-cooldown"
              type="number"
              min={5}
              max={600}
              value={form.cooldownSec}
              onChange={(e) => setForm({ ...form, cooldownSec: Number(e.target.value) || 60 })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label htmlFor="th-min" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              حداقل Jitter بین درخواست‌ها (ms)
            </label>
            <input
              id="th-min"
              type="number"
              min={0}
              step={250}
              value={form.minDelayMs}
              onChange={(e) => setForm({ ...form, minDelayMs: Number(e.target.value) || 0 })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label htmlFor="th-max" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              حداکثر Jitter بین درخواست‌ها (ms)
            </label>
            <input
              id="th-max"
              type="number"
              min={0}
              step={250}
              value={form.maxDelayMs}
              onChange={(e) => setForm({ ...form, maxDelayMs: Number(e.target.value) || 0 })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label htmlFor="th-night" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              ضریب تاخیر ساعات شبانه (۱ تا ۶ صبح)
            </label>
            <input
              id="th-night"
              type="number"
              min={1}
              max={5}
              step={0.5}
              value={form.nightMultiplier}
              onChange={(e) => setForm({ ...form, nightMultiplier: Number(e.target.value) || 1 })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-6 border-t border-slate-200 pt-4 dark:border-slate-800">
            <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={form.throttleEnabled}
                onChange={(e) => setForm({ ...form, throttleEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              پروکسی تراتل استریم فعال باشد
            </label>

            <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={form.detectSoftBlock}
                onChange={(e) => setForm({ ...form, detectSoftBlock: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              تشخیص خودکار «رد با کد 200» (Soft-Block) و اعمال Cooldown مدل
            </label>
          </div>
        </div>
      </section>

      {/* Recent Forwarded Requests */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              تاریخچه زنده درخواست‌های عبوری از تراتل
            </h2>
          </div>
          <span className="font-mono text-xs text-slate-400">
            {telemetry?.recentLogs.length ?? 0} رکورد اخیر
          </span>
        </div>

        {(telemetry?.recentLogs.length ?? 0) === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            هنوز درخواستی از طریق پورت <span className="font-mono" dir="ltr">:{telemetry?.port ?? form.throttlePort}</span> یا مسیر <span className="font-mono" dir="ltr">/proxy/v1/...</span> عبور نکرده است.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-6 py-3 font-medium">زمان</th>
                  <th className="px-4 py-3 font-medium">متد و مسیر</th>
                  <th className="px-4 py-3 font-medium">مدل</th>
                  <th className="px-4 py-3 font-medium">کد</th>
                  <th className="px-4 py-3 font-medium">Jitter</th>
                  <th className="px-4 py-3 font-medium">کل زمان</th>
                  <th className="px-6 py-3 font-medium">توضیح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {telemetry?.recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-6 py-3 font-mono tabular-nums text-slate-500" dir="ltr">
                      {new Date(log.ts).toLocaleTimeString('en-GB')}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-800 dark:text-slate-200" dir="ltr">
                      {log.method} {log.path}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">{log.model}</td>
                    <td className={`px-4 py-3 font-mono font-semibold ${log.status < 300 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {log.status}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-500">{log.jitterMs}ms</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-500">{log.durationMs}ms</td>
                    <td className="px-6 py-3 text-slate-500 dark:text-slate-400">
                      {log.softBlocked ? 'تشخیص Soft-Block' : log.stream ? 'SSE Stream' : log.note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
