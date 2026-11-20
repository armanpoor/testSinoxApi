import type { SystemResourcesSnapshot } from './types';

export interface CpuTickTotals {
  idle: number;
  total: number;
}

export interface RawSystemMetricsInput {
  sampledAt?: number;
  platform: string;
  arch: string;
  nodeVersion: string;
  cpuModel: string;
  cpuCores: number;
  cpuUsagePercent: number;
  loadAvg: number[];
  totalMemBytes: number;
  freeMemBytes: number;
  processRssBytes: number;
  processHeapUsedBytes: number;
  processHeapTotalBytes: number;
  systemUptimeSec: number;
  processUptimeSec: number;
}

export type ResourceHealthLevel = 'normal' | 'elevated' | 'critical';

/**
 * Computes instantaneous CPU usage percentage (0..100, 1 decimal place)
 * from two cumulative CPU tick totals.
 */
export function computeCpuUsagePercent(prev: CpuTickTotals, curr: CpuTickTotals): number {
  const totalDelta = curr.total - prev.total;
  const idleDelta = curr.idle - prev.idle;
  if (totalDelta <= 0) return 0;
  const busyRatio = (totalDelta - Math.max(0, idleDelta)) / totalDelta;
  const clamped = Math.max(0, Math.min(1, busyRatio));
  return Math.round(clamped * 1000) / 10;
}

/**
 * Aggregates raw CPU core time objects into cumulative { idle, total } ticks.
 */
export function sumCpuTicks(
  cpus: Array<{ times: { user: number; nice: number; sys: number; idle: number; irq: number } }>
): CpuTickTotals {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/**
 * Builds a normalized SystemResourcesSnapshot safe for serialization and UI display.
 */
export function buildSystemResourcesSnapshot(input: RawSystemMetricsInput): SystemResourcesSnapshot {
  const totalMem = Math.max(0, input.totalMemBytes);
  const freeMem = Math.max(0, Math.min(totalMem, input.freeMemBytes));
  const usedMem = Math.max(0, totalMem - freeMem);
  const memUsagePercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 1000) / 10 : 0;

  const heapTotal = Math.max(0, input.processHeapTotalBytes);
  const heapUsed = Math.max(0, input.processHeapUsedBytes);
  const heapUsagePercent =
    heapTotal > 0 ? Math.min(100, Math.round((heapUsed / heapTotal) * 1000) / 10) : 0;

  const loadAvg: [number, number, number] = [
    Math.round((input.loadAvg[0] ?? 0) * 100) / 100,
    Math.round((input.loadAvg[1] ?? 0) * 100) / 100,
    Math.round((input.loadAvg[2] ?? 0) * 100) / 100,
  ];

  const cpuUsagePercent = Math.max(0, Math.min(100, Math.round(input.cpuUsagePercent * 10) / 10));

  return {
    sampledAt: input.sampledAt ?? Date.now(),
    platform: input.platform || 'unknown',
    arch: input.arch || 'unknown',
    nodeVersion: input.nodeVersion || 'v0.0.0',
    cpuModel: input.cpuModel?.trim() || 'Unknown CPU',
    cpuCores: Math.max(1, input.cpuCores || 1),
    cpuUsagePercent,
    loadAvg,
    totalMemBytes: totalMem,
    usedMemBytes: usedMem,
    freeMemBytes: freeMem,
    memUsagePercent,
    processRssBytes: Math.max(0, input.processRssBytes),
    processHeapUsedBytes: heapUsed,
    processHeapTotalBytes: heapTotal,
    heapUsagePercent,
    systemUptimeSec: Math.max(0, Math.floor(input.systemUptimeSec)),
    processUptimeSec: Math.max(0, Math.floor(input.processUptimeSec)),
  };
}

/**
 * Classifies resource utilization percentage into visual health levels.
 */
export function getResourceHealthLevel(percent: number): ResourceHealthLevel {
  if (percent >= 85) return 'critical';
  if (percent >= 65) return 'elevated';
  return 'normal';
}

/**
 * Formats byte counts cleanly for monospace UI readouts (e.g. "1.42 GB", "128 MB").
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  const decimals = idx === 0 ? 0 : val >= 100 ? 0 : val >= 10 ? 1 : 2;
  return `${val.toFixed(decimals)} ${units[idx]}`;
}

/**
 * Formats seconds into a compact duration string (e.g. "2d 4h", "3h 18m", "4m 12s").
 */
export function formatDurationShort(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}
