export interface BridgeSettings {
  gw2apiUrl: string;
  bridgeUrl: string;
  adminToken: string;
  gw2apiKey: string;
  bridgeKey: string;
  cdpPort: number;
  throttlePort: number;
  throttleEnabled: boolean;
  throttleTarget: 'bridge' | 'engine';
  minDelayMs: number;
  maxDelayMs: number;
  burstMin: number;
  burstMax: number;
  burstPauseMinMs: number;
  burstPauseMaxMs: number;
  nightMultiplier: number;
  cooldownSec: number;
  detectSoftBlock: boolean;
  watchdogIntervalMin: number;
  watchdogAutoRun: boolean;
}

export interface WatchdogSource {
  id: string;
  label: string;
  browserType: 'firefox' | 'chrome-cdp';
  profileDir: string;
  profileName: string;
  authuser: number;
  note?: string;
}

export interface CookieAccount {
  id: number;
  label: string;
  status: 'enabled' | 'disabled' | string;
  health: 'ok' | 'dead' | 'error' | 'disabled' | string;
  fail_count: number;
  cookie_count?: number;
  has_1psidts?: boolean;
  authuser?: number;
  note?: string;
  last_ok_at?: number;
  last_used_at?: number;
  created_at?: number;
  last_error?: string;
}

export interface ThrottleLogEntry {
  id: string;
  ts: number;
  method: string;
  path: string;
  model: string;
  status: number;
  jitterMs: number;
  durationMs: number;
  stream: boolean;
  softBlocked: boolean;
  note?: string;
}

export interface CooldownStatus {
  scope: string; // 'global' or model id
  until: number;
  remainingSec: number;
  reason: string;
}

export interface ThrottleTelemetry {
  running: boolean;
  port: number;
  targetUrl: string;
  queueDepth: number;
  inFlight: boolean;
  totalForwarded: number;
  totalCooldownRejected: number;
  totalSoftBlocksDetected: number;
  activeCooldowns: CooldownStatus[];
  recentLogs: ThrottleLogEntry[];
}

export interface LayerStatus {
  id: 'engine' | 'bridge' | 'throttle' | 'watchdog';
  name: string;
  endpoint: string;
  online: boolean;
  detail: string;
  latencyMs?: number;
  managedPid?: number | null;
}

export interface AntiBanAuditItem {
  key: string;
  label: string;
  recommended: string | number | boolean;
  current: string | number | boolean | null;
  compliant: boolean;
  reason: string;
}

export interface WatchdogRunRecord {
  ts: number;
  label: string;
  action: 'ok' | 'refreshed' | 'disabled' | 'no-source' | 'error';
  detail: string;
}

export interface ProbeCase {
  id: string;
  name: string;
  prompt: string;
  expected: string;
}

export interface ProbeResult {
  probeId: string;
  probeName: string;
  model: string;
  passed: boolean;
  expected: string;
  got: string | null;
  durationMs: number;
  error?: string;
}
