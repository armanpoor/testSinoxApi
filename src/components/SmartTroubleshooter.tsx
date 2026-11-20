import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  RefreshCw,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  parseSafeJsonResponse,
  type AutoHealReport,
  type AutoHealStepResult,
  type DiagnosisReport,
} from '../lib/diagnostics';

interface SmartTroubleshooterProps {
  contextError?: string;
  contextSource?: string;
  compact?: boolean;
  onHealed?: () => Promise<void> | void;
  onRetry?: () => Promise<void> | void;
  onNotify?: (msg: string, tone?: 'ok' | 'err') => void;
}

function stepStatusMeta(status: AutoHealStepResult['status']): { label: string; cls: string } {
  switch (status) {
    case 'fixed':
      return { label: 'تعمیر شد', cls: 'text-emerald-600 dark:text-emerald-400' };
    case 'ok':
      return { label: 'سالم', cls: 'text-blue-600 dark:text-blue-400' };
    case 'blocked':
      return { label: 'نیازمند محیط محلی', cls: 'text-amber-600 dark:text-amber-400' };
    case 'skipped':
      return { label: 'رد شد', cls: 'text-slate-500 dark:text-slate-400' };
    default:
      return { label: 'ناموفق', cls: 'text-red-600 dark:text-red-400' };
  }
}

export function SmartTroubleshooter({
  contextError,
  contextSource,
  compact = false,
  onHealed,
  onRetry,
  onNotify,
}: SmartTroubleshooterProps) {
  const [diagnosis, setDiagnosis] = useState<DiagnosisReport | null>(null);
  const [loadingDiag, setLoadingDiag] = useState(false);
  const [healing, setHealing] = useState(false);
  const [healReport, setHealReport] = useState<AutoHealReport | null>(null);
  const [copiedClaude, setCopiedClaude] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  const runDiagnose = useCallback(async () => {
    setLoadingDiag(true);
    setFetchErr(null);
    try {
      const params = new URLSearchParams();
      if (contextError) params.set('error', contextError.slice(0, 400));
      if (contextSource) params.set('source', contextSource);
      const qs = params.toString();
      const res = await fetch(`/api/control/diagnose${qs ? `?${qs}` : ''}`);
      const parsed = await parseSafeJsonResponse<DiagnosisReport>(res);
      if (!parsed.ok || !parsed.data) {
        setFetchErr(parsed.error || 'دریافت گزارش عیب‌یابی ناموفق بود.');
      } else {
        setDiagnosis(parsed.data);
      }
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : 'خطای ارتباط با سرور عیب‌یاب');
    } finally {
      setLoadingDiag(false);
    }
  }, [contextError, contextSource]);

  useEffect(() => {
    void runDiagnose();
  }, [runDiagnose]);

  const handleAutoHeal = async () => {
    setHealing(true);
    setFetchErr(null);
    try {
      const res = await fetch('/api/control/auto-heal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: contextError,
          source: contextSource || 'ui-troubleshooter',
        }),
      });
      const parsed = await parseSafeJsonResponse<AutoHealReport>(res);
      if (!parsed.ok || !parsed.data) {
        const msg = parsed.error || 'اجرای تعمیر خودکار ناموفق بود';
        setFetchErr(msg);
        onNotify?.(msg, 'err');
        return;
      }

      setHealReport(parsed.data);
      setDiagnosis(parsed.data.diagnosisAfter);
      await onHealed?.();

      if (parsed.data.ok) {
        onNotify?.(
          parsed.data.healedCount > 0
            ? `تعمیر خودکار موفق بود (${parsed.data.healedCount} مورد برطرف شد)`
            : 'تمام سرویس‌ها سالم و آماده هستند',
          'ok'
        );
        if (onRetry) {
          await onRetry();
        }
      } else if (parsed.data.healedCount > 0) {
        onNotify?.(
          `${parsed.data.healedCount} مورد خودکار اصلاح شد، اما ${parsed.data.remainingIssues} مورد نیازمند اجرای محلی یا Claude Code است`,
          'err'
        );
      } else {
        onNotify?.('برخی مشکلات خارج از دسترسی مرورگر است — پرامپت تعمیر خودکار برای Claude Code آماده شد', 'err');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'خطای ارتباط هنگام تعمیر خودکار';
      setFetchErr(msg);
      onNotify?.(msg, 'err');
    } finally {
      setHealing(false);
    }
  };

  const handleCopyClaudePrompt = async () => {
    const text =
      diagnosis?.suggestedClaudePrompt ||
      'این پروژه را طبق CLAUDE.md با `npm run heal` به‌صورت کامل بالا بیاور و مشکل اتصال را خودت حل کن.';
    try {
      await navigator.clipboard.writeText(text);
      setCopiedClaude(true);
      onNotify?.('دستور تعمیر خودکار برای Claude Code کپی شد', 'ok');
      setTimeout(() => setCopiedClaude(false), 2000);
    } catch {
      onNotify?.('کپی خودکار ناموفق بود — متن پرامپت را دستی کپی کنید', 'err');
    }
  };

  return (
    <div
      aria-label="ریشه‌یابی هوشمند و تعمیر خودکار"
      className={`rounded-xl border border-amber-300/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-slate-900/80 ${
        compact ? 'p-4' : 'p-5'
      }`}
    >
      {/* Header & Action Controls */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Wrench className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>ریشه‌یابی هوشمند و تعمیر خودکار</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {loadingDiag && !diagnosis
              ? 'در حال اسکن لایه‌های موتور، پل، تراتل، کلیدها و محیط اجرا...'
              : diagnosis?.summary || fetchErr || 'در حال آماده‌سازی گزارش ریشه‌یابی...'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={healing}
            onClick={() => void handleAutoHeal()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            <Wrench className={`h-3.5 w-3.5 ${healing ? 'animate-spin' : ''}`} />
            {healing ? 'در حال تعمیر خودکار...' : 'تعمیر خودکار توسط سرور'}
          </button>

          <button
            type="button"
            onClick={() => void handleCopyClaudePrompt()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {copiedClaude ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedClaude ? 'کپی شد برای Claude Code' : 'کپی دستور برای Claude Code'}
          </button>

          {onRetry && (
            <button
              type="button"
              disabled={healing}
              onClick={() => void onRetry()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              تست مجدد
            </button>
          )}
        </div>
      </div>

      {fetchErr && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {fetchErr}
        </div>
      )}

      {/* Root-Cause Findings */}
      {diagnosis && diagnosis.findings.length > 0 && (
        <div className="mt-4 space-y-2">
          {diagnosis.findings.map((f) => (
            <div
              key={f.code}
              className="rounded-lg border border-slate-200/90 bg-white p-3 text-xs dark:border-slate-800 dark:bg-[#111827]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                  {f.severity === 'critical' ? (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  )}
                  <span>{f.title}</span>
                </div>
                <span className="font-mono text-[11px] text-slate-400" dir="ltr">
                  {f.code}
                </span>
              </div>
              <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-400">{f.detail}</p>
              <p className="mt-1.5 text-[11px] text-blue-600 dark:text-blue-400">
                اقدام خودکار: {f.autoFixAction}
              </p>
            </div>
          ))}
        </div>
      )}

      {diagnosis && diagnosis.healthy && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>تمام لایه‌ها سالم و متصل هستند؛ می‌توانید دوباره تست بگیرید.</span>
        </div>
      )}

      {/* Executed Server Auto-Heal Steps */}
      {healReport && healReport.steps.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-200">
            <span>گزارش مراحل تعمیر خودکار اجراشده توسط سرور</span>
            <span className="font-mono text-[11px] text-slate-400">
              {healReport.healedCount} اصلاح / {healReport.remainingIssues} باقی‌مانده
            </span>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {healReport.steps.map((s) => {
              const st = stepStatusMeta(s.status);
              return (
                <div key={s.id} className="flex flex-wrap items-start justify-between gap-2 px-3.5 py-2.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-slate-900 dark:text-slate-100">{s.label}</span>
                    <p className="mt-0.5 text-slate-500 dark:text-slate-400">{s.detail}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-medium ${st.cls}`}>{st.label}</span>
                    <span className="font-mono text-[11px] tabular-nums text-slate-400" dir="ltr">
                      {s.durationMs}ms
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Claude Code Autonomous CLI Note */}
      <div className="mt-3 flex items-start gap-2 border-t border-slate-200/80 pt-3 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <p>
          در Claude Code کافی است بگویید «پروژه را بالا بیاور و مشکلش را حل کن» — فایل{' '}
          <code className="font-mono text-slate-700 dark:text-slate-300" dir="ltr">
            CLAUDE.md
          </code>{' '}
          و دستور{' '}
          <code className="font-mono text-slate-700 dark:text-slate-300" dir="ltr">
            npm run heal
          </code>{' '}
          تمام مراحل را خودکار هدایت می‌کنند.
        </p>
      </div>
    </div>
  );
}
