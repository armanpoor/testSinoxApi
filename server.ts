import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { ANTI_BAN_PRESET, evaluateAntiBanAudit } from './src/lib/configGenerator';
import { parseCookieInput } from './src/lib/cookieParser';
import { extractProbeAnswer, generateCapabilityProbes } from './src/lib/capabilityProbes';
import type { ProbeResult } from './src/lib/types';
import { adminClient } from './server/adminClient';
import { orchestrator } from './server/orchestrator';
import { store } from './server/store';
import { throttleProxy } from './server/throttleProxy';

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Mount built-in Async SSE Throttle Proxy also under /proxy/* for single-port access
  app.use('/proxy', (req, res) => {
    void throttleProxy.handleRequest(req, res, req.url || '/');
  });

  // ── Control Center Settings & Health ──
  app.get('/api/control/status', async (_req, res) => {
    const layers = await orchestrator.getStackStatus();
    const settings = store.getSettings();
    const throttle = throttleProxy.getTelemetry();
    const watchdog = orchestrator.getWatchdogState();

    // Try reading upstream config & stats if online
    let upstreamConfig: Record<string, unknown> | null = null;
    let upstreamStats: Record<string, unknown> | null = null;
    let upstreamCookies: { items?: unknown[]; total?: number; enabled?: number } | null = null;
    let upstreamModels: string[] = [];

    const engineLayer = layers.find((l) => l.id === 'engine');
    if (engineLayer?.online) {
      const [cfgRes, statsRes, ckRes] = await Promise.all([
        adminClient.request<{ config?: Record<string, unknown>; models?: string[] }>('GET', '/admin/api/config'),
        adminClient.request<Record<string, unknown>>('GET', '/admin/api/stats?hours=24'),
        adminClient.request<{ items?: unknown[]; total?: number; enabled?: number }>('GET', '/admin/api/cookies'),
      ]);
      if (cfgRes.ok && cfgRes.data) {
        upstreamConfig = cfgRes.data.config || null;
        upstreamModels = cfgRes.data.models || [];
      }
      if (statsRes.ok && statsRes.data) upstreamStats = statsRes.data;
      if (ckRes.ok && ckRes.data) upstreamCookies = ckRes.data;
    }

    res.json({
      layers,
      settings: {
        ...settings,
        adminToken: settings.adminToken ? '••••••••' : '',
        hasAdminToken: Boolean(settings.adminToken),
      },
      throttle,
      watchdog,
      upstream: {
        online: Boolean(engineLayer?.online),
        stats: upstreamStats,
        cookies: upstreamCookies,
        models: upstreamModels,
        config: upstreamConfig,
        antiBanAudit: evaluateAntiBanAudit(upstreamConfig),
      },
    });
  });

  app.get('/api/control/settings', (_req, res) => {
    res.json(store.getSettings());
  });

  app.put('/api/control/settings', async (req, res) => {
    const patch = req.body || {};
    const updated = store.updateSettings(patch);
    orchestrator.syncWatchdogSchedule();
    const throttleRes = updated.throttleEnabled
      ? await throttleProxy.start()
      : (await throttleProxy.stop(), { started: false, port: updated.throttlePort });
    res.json({ ok: true, settings: updated, throttle: throttleRes });
  });

  app.post('/api/control/auth/test', async (req, res) => {
    const { gw2apiUrl, adminToken } = req.body || {};
    const result = await adminClient.login(gw2apiUrl, adminToken);
    res.status(result.ok ? 200 : result.status || 401).json(result);
  });

  // ── Process Orchestrator Controls ──
  app.post('/api/control/process/:target/:action', (req, res) => {
    const target = req.params.target === 'bridge' ? 'bridge' : 'engine';
    const action = req.params.action;
    const out =
      action === 'start'
        ? orchestrator.startManagedBinary(target)
        : orchestrator.stopManagedBinary(target);
    res.status(out.ok ? 200 : 400).json(out);
  });

  // ── Anti-Ban Hardening Preset (Non-destructive merge!) ──
  app.post('/api/control/anti-ban/apply', async (_req, res) => {
    const current = await adminClient.request<{ config?: Record<string, unknown> }>('GET', '/admin/api/config');
    if (!current.ok) {
      res.status(current.status).json({ ok: false, error: current.error });
      return;
    }
    const merged = { ...(current.data?.config || {}), ...ANTI_BAN_PRESET };
    const put = await adminClient.request('PUT', '/admin/api/config', merged);
    if (!put.ok) {
      res.status(put.status).json({ ok: false, error: put.error });
      return;
    }
    res.json({
      ok: true,
      applied: ANTI_BAN_PRESET,
      audit: evaluateAntiBanAudit(merged),
    });
  });

  // ── Throttle Proxy Controls & Telemetry ──
  app.get('/api/control/throttle', (_req, res) => {
    res.json(throttleProxy.getTelemetry());
  });

  app.post('/api/control/throttle/clear-cooldown', (req, res) => {
    const scope = typeof req.body?.scope === 'string' ? req.body.scope : undefined;
    throttleProxy.clearCooldowns(scope);
    res.json({ ok: true, telemetry: throttleProxy.getTelemetry() });
  });

  app.post('/api/control/throttle/toggle', async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    store.updateSettings({ throttleEnabled: enabled });
    const result = enabled
      ? await throttleProxy.start()
      : (await throttleProxy.stop(), { started: false, port: store.getSettings().throttlePort });
    res.json({ ok: true, ...result, telemetry: throttleProxy.getTelemetry() });
  });

  // ── Cookie Parser, Local Chrome CDP & Atomic Watchdog ──
  app.post('/api/control/cookies/parse', (req, res) => {
    const raw = typeof req.body?.raw === 'string' ? req.body.raw : '';
    res.json(parseCookieInput(raw));
  });

  app.post('/api/control/cookies/extract-cdp', async (req, res) => {
    const cdpPort = req.body?.cdpPort ? Number(req.body.cdpPort) : undefined;
    const out = await orchestrator.extractFromLocalChromeCDP(cdpPort);
    res.status(out.ok ? 200 : 400).json(out);
  });

  app.get('/api/control/watchdog', (_req, res) => {
    res.json(orchestrator.getWatchdogState());
  });

  app.post('/api/control/watchdog/sources', (req, res) => {
    const { id, label, browserType, profileDir, profileName, authuser, note } = req.body || {};
    if (!label || !String(label).trim()) {
      res.status(400).json({ ok: false, error: 'نام (label) اکانت الزامی است.' });
      return;
    }
    const saved = store.upsertWatchdogSource({
      id,
      label: String(label),
      browserType: browserType === 'firefox' ? 'firefox' : 'chrome-cdp',
      profileDir: String(profileDir || ''),
      profileName: String(profileName || 'Default'),
      authuser: Number(authuser || 0),
      note: String(note || ''),
    });
    res.json({ ok: true, source: saved, sources: store.getWatchdogSources() });
  });

  app.delete('/api/control/watchdog/sources/:id', (req, res) => {
    const deleted = store.deleteWatchdogSource(req.params.id);
    res.json({ ok: deleted, sources: store.getWatchdogSources() });
  });

  app.post('/api/control/watchdog/run', async (_req, res) => {
    const out = await orchestrator.runAtomicWatchdogCycle();
    res.status(out.ok ? 200 : 503).json(out);
  });

  // ── Live Streaming Playground Proxy (SSE Passthrough) ──
  app.post('/api/control/playground/chat', async (req, res) => {
    const s = store.getSettings();
    const { model, messages, stream = true, useThrottle = true, enableToolTest = false } = req.body || {};
    const targetBase = useThrottle
      ? `http://127.0.0.1:${s.throttlePort}`
      : s.gw2apiUrl.replace(/\/+$/, '');
    const apiKey = useThrottle && s.throttleTarget === 'bridge' ? s.bridgeKey : s.gw2apiKey;

    const payload: Record<string, unknown> = {
      model: model || 'gemini-4-hydrogen',
      messages: Array.isArray(messages) ? messages : [],
      stream: Boolean(stream),
    };
    if (enableToolTest) {
      payload.tools = [
        {
          type: 'function',
          function: {
            name: 'get_time',
            description: 'Get current local time for a timezone',
            parameters: {
              type: 'object',
              properties: { tz: { type: 'string' } },
              required: ['tz'],
            },
          },
        },
      ];
      payload.tool_choice = 'auto';
    }

    try {
      const up = await fetch(`${targetBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      res.status(up.status);
      const ct = up.headers.get('content-type') || 'application/json';
      res.setHeader('Content-Type', ct);
      if (ct.includes('text/event-stream')) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Accel-Buffering', 'no');
      }

      if (!up.body) {
        res.end();
        return;
      }

      const reader = up.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (err) {
      res.status(503).json({
        error: `اتصال به ${targetBase} برقرار نشد: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // ── Capability Probe Generator & Live Runner ──
  app.get('/api/control/probes/preview', (req, res) => {
    const seed = req.query.seed ? Number(req.query.seed) : undefined;
    res.json(generateCapabilityProbes(Number.isFinite(seed) ? seed : undefined));
  });

  app.post('/api/control/probes/run', async (req, res) => {
    const s = store.getSettings();
    const models: string[] = Array.isArray(req.body?.models) && req.body.models.length
      ? req.body.models
      : ['gemini-4-hydrogen'];
    const { seed, probes } = generateCapabilityProbes(req.body?.seed ? Number(req.body.seed) : undefined);
    const chosenProbes = probes.slice(0, Math.min(probes.length, Number(req.body?.limit || 3)));
    const targetBase = s.gw2apiUrl.replace(/\/+$/, '');
    const results: ProbeResult[] = [];

    for (const model of models) {
      for (const p of chosenProbes) {
        const t0 = performance.now();
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 90_000);
          const r = await fetch(`${targetBase}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(s.gw2apiKey ? { Authorization: `Bearer ${s.gw2apiKey}` } : {}),
            },
            body: JSON.stringify({
              model,
              stream: false,
              messages: [{ role: 'user', content: p.prompt }],
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          const durationMs = Math.round(performance.now() - t0);
          if (!r.ok) {
            const errTxt = (await r.text()).slice(0, 180);
            results.push({
              probeId: p.id,
              probeName: p.name,
              model,
              passed: false,
              expected: p.expected,
              got: null,
              durationMs,
              error: `HTTP ${r.status}: ${errTxt}`,
            });
            continue;
          }
          const json = (await r.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = json.choices?.[0]?.message?.content || '';
          const got = extractProbeAnswer(content);
          results.push({
            probeId: p.id,
            probeName: p.name,
            model,
            passed: got === p.expected,
            expected: p.expected,
            got,
            durationMs,
          });
        } catch (err) {
          results.push({
            probeId: p.id,
            probeName: p.name,
            model,
            passed: false,
            expected: p.expected,
            got: null,
            durationMs: Math.round(performance.now() - t0),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    res.json({ ok: true, seed, results });
  });

  // ── Authenticated Upstream Admin Proxy (/api/admin/* -> :8093/admin/api/*) ──
  app.all('/api/admin/*', async (req, res) => {
    const suffix = req.path.replace(/^\/api\/admin/, '');
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const adminPath = `/admin/api${suffix}${qs}`;

    // Guard against destructive partial PUT /config by merging with current config first
    let body = ['GET', 'HEAD', 'DELETE'].includes(req.method) ? undefined : req.body;
    if (req.method === 'PUT' && suffix === '/config' && body && typeof body === 'object') {
      const existing = await adminClient.request<{ config?: Record<string, unknown> }>('GET', '/admin/api/config');
      if (existing.ok && existing.data?.config) {
        body = { ...existing.data.config, ...body };
      }
    }

    const upstream = await adminClient.request(req.method, adminPath, body);
    res.status(upstream.status).json(upstream.ok ? upstream.data : { error: upstream.error, offline: upstream.offline });
  });

  // Start embedded Async SSE Throttle Proxy on configured port
  const tStart = await throttleProxy.start();
  if (tStart.started) {
    console.log(`[Throttle] Async SSE proxy listening on http://127.0.0.1:${tStart.port}`);
  }

  // Frontend serving (Vite dev middleware in dev, dist/ static in prod)
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Control Center] Ready at http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start Gemini Web Bridge Control Center:', err);
  process.exit(1);
});
