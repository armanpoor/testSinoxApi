import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Cookie,
  ShieldCheck,
  TerminalSquare,
  Sliders,
  Code2,
  ScrollText,
  Sun,
  Moon,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import type { BridgeSettings, WatchdogRunRecord, WatchdogSource } from './lib/types';
import { OverviewView, type ControlStatusPayload } from './components/OverviewView';
import { CookiesWatchdogView } from './components/CookiesWatchdogView';
import { ThrottleAntiBanView } from './components/ThrottleAntiBanView';
import { PlaygroundProbeView } from './components/PlaygroundProbeView';
import { ModelsSettingsView } from './components/ModelsSettingsView';
import { ConfigGeneratorView } from './components/ConfigGeneratorView';
import { LogsView } from './components/LogsView';
import { Modal } from './components/Modal';
import { SmartTroubleshooter } from './components/SmartTroubleshooter';
import { HeaderHealthWidget } from './components/HeaderHealthWidget';

type TabKey = 'overview' | 'cookies' | 'throttle' | 'playground' | 'settings' | 'configs' | 'logs';

const NAV_ITEMS: Array<{ key: TabKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'overview', label: 'نمای کلی و سرویس‌ها', icon: LayoutDashboard },
  { key: 'cookies', label: 'استخر کوکی و نگهبان', icon: Cookie },
  { key: 'throttle', label: 'پروکسی تراتل و ضدبن', icon: ShieldCheck },
  { key: 'playground', label: 'آزمایشگاه چت و پروب', icon: TerminalSquare },
  { key: 'settings', label: 'مدل‌ها و تنظیمات', icon: Sliders },
  { key: 'configs', label: 'تولید کانفیگ ابزارها', icon: Code2 },
  { key: 'logs', label: 'گزارش‌های زنده', icon: ScrollText },
];

interface FullStatusResponse extends ControlStatusPayload {
  watchdog: {
    autoRun: boolean;
    intervalMin: number;
    runningNow: boolean;
    sources: WatchdogSource[];
    history: WatchdogRunRecord[];
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [dark, setDark] = useState(true);
  const [statusData, setStatusData] = useState<FullStatusResponse | null>(null);
  const [fullSettings, setFullSettings] = useState<BridgeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null);
  const [troubleshooterOpen, setTroubleshooterOpen] = useState(false);
  const [lastErrorContext, setLastErrorContext] = useState<{ error: string; source: string } | null>(null);

  const notify = useCallback((msg: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ msg, tone });
    if (tone === 'err') {
      setLastErrorContext({ error: msg, source: activeTab });
    }
    setTimeout(() => {
      setToast((curr) => (curr?.msg === msg ? null : curr));
    }, tone === 'err' ? 6500 : 3400);
  }, [activeTab]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, settingsRes] = await Promise.all([
        fetch('/api/control/status'),
        fetch('/api/control/settings'),
      ]);
      if (statusRes.ok) {
        setStatusData((await statusRes.json()) as FullStatusResponse);
        setLastUpdatedAt(Date.now());
      }
      if (settingsRes.ok) {
        setFullSettings((await settingsRes.json()) as BridgeSettings);
      }
    } catch {
      notify('خطا در دریافت وضعیت از سرور کنترل‌سنتر', 'err');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Real-time background health polling every 10s (silent, skips hidden tabs)
  useEffect(() => {
    const timer = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/control/status');
        if (res.ok) {
          setStatusData((await res.json()) as FullStatusResponse);
          setLastUpdatedAt(Date.now());
        }
      } catch {
        // Keep previous state visible; widget will reflect disconnection if persistent
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const activeMeta = NAV_ITEMS.find((n) => n.key === activeTab) || NAV_ITEMS[0];

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 lg:flex-row dark:bg-[#0B1120] dark:text-slate-100">
      {/* RTL Sticky Sidebar */}
      <aside className="w-full shrink-0 border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:flex-col lg:border-b-0 lg:border-l dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <span className="font-latin text-base font-bold tracking-tight text-slate-900 whitespace-nowrap dark:text-slate-100">
            Gemini Web Bridge
          </span>
        </div>

        <nav aria-label="منوی اصلی کنترل‌سنتر" className="flex gap-1 overflow-x-auto p-3 lg:flex-1 lg:flex-col lg:overflow-visible">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="hidden border-t border-slate-200 px-5 py-4 text-xs text-slate-500 lg:block dark:border-slate-800 dark:text-slate-400">
          <div className="flex items-center justify-between">
            <span>تراتل استریم</span>
            <span className="font-mono tabular-nums" dir="ltr">
              :{statusData?.throttle.port ?? fullSettings?.throttlePort ?? 8095}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span>موتور بالادست</span>
            <span className={statusData?.upstream.online ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
              {statusData?.upstream.online ? 'متصل' : 'آفلاین'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Clean Top Bar (Breadcrumb + Action Controls) */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-6 backdrop-blur-xs dark:border-slate-800 dark:bg-[#111827]/95">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden text-slate-400 sm:inline">کنترل‌سنتر</span>
            <span className="hidden text-slate-300 sm:inline dark:text-slate-700">/</span>
            <h1 className="truncate whitespace-nowrap font-semibold text-slate-900 dark:text-slate-100">{activeMeta.label}</h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <HeaderHealthWidget
              status={statusData}
              loading={loading}
              lastUpdatedAt={lastUpdatedAt}
              onOpenTroubleshooter={() => setTroubleshooterOpen(true)}
            />
            <button
              type="button"
              onClick={() => setTroubleshooterOpen(true)}
              className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                !statusData?.upstream.online || lastErrorContext
                  ? 'border-amber-300 bg-amber-50/70 text-amber-800 hover:bg-amber-100/70 dark:border-amber-800/80 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <Wrench className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">عیب‌یاب و تعمیر خودکار</span>
            </button>
            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              aria-label={dark ? 'تغییر به تم روشن' : 'تغییر به تم تیره'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => void refreshAll()}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              همگام‌سازی
            </button>
          </div>
        </header>

        {/* Viewport Container */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
          {activeTab === 'overview' && (
            <OverviewView
              data={statusData}
              loading={loading}
              onRefresh={refreshAll}
              onNotify={notify}
              onNavigate={(tab) => setActiveTab(tab as TabKey)}
            />
          )}

          {activeTab === 'cookies' && (
            <CookiesWatchdogView
              online={Boolean(statusData?.upstream.online)}
              cookies={statusData?.upstream.cookies?.items || []}
              localEnv={statusData?.localEnv}
              watchdog={statusData?.watchdog || null}
              cdpPort={fullSettings?.cdpPort ?? 9333}
              onRefresh={refreshAll}
              onNotify={notify}
            />
          )}

          {activeTab === 'throttle' && (
            <ThrottleAntiBanView
              settings={fullSettings}
              telemetry={statusData?.throttle || null}
              onRefresh={refreshAll}
              onNotify={notify}
            />
          )}

          {activeTab === 'playground' && (
            <PlaygroundProbeView
              availableModels={statusData?.upstream.models || []}
              online={Boolean(statusData?.upstream.online)}
              onRefresh={refreshAll}
              onNotify={notify}
            />
          )}

          {activeTab === 'settings' && (
            <ModelsSettingsView
              settings={fullSettings}
              upstreamModels={statusData?.upstream.models || []}
              upstreamConfig={statusData?.upstream.config || null}
              online={Boolean(statusData?.upstream.online)}
              autoSync={statusData?.autoSync}
              onRefresh={refreshAll}
              onNotify={notify}
            />
          )}

          {activeTab === 'configs' && (
            <ConfigGeneratorView settings={fullSettings} onNotify={notify} />
          )}

          {activeTab === 'logs' && <LogsView onNotify={notify} />}
        </main>
      </div>

      {/* Global Smart Troubleshooter & Auto-Heal Modal */}
      <Modal
        open={troubleshooterOpen}
        onClose={() => setTroubleshooterOpen(false)}
        title="عیب‌یابی ریشه‌ای و تعمیر خودکار پل جمنای"
        subtitle="اسکن لایه‌های موتور، پل، تراتل و کوکی‌ها + اجرای خودکار مراحل تعمیر توسط سرور یا Claude Code"
        maxWidthClass="max-w-3xl"
      >
        <SmartTroubleshooter
          contextError={lastErrorContext?.error}
          contextSource={lastErrorContext?.source || activeTab}
          onHealed={async () => {
            await refreshAll();
          }}
          onNotify={notify}
        />
      </Modal>

      {/* Live Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 left-5 z-50 flex max-w-md items-center gap-3 rounded-lg border px-4 py-3 text-xs font-medium shadow-lg ${
            toast.tone === 'ok'
              ? 'border-emerald-300 bg-white text-emerald-800 dark:border-emerald-800 dark:bg-[#111827] dark:text-emerald-300'
              : 'border-red-300 bg-white text-red-800 dark:border-red-800 dark:bg-[#111827] dark:text-red-300'
          }`}
        >
          <span className="leading-relaxed">{toast.msg}</span>
          {toast.tone === 'err' && (
            <button
              type="button"
              onClick={() => {
                setToast(null);
                setTroubleshooterOpen(true);
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100 whitespace-nowrap dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-900/60"
            >
              <Wrench className="h-3 w-3" />
              ریشه‌یابی و تعمیر
            </button>
          )}
        </div>
      )}
    </div>
  );
}
