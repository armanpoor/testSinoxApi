import test from 'node:test';
import assert from 'node:assert/strict';
import { ANTI_BAN_PRESET, evaluateAntiBanAudit, generateToolSnippets } from './configGenerator';

test('evaluateAntiBanAudit marks hardened config 100% compliant and flags loose config', () => {
  const compliant = evaluateAntiBanAudit({ ...ANTI_BAN_PRESET });
  assert.equal(compliant.every((item) => item.compliant), true);

  const loose = evaluateAntiBanAudit({
    per_ip_concurrent: 5,
    per_ip_rpm: 20,
    per_ip_rph: 180,
    retry_attempts: 5,
    retry_delay_sec: 2,
    temporary_chat: false,
    anon_first: false,
    strict_model: false,
    stream_idle_timeout_sec: 300,
  });
  assert.equal(loose.every((item) => !item.compliant), true);
});

test('generateToolSnippets switches URL between throttle port 8095 and direct bridge 8094', () => {
  const throttled = generateToolSnippets({
    useThrottle: true,
    throttlePort: 8095,
    bridgeUrl: 'http://127.0.0.1:8094',
    engineUrl: 'http://127.0.0.1:8093',
    bridgeKey: 'local-client-key-1',
    engineKey: 'sk-gemini-test',
    model: 'gemini-4-hydrogen',
  });
  assert.equal(throttled.anthropicBase, 'http://127.0.0.1:8095');
  assert.ok(throttled.claudePowerShell.includes('8095'));

  const direct = generateToolSnippets({
    useThrottle: false,
    throttlePort: 8095,
    bridgeUrl: 'http://127.0.0.1:8094',
    engineUrl: 'http://127.0.0.1:8093',
    bridgeKey: 'local-client-key-1',
    engineKey: 'sk-gemini-test',
    model: 'gemini-4-neon',
  });
  assert.equal(direct.anthropicBase, 'http://127.0.0.1:8094');
  assert.ok(direct.claudeSettingsJson.includes('gemini-4-neon'));
});
