/**
 * Pure helpers for zero-config auto-discovery, credential syncing, and self-healing debounce.
 */

export interface UpstreamApiKeyRecord {
  id?: number;
  key?: string;
  api_key?: string;
  token?: string;
  label?: string;
  name?: string;
  enabled?: boolean;
  status?: string;
}

export interface AutoSyncEvent {
  ts: number;
  kind: 'token' | 'api-key' | 'bridge-key' | 'cookie-rotate' | 'cookie-refresh' | 'anti-ban';
  ok: boolean;
  detail: string;
}

/**
 * Extracts the first usable active API key from gemini-web2api-go /admin/api/keys payload.
 */
export function pickActiveApiKey(payload: unknown): string | null {
  const list: UpstreamApiKeyRecord[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { items?: unknown[] })?.items)
      ? ((payload as { items: UpstreamApiKeyRecord[] }).items)
      : Array.isArray((payload as { keys?: unknown[] })?.keys)
        ? ((payload as { keys: UpstreamApiKeyRecord[] }).keys)
        : [];

  for (const item of list) {
    if (item.enabled === false || item.status === 'disabled') continue;
    const candidate = item.key || item.api_key || item.token;
    if (typeof candidate === 'string' && candidate.trim().length >= 8) {
      return candidate.trim();
    }
  }
  return null;
}

/**
 * Parses CLIProxyAPI config.yaml to discover client api-keys and upstream engine key without external YAML deps.
 */
export function parseBridgeYamlCredentials(yamlText: string): {
  bridgeKey: string | null;
  engineKey: string | null;
} {
  let bridgeKey: string | null = null;
  let engineKey: string | null = null;

  const lines = yamlText.split(/\r?\n/);
  let inClientKeys = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (/^api-keys\s*:/i.test(line)) {
      inClientKeys = true;
      continue;
    }
    if (inClientKeys) {
      const m = line.match(/^-\s*["']?([^"'\s#]+)["']?/);
      if (m) {
        if (!bridgeKey) bridgeKey = m[1];
        continue;
      }
      if (!rawLine.startsWith(' ') && !rawLine.startsWith('\t')) {
        inClientKeys = false;
      }
    }

    const apiKeyMatch = line.match(/^(?:-\s*)?api-key\s*:\s*["']?([^"'\s#]+)["']?/i);
    if (apiKeyMatch && apiKeyMatch[1] && !apiKeyMatch[1].includes('YOUR-KEY')) {
      engineKey = apiKeyMatch[1];
    }
  }

  return { bridgeKey, engineKey };
}

/**
 * Extracts ADMIN_TOKEN default value from PowerShell launcher if user customized it locally.
 */
export function parseAdminTokenFromScript(ps1Text: string): string | null {
  const m = ps1Text.match(/\$AdminToken\s*=\s*["']([^"']+)["']/i);
  if (m && m[1] && m[1].trim()) return m[1].trim();
  const m2 = ps1Text.match(/ADMIN_TOKEN\s*=\s*["']?([^"'\s\r\n]+)["']?/i);
  if (m2 && m2[1] && m2[1].trim()) return m2[1].trim();
  return null;
}

/**
 * Masks sensitive values for safe display in the UI while keeping prefix/suffix recognizable.
 */
export function maskSecret(value: string): string {
  const v = value.trim();
  if (!v) return '—';
  if (v.length <= 8) return '••••••••';
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

/**
 * Rate-limits reactive self-healing triggers so a burst of upstream errors runs only one heal pass.
 */
export function shouldTriggerSelfHeal(
  lastHealAtMs: number,
  nowMs: number,
  cooldownMs = 90_000
): boolean {
  if (lastHealAtMs <= 0) return true;
  return nowMs - lastHealAtMs >= cooldownMs;
}
