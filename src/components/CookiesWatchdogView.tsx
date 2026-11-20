import { useMemo, useState } from 'react';
import {
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Trash2,
  ShieldAlert,
  Chrome,
  Globe,
  KeyRound,
  Play,
} from 'lucide-react';
import { parseCookieInput } from '../lib/cookieParser';
import type { CookieAccount, WatchdogRunRecord, WatchdogSource } from '../lib/types';
import { Modal } from './Modal';

interface CookiesWatchdogViewProps {
  online: boolean;
  cookies: CookieAccount[];
  watchdog: {
    autoRun: boolean;
    intervalMin: number;
    runningNow: boolean;
    sources: WatchdogSource[];
    history: WatchdogRunRecord[];
  } | null;
  cdpPort: number;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}

function fmtRelative(sec?: number): string {
  if (!sec) return '—';
  const diff = Math.max(0, Date.now() / 1000 - sec);
  if (diff < 60) return 'همین حالا';
  if (diff < 3600) return `${Math.floor(diff / 60)} دقیقه پیش`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ساعت پیش`;
  return `${Math.floor(diff / 86400)} روز پیش`;
}

export function CookiesWatchdogView({
  online,
  cookies,
  watchdog,
  cdpPort,
  onRefresh,
  onNotify,
}: CookiesWatchdogViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'problem'>('all');
  const [search, setSearch] = useState('');

  // Add Cookie Modal State
  const [addOpen, setAddOpen] = useState(false);
  const [importMode, setImportMode] = useState<'firefox' | 'cdp' | 'raw'>('firefox');
  const [rawCookieInput, setRawCookieInput] = useState('');
  const [label, setLabel] = useState('');
  const [authuser, setAuthuser] = useState(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cdpBusy, setCdpBusy] = useState(false);

  // Delete Confirmation Modal
  const [deleteTarget, setDeleteTarget] = useState<CookieAccount | null>(null);

  // Watchdog Source Form
  const [srcModalOpen, setSrcModalOpen] = useState(false);
  const [srcLabel, setSrcLabel] = useState('');
  const [srcBrowser, setSrcBrowser] = useState<'firefox' | 'chrome-cdp'>('firefox');
  const [srcDir, setSrcDir] = useState('');
  const [srcProfile, setSrcProfile] = useState('Default');
  const [srcAuthuser, setSrcAuthuser] = useState(0);
  const [watchdogRunning, setWatchdogRunning] = useState(false);

  const parsedPreview = useMemo(() => parseCookieInput(rawCookieInput), [rawCookieInput]);

  const filteredCookies = useMemo(() => {
    return cookies.filter((c) => {
      const isHealthy = c.status === 'enabled' && c.health !== 'dead';
      if (statusFilter === 'active' && !isHealthy) return false;
      if (statusFilter === 'problem' && isHealthy) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          (c.label || '').toLowerCase().includes(q) ||
          (c.last_error || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [cookies, statusFilter, search]);

  const handleExtractCDP = async () => {
    setCdpBusy(true);
    try {
      const r = await fetch('/api/control/cookies/extract-cdp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cdpPort }),
      });
      const j = (await r.json()) as { ok?: boolean; cookieHeader?: string; foundCount?: number; error?: string };
      if (!r.ok || !j.ok || !j.cookieHeader) {
        onNotify(j.error || 'استخراج از کروم ناموفق بود', 'err');
      } else {
        setRawCookieInput(j.cookieHeader);
        onNotify(`${j.foundCount} کوکی از کروم استخراج شد — مرورگر را فوراً ببندید`, 'ok');
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطای ارتباط', 'err');
    } finally {
      setCdpBusy(false);
    }
  };

  const handleSubmitCookie = async () => {
    if (!parsedPreview.valid) {
      onNotify(parsedPreview.errors[0] || 'کوکی معتبر نیست', 'err');
      return;
    }
    if (!label.trim()) {
      onNotify('لطفاً یک برچسب (label) برای اکانت وارد کنید', 'err');
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          cookie: parsedPreview.cookieHeader,
          authuser,
          note: note.trim() || `${importMode}-import`,
        }),
      });
      const j = (await r.json()) as { id?: number; error?: string };
      if (!r.ok) {
        onNotify(j.error || 'ثبت کوکی روی موتور ناموفق بود (آیا موتور 8093 روشن است؟)', 'err');
      } else {
        onNotify(`اکانت «${label.trim()}» با موفقیت ثبت شد`, 'ok');
        setAddOpen(false);
        setRawCookieInput('');
        setLabel('');
        setAuthuser(0);
        setNote('');
        await onRefresh();
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا در ثبت کوکی', 'err');
    } finally {
      setSubmitting(false);
    }
  };

  const cookieAction = async (id: number, action: 'check' | 'rotate' | 'toggle') => {
    try {
      const r = await fetch(`/api/admin/cookies/${id}/${action}`, { method: 'POST' });
      const j = (await r.json()) as { ok?: boolean; detail?: string; error?: string };
      if (!r.ok) {
        onNotify(j.error || 'عملیات ناموفق بود', 'err');
      } else if (action === 'check') {
        onNotify(j.ok ? 'سشن اکانت سالم است' : `سشن منقضی است: ${j.detail || ''}`, j.ok ? 'ok' : 'err');
      } else {
        onNotify(action === 'rotate' ? 'درخواست چرخش کوکی ارسال شد' : 'وضعیت اکانت تغییر کرد', 'ok');
      }
      await onRefresh();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    }
  };

  const confirmDeleteCookie = async () => {
    if (!deleteTarget) return;
    try {
      const r = await fetch(`/api/admin/cookies/${deleteTarget.id}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        onNotify(j.error || 'حذف ناموفق بود', 'err');
      } else {
        onNotify(`اکانت «${deleteTarget.label}» حذف شد`, 'ok');
        setDeleteTarget(null);
        await onRefresh();
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    }
  };

  const handleSaveWatchdogSource = async () => {
    if (!srcLabel.trim()) {
      onNotify('نام اکانت الزامی است', 'err');
      return;
    }
    try {
      const r = await fetch('/api/control/watchdog/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: srcLabel.trim(),
          browserType: srcBrowser,
          profileDir: srcDir.trim(),
          profileName: srcProfile.trim() || 'Default',
          authuser: srcAuthuser,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        onNotify(j.error || 'ذخیره منبع ناموفق بود', 'err');
      } else {
        onNotify(`منبع نگهبان برای «${srcLabel.trim()}» ذخیره شد`, 'ok');
        setSrcModalOpen(false);
        setSrcLabel('');
        setSrcDir('');
        setSrcProfile('Default');
        setSrcAuthuser(0);
        await onRefresh();
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    }
  };

  const handleDeleteSource = async (id: string) => {
    try {
      await fetch(`/api/control/watchdog/sources/${id}`, { method: 'DELETE' });
      onNotify('منبع نگهبان حذف شد', 'ok');
      await onRefresh();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    }
  };

  const handleRunWatchdogNow = async () => {
    setWatchdogRunning(true);
    try {
      const r = await fetch('/api/control/watchdog/run', { method: 'POST' });
      const j = (await r.json()) as { ok?: boolean; results?: WatchdogRunRecord[]; error?: string };
      if (!r.ok || !j.ok) {
        onNotify(j.error || 'اجرای نگهبان ناموفق بود — موتور وب در دسترس نیست', 'err');
      } else {
        onNotify(`چرخه نگهبان اتمیک انجام شد (${j.results?.length ?? 0} اکانت بررسی شد)`, 'ok');
        await onRefresh();
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    } finally {
      setWatchdogRunning(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Cookie Pool Section */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              استخر کوکی چنداکانته
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              مجموع <span className="font-mono tabular-nums">{cookies.length}</span> اکانت
              {' · '}
              برای پایداری چند هفته‌ای، کوکی فایرفاکس (بدون قفل DBSC کروم) پیشنهاد می‌شود
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              بروزرسانی
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              افزودن کوکی
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-3 dark:border-slate-800">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900" role="tablist" aria-label="فیلتر وضعیت اکانت">
            {(
              [
                ['all', 'همه'],
                ['active', 'سالم و فعال'],
                ['problem', 'منقضی / غیرفعال'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={statusFilter === k}
                onClick={() => setStatusFilter(k)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === k
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو بر اساس نام اکانت یا خطا..."
            aria-label="جستجوی اکانت"
            className="w-full max-w-xs rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        {!online ? (
          <div className="px-6 py-10 text-center">
            <ShieldAlert className="mx-auto h-7 w-7 text-amber-500" />
            <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
              موتور وب (پورت 8093) در دسترس نیست
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              همچنان می‌توانید از دکمه «افزودن کوکی» برای تست و اعتبارسنجی فرمت کوکی فایرفاکس یا کروم استفاده کنید.
            </p>
          </div>
        ) : filteredCookies.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">هیچ اکانتی در این نما وجود ندارد</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              اولین اکانت فرعی Google AI Pro خود را از طریق فایرفاکس یا CDP اضافه کنید.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-6 py-3 font-medium">اکانت</th>
                  <th className="px-4 py-3 font-medium">وضعیت</th>
                  <th className="px-4 py-3 font-medium">1PSIDTS</th>
                  <th className="px-4 py-3 font-medium">آخرین موفق</th>
                  <th className="px-4 py-3 font-medium">خطاها</th>
                  <th className="px-6 py-3 text-left font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredCookies.map((c) => {
                  const isHealthy = c.status === 'enabled' && c.health !== 'dead';
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-6 py-3.5">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {c.label || `#${c.id}`}
                          {c.authuser ? (
                            <span className="mr-2 font-mono text-xs text-slate-400">/u/{c.authuser}</span>
                          ) : null}
                        </div>
                        {c.last_error && (
                          <p className="mt-0.5 max-w-md truncate font-mono text-xs text-red-500">{c.last_error}</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium ${
                            isHealthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {isHealthy ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                          {isHealthy ? 'فعال و سالم' : c.health === 'dead' ? 'منقضی' : 'غیرفعال'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs">
                        {c.has_1psidts ? (
                          <span className="text-emerald-600 dark:text-emerald-400">موجود</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">ناموجود</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                        {fmtRelative(c.last_ok_at)}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                        {c.fail_count ?? 0}
                      </td>
                      <td className="px-6 py-3.5 text-left">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void cookieAction(c.id, 'check')}
                            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            بررسی
                          </button>
                          <button
                            type="button"
                            onClick={() => void cookieAction(c.id, 'rotate')}
                            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            چرخش
                          </button>
                          <button
                            type="button"
                            onClick={() => void cookieAction(c.id, 'toggle')}
                            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            {c.status === 'enabled' ? 'غیرفعال' : 'فعال'}
                          </button>
                          <button
                            type="button"
                            aria-label={`حذف اکانت ${c.label}`}
                            onClick={() => setDeleteTarget(c)}
                            className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Atomic Cookie Watchdog Section */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              نگهبان اتمیک کوکی (Verify-Before-Delete)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              ابتدا کوکی جدید استخراج و با <span className="font-mono">/check</span> تأیید می‌شود؛ سپس با حفظ{' '}
              <span className="font-mono">authuser</span> جایگزین رکورد منقضی می‌گردد.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setSrcModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              افزودن پروفایل مرورگر
            </button>
            <button
              type="button"
              disabled={watchdogRunning}
              onClick={() => void handleRunWatchdogNow()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              <Play className="h-3.5 w-3.5" />
              {watchdogRunning ? 'در حال بررسی...' : 'اجرای فوری نگهبان'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0 lg:divide-x-reverse dark:divide-slate-800">
          {/* Sources list */}
          <div className="p-6">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              نگاشت اکانت به پروفایل مرورگر ({watchdog?.sources.length ?? 0})
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              این لیست همگام با فایل <span className="font-mono">cookie-sources.json</span> ذخیره می‌شود.
            </p>

            {(watchdog?.sources.length ?? 0) === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                هنوز پروفایلی ثبت نشده است. با دکمه «افزودن پروفایل مرورگر» اکانت را متصل کنید.
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
                {watchdog?.sources.map((src) => (
                  <li key={src.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {src.label}
                        <span className="mr-2 font-mono text-xs font-normal text-slate-400">
                          {src.browserType === 'firefox' ? 'Firefox' : 'Chrome CDP'} · /u/{src.authuser}
                        </span>
                      </p>
                      <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                        {src.profileDir || 'پروفایل پیش‌فرض'} ({src.profileName})
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`حذف منبع ${src.label}`}
                      onClick={() => void handleDeleteSource(src.id)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Watchdog history */}
          <div className="p-6">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">گزارش چرخه‌های نگهبان</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              وضعیت آخرین عملیات بررسی و تازه‌سازی اتمیک
            </p>
            {(watchdog?.history.length ?? 0) === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                هنوز چرخه‌ای اجرا نشده است.
              </div>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {watchdog?.history.slice(0, 8).map((h, i) => (
                  <li key={`${h.ts}-${i}`} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 text-xs dark:border-slate-800/80">
                    <div>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{h.label}</span>
                      <span className="mx-1.5 text-slate-400">·</span>
                      <span className="text-slate-600 dark:text-slate-300">{h.detail}</span>
                    </div>
                    <span className="shrink-0 font-mono tabular-nums text-slate-400" dir="ltr">
                      {new Date(h.ts).toLocaleTimeString('en-GB')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Multi-tab Add Cookie Modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="افزودن کوکی اکانت گوگل"
        subtitle="پشتیبانی از خروجی JSON افزونه Cookie-Editor فایرفاکس، فرمت Netscape، استخراج مستقیم CDP و رشته خام"
        maxWidthClass="max-w-2xl"
        footer={
          <>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              انصراف
            </button>
            <button
              type="button"
              disabled={!parsedPreview.valid || !label.trim() || submitting}
              onClick={() => void handleSubmitCookie()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'در حال ثبت...' : 'ذخیره در استخر کوکی'}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {/* Import Method Tabs */}
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={importMode === 'firefox'}
              onClick={() => setImportMode('firefox')}
              className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                importMode === 'firefox'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              فایرفاکس (JSON / Netscape)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={importMode === 'cdp'}
              onClick={() => setImportMode('cdp')}
              className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                importMode === 'cdp'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Chrome className="h-3.5 w-3.5" />
              استخراج کروم (CDP)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={importMode === 'raw'}
              onClick={() => setImportMode('raw')}
              className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                importMode === 'raw'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              رشته Header خام
            </button>
          </div>

          {importMode === 'cdp' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="text-xs text-slate-600 dark:text-slate-300">
                کروم موقت را با <span className="font-mono">--remote-debugging-port={cdpPort}</span> باز و لاگین کنید؛ پس از استخراج فوراً مرورگر را ببندید.
              </div>
              <button
                type="button"
                disabled={cdpBusy}
                onClick={() => void handleExtractCDP()}
                className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                {cdpBusy ? 'در حال خواندن...' : `استخراج از پورت ${cdpPort}`}
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="ck-label" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                نام اکانت (Label)
              </label>
              <input
                id="ck-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="مثلاً: pro-account-1"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="ck-authuser" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                اندیس مرورگر (authuser)
              </label>
              <input
                id="ck-authuser"
                type="number"
                min={0}
                max={10}
                value={authuser}
                onChange={(e) => setAuthuser(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label htmlFor="ck-raw" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {importMode === 'firefox'
                ? 'محتوای JSON افزونه Cookie-Editor یا فایل Netscape فایرفاکس'
                : 'رشته کوکی استخراج‌شده (SID=...; __Secure-1PSID=...; __Secure-1PSIDTS=...)'}
            </label>
            <textarea
              id="ck-raw"
              rows={5}
              dir="ltr"
              value={rawCookieInput}
              onChange={(e) => setRawCookieInput(e.target.value)}
              placeholder={
                importMode === 'firefox'
                  ? '[{"name": "__Secure-1PSID", "value": "...", "domain": ".google.com"}, ...]'
                  : 'SID=...; HSID=...; SAPISID=...; __Secure-1PSID=...; __Secure-1PSIDTS=...'
              }
              className="w-full rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          {/* Live Validation Summary */}
          {rawCookieInput.trim().length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-900/70">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-medium">
                <span>
                  فرمت تشخیص‌داده‌شده: <span className="font-mono uppercase">{parsedPreview.format}</span>
                </span>
                <span>·</span>
                <span>
                  کوکی‌های معتبر: <span className="font-mono">{parsedPreview.foundCount} / 9</span>
                </span>
                {parsedPreview.sapisidHash && (
                  <>
                    <span>·</span>
                    <span>
                      اثرانگشت SAPISID: <span className="font-mono">{parsedPreview.sapisidHash}</span>
                    </span>
                  </>
                )}
              </div>

              {parsedPreview.errors.map((err) => (
                <p key={err} className="mt-2 flex items-center gap-1.5 text-red-600 dark:text-red-400">
                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                  {err}
                </p>
              ))}
              {parsedPreview.warnings.map((w) => (
                <p key={w} className="mt-2 flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {w}
                </p>
              ))}
              {parsedPreview.valid && parsedPreview.warnings.length === 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ساختار کوکی کامل است (شامل __Secure-1PSIDTS و SIDCC برای دسترسی مدل‌های Pro و سهمیه)
                </p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="ck-note" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              یادداشت اختیاری
            </label>
            <input
              id="ck-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثلاً: اکانت فرعی فایرفاکس خانگی"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      </Modal>

      {/* Watchdog Source Modal */}
      <Modal
        open={srcModalOpen}
        onClose={() => setSrcModalOpen(false)}
        title="ثبت پروفایل مرورگر برای نگهبان اتمیک"
        subtitle="در صورت انقضای سشن، نگهبان از این پروفایل کوکی تازه استخراج و پیش از حذف رکورد قدیمی آن را اعتبارسنجی می‌کند"
        footer={
          <>
            <button
              type="button"
              onClick={() => setSrcModalOpen(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={() => void handleSaveWatchdogSource()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              ذخیره پروفایل
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ws-label" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                برچسب اکانت (مطابق Cookie Pool)
              </label>
              <input
                id="ws-label"
                type="text"
                value={srcLabel}
                onChange={(e) => setSrcLabel(e.target.value)}
                placeholder="مثلاً: arman2"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div>
              <label htmlFor="ws-browser" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                نوع مرورگر
              </label>
              <select
                id="ws-browser"
                value={srcBrowser}
                onChange={(e) => setSrcBrowser(e.target.value as 'firefox' | 'chrome-cdp')}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="firefox">Firefox (پیشنهادی بدون DBSC)</option>
                <option value="chrome-cdp">Chrome Clone (CDP)</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="ws-dir" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              مسیر پوشه پروفایل روی سیستم محلی
            </label>
            <input
              id="ws-dir"
              type="text"
              dir="ltr"
              value={srcDir}
              onChange={(e) => setSrcDir(e.target.value)}
              placeholder="C:\Users\You\AppData\Roaming\Mozilla\Firefox\Profiles\xxxx.default-release"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="ws-profile" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                نام پروفایل (Profile Name)
              </label>
              <input
                id="ws-profile"
                type="text"
                dir="ltr"
                value={srcProfile}
                onChange={(e) => setSrcProfile(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div>
              <label htmlFor="ws-auth" className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                اندیس /u/n
              </label>
              <input
                id="ws-auth"
                type="number"
                min={0}
                value={srcAuthuser}
                onChange={(e) => setSrcAuthuser(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="تأیید حذف کوکی اکانت"
        subtitle={`آیا از حذف اکانت «${deleteTarget?.label || ''}» از استخر کوکی مطمئن هستید؟`}
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={() => void confirmDeleteCookie()}
              className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700"
            >
              حذف قطعی
            </button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          این عملیات کوکی را از دیتابیس موتور <span className="font-mono">gemini-web2api-go</span> پاک می‌کند. در صورت نیاز باید دوباره کوکی را از مرورگر استخراج کنید.
        </p>
      </Modal>
    </div>
  );
}
