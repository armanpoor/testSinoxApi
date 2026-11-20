import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLast60mThroughput } from './throughputMetrics';
import type { ThrottleLogEntry } from './types';

function makeLog(overrides: Partial<ThrottleLogEntry> & { ts: number }): ThrottleLogEntry {
  return {
    id: `l-${overrides.ts}`,
    method: 'POST',
    path: '/v1/chat/completions',
    model: 'gemini-4-hydrogen',
    status: 200,
    jitterMs: 1200,
    durationMs: 1800,
    stream: true,
    softBlocked: false,
    ...overrides,
  };
}

test('buildLast60mThroughput produces 12 five-minute buckets and ignores logs older than 60m', () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const logs: ThrottleLogEntry[] = [
    // Older than 60m -> ignored
    makeLog({ ts: now - 75 * 60_000, status: 200 }),
    // Inside latest bucket
    makeLog({ ts: now - 2 * 60_000, status: 200, durationMs: 1000 }),
    makeLog({ ts: now - 1 * 60_000, status: 502, durationMs: 400 }),
    // Soft-block on HTTP 200 counts as error
    makeLog({ ts: now - 30_000, status: 200, softBlocked: true, durationMs: 1600 }),
    // Earlier bucket (~20m ago)
    makeLog({ ts: now - 20 * 60_000, status: 200, durationMs: 2000 }),
  ];

  const out = buildLast60mThroughput(logs, null, now, 5);
  assert.equal(out.buckets.length, 12);
  assert.equal(out.total60m, 4);
  assert.equal(out.errors60m, 2);
  assert.equal(out.errorRate60m, 50);
  assert.equal(out.peakBucketReq, 3);
  assert.equal(out.avgLatencyMs, 1250);
  assert.equal(out.hasLiveTraffic, true);

  const lastBucket = out.buckets[out.buckets.length - 1];
  assert.equal(lastBucket.requests, 3);
  assert.equal(lastBucket.errors, 2);
  assert.equal(lastBucket.errorRate, 66.7);
});

test('buildLast60mThroughput returns zeroed buckets and falls back to upstream stats when no throttle logs exist', () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const out = buildLast60mThroughput(
    [],
    { total_requests: 20, failures: 3, success_rate: 0.85, avg_ms: 940 },
    now
  );
  assert.equal(out.buckets.length, 12);
  assert.equal(out.hasLiveTraffic, false);
  assert.equal(out.total60m, 0);
  assert.equal(out.errorRate60m, 15);
  assert.equal(out.avgLatencyMs, 940);
});
