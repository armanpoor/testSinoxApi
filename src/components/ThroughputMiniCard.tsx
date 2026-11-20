import { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import {
  buildLast60mThroughput,
  type ThroughputBucket,
  type UpstreamStatsSnapshot,
} from '../lib/throughputMetrics';
import type { ThrottleLogEntry } from '../lib/types';

interface ThroughputMiniCardProps {
  recentLogs: ThrottleLogEntry[];
  upstreamStats?: UpstreamStatsSnapshot | null;
  throttlePort: number;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ThroughputBucket }>;
}

function CustomTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0].payload;
  return (
    <div
      dir="rtl"
      className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="font-mono font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
        {bucket.label} (+5m)
      </p>
      <div className="mt-1.5 space-y-1 text-slate-600 dark:text-slate-300">
        <div className="flex items-center justify-between gap-4">
          <span>درخواست‌ها:</span>
          <span className="font-mono font-medium tabular-nums text-blue-600 dark:text-blue-400">
            {bucket.requests}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>خطاها / Soft-Block:</span>
          <span className="font-mono font-medium tabular-nums text-red-600 dark:text-red-400">
            {bucket.errors}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>نرخ خطا:</span>
          <span className="font-mono font-medium tabular-nums" dir="ltr">
            {bucket.errorRate.toFixed(1)}%
          </span>
        </div>
        {bucket.requests > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span>میانگین پاسخ:</span>
            <span className="font-mono tabular-nums" dir="ltr">
              {bucket.avgLatencyMs}ms
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ThroughputMiniCard({
  recentLogs,
  upstreamStats,
  throttlePort,
}: ThroughputMiniCardProps) {
  const summary = useMemo(
    () => buildLast60mThroughput(recentLogs, upstreamStats),
    [recentLogs, upstreamStats]
  );

  const errorTone =
    summary.errorRate60m > 25
      ? 'text-red-600 dark:text-red-400'
      : summary.errorRate60m > 5
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-600 dark:text-emerald-400';

  const maxYLeft = Math.max(4, summary.peakBucketReq + 1);

  return (
    <section
      aria-label="نمودار نرخ عبور و خطای ۶۰ دقیقه اخیر"
      className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]"
    >
      {/* Header & Compact Summary Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <BarChart3 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            نرخ عبور و خطای درخواست‌ها (۶۰ دقیقه اخیر)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            حجم ترافیک عبوری در بازه‌های ۵ دقیقه‌ای به تفکیک تعداد درخواست و درصد خطا (HTTP ≥ 400 یا Soft-Block)
          </p>
        </div>

        <div className="grid w-full grid-cols-3 gap-3 border-t border-slate-200 pt-3 dark:border-slate-800 sm:flex sm:w-auto sm:items-center sm:gap-6 sm:border-t-0 sm:pt-0">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">ترافیک ۶۰ دقیقه</p>
            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100 sm:text-lg">
              {summary.total60m.toLocaleString('en-US')}
            </p>
          </div>
          <div className="hidden h-8 w-px bg-slate-200 dark:bg-slate-800 sm:block" />
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">نرخ خطا</p>
            <p className={`mt-0.5 font-mono text-base font-semibold tabular-nums sm:text-lg ${errorTone}`} dir="ltr">
              {summary.errorRate60m.toFixed(1)}%
            </p>
          </div>
          <div className="hidden h-8 w-px bg-slate-200 dark:bg-slate-800 sm:block" />
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">میانگین پاسخ</p>
            <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100 sm:text-lg" dir="ltr">
              {summary.avgLatencyMs}ms
            </p>
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="px-6 pt-5 pb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-5">
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-xs bg-blue-600" />
              تعداد درخواست (بازه ۵ دقیقه‌ای)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-0.5 w-4 bg-red-500" />
              نرخ خطا (%)
            </span>
          </div>
          {!summary.hasLiveTraffic && (
            <span>
              در انتظار ترافیک روی پورت{' '}
              <span className="font-mono" dir="ltr">
                :{throttlePort}
              </span>
            </span>
          )}
        </div>

        <div dir="ltr" className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={summary.buckets} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#64748B" strokeOpacity={0.18} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                axisLine={{ stroke: '#64748B', strokeOpacity: 0.25 }}
                tickLine={false}
                tickMargin={6}
                minTickGap={28}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="left"
                allowDecimals={false}
                domain={[0, maxYLeft]}
                tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
              <Bar
                yAxisId="left"
                dataKey="requests"
                name="Requests"
                fill="#2563EB"
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="errorRate"
                name="Error Rate %"
                stroke="#EF4444"
                strokeWidth={2}
                dot={{ r: 3, fill: '#EF4444', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#EF4444', strokeWidth: 0 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
