import { Cpu, MemoryStick, Server } from 'lucide-react';
import {
  formatBytes,
  formatDurationShort,
  getResourceHealthLevel,
  type ResourceHealthLevel,
} from '../lib/systemResources';
import type { SystemResourcesSnapshot } from '../lib/types';

interface SystemResourcesCardProps {
  resources?: SystemResourcesSnapshot | null;
}

function getToneClasses(level: ResourceHealthLevel): { text: string; bar: string } {
  if (level === 'critical') {
    return {
      text: 'text-red-600 dark:text-red-400',
      bar: 'bg-red-500',
    };
  }
  if (level === 'elevated') {
    return {
      text: 'text-amber-600 dark:text-amber-400',
      bar: 'bg-amber-500',
    };
  }
  return {
    text: 'text-slate-900 dark:text-slate-100',
    bar: 'bg-blue-600 dark:bg-blue-500',
  };
}

export function SystemResourcesCard({ resources }: SystemResourcesCardProps) {
  if (!resources) {
    return (
      <section
        aria-label="خلاصه وضعیت منابع سیستم"
        className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#111827]"
      >
        <div className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
          <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          وضعیت منابع سیستم سرور
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          در حال دریافت آمار پردازنده و حافظه از سرور کنترل‌سنتر...
        </p>
      </section>
    );
  }

  const cpuTone = getToneClasses(getResourceHealthLevel(resources.cpuUsagePercent));
  const memTone = getToneClasses(getResourceHealthLevel(resources.memUsagePercent));
  const heapTone = getToneClasses(getResourceHealthLevel(resources.heapUsagePercent));

  const cpuWidth = Math.max(2, Math.min(100, resources.cpuUsagePercent));
  const memWidth = Math.max(2, Math.min(100, resources.memUsagePercent));
  const heapWidth = Math.max(2, Math.min(100, resources.heapUsagePercent));

  return (
    <section
      aria-label="خلاصه وضعیت منابع سیستم"
      className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]"
    >
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            وضعیت منابع سیستم سرور
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            مصرف لحظه‌ای پردازنده، حافظه RAM میزبان و حافظه پردازش کنترل‌سنتر
          </p>
        </div>

        <div
          dir="ltr"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-slate-500 dark:text-slate-400"
        >
          <span>
            {resources.platform}/{resources.arch}
          </span>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span>Node {resources.nodeVersion}</span>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span>Up {formatDurationShort(resources.processUptimeSec)}</span>
        </div>
      </div>

      {/* 3-Column Resource Breakdown */}
      <div className="grid grid-cols-1 divide-y divide-slate-200 dark:divide-slate-800 md:grid-cols-3 md:divide-y-0 md:divide-x md:divide-x-reverse">
        {/* CPU */}
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Cpu className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              پردازنده (CPU)
            </span>
            <span className="text-xs text-slate-400">
              <span className="font-mono tabular-nums">{resources.cpuCores}</span> هسته
            </span>
          </div>

          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            <p className={`font-mono text-2xl font-semibold tabular-nums ${cpuTone.text}`} dir="ltr">
              {resources.cpuUsagePercent.toFixed(1)}%
            </p>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
              Load {resources.loadAvg.map((v) => v.toFixed(2)).join(' / ')}
            </span>
          </div>

          <div
            dir="ltr"
            role="progressbar"
            aria-label="مصرف پردازنده"
            aria-valuenow={Math.round(resources.cpuUsagePercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${cpuTone.bar}`}
              style={{ width: `${cpuWidth}%` }}
            />
          </div>

          {resources.cpuModel && resources.cpuModel.toLowerCase() !== 'unknown' ? (
            <p
              dir="ltr"
              title={resources.cpuModel}
              className="mt-2.5 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400"
            >
              {resources.cpuModel}
            </p>
          ) : (
            <p className="mt-2.5 text-[11px] text-slate-500 dark:text-slate-400">
              پردازنده میزبان (<span className="font-mono" dir="ltr">{resources.platform}/{resources.arch}</span>)
            </p>
          )}
        </div>

        {/* System Memory (RAM) */}
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <MemoryStick className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              حافظه سیستم (RAM)
            </span>
            <span className="font-mono text-xs text-slate-400" dir="ltr">
              {formatBytes(resources.totalMemBytes)}
            </span>
          </div>

          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            <p className={`font-mono text-2xl font-semibold tabular-nums ${memTone.text}`} dir="ltr">
              {resources.memUsagePercent.toFixed(1)}%
            </p>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
              {formatBytes(resources.usedMemBytes)} / {formatBytes(resources.totalMemBytes)}
            </span>
          </div>

          <div
            dir="ltr"
            role="progressbar"
            aria-label="مصرف حافظه سیستم"
            aria-valuenow={Math.round(resources.memUsagePercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${memTone.bar}`}
              style={{ width: `${memWidth}%` }}
            />
          </div>

          <p className="mt-2.5 text-[11px] text-slate-500 dark:text-slate-400">
            حافظه آزاد:{' '}
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300" dir="ltr">
              {formatBytes(resources.freeMemBytes)}
            </span>
            {' · '}
            آپتایم میزبان:{' '}
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300" dir="ltr">
              {formatDurationShort(resources.systemUptimeSec)}
            </span>
          </p>
        </div>

        {/* Node.js Process Memory (RSS & Heap) */}
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Server className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              پردازش سرور (RSS / Heap)
            </span>
            <span className="font-mono text-xs text-slate-400" dir="ltr">
              Heap {resources.heapUsagePercent.toFixed(0)}%
            </span>
          </div>

          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            <p className={`font-mono text-2xl font-semibold tabular-nums ${heapTone.text}`} dir="ltr">
              {formatBytes(resources.processRssBytes)}
            </p>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
              {formatBytes(resources.processHeapUsedBytes)} / {formatBytes(resources.processHeapTotalBytes)}
            </span>
          </div>

          <div
            dir="ltr"
            role="progressbar"
            aria-label="مصرف هیپ پردازش سرور"
            aria-valuenow={Math.round(resources.heapUsagePercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${heapTone.bar}`}
              style={{ width: `${heapWidth}%` }}
            />
          </div>

          <p className="mt-2.5 text-[11px] text-slate-500 dark:text-slate-400">
            حافظه اختصاص‌یافته به سرور Express و پروکسی تراتل استریم
          </p>
        </div>
      </div>
    </section>
  );
}
