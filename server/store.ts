import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseAdminTokenFromScript,
  parseBridgeYamlCredentials,
} from '../src/lib/smartSync';
import type { BridgeSettings, WatchdogSource } from '../src/lib/types';

const ROOT_DIR = process.cwd();
const STATE_FILE = path.join(ROOT_DIR, '.bridge-control-state.json');
const WATCHDOG_SOURCES_FILE = path.join(ROOT_DIR, 'gemini-web-bridge', 'scripts', 'cookie-sources.json');
const BRIDGE_YAML_FILE = path.join(ROOT_DIR, 'gemini-web-bridge', 'bin-cpa', 'cfg', 'config.yaml');
const PROXY_PS1_FILE = path.join(ROOT_DIR, 'gemini-web-bridge', 'scripts', '01-start-proxy.ps1');

function generateLocalSecret(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
}

export const DEFAULT_SETTINGS: BridgeSettings = {
  gw2apiUrl: 'http://127.0.0.1:8093',
  bridgeUrl: 'http://127.0.0.1:8094',
  adminToken: 'change-me-123',
  gw2apiKey: '',
  bridgeKey: 'local-client-key-1',
  cdpPort: 9333,
  throttlePort: 8095,
  throttleEnabled: true,
  throttleTarget: 'bridge',
  minDelayMs: 2000,
  maxDelayMs: 7000,
  burstMin: 3,
  burstMax: 7,
  burstPauseMinMs: 8000,
  burstPauseMaxMs: 25000,
  nightMultiplier: 2.5,
  cooldownSec: 60,
  detectSoftBlock: true,
  watchdogIntervalMin: 10,
  watchdogAutoRun: true,
};

interface PersistedState {
  settings: BridgeSettings;
}

class LocalStore {
  private settings: BridgeSettings = { ...DEFAULT_SETTINGS };
  private sources: WatchdogSource[] = [];

  constructor() {
    this.load();
    this.discoverLocalFiles();
  }

  private load(): void {
    let loadedFromDisk = false;
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as Partial<PersistedState>;
        if (raw.settings) {
          this.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
          loadedFromDisk = true;
        }
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }

    // Ensure valid non-empty local bridge key automatically on first boot
    if (!this.settings.bridgeKey || this.settings.bridgeKey === 'local-client-key-1') {
      if (!loadedFromDisk) {
        this.settings.bridgeKey = generateLocalSecret('gwb-local');
      }
    }

    try {
      if (fs.existsSync(WATCHDOG_SOURCES_FILE)) {
        const raw = JSON.parse(fs.readFileSync(WATCHDOG_SOURCES_FILE, 'utf-8'));
        const list = Array.isArray(raw?.accounts) ? raw.accounts : [];
        this.sources = list.map((a: Record<string, unknown>, idx: number) => ({
          id: String(a.id || `src-${idx + 1}`),
          label: String(a.label || ''),
          browserType: a.browser_type === 'firefox' ? 'firefox' : 'chrome-cdp',
          profileDir: String(a.profile_dir || ''),
          profileName: String(a.profile_name || 'Default'),
          authuser: Number(a.authuser || 0),
          note: typeof a.note === 'string' ? a.note : '',
        }));
      }
    } catch {
      this.sources = [];
    }
  }

  /**
   * Automatically discovers existing local tokens/keys from CLIProxyAPI config.yaml and scripts.
   */
  discoverLocalFiles(): { discoveredBridgeKey: boolean; discoveredEngineKey: boolean; discoveredAdminToken: boolean } {
    let discoveredBridgeKey = false;
    let discoveredEngineKey = false;
    let discoveredAdminToken = false;

    try {
      if (fs.existsSync(BRIDGE_YAML_FILE)) {
        const yaml = fs.readFileSync(BRIDGE_YAML_FILE, 'utf-8');
        const parsed = parseBridgeYamlCredentials(yaml);
        if (parsed.bridgeKey) {
          this.settings.bridgeKey = parsed.bridgeKey;
          discoveredBridgeKey = true;
        }
        if (parsed.engineKey && !this.settings.gw2apiKey) {
          this.settings.gw2apiKey = parsed.engineKey;
          discoveredEngineKey = true;
        }
      }
    } catch {
      // ignore unreadable yaml
    }

    try {
      if (fs.existsSync(PROXY_PS1_FILE)) {
        const ps1 = fs.readFileSync(PROXY_PS1_FILE, 'utf-8');
        const tok = parseAdminTokenFromScript(ps1);
        if (tok && (!this.settings.adminToken || this.settings.adminToken === 'change-me-123')) {
          this.settings.adminToken = tok;
          discoveredAdminToken = true;
        }
      }
    } catch {
      // ignore
    }

    if (discoveredBridgeKey || discoveredEngineKey || discoveredAdminToken) {
      this.saveState();
    }

    return { discoveredBridgeKey, discoveredEngineKey, discoveredAdminToken };
  }

  /**
   * Keeps local CLIProxyAPI config.yaml synchronized whenever the engine API key changes.
   */
  syncBridgeYamlKey(newEngineKey: string): boolean {
    if (!newEngineKey || !fs.existsSync(BRIDGE_YAML_FILE)) return false;
    try {
      const yaml = fs.readFileSync(BRIDGE_YAML_FILE, 'utf-8');
      const updated = yaml.replace(/(\bapi-key\s*:\s*["']?)([^"'\s#]+)(["']?)/i, `$1${newEngineKey}$3`);
      if (updated !== yaml) {
        fs.writeFileSync(BRIDGE_YAML_FILE, updated, 'utf-8');
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  private saveState(): void {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ settings: this.settings }, null, 2), 'utf-8');
    } catch {
      // Non-fatal in read-only sandboxes
    }
  }

  private saveSources(): void {
    try {
      const dir = path.dirname(WATCHDOG_SOURCES_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const payload = {
        accounts: this.sources.map((s) => ({
          id: s.id,
          label: s.label,
          browser_type: s.browserType,
          profile_dir: s.profileDir,
          profile_name: s.profileName,
          authuser: s.authuser,
          note: s.note || '',
        })),
      };
      fs.writeFileSync(WATCHDOG_SOURCES_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // Non-fatal
    }
  }

  getSettings(): BridgeSettings {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<BridgeSettings>): BridgeSettings {
    this.settings = {
      ...this.settings,
      ...patch,
      cdpPort: Number(patch.cdpPort ?? this.settings.cdpPort) || 9333,
      throttlePort: Number(patch.throttlePort ?? this.settings.throttlePort) || 8095,
      minDelayMs: Math.max(0, Number(patch.minDelayMs ?? this.settings.minDelayMs)),
      maxDelayMs: Math.max(0, Number(patch.maxDelayMs ?? this.settings.maxDelayMs)),
      cooldownSec: Math.max(5, Number(patch.cooldownSec ?? this.settings.cooldownSec)),
      watchdogIntervalMin: Math.max(1, Number(patch.watchdogIntervalMin ?? this.settings.watchdogIntervalMin)),
    };
    this.saveState();
    return this.getSettings();
  }

  getWatchdogSources(): WatchdogSource[] {
    return this.sources.map((s) => ({ ...s }));
  }

  upsertWatchdogSource(input: Omit<WatchdogSource, 'id'> & { id?: string }): WatchdogSource {
    const id = input.id || `src-${Date.now().toString(36)}`;
    const record: WatchdogSource = {
      id,
      label: input.label.trim(),
      browserType: input.browserType === 'firefox' ? 'firefox' : 'chrome-cdp',
      profileDir: input.profileDir.trim(),
      profileName: input.profileName.trim() || 'Default',
      authuser: Math.max(0, Number(input.authuser) || 0),
      note: (input.note || '').trim(),
    };
    const idx = this.sources.findIndex((s) => s.id === id || s.label === record.label);
    if (idx >= 0) {
      this.sources[idx] = record;
    } else {
      this.sources.push(record);
    }
    this.saveSources();
    return record;
  }

  deleteWatchdogSource(id: string): boolean {
    const before = this.sources.length;
    this.sources = this.sources.filter((s) => s.id !== id);
    if (this.sources.length !== before) {
      this.saveSources();
      return true;
    }
    return false;
  }
}

export const store = new LocalStore();
