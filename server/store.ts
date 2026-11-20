import fs from 'node:fs';
import path from 'node:path';
import type { BridgeSettings, WatchdogSource } from '../src/lib/types';

const ROOT_DIR = process.cwd();
const STATE_FILE = path.join(ROOT_DIR, '.bridge-control-state.json');
const WATCHDOG_SOURCES_FILE = path.join(ROOT_DIR, 'gemini-web-bridge', 'scripts', 'cookie-sources.json');

export const DEFAULT_SETTINGS: BridgeSettings = {
  gw2apiUrl: process.env.GW2API_URL || 'http://127.0.0.1:8093',
  bridgeUrl: process.env.BRIDGE_URL || 'http://127.0.0.1:8094',
  adminToken: process.env.GW2API_ADMIN_TOKEN || 'change-me-123',
  gw2apiKey: process.env.GW2API_KEY || '',
  bridgeKey: process.env.BRIDGE_KEY || 'local-client-key-1',
  cdpPort: Number(process.env.CDP_PORT || 9333),
  throttlePort: Number(process.env.THROTTLE_PORT || 8095),
  throttleEnabled: process.env.THROTTLE_ENABLED !== 'false',
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
  watchdogAutoRun: false,
};

interface PersistedState {
  settings: BridgeSettings;
}

class LocalStore {
  private settings: BridgeSettings = { ...DEFAULT_SETTINGS };
  private sources: WatchdogSource[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as Partial<PersistedState>;
        if (raw.settings) {
          this.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
        }
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
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
