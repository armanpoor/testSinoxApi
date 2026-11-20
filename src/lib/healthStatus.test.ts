import test from 'node:test';
import assert from 'node:assert/strict';
import type { ControlStatusPayload } from '../components/OverviewView';
import { evaluateConnectionHealth } from './healthStatus';

function makeStatus(overrides?: Partial<ControlStatusPayload>): ControlStatusPayload {
  return {
    layers: [
      { id: 'engine', name: 'Engine', endpoint: 'http://127.0.0.1:8093', online: true, detail: 'ok', latencyMs: 14 },
      { id: 'bridge', name: 'Bridge', endpoint: 'http://127.0.0.1:8094', online: true, detail: 'ok' },
      { id: 'throttle', name: 'Throttle', endpoint: 'http://127.0.0.1:8095', online: true, detail: 'ok' },
      { id: 'watchdog', name: 'Watchdog', endpoint: '10m', online: true, detail: 'ok' },
    ],
    throttle: {
      running: true,
      port: 8095,
      targetUrl: 'http://127.0.0.1:8094',
      queueDepth: 0,
      inFlight: false,
      totalForwarded: 12,
      totalCooldownRejected: 0,
      totalSoftBlocksDetected: 0,
      activeCooldowns: [],
      recentLogs: [],
    },
    upstream: {
      online: true,
      stats: null,
      cookies: {
        items: [{ id: 1, label: 'pro-1', status: 'enabled', health: 'ok', fail_count: 0 }],
      },
      models: ['gemini-4-hydrogen'],
      config: null,
      antiBanAudit: [],
    },
    ...overrides,
  };
}

test('evaluateConnectionHealth returns checking/offline when status is null', () => {
  const checking = evaluateConnectionHealth(null, true);
  assert.equal(checking.level, 'checking');

  const offline = evaluateConnectionHealth(null, false);
  assert.equal(offline.level, 'offline');
});

test('evaluateConnectionHealth returns healthy when engine, throttle, and cookies are healthy', () => {
  const res = evaluateConnectionHealth(makeStatus(), false);
  assert.equal(res.level, 'healthy');
  assert.equal(res.onlineCount, 4);
  assert.equal(res.latencyMs, 14);
  assert.equal(res.healthyCookies, 1);
});

test('evaluateConnectionHealth returns degraded when engine is offline but throttle runs, or when cookies/cooldowns fail', () => {
  const noEngine = makeStatus({
    layers: [
      { id: 'engine', name: 'Engine', endpoint: 'http://127.0.0.1:8093', online: false, detail: 'off' },
      { id: 'bridge', name: 'Bridge', endpoint: 'http://127.0.0.1:8094', online: false, detail: 'off' },
      { id: 'throttle', name: 'Throttle', endpoint: 'http://127.0.0.1:8095', online: true, detail: 'ok' },
      { id: 'watchdog', name: 'Watchdog', endpoint: '10m', online: true, detail: 'ok' },
    ],
    upstream: {
      online: false,
      stats: null,
      cookies: null,
      models: [],
      config: null,
      antiBanAudit: [],
    },
  });
  const res1 = evaluateConnectionHealth(noEngine, false);
  assert.equal(res1.level, 'degraded');
  assert.equal(res1.onlineCount, 1);

  const cooldownActive = makeStatus();
  cooldownActive.throttle.activeCooldowns = [
    { scope: 'global', until: Date.now() + 30_000, remainingSec: 30, reason: '429' },
  ];
  const res2 = evaluateConnectionHealth(cooldownActive, false);
  assert.equal(res2.level, 'degraded');
  assert.equal(res2.activeCooldowns, 1);
});

test('evaluateConnectionHealth returns offline when both engine and throttle are stopped', () => {
  const down = makeStatus({
    layers: [
      { id: 'engine', name: 'Engine', endpoint: 'http://127.0.0.1:8093', online: false, detail: 'off' },
      { id: 'bridge', name: 'Bridge', endpoint: 'http://127.0.0.1:8094', online: false, detail: 'off' },
      { id: 'throttle', name: 'Throttle', endpoint: 'http://127.0.0.1:8095', online: false, detail: 'off' },
    ],
    throttle: {
      running: false,
      port: 8095,
      targetUrl: 'http://127.0.0.1:8094',
      queueDepth: 0,
      inFlight: false,
      totalForwarded: 0,
      totalCooldownRejected: 0,
      totalSoftBlocksDetected: 0,
      activeCooldowns: [],
      recentLogs: [],
    },
    upstream: {
      online: false,
      stats: null,
      cookies: null,
      models: [],
      config: null,
      antiBanAudit: [],
    },
  });
  const res = evaluateConnectionHealth(down, false);
  assert.equal(res.level, 'offline');
  assert.equal(res.onlineCount, 0);
});
