import { pickActiveApiKey } from '../src/lib/smartSync';
import { emitLog } from './logHub';
import { store } from './store';

export interface UpstreamResponse<T = unknown> {
  ok: boolean;
  status: number;
  offline?: boolean;
  data?: T;
  error?: string;
}

class AdminClient {
  private sessionCookie = '';
  private lastUrl = '';
  private lastToken = '';

  private resetSessionIfChanged(url: string, token: string): void {
    if (url !== this.lastUrl || token !== this.lastToken) {
      this.sessionCookie = '';
      this.lastUrl = url;
      this.lastToken = token;
    }
  }

  private async trySingleLogin(base: string, token: string): Promise<UpstreamResponse> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${base}/admin/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const setCookie =
        res.headers.getSetCookie?.() ||
        (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
      if (setCookie.length > 0) {
        this.sessionCookie = setCookie.map((c) => c.split(';')[0]).join('; ');
      }

      const text = await res.text();
      let data: unknown = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: (data as Record<string, string>)?.error || `ورود ناموفق (HTTP ${res.status})`,
        };
      }

      this.lastUrl = base;
      this.lastToken = token;
      return { ok: true, status: res.status, data };
    } catch (err) {
      return {
        ok: false,
        status: 503,
        offline: true,
        error: `اتصال به موتور وب (${base}) برقرار نشد: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Smart login: tries configured token first, and on 401/403 automatically probes
   * discovered local script tokens & standard defaults, persisting the working token automatically.
   */
  async login(overrideUrl?: string, overrideToken?: string): Promise<UpstreamResponse> {
    const settings = store.getSettings();
    const base = (overrideUrl || settings.gw2apiUrl).replace(/\/+$/, '');
    const primaryToken = overrideToken ?? settings.adminToken;
    this.resetSessionIfChanged(base, primaryToken);

    const first = await this.trySingleLogin(base, primaryToken);
    if (first.ok || first.offline || overrideToken !== undefined) {
      return first;
    }

    // Re-scan local files in case the user restarted 01-start-proxy.ps1 with a new token
    store.discoverLocalFiles();
    const refreshed = store.getSettings().adminToken;
    const candidates = Array.from(
      new Set([refreshed, 'change-me-123', 'testprobe123', ''].filter((t) => t !== primaryToken))
    );

    for (const candidate of candidates) {
      const attempt = await this.trySingleLogin(base, candidate);
      if (attempt.ok) {
        store.updateSettings({ adminToken: candidate });
        emitLog('info', 'sync', `Admin token auto-discovered and authenticated against ${base}`);
        return attempt;
      }
      if (attempt.offline) return attempt;
    }

    if (!first.offline) {
      emitLog('error', 'engine', `Admin login rejected by ${base}`, first.error);
    }
    return first;
  }

  /**
   * Automatically discovers an active API key from :8093 /admin/api/keys,
   * or creates one automatically if none exist, and keeps CLIProxyAPI config.yaml in sync.
   */
  async autoSyncApiKey(): Promise<{ synced: boolean; created: boolean; key?: string; error?: string }> {
    const res = await this.request('GET', '/admin/api/keys');
    if (!res.ok) {
      return { synced: false, created: false, error: res.error };
    }

    let activeKey = pickActiveApiKey(res.data);
    let created = false;

    if (!activeKey) {
      const createRes = await this.request<{ key?: string; api_key?: string; item?: { key?: string } }>(
        'POST',
        '/admin/api/keys',
        { label: 'auto-bridge-harness', name: 'auto-bridge-harness' }
      );
      if (createRes.ok && createRes.data) {
        activeKey =
          createRes.data.key ||
          createRes.data.api_key ||
          createRes.data.item?.key ||
          pickActiveApiKey(createRes.data);
        created = Boolean(activeKey);
      }
    }

    if (activeKey) {
      const current = store.getSettings().gw2apiKey;
      if (current !== activeKey) {
        store.updateSettings({ gw2apiKey: activeKey });
      }
      const yamlSynced = store.syncBridgeYamlKey(activeKey);
      emitLog(
        'info',
        'sync',
        created ? 'Auto-provisioned new engine API key on :8093' : 'Synced active engine API key from :8093',
        yamlSynced ? 'config.yaml updated' : undefined
      );
      return { synced: true, created, key: activeKey };
    }

    return { synced: false, created: false, error: 'کلید API فعالی در موتور یافت نشد' };
  }

  async request<T = unknown>(
    method: string,
    adminPath: string,
    payload?: unknown,
    retryAuth = true
  ): Promise<UpstreamResponse<T>> {
    const settings = store.getSettings();
    const base = settings.gw2apiUrl.replace(/\/+$/, '');
    const cleanPath = adminPath.startsWith('/') ? adminPath : `/${adminPath}`;
    this.resetSessionIfChanged(base, settings.adminToken);

    if (!this.sessionCookie) {
      const logged = await this.login();
      if (!logged.ok) {
        return {
          ok: false,
          status: logged.status,
          offline: logged.offline,
          error: logged.error,
        };
      }
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const headers: Record<string, string> = {};
      if (this.sessionCookie) headers['Cookie'] = this.sessionCookie;
      if (payload !== undefined) headers['Content-Type'] = 'application/json';

      const res = await fetch(`${base}${cleanPath}`, {
        method,
        headers,
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 401 && retryAuth) {
        this.sessionCookie = '';
        return this.request<T>(method, cleanPath, payload, false);
      }

      const text = await res.text();
      let data: T | undefined;
      try {
        data = text ? (JSON.parse(text) as T) : ({} as T);
      } catch {
        data = ({ raw: text } as unknown) as T;
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          data,
          error: (data as Record<string, string>)?.error || `HTTP ${res.status}`,
        };
      }

      return { ok: true, status: res.status, data };
    } catch (err) {
      return {
        ok: false,
        status: 503,
        offline: true,
        error: `موتور وب (${base}) در دسترس نیست: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async pingEndpoint(url: string): Promise<{ online: boolean; latencyMs: number; detail: string }> {
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - start);
      return {
        online: res.status < 500,
        latencyMs,
        detail: `پاسخ HTTP ${res.status}`,
      };
    } catch {
      return {
        online: false,
        latencyMs: Math.round(performance.now() - start),
        detail: 'سرویس روی این آدرس در حال اجرا نیست',
      };
    }
  }
}

export const adminClient = new AdminClient();
