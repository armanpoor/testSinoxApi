import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskSecret,
  parseAdminTokenFromScript,
  parseBridgeYamlCredentials,
  pickActiveApiKey,
  shouldTriggerSelfHeal,
} from './smartSync';

test('pickActiveApiKey skips disabled keys and selects first active key', () => {
  const key = pickActiveApiKey({
    items: [
      { id: 1, key: 'sk-gemini-disabled-000', enabled: false },
      { id: 2, key: 'sk-gemini-active-99999', enabled: true },
    ],
  });
  assert.equal(key, 'sk-gemini-active-99999');
});

test('parseBridgeYamlCredentials extracts client bridge key and upstream engine key', () => {
  const yaml = `
port: 8094
api-keys:
  - "local-auto-bridge-key"
openai-compatibility:
  - name: "gw2api"
    api-key-entries:
      - api-key: "sk-gemini-real-12345"
`;
  const parsed = parseBridgeYamlCredentials(yaml);
  assert.equal(parsed.bridgeKey, 'local-auto-bridge-key');
  assert.equal(parsed.engineKey, 'sk-gemini-real-12345');
});

test('parseAdminTokenFromScript extracts PowerShell AdminToken parameter', () => {
  const ps1 = `param([string]$AdminToken = "my-local-secret-42")`;
  assert.equal(parseAdminTokenFromScript(ps1), 'my-local-secret-42');
});

test('maskSecret and shouldTriggerSelfHeal enforce safe masking and debounce', () => {
  assert.equal(maskSecret('sk-gemini-1234567890'), 'sk-g••••7890');
  assert.equal(maskSecret('short'), '••••••••');
  assert.equal(shouldTriggerSelfHeal(0, 1000, 90_000), true);
  assert.equal(shouldTriggerSelfHeal(10_000, 50_000, 90_000), false);
  assert.equal(shouldTriggerSelfHeal(10_000, 105_000, 90_000), true);
});
