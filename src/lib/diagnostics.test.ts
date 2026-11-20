import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClaudeCodePrompt,
  diagnoseStackState,
  parseSafeJsonResponse,
  type DiagnoseInput,
} from './diagnostics';

function makeBaseInput(): DiagnoseInput {
  return {
    layers: [
      { id: 'engine', name: 'Engine', endpoint: 'http://127.0.0.1:8093', online: true, detail: 'ok' },
      { id: 'bridge', name: 'Bridge', endpoint: 'http://127.0.0.1:8094', online: true, detail: 'ok' },
      { id: 'throttle', name: 'Throttle', endpoint: 'http://127.0.0.1:8095', online: true, detail: 'ok' },
      { id: 'watchdog', name: 'Watchdog', endpoint: '10m', online: true, detail: 'ok' },
    ],
    localEnv: {
      platform: 'win32',
      hasEngineBinary: true,
      hasBridgeBinary: true,
      detectedChromePath: 'C:\\Chrome\\chrome.exe',
      firefoxProfiles: [{ name: 'default-release', path: 'C:\\ff', hasCookiesDb: true }],
      pythonCommand: 'python',
    },
    throttle: {
      running: true,
      port: 8095,
      targetUrl: 'http://127.0.0.1:8094',
      queueDepth: 0,
      inFlight: false,
      totalForwarded: 5,
      totalCooldownRejected: 0,
      totalSoftBlocksDetected: 0,
      activeCooldowns: [],
      recentLogs: [],
    },
    settings: {
      gw2apiUrl: 'http://127.0.0.1:8093',
      bridgeUrl: 'http://127.0.0.1:8094',
      throttlePort: 8095,
      throttleEnabled: true,
      throttleTarget: 'bridge',
    },
    upstream: {
      online: true,
      healthyCookiesCount: 2,
      totalCookiesCount: 2,
      antiBanAudit: [],
    },
  };
}

test('parseSafeJsonResponse catches HTML doctype responses without throwing SyntaxError', async () => {
  const htmlRes = new Response('<!doctype html><html><body>502</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
  const parsed = await parseSafeJsonResponse(htmlRes);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.isHtml, true);
  assert.match(parsed.error || '', /HTML/);

  const jsonErrRes = new Response(JSON.stringify({ error: { message: 'Upstream offline' } }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
  const parsedErr = await parseSafeJsonResponse(jsonErrRes);
  assert.equal(parsedErr.ok, false);
  assert.equal(parsedErr.status, 502);
  assert.equal(parsedErr.error, 'Upstream offline');
});

test('diagnoseStackState identifies healthy stack accurately', () => {
  const report = diagnoseStackState(makeBaseInput());
  assert.equal(report.healthy, true);
  assert.equal(report.findings.length, 0);
  assert.equal(report.environment, 'local');
});

test('diagnoseStackState detects HTML_INSTEAD_OF_JSON, ENGINE_OFFLINE, and BRIDGE_OFFLINE', () => {
  const input = makeBaseInput();
  input.layers[0].online = false;
  input.layers[1].online = false;
  input.upstream.online = false;
  input.upstream.healthyCookiesCount = 0;
  input.contextError = `Unexpected token '<', "<!doctype "... is not valid JSON`;
  input.contextSource = 'playground-chat';

  const report = diagnoseStackState(input);
  const codes = report.findings.map((f) => f.code);
  assert.equal(report.healthy, false);
  assert.ok(codes.includes('HTML_INSTEAD_OF_JSON'));
  assert.ok(codes.includes('ENGINE_OFFLINE'));
  assert.ok(codes.includes('BRIDGE_OFFLINE'));
  assert.match(report.suggestedClaudePrompt, /npm run heal/);
  assert.match(report.suggestedClaudePrompt, /playground-chat/);
});

test('diagnoseStackState detects CLOUD_SANDBOX_ENV when no local binaries or browsers exist', () => {
  const input = makeBaseInput();
  input.layers[0].online = false;
  input.layers[1].online = false;
  input.upstream.online = false;
  input.localEnv = {
    platform: 'linux',
    hasEngineBinary: false,
    hasBridgeBinary: false,
    detectedChromePath: null,
    firefoxProfiles: [],
    pythonCommand: 'python3',
  };

  const report = diagnoseStackState(input);
  assert.equal(report.environment, 'cloud-sandbox');
  assert.ok(report.findings.some((f) => f.code === 'CLOUD_SANDBOX_ENV'));
});

test('diagnoseStackState flags NO_ACTIVE_COOKIES and COOLDOWN_ACTIVE and builds actionable Claude prompt', () => {
  const input = makeBaseInput();
  input.upstream.healthyCookiesCount = 0;
  input.throttle.activeCooldowns = [
    { scope: 'global', until: Date.now() + 30_000, remainingSec: 30, reason: 'Upstream HTTP 429' },
  ];

  const report = diagnoseStackState(input);
  const codes = report.findings.map((f) => f.code);
  assert.ok(codes.includes('NO_ACTIVE_COOKIES'));
  assert.ok(codes.includes('COOLDOWN_ACTIVE'));

  const prompt = buildClaudeCodePrompt(report, { source: 'probe', error: 'HTTP 429' });
  assert.match(prompt, /NO_ACTIVE_COOKIES/);
  assert.match(prompt, /COOLDOWN_ACTIVE/);
});
