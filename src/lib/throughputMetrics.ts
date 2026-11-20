import type { ThrottleLogEntry } from './types';

export interface ThroughputBucket {
  ts: number;
  label: string; // HH:MM
  requests: number;
  success: number;
  errors: number;
  errorRate: number; // 0..100
  avgLatencyMs: number;
}

export interface ThroughputSummary {
  buckets: ThroughputBucket[];
  total60m: number;
  errors60m: number;
  errorRate60m: number;
  peakBucketReq: number;
  avgLatencyMs: number;
  hasLiveTraffic: boolean;
}

export interface UpstreamStatsSnapshot {
  total_requests?: number;
  success?: number;
  failures?: number;
  success_rate?: number;
  avg_ms?: number;
}

function formatHHMM(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Aggregates throttle logs from the last 60 minutes into 12 crisp 5-minute buckets
 * for throughput (requests) and error rate (%) visualization.
 */
export function buildLast60mThroughput(
  recentLogs: ThrottleLogEntry[],
  upstreamStats?: UpstreamStatsSnapshot | null,
  nowMs = Date.now(),
  bucketMinutes = 5
): ThroughputSummary {
  const bucketMs = bucketMinutes * 60_000;
  const bucketCount = Math.max(1, Math.round(60 / bucketMinutes));
  // Align bucket end to current minute boundary so labels stay clean
  const alignedEnd = Math.floor(nowMs / 60_000) * 60_000 + 60_000;
  const windowStart = alignedEnd - bucketCount * bucketMs;

  const acc = Array.from({ length: bucketCount }, (_, i) => ({
    ts: windowStart + i * bucketMs,
    requests: 0,
    success: 0,
    errors: 0,
    latencySum: 0,
  }));

  for (const log of recentLogs) {
    if (!Number.isFinite(log.ts) || log.ts < windowStart || log.ts >= alignedEnd) continue;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((log.ts - windowStart) / bucketMs)));
    const slot = acc[idx];
    slot.requests += 1;
    const isErr = log.status >= 400 || Boolean(log.softBlocked);
    if (isErr) {
      slot.errors += 1;
    } else {
      slot.success += 1;
    }
    if (Number.isFinite(log.durationMs) && log.durationMs >= 0) {
      slot.latencySum += log.durationMs;
    }
  }

  let total60m = 0;
  let errors60m = 0;
  let peakBucketReq = 0;
  let totalLatencySum = 0;

  const buckets: ThroughputBucket[] = acc.map((slot) => {
    total60m += slot.requests;
    errors60m += slot.errors;
    if (slot.requests > peakBucketReq) peakBucketReq = slot.requests;
    totalLatencySum += slot.latencySum;

    const errorRate =
      slot.requests > 0 ? Math.round((slot.errors / slot.requests) * 1000) / 10 : 0;
    const avgLatencyMs =
      slot.requests > 0 ? Math.round(slot.latencySum / slot.requests) : 0;

    return {
      ts: slot.ts,
      label: formatHHMM(slot.ts),
      requests: slot.requests,
      success: slot.success,
      errors: slot.errors,
      errorRate,
      avgLatencyMs,
    };
  });

  const hasLiveTraffic = total60m > 0;
  let errorRate60m = hasLiveTraffic ? Math.round((errors60m / total60m) * 1000) / 10 : 0;
  if (!hasLiveTraffic && upstreamStats) {
    if (typeof upstreamStats.failures === 'number' && typeof upstreamStats.total_requests === 'number' && upstreamStats.total_requests > 0) {
      errorRate60m = Math.round((upstreamStats.failures / upstreamStats.total_requests) * 1000) / 10;
    } else if (typeof upstreamStats.success_rate === 'number' && (upstreamStats.total_requests ?? 0) > 0) {
      errorRate60m = Math.round(Math.max(0, (1 - upstreamStats.success_rate) * 1000)) / 10;
    }
  }

  const avgLatencyMs = hasLiveTraffic
    ? Math.round(totalLatencySum / total60m)
    : Math.round(upstreamStats?.avg_ms ?? 0);

  return {
    buckets,
    total60m,
    errors60m,
    errorRate60m,
    peakBucketReq,
    avgLatencyMs,
    hasLiveTraffic,
  };
}
