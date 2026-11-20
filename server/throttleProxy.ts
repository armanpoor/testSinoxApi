import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  computeNextDelay,
  CooldownTracker,
  detectSoftBlockText,
  type BurstState,
  type ThrottleConfig,
} from '../src/lib/throttleEngine';
import type { ThrottleLogEntry, ThrottleTelemetry } from '../src/lib/types';
import { store } from './store';

const MAX_LOG_ENTRIES = 60;

export class AsyncStreamingThrottleProxy {
  private server: http.Server | null = null;
  private running = false;
  private activePort = 0;

  private burstState: BurstState = { burstCount: 0, burstLimit: 5, lastRequestAt: 0 };
  private cooldowns = new CooldownTracker();
  private queue: Array<() => void> = [];
  private inFlight = false;

  private totalForwarded = 0;
  private totalCooldownRejected = 0;
  private totalSoftBlocksDetected = 0;
  private recentLogs: ThrottleLogEntry[] = [];

  private getThrottleConfig(): ThrottleConfig {
    const s = store.getSettings();
    return {
      minDelayMs: s.minDelayMs,
      maxDelayMs: s.maxDelayMs,
      burstMin: s.burstMin,
      burstMax: s.burstMax,
      burstPauseMinMs: s.burstPauseMinMs,
      burstPauseMaxMs: s.burstPauseMaxMs,
      nightMultiplier: s.nightMultiplier,
      cooldownSec: s.cooldownSec,
      detectSoftBlock: s.detectSoftBlock,
    };
  }

  private getTargetBaseUrl(): string {
    const s = store.getSettings();
    return (s.throttleTarget === 'engine' ? s.gw2apiUrl : s.bridgeUrl).replace(/\/+$/, '');
  }

  async start(): Promise<{ started: boolean; port: number; error?: string }> {
    const s = store.getSettings();
    if (!s.throttleEnabled) {
      await this.stop();
      return { started: false, port: s.throttlePort };
    }
    if (this.running && this.activePort === s.throttlePort) {
      return { started: true, port: this.activePort };
    }
    await this.stop();

    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        void this.handleRequest(req, res, req.url || '/');
      });
      srv.on('error', (err) => {
        this.running = false;
        this.server = null;
        resolve({ started: false, port: s.throttlePort, error: err.message });
      });
      srv.listen(s.throttlePort, '127.0.0.1', () => {
        this.server = srv;
        this.running = true;
        this.activePort = s.throttlePort;
        resolve({ started: true, port: this.activePort });
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.running = false;
      return;
    }
    const srv = this.server;
    this.server = null;
    this.running = false;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  clearCooldowns(scope?: string): void {
    this.cooldowns.clear(scope);
  }

  getTelemetry(): ThrottleTelemetry {
    const s = store.getSettings();
    return {
      running: this.running,
      port: this.running ? this.activePort : s.throttlePort,
      targetUrl: this.getTargetBaseUrl(),
      queueDepth: this.queue.length,
      inFlight: this.inFlight,
      totalForwarded: this.totalForwarded,
      totalCooldownRejected: this.totalCooldownRejected,
      totalSoftBlocksDetected: this.totalSoftBlocksDetected,
      activeCooldowns: this.cooldowns.listActive(),
      recentLogs: [...this.recentLogs],
    };
  }

  private pushLog(entry: ThrottleLogEntry): void {
    this.recentLogs.unshift(entry);
    if (this.recentLogs.length > MAX_LOG_ENTRIES) {
      this.recentLogs.length = MAX_LOG_ENTRIES;
    }
  }

  private acquireTurn(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  private releaseTurn(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.inFlight = false;
    }
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse, forwardPath: string): Promise<void> {
    const method = (req.method || 'GET').toUpperCase();
    const startedAt = Date.now();

    // Collect body bytes for POST/PUT/PATCH so we can inspect model/stream flags cleanly
    const chunks: Buffer[] = [];
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    }
    const bodyBuf = Buffer.concat(chunks);

    let model = '';
    let isStreamReq = false;
    if (bodyBuf.length > 0 && (req.headers['content-type'] || '').includes('json')) {
      try {
        const parsed = JSON.parse(bodyBuf.toString('utf-8')) as Record<string, unknown>;
        if (typeof parsed.model === 'string') model = parsed.model;
        if (parsed.stream === true) isStreamReq = true;
      } catch {
        // Not valid JSON; forward as-is
      }
    }

    // Read-only metadata endpoints like GET /v1/models bypass jitter & queue so UI/IDE never stalls
    const isChatMutation =
      method === 'POST' &&
      (forwardPath.includes('/chat/completions') || forwardPath.includes('/messages') || forwardPath.includes('/responses'));

    if (isChatMutation) {
      const cd = this.cooldowns.check(model || undefined);
      if (cd.blocked) {
        this.totalCooldownRejected++;
        const payload = JSON.stringify({
          error: {
            type: 'rate_limit_error',
            message: `Anti-Ban cooldown active (${cd.scope}: ${cd.reason}). Retry in ${cd.remainingSec}s.`,
          },
        });
        res.writeHead(429, {
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': String(cd.remainingSec),
        });
        res.end(payload);
        this.pushLog({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ts: Date.now(),
          method,
          path: forwardPath,
          model: model || '—',
          status: 429,
          jitterMs: 0,
          durationMs: Date.now() - startedAt,
          stream: isStreamReq,
          softBlocked: false,
          note: `Cooldown (${cd.scope})`,
        });
        return;
      }
    }

    let jitterMs = 0;
    const lockAcquired = isChatMutation;
    if (lockAcquired) {
      await this.acquireTurn();
    }

    try {
      const cfg = this.getThrottleConfig();
      if (isChatMutation) {
        const now = Date.now();
        const plan = computeNextDelay(cfg, this.burstState, now, new Date(now).getHours());
        this.burstState = plan.nextState;
        jitterMs = plan.waitMs;
        if (jitterMs > 0) {
          await new Promise((r) => setTimeout(r, jitterMs));
        }
      }

      const targetUrl = new URL(forwardPath, `${this.getTargetBaseUrl()}/`);
      const transport = targetUrl.protocol === 'https:' ? https : http;
      const forwardHeaders: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!v) continue;
        const lower = k.toLowerCase();
        if (['host', 'connection', 'content-length'].includes(lower)) continue;
        forwardHeaders[k] = v;
      }
      if (bodyBuf.length > 0) {
        forwardHeaders['content-length'] = String(bodyBuf.length);
      }

      await new Promise<void>((resolve) => {
        const upReq = transport.request(
          targetUrl,
          {
            method,
            headers: forwardHeaders,
            timeout: 600_000,
          },
          (upRes) => {
            const status = upRes.statusCode || 502;
            const contentType = String(upRes.headers['content-type'] || '');
            const isEventStream = contentType.includes('text/event-stream') || isStreamReq;

            if (status === 429 || status === 502) {
              const scope = status === 502 && model ? model : 'global';
              this.cooldowns.trigger(scope, cfg.cooldownSec, `Upstream HTTP ${status}`);
            }

            // Copy response headers while keeping chunked/SSE streaming intact
            const outHeaders: Record<string, string | string[]> = {};
            for (const [hk, hv] of Object.entries(upRes.headers)) {
              if (!hv) continue;
              if (hk.toLowerCase() === 'transfer-encoding' && isEventStream) continue;
              outHeaders[hk] = hv;
            }
            if (isEventStream) {
              outHeaders['cache-control'] = 'no-cache';
              outHeaders['x-accel-buffering'] = 'no';
            }

            res.writeHead(status, outHeaders);
            if ('flushHeaders' in res && typeof res.flushHeaders === 'function') {
              res.flushHeaders();
            }

            let sampleText = '';
            let softBlocked = false;

            upRes.on('data', (chunk: Buffer) => {
              // Forward IMMEDIATELY without buffering so SSE streams stay real-time!
              res.write(chunk);
              if (cfg.detectSoftBlock && status === 200 && sampleText.length < 4096) {
                sampleText += chunk.toString('utf-8');
                if (!softBlocked && detectSoftBlockText(sampleText)) {
                  softBlocked = true;
                  this.totalSoftBlocksDetected++;
                  this.cooldowns.trigger(
                    model || 'global',
                    cfg.cooldownSec,
                    'Soft-Block (HTTP 200 refusal text)'
                  );
                }
              }
            });

            upRes.on('end', () => {
              res.end();
              this.totalForwarded++;
              this.pushLog({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                ts: Date.now(),
                method,
                path: forwardPath,
                model: model || '—',
                status,
                jitterMs,
                durationMs: Date.now() - startedAt,
                stream: isEventStream,
                softBlocked,
                note: softBlocked ? 'تشخیص Soft-Block (200)' : undefined,
              });
              resolve();
            });

            upRes.on('error', (err) => {
              if (!res.writableEnded) res.end();
              this.pushLog({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                ts: Date.now(),
                method,
                path: forwardPath,
                model: model || '—',
                status: 502,
                jitterMs,
                durationMs: Date.now() - startedAt,
                stream: isEventStream,
                softBlocked: false,
                note: err.message,
              });
              resolve();
            });
          }
        );

        upReq.on('error', (err) => {
          const payload = JSON.stringify({
            error: {
              type: 'upstream_unreachable',
              message: `Upstream ${this.getTargetBaseUrl()} unreachable: ${err.message}`,
            },
          });
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          }
          res.end(payload);
          this.pushLog({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ts: Date.now(),
            method,
            path: forwardPath,
            model: model || '—',
            status: 502,
            jitterMs,
            durationMs: Date.now() - startedAt,
            stream: isStreamReq,
            softBlocked: false,
            note: 'بالادست خاموش است',
          });
          resolve();
        });

        if (bodyBuf.length > 0) {
          upReq.write(bodyBuf);
        }
        upReq.end();
      });
    } finally {
      if (lockAcquired) {
        this.releaseTurn();
      }
    }
  }
}

export const throttleProxy = new AsyncStreamingThrottleProxy();
