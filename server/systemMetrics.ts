import os from 'node:os';
import {
  buildSystemResourcesSnapshot,
  computeCpuUsagePercent,
  sumCpuTicks,
  type CpuTickTotals,
} from '../src/lib/systemResources';
import type { SystemResourcesSnapshot } from '../src/lib/types';

class SystemMetricsCollector {
  private prevTicks: CpuTickTotals;
  private lastCpuPercent = 0;
  private lastSampleAt = 0;

  constructor() {
    const cpus = os.cpus();
    this.prevTicks = sumCpuTicks(cpus);
    // Warm an initial baseline tick after 400ms so the first UI request reflects real delta CPU
    const warmTimer = setTimeout(() => {
      this.sampleCpu();
    }, 400);
    warmTimer.unref?.();
  }

  private sampleCpu(): number {
    const now = Date.now();
    // Avoid sub-250ms rapid double-sampling jitter
    if (now - this.lastSampleAt < 250 && this.lastSampleAt > 0) {
      return this.lastCpuPercent;
    }
    const currTicks = sumCpuTicks(os.cpus());
    if (currTicks.total > this.prevTicks.total) {
      this.lastCpuPercent = computeCpuUsagePercent(this.prevTicks, currTicks);
      this.prevTicks = currTicks;
      this.lastSampleAt = now;
    }
    return this.lastCpuPercent;
  }

  getSnapshot(): SystemResourcesSnapshot {
    const cpus = os.cpus();
    const cpuUsagePercent = this.sampleCpu();
    const mem = process.memoryUsage();
    return buildSystemResourcesSnapshot({
      sampledAt: Date.now(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpuModel: cpus[0]?.model || 'CPU',
      cpuCores: cpus.length || 1,
      cpuUsagePercent,
      loadAvg: os.loadavg(),
      totalMemBytes: os.totalmem(),
      freeMemBytes: os.freemem(),
      processRssBytes: mem.rss,
      processHeapUsedBytes: mem.heapUsed,
      processHeapTotalBytes: mem.heapTotal,
      systemUptimeSec: os.uptime(),
      processUptimeSec: process.uptime(),
    });
  }
}

export const systemMetrics = new SystemMetricsCollector();
