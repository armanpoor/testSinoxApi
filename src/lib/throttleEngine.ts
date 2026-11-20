export interface ThrottleConfig {
  minDelayMs: number;
  maxDelayMs: number;
  burstMin: number;
  burstMax: number;
  burstPauseMinMs: number;
  burstPauseMaxMs: number;
  nightMultiplier: number;
  cooldownSec: number;
  detectSoftBlock: boolean;
}

export interface BurstState {
  burstCount: number;
  burstLimit: number;
  lastRequestAt: number;
}

export const SOFT_BLOCK_PATTERNS: RegExp[] = [
  /I['’]m having a hard time fulfilling your request/i,
  /Sorry,\s*something went wrong/i,
  /Something went wrong\.\s*Please try again/i,
  /couldn['’]t complete your request right now/i,
  /no content frame/i,
  /no SNlM0e in page/i,
];

export function detectSoftBlockText(sample: string): boolean {
  if (!sample) return false;
  return SOFT_BLOCK_PATTERNS.some((rx) => rx.test(sample));
}

export function randomIntInclusive(min: number, max: number, rand = Math.random): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(rand() * (hi - lo + 1)) + lo;
}

export function computeNextDelay(
  cfg: ThrottleConfig,
  state: BurstState,
  nowMs: number,
  localHour: number,
  rand = Math.random
): { waitMs: number; isBurstPause: boolean; isNight: boolean; nextState: BurstState } {
  const sinceLast = state.lastRequestAt > 0 ? Math.max(0, nowMs - state.lastRequestAt) : Number.POSITIVE_INFINITY;
  let burstCount = state.burstCount + 1;
  let burstLimit = state.burstLimit || randomIntInclusive(cfg.burstMin, cfg.burstMax, rand);
  let targetSpacing: number;
  let isBurstPause = false;

  if (burstCount >= burstLimit) {
    targetSpacing = randomIntInclusive(cfg.burstPauseMinMs, cfg.burstPauseMaxMs, rand);
    burstCount = 0;
    burstLimit = randomIntInclusive(cfg.burstMin, cfg.burstMax, rand);
    isBurstPause = true;
  } else {
    targetSpacing = randomIntInclusive(cfg.minDelayMs, cfg.maxDelayMs, rand);
  }

  const isNight = localHour >= 1 && localHour < 6;
  if (isNight && cfg.nightMultiplier > 1) {
    targetSpacing = Math.round(targetSpacing * cfg.nightMultiplier);
  }

  const waitMs = sinceLast < targetSpacing ? Math.round(targetSpacing - sinceLast) : 0;

  return {
    waitMs,
    isBurstPause,
    isNight,
    nextState: {
      burstCount,
      burstLimit,
      lastRequestAt: nowMs + waitMs,
    },
  };
}

export class CooldownTracker {
  private map = new Map<string, { until: number; reason: string }>();

  trigger(scope: string, durationSec: number, reason: string, nowMs = Date.now()): void {
    const until = nowMs + Math.max(1, durationSec) * 1000;
    const existing = this.map.get(scope);
    if (!existing || existing.until < until) {
      this.map.set(scope, { until, reason });
    }
  }

  clear(scope?: string): void {
    if (scope) {
      this.map.delete(scope);
    } else {
      this.map.clear();
    }
  }

  check(model?: string, nowMs = Date.now()): { blocked: boolean; scope?: string; remainingSec: number; reason?: string } {
    this.prune(nowMs);
    const scopes = model ? ['global', model] : ['global'];
    for (const s of scopes) {
      const entry = this.map.get(s);
      if (entry && entry.until > nowMs) {
        return {
          blocked: true,
          scope: s,
          remainingSec: Math.max(1, Math.ceil((entry.until - nowMs) / 1000)),
          reason: entry.reason,
        };
      }
    }
    return { blocked: false, remainingSec: 0 };
  }

  listActive(nowMs = Date.now()): Array<{ scope: string; until: number; remainingSec: number; reason: string }> {
    this.prune(nowMs);
    const out: Array<{ scope: string; until: number; remainingSec: number; reason: string }> = [];
    for (const [scope, entry] of this.map.entries()) {
      if (entry.until > nowMs) {
        out.push({
          scope,
          until: entry.until,
          remainingSec: Math.max(1, Math.ceil((entry.until - nowMs) / 1000)),
          reason: entry.reason,
        });
      }
    }
    return out;
  }

  private prune(nowMs: number): void {
    for (const [k, v] of this.map.entries()) {
      if (v.until <= nowMs) this.map.delete(k);
    }
  }
}
