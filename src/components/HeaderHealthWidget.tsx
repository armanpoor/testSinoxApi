import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Wrench, XCircle } from 'lucide-react';
import { evaluateConnectionHealth, type HealthLayerCheck, type HealthLevel } from '../lib/healthStatus';
import type { ControlStatusPayload } from './OverviewView';

interface HeaderHealthWidgetProps {
  status: ControlStatusPayload | null;
  loading: boolean;
  lastUpdatedAt: number | null;
  onOpenTroubleshooter: () => void;
}

function getLevelVisuals(level: HealthLevel) {
  switch (level) {
    case 'healthy':
      return {
        Icon: CheckCircle2,
        iconCls: 'text-emerald-600 dark:text-emerald-400',
        btnCls:
          'border-emerald-200 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-100/70 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50',
      };
    case 'degraded':
      return {
        Icon: AlertTriangle,
        iconCls: 'text-amber-600 dark:text-amber-400',
        btnCls:
          'border-amber-200 bg-amber-50/60 text-amber-800 hover:bg-amber-100/70 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50',
      };
    case 'offline':
      return {
        Icon: XCircle,
        iconCls: 'text-red-600 dark:text-red-400',
        btnCls:
          'border-red-200 bg-red-50/60 text-red-800 hover:bg-red-100/70 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50',
      };
    default:
      return {
        Icon: Activity,
        iconCls: 'text-slate-500 dark:text-slate-400',
        btnCls:
          'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
      };
  }
}

function LayerStateIcon({ state }: { state: HealthLayerCheck['state'] }) {
  if (state === 'ok') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />;
  if (state === 'warn') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />;
}

export function HeaderHealthWidget({
  status,
  loading,
  lastUpdatedAt,
  onOpenTroubleshooter,
}: HeaderHealthWidgetProps) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = hovered || pinned;
  const health = useMemo(() => evaluateConnectionHealth(status, loading), [status, loading]);
  const { Icon, iconCls, btnCls } = getLevelVisuals(health.level);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleHoverClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setHovered(false), 160);
  };

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setHovered(false);
        setPinned(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHovered(false);
        setPinned(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      clearCloseTimer();
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  const updatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString('en-GB', { hour12: false })
    : '—';

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => {
        clearCloseTimer();
        setHovered(true);
      }}
      onMouseLeave={scheduleHoverClose}
    >
      <button
        type="button"
        aria-label={`وضعیت سلامت اتصال: ${health.shortLabel}`}
        aria-expanded={open}
        aria-describedby={open ? 'header-health-tooltip' : undefined}
        onClick={() => {
          setPinned((prev) => {
            if (prev) setHovered(false);
            return !prev;
          });
        }}
        onFocus={() => {
          clearCloseTimer();
          setHovered(true);
        }}
        onBlur={(e) => {
          if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
            setHovered(false);
            setPinned(false);
          }
        }}
        className={`inline-flex h-10 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 md:px-3 ${btnCls}`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${iconCls}`} />
        <span className="hidden md:inline">{health.shortLabel}</span>
        <span
          dir="ltr"
          className="hidden font-mono text-[11px] tabular-nums opacity-80 lg:inline"
        >
          {health.onlineCount}/{health.totalCount}
        </span>
      </button>

      {/* Live Connection Stability Tooltip Popover */}
      {open && (
        <div
          id="header-health-tooltip"
          role="tooltip"
          dir="rtl"
          className="fixed inset-x-4 top-[4.5rem] z-50 rounded-xl border border-slate-200 bg-white p-4 text-right shadow-xl dark:border-slate-700 dark:bg-[#111827] sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-80"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
            <div className="flex items-start gap-2 min-w-0">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconCls}`} />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  سلامت اتصال: {health.shortLabel}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {health.headline}
                </p>
              </div>
            </div>
          </div>

          {health.checks.length > 0 && (
            <div className="mt-3 space-y-2.5">
              {health.checks.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                    <LayerStateIcon state={item.state} />
                    <span>{item.label}</span>
                  </span>
                  <span
                    className={`text-[11px] font-medium tabular-nums ${
                      item.state === 'ok'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : item.state === 'warn'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {item.detail}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-2.5 text-[11px] text-slate-400 dark:border-slate-800">
            <span>
              پایش لحظه‌ای ·{' '}
              <span className="font-mono tabular-nums" dir="ltr">
                {updatedLabel}
              </span>
            </span>

            {health.level !== 'healthy' && (
              <button
                type="button"
                onClick={() => {
                  setHovered(false);
                  setPinned(false);
                  onOpenTroubleshooter();
                }}
                className="inline-flex items-center gap-1 font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
              >
                <Wrench className="h-3 w-3" />
                تعمیر خودکار
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
