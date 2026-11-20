import test from 'node:test';
import assert from 'node:assert/strict';
import { filterLogs, formatLogsAsText, LogRingBuffer } from './logBus';

test('LogRingBuffer bounds capacity and notifies subscribers in real time', () => {
  const buf = new LogRingBuffer(3);
  const seen: string[] = [];
  const unsub = buf.subscribe((e) => seen.push(e.message));

  buf.push('info', 'server', 'boot-1');
  buf.push('warn', 'throttle', 'jitter-2');
  buf.push('error', 'engine', 'offline-3');
  buf.push('info', 'watchdog', 'check-4');
  unsub();
  buf.push('debug', 'sync', 'after-unsub-5');

  assert.equal(buf.size(), 3);
  assert.deepEqual(
    buf.list().map((e) => e.message),
    ['offline-3', 'check-4', 'after-unsub-5']
  );
  assert.deepEqual(seen, ['boot-1', 'jitter-2', 'offline-3', 'check-4']);
});

test('filterLogs filters accurately by level, source, and case-insensitive search query', () => {
  const buf = new LogRingBuffer(10);
  buf.push('info', 'engine', 'Connected to :8093');
  buf.push('error', 'engine', 'HTTP 401 Unauthorized', 'token mismatch');
  buf.push('warn', 'throttle', 'Soft-Block detected on model', 'gemini-4-neon');
  buf.push('error', 'bridge', 'ECONNREFUSED 127.0.0.1:8094');

  const engineErrors = filterLogs(buf.list(), { level: 'error', source: 'engine' });
  assert.equal(engineErrors.length, 1);
  assert.match(engineErrors[0].message, /401/);

  const metaMatch = filterLogs(buf.list(), { query: 'GEMINI-4-NEON' });
  assert.equal(metaMatch.length, 1);
  assert.equal(metaMatch[0].source, 'throttle');
});

test('formatLogsAsText formats structured plain-text lines with metadata', () => {
  const buf = new LogRingBuffer(5);
  buf.push('warn', 'throttle', 'Cooldown triggered', '60s');
  const txt = formatLogsAsText(buf.list());
  assert.match(txt, /\[WARN \]/);
  assert.match(txt, /\[THROTTLE\]/);
  assert.match(txt, /Cooldown triggered \| 60s/);
});
