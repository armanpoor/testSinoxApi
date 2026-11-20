import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemResourcesSnapshot,
  computeCpuUsagePercent,
  formatBytes,
  formatDurationShort,
  getResourceHealthLevel,
  sumCpuTicks,
} from './systemResources';

test('computeCpuUsagePercent calculates accurate delta usage and clamps edge cases', () => {
  assert.equal(computeCpuUsagePercent({ idle: 1000, total: 2000 }, { idle: 1750, total: 3000 }), 25);
  assert.equal(computeCpuUsagePercent({ idle: 500, total: 1000 }, { idle: 500, total: 1000 }), 0);
  assert.equal(computeCpuUsagePercent({ idle: 100, total: 1000 }, { idle: 100, total: 1500 }), 100);
  assert.equal(computeCpuUsagePercent({ idle: 900, total: 1000 }, { idle: 1100, total: 1100 }), 0);
});

test('sumCpuTicks aggregates multi-core tick counters', () => {
  const totals = sumCpuTicks([
    { times: { user: 100, nice: 10, sys: 40, idle: 350, irq: 0 } },
    { times: { user: 200, nice: 0, sys: 50, idle: 250, irq: 0 } },
  ]);
  assert.equal(totals.idle, 600);
  assert.equal(totals.total, 1000);
});

test('buildSystemResourcesSnapshot computes memory, heap, and load metrics accurately', () => {
  const gb = 1024 ** 3;
  const mb = 1024 ** 2;
  const snap = buildSystemResourcesSnapshot({
    sampledAt: 1_700_000_000_000,
    platform: 'linux',
    arch: 'x64',
    nodeVersion: 'v22.12.0',
    cpuModel: 'AMD EPYC 7B13  ',
    cpuCores: 4,
    cpuUsagePercent: 37.46,
    loadAvg: [0.842, 0.519, 0.331],
    totalMemBytes: 8 * gb,
    freeMemBytes: 2 * gb,
    processRssBytes: 148 * mb,
    processHeapUsedBytes: 45 * mb,
    processHeapTotalBytes: 90 * mb,
    systemUptimeSec: 9370,
    processUptimeSec: 125,
  });

  assert.equal(snap.cpuModel, 'AMD EPYC 7B13');
  assert.equal(snap.cpuUsagePercent, 37.5);
  assert.equal(snap.usedMemBytes, 6 * gb);
  assert.equal(snap.memUsagePercent, 75);
  assert.equal(snap.heapUsagePercent, 50);
  assert.deepEqual(snap.loadAvg, [0.84, 0.52, 0.33]);
});

test('formatBytes, formatDurationShort, and getResourceHealthLevel format cleanly', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.50 KB');
  assert.equal(formatBytes(148 * 1024 * 1024), '148 MB');
  assert.equal(formatBytes(6.25 * 1024 ** 3), '6.25 GB');

  assert.equal(formatDurationShort(42), '42s');
  assert.equal(formatDurationShort(125), '2m 5s');
  assert.equal(formatDurationShort(7380), '2h 3m');
  assert.equal(formatDurationShort(90000), '1d 1h');

  assert.equal(getResourceHealthLevel(32), 'normal');
  assert.equal(getResourceHealthLevel(72), 'elevated');
  assert.equal(getResourceHealthLevel(91), 'critical');
});
