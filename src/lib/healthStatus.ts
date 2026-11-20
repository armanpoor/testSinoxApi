import type { ControlStatusPayload } from '../components/OverviewView';

export type HealthLevel = 'healthy' | 'degraded' | 'offline' | 'checking';

export interface HealthLayerCheck {
  id: string;
  label: string;
  state: 'ok' | 'warn' | 'down';
  detail: string;
}

export interface ConnectionHealthSummary {
  level: HealthLevel;
  shortLabel: string;
  headline: string;
  onlineCount: number;
  totalCount: number;
  healthyCookies: number;
  totalCookies: number;
  activeCooldowns: number;
  latencyMs: number | null;
  checks: HealthLayerCheck[];
}

/**
 * Evaluates real-time connection stability across Engine, Bridge, Throttle, and Cookie Pool
 * so the header health widget can show accurate status & tooltip diagnostics from any tab.
 */
export function evaluateConnectionHealth(
  status: ControlStatusPayload | null,
  loading: boolean
): ConnectionHealthSummary {
  if (!status) {
    return {
      level: loading ? 'checking' : 'offline',
      shortLabel: loading ? 'بررسی...' : 'قطع',
      headline: loading
        ? 'در حال دریافت وضعیت زنده سرویس‌ها از سرور...'
        : 'ارتباط با سرور کنترل‌سنتر برقرار نیست.',
      onlineCount: 0,
      totalCount: 4,
      healthyCookies: 0,
      totalCookies: 0,
      activeCooldowns: 0,
      latencyMs: null,
      checks: [],
    };
  }

  const layers = status.layers || [];
  const engine = layers.find((l) => l.id === 'engine');
  const bridge = layers.find((l) => l.id === 'bridge');
  const throttle = layers.find((l) => l.id === 'throttle');

  const engineOnline = Boolean(engine?.online || status.upstream.online);
  const bridgeOnline = Boolean(bridge?.online);
  const throttleOnline = Boolean(throttle?.online || status.throttle.running);

  const cookies = status.upstream.cookies?.items || [];
  const totalCookies = cookies.length;
  const healthyCookies = cookies.filter(
    (c) => c.status === 'enabled' && c.health !== 'dead'
  ).length;

  const activeCooldowns = status.throttle.activeCooldowns?.length ?? 0;
  const latencyMs = typeof engine?.latencyMs === 'number' && engineOnline ? engine.latencyMs : null;

  const checks: HealthLayerCheck[] = [
    {
      id: 'engine',
      label: 'موتور وب (:8093)',
      state: engineOnline ? 'ok' : 'down',
      detail: engineOnline
        ? latencyMs !== null
          ? `متصل (${latencyMs}ms)`
          : 'متصل'
        : 'آفلاین',
    },
    {
      id: 'throttle',
      label: `پروکسی تراتل (:${status.throttle.port})`,
      state: !throttleOnline ? 'down' : activeCooldowns > 0 ? 'warn' : 'ok',
      detail: !throttleOnline
        ? 'متوقف'
        : activeCooldowns > 0
          ? `فعال · ${activeCooldowns} قفل Cooldown`
          : 'فعال و آماده',
    },
    {
      id: 'bridge',
      label: 'پل Anthropic (:8094)',
      state: bridgeOnline ? 'ok' : engineOnline ? 'warn' : 'down',
      detail: bridgeOnline ? 'متصل' : 'آفلاین',
    },
    {
      id: 'cookies',
      label: 'استخر کوکی جمنای',
      state: !engineOnline ? 'down' : healthyCookies > 0 ? 'ok' : 'warn',
      detail: !engineOnline
        ? 'در انتظار موتور'
        : healthyCookies > 0
          ? `${healthyCookies} از ${totalCookies} سالم`
          : 'کوکی فعالی ثبت نشده',
    },
  ];

  const onlineCount = checks.filter((c) => c.state === 'ok').length;
  const totalCount = checks.length;

  let level: HealthLevel;
  let shortLabel: string;
  let headline: string;

  if (engineOnline && throttleOnline && healthyCookies > 0 && activeCooldowns === 0) {
    level = 'healthy';
    shortLabel = 'پایدار';
    headline = bridgeOnline
      ? 'اتصال کامل و پایدار در تمامی لایه‌ها برقرار است.'
      : 'موتور جمنای، تراتل و کوکی‌ها پایدار و آماده پاسخ‌دهی هستند.';
  } else if (!engineOnline && !throttleOnline) {
    level = 'offline';
    shortLabel = 'قطع';
    headline = 'موتور وب و پروکسی تراتل هر دو متوقف هستند.';
  } else {
    level = 'degraded';
    shortLabel = 'نیمه‌متصل';
    if (!engineOnline) {
      headline = 'تراتل فعال است اما موتور وب (:8093) آفلاین است.';
    } else if (healthyCookies === 0) {
      headline = 'موتور متصل است اما کوکی سالمی برای جمنای ثبت نشده است.';
    } else if (activeCooldowns > 0) {
      headline = 'قفل ضدبن (Cooldown) روی تراتل فعال است و درخواست‌ها محدود شده‌اند.';
    } else {
      headline = 'پروکسی تراتل متوقف است و نیاز به فعال‌سازی دارد.';
    }
  }

  return {
    level,
    shortLabel,
    headline,
    onlineCount,
    totalCount,
    healthyCookies,
    totalCookies,
    activeCooldowns,
    latencyMs,
    checks,
  };
}
