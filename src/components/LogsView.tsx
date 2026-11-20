import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Copy,
  Check,
  Pause,
  Play,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  filterLogs,
  formatLogsAsText,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from '../lib/logBus';

interface LogsViewProps {
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}

const SOURCE_TABS: Array<{ key: LogSource | 'all'; label: string }> = [
  { key: 'all', label: 'همه' },
  { key: 'server', label: 'سرور' },
  { key: 'engine', label: 'موتور' },
  { key: 'bridge', label: 'پل' },
  { key: 'throttle', label: 'تراتل' },
  { key: 'watchdog', label: 'نگهبان' },
  { key: 'sync', label: 'همگام‌سازی' },
];

const LEVEL_STYLES: Record<LogLevel, string> = {
  info: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  debug: 'text-slate-400',
};

function formatTimeMs(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function LogsView({ onNotify }: LogsViewProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<LogSource | 'all'>('all');
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [query, setQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [probing, setProbing] = useState(false);
  const [copied, setCopied] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/control/logs/stream');

    es.onopen = () => {
      setConnected(true);
    };

    es.addEventListener('init', (ev) => {
      try {
        const snapshot = JSON.parse((ev as MessageEvent).data) as LogEntry[];
        if (Array.isArray(snapshot)) {
          setEntries(snapshot);
        }
        setConnected(true);
      } catch {
        // ignore malformed payload
      }
    });

    es.addEventListener('log', (ev) => {
      try {
        const item = JSON.parse((ev as MessageEvent).data) as LogEntry;
        setEntries((prev) => {
          const next = [...prev, item];
          return next.length > 500 ? next.slice(next.length - 500) : next;
        });
      } catch {
        // ignore
      }
    });

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
    };
  }, []);

  const filtered = useMemo(
    () =>
      filterLogs(entries, {
        source: sourceFilter,
        level: levelFilter,
        query,
      }),
    [entries, sourceFilter, levelFilter, query]
  );

  useEffect(() => {
    if (!autoScroll || !viewportRef.current) return;
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [filtered.length, autoScroll]);

  const handleRunProbe = async () => {
    setProbing(true);
    try {
      const r = await fetch('/api/control/logs/probe', { method: 'POST' });
      if (!r.ok) throw new Error('اجرای تست اتصال ناموفق بود');
      onNotify('تست اتصال لایه‌های پل انجام شد و خروجی در گزارش زنده ثبت گردید', 'ok');
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطای ارتباط', 'err');
    } finally {
      setProbing(false);
    }
  };

  const handleClear = async () => {
    try {
      const r = await fetch('/api/control/logs/clear', { method: 'POST' });
      if (r.ok) {
        setEntries([]);
        onNotify('بافر گزارش‌های سرور پاکسازی شد', 'ok');
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا در پاکسازی', 'err');
    }
  };

  const handleCopy = async () => {
    const text = formatLogsAsText(filtered);
    if (!text) {
      onNotify('گزارشی برای کپی وجود ندارد', 'err');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onNotify(`${filtered.length} خط گزارش در کلیپ‌بورد کپی شد`, 'ok');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify('کپی خودکار محدود شده است', 'err');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                گزارش‌های زنده سرور و اتصال پل (SSE)
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                  connected
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {connected ? 'متصل به استریم زنده' : 'در حال اتصال مجدد...'}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              پایش لحظه‌ای خروجی سرور، موتور وب، پل Anthropic، پروکسی تراتل و نگهبان اتمیک برای عیب‌یابی اتصال
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={probing}
              onClick={() => void handleRunProbe()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              <Activity className="h-3.5 w-3.5" />
              {probing ? 'در حال بررسی...' : 'تست اتصال پل'}
            </button>
            <button
              type="button"
              onClick={() => setAutoScroll((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {autoScroll ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {autoScroll ? 'توقف اسکرول' : 'ادامه اسکرول'}
            </button>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'کپی شد' : 'کپی'}
            </button>
            <button
              type="button"
              onClick={() => void handleClear()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-red-50 hover:text-red-600 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              پاکسازی
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-3 dark:border-slate-800">
          <div
            className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900"
            role="tablist"
            aria-label="فیلتر منبع گزارش"
          >
            {SOURCE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={sourceFilter === tab.key}
                onClick={() => setSourceFilter(tab.key)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  sourceFilter === tab.key
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="فیلتر سطح گزارش"
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as LogLevel | 'all')}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="all">همه سطوح</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
            </select>

            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو در پیام یا خطا..."
              aria-label="جستجو در گزارش‌های زنده"
              className="w-56 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />

            <span className="font-mono text-xs tabular-nums text-slate-400" dir="ltr">
              {filtered.length} / {entries.length}
            </span>
          </div>
        </div>

        {/* Live Terminal Stream Viewport */}
        <div
          ref={viewportRef}
          dir="ltr"
          role="log"
          aria-live="polite"
          aria-label="خروجی زنده سرور"
          className="h-[520px] overflow-y-auto bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-200 rounded-b-xl"
        >
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-400" dir="rtl">
              <p className="text-sm text-slate-300">گزارشی مطابق فیلتر فعلی ثبت نشده است</p>
              <p className="text-xs text-slate-500">
                روی دکمه «تست اتصال پل» کلیک کنید تا وضعیت لحظه‌ای پورت‌ها و سرویس‌ها در استریم نمایش داده شود.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 rounded-sm px-2 py-0.5 hover:bg-slate-900/90"
                >
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {formatTimeMs(entry.ts)}
                  </span>
                  <span className={`w-12 shrink-0 uppercase font-semibold ${LEVEL_STYLES[entry.level]}`}>
                    {entry.level}
                  </span>
                  <span className="w-20 shrink-0 text-sky-400">
                    [{entry.source}]
                  </span>
                  <span className="min-w-0 flex-1 break-words text-slate-100">
                    {entry.message}
                    {entry.meta && (
                      <span className="ml-2 text-slate-400">({entry.meta})</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
