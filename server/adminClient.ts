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

  async login(overrideUrl?: string, overrideToken?: string): Promise<UpstreamResponse> {
    const settings = store.getSettings();
    const base = (overrideUrl || settings.gw2apiUrl).replace(/\/+$/, '');
    const token = overrideToken ?? settings.adminToken;
    this.resetSessionIfChanged(base, token);

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

      const setCookie = res.headers.getSetCookie?.() || (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
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
