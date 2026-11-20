import type {
  AntiBanAuditItem,
  BridgeSettings,
  LayerStatus,
  LocalEnvironmentInfo,
  ThrottleTelemetry,
} from './types';

export type DiagnosticIssueCode =
  | 'HTML_INSTEAD_OF_JSON'
  | 'CLOUD_SANDBOX_ENV'
  | 'MISSING_BINARIES'
  | 'ENGINE_OFFLINE'
  | 'BRIDGE_OFFLINE'
  | 'THROTTLE_STOPPED'
  | 'NO_ACTIVE_COOKIES'
  | 'COOLDOWN_ACTIVE'
  | 'AUTH_OR_KEY_MISMATCH'
  | 'SOFT_BLOCK'
  | 'ANTI_BAN_NON_COMPLIANT'
  | 'UPSTREAM_NETWORK_ERROR';

export interface DiagnosticFinding {
  code: DiagnosticIssueCode;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  autoFixable: boolean;
  autoFixAction: string;
  claudeHint: string;
}

export interface AutoHealStepResult {
  id: string;
  label: string;
  status: 'fixed' | 'ok' | 'skipped' | 'blocked' | 'failed';
  detail: string;
  durationMs: number;
}

export interface DiagnosisReport {
  sampledAt: number;
  healthy: boolean;
  environment: 'local' | 'cloud-sandbox';
  summary: string;
  findings: DiagnosticFinding[];
  suggestedClaudePrompt: string;
}

export interface AutoHealReport {
  ok: boolean;
  healedCount: number;
  remainingIssues: number;
  steps: AutoHealStepResult[];
  diagnosisAfter: DiagnosisReport;
}

export interface SafeApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  isHtml?: boolean;
  rawSnippet?: string;
}

export interface DiagnoseInput {
  layers: LayerStatus[];
  localEnv: LocalEnvironmentInfo;
  throttle: ThrottleTelemetry;
  settings: Pick<BridgeSettings, 'gw2apiUrl' | 'bridgeUrl' | 'throttlePort' | 'throttleEnabled' | 'throttleTarget'>;
  upstream: {
    online: boolean;
    healthyCookiesCount: number;
    totalCookiesCount: number;
    antiBanAudit: AntiBanAuditItem[];
  };
  contextError?: string;
  contextSource?: string;
}

/**
 * Safely parses a fetch Response without ever throwing "Unexpected token '<', <!doctype...".
 * Detects HTML fallback responses and returns a structured error payload.
 */
export async function parseSafeJsonResponse<T = unknown>(res: Response): Promise<SafeApiResult<T>> {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const raw = await res.text();
  const trimmed = raw.trim();
  const looksLikeHtml =
    ct.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<HTML');

  if (looksLikeHtml) {
    return {
      ok: false,
      status: res.status,
      isHtml: true,
      rawSnippet: trimmed.slice(0, 140),
      error:
        'سرور به‌جای داده JSON یک صفحه HTML برگرداند (معمولاً به دلیل خاموش بودن سرویس بالادست، ری‌استارت سرور یا بازگشت صفحه خطا از پروکسی).',
    };
  }

  if (!trimmed) {
    return res.ok
      ? { ok: true, status: res.status }
      : { ok: false, status: res.status, error: `پاسخ خالی از سرور (HTTP ${res.status})` };
  }

  try {
    const parsed = JSON.parse(trimmed) as T & { error?: string | { message?: string } };
    if (!res.ok) {
      const errField = parsed && typeof parsed === 'object' ? (parsed as { error?: unknown }).error : undefined;
      const msg =
        typeof errField === 'string'
          ? errField
          : errField && typeof errField === 'object' && typeof (errField as { message?: unknown }).message === 'string'
            ? String((errField as { message: string }).message)
            : `خطای سرور (HTTP ${res.status})`;
      return { ok: false, status: res.status, data: parsed, error: msg };
    }
    return { ok: true, status: res.status, data: parsed };
  } catch {
    return {
      ok: false,
      status: res.status,
      rawSnippet: trimmed.slice(0, 160),
      error: res.ok
        ? 'پاسخ دریافتی فرمت معتبر JSON نداشت.'
        : `HTTP ${res.status}: ${trimmed.slice(0, 160)}`,
    };
  }
}

/**
 * Classifies live stack telemetry + optional test error into actionable root-cause findings.
 */
export function diagnoseStackState(input: DiagnoseInput): DiagnosisReport {
  const findings: DiagnosticFinding[] = [];
  const errLower = (input.contextError || '').toLowerCase();

  const engineLayer = input.layers.find((l) => l.id === 'engine');
  const bridgeLayer = input.layers.find((l) => l.id === 'bridge');
  const throttleLayer = input.layers.find((l) => l.id === 'throttle');

  const engineOnline = Boolean(engineLayer?.online || input.upstream.online);
  const bridgeOnline = Boolean(bridgeLayer?.online);
  const throttleOnline = Boolean(throttleLayer?.online || input.throttle.running);

  const hasBrowser = Boolean(
    input.localEnv.detectedChromePath || input.localEnv.firefoxProfiles.length > 0
  );
  const isCloudSandbox = !input.localEnv.hasEngineBinary && !input.localEnv.hasBridgeBinary && !hasBrowser;

  // 1. HTML-instead-of-JSON response bug (e.g. <!doctype html>)
  if (
    errLower.includes('<!doctype') ||
    errLower.includes("unexpected token '<'") ||
    errLower.includes('html') ||
    errLower.includes('html_instead_of_json')
  ) {
    findings.push({
      code: 'HTML_INSTEAD_OF_JSON',
      severity: 'critical',
      title: 'دریافت پاسخ HTML به‌جای JSON از مسیر API یا پروکسی',
      detail:
        'درخواست تست به یک صفحه HTML برخورد کرده است (به‌جای پاسخ JSON/SSE مدل). این خطا معمولاً هنگام خاموش بودن سرور مقصد، پاسخ صفحه لاگین/خطای پروکسی یا مسیردهی اشتباه رخ می‌دهد.',
      autoFixable: true,
      autoFixAction: 'بررسی سلامت مسیرهای /api و راه‌اندازی/همگام‌سازی خودکار لایه مقصد',
      claudeHint: 'Run `npm run heal` and inspect `GET /api/control/diagnose` to ensure API proxy returns JSON/SSE.',
    });
  }

  // 2. Throttle proxy stopped
  if (!throttleOnline || !input.settings.throttleEnabled) {
    findings.push({
      code: 'THROTTLE_STOPPED',
      severity: 'critical',
      title: `پروکسی تراتل استریم روی پورت :${input.settings.throttlePort} متوقف است`,
      detail: 'لایه پروکسی تراتل که درخواست‌های هارنس و آزمایشگاه چت را عبور می‌دهد خاموش است.',
      autoFixable: true,
      autoFixAction: `فعال‌سازی و اجرای خودکار پروکسی تراتل روی پورت ${input.settings.throttlePort}`,
      claudeHint: 'POST /api/control/throttle/toggle with {"enabled":true}.',
    });
  }

  // 3. Cooldown active blocking requests
  if (input.throttle.activeCooldowns.length > 0 || errLower.includes('cooldown') || errLower.includes('429')) {
    const cd = input.throttle.activeCooldowns[0];
    findings.push({
      code: 'COOLDOWN_ACTIVE',
      severity: 'warning',
      title: 'قفل ضدبن (Cooldown) در حال مسدود کردن درخواست‌هاست',
      detail: cd
        ? `محدودیت موقت روی ${cd.scope} به علت «${cd.reason}» (${cd.remainingSec} ثانیه باقی‌مانده).`
        : 'پروکسی تراتل به دلیل خطای قبلی وارد حالت Cooldown شده است.',
      autoFixable: true,
      autoFixAction: 'پاک‌سازی خودکار Cooldown برای انجام تست و همگام‌سازی کلیدها',
      claudeHint: 'POST /api/control/throttle/clear-cooldown after fixing upstream cause.',
    });
  }

  // 4. Cloud sandbox / missing local binaries
  if (isCloudSandbox && !engineOnline) {
    findings.push({
      code: 'CLOUD_SANDBOX_ENV',
      severity: 'critical',
      title: 'اجرا در محیط ایزوله/ابری بدون باینری و مرورگر محلی',
      detail:
        'موتور وب (gemini-web2api-go)، پل Anthropic و مرورگر محلی روی این کانتینر موجود نیستند. برای اتصال واقعی به اشتراک Gemini Pro، پروژه باید روی سیستم شخصی (یا از طریق Claude Code محلی) اجرا شود.',
      autoFixable: false,
      autoFixAction: 'اجرای پروژه روی سیستم محلی با Claude Code و دستور `npm run heal`',
      claudeHint:
        'On the local machine, run `npm run heal` (see CLAUDE.md) to install/verify binaries, start :8093/:8094/:8095, and extract browser cookies.',
    });
  } else if (!input.localEnv.hasEngineBinary && !engineOnline) {
    findings.push({
      code: 'MISSING_BINARIES',
      severity: 'critical',
      title: 'فایل اجرایی موتور وب (gemini-web2api-go) روی دیسک یافت نشد',
      detail: 'باینری موتور در مسیر gemini-web-bridge/bin وجود ندارد، بنابراین سرور نمی‌تواند پورت 8093 را روشن کند.',
      autoFixable: false,
      autoFixAction: 'نصب خودکار باینری موتور توسط Claude Code (طبق CLAUDE.md)',
      claudeHint:
        'Download/setup gemini-web2api-go binary into gemini-web-bridge/bin/ (check gemini-web-bridge/scripts/01-start-proxy.ps1), then run `npm run heal`.',
    });
  }

  // 5. Engine offline (when binary exists or local)
  if (!engineOnline && input.localEnv.hasEngineBinary) {
    findings.push({
      code: 'ENGINE_OFFLINE',
      severity: 'critical',
      title: `موتور اصلی جمنای (${input.settings.gw2apiUrl}) خاموش است`,
      detail: 'فایل اجرایی موتور روی دیسک موجود است اما سرویس روی پورت 8093 در حال اجرا نیست.',
      autoFixable: true,
      autoFixAction: 'اجرای خودکار پروسس gemini-web2api-go روی پورت 8093 و انتظار تا آماده شدن',
      claudeHint: 'POST /api/control/process/engine/start and wait for port 8093 health.',
    });
  }

  // 6. Bridge offline when throttle points to bridge
  if (input.settings.throttleTarget === 'bridge' && !bridgeOnline) {
    const canFallbackToEngine = engineOnline || (input.localEnv.hasEngineBinary && !input.localEnv.hasBridgeBinary);
    findings.push({
      code: 'BRIDGE_OFFLINE',
      severity: engineOnline ? 'warning' : 'critical',
      title: `پل Anthropic (${input.settings.bridgeUrl}) آفلاین است در حالی که تراتل به آن وصل است`,
      detail: canFallbackToEngine
        ? 'تراتل روی پل 8094 تنظیم شده ولی پل خاموش است؛ سرور می‌تواند یا پل را روشن کند یا مسیر تراتل را خودکار به موتور 8093 تغییر دهد.'
        : 'پروکسی تراتل درخواست‌ها را به پورت 8094 می‌فرستد اما CLIProxyAPI در حال اجرا نیست.',
      autoFixable: Boolean(input.localEnv.hasBridgeBinary || canFallbackToEngine),
      autoFixAction: input.localEnv.hasBridgeBinary
        ? 'اجرای خودکار پل CLIProxyAPI روی پورت 8094'
        : 'تغییر هوشمند مسیر تراتل به موتور 8093 تا تست چت و مدل‌ها بدون خطا کار کند',
      claudeHint:
        'Start bridge via POST /api/control/process/bridge/start (or switch throttleTarget to "engine" if only OpenAI/Playground is needed).',
    });
  }

  // 7. Auth / API key mismatch
  if (errLower.includes('401') || errLower.includes('403') || errLower.includes('unauthorized') || errLower.includes('invalid api key')) {
    findings.push({
      code: 'AUTH_OR_KEY_MISMATCH',
      severity: 'critical',
      title: 'عدم تطابق کلید API یا توکن نشست ادمین (401/403)',
      detail: 'کلید ارسال‌شده توسط پل یا هارنس با کلید فعال روی موتور وب یا فایل config.yaml هماهنگ نیست.',
      autoFixable: true,
      autoFixAction: 'اجرای همگام‌سازی هوشمند (Smart Sync) برای کشف/ساخت کلید فعال و آپدیت config.yaml',
      claudeHint: 'POST /api/control/smart-sync to re-authenticate admin session and sync engine/bridge API keys.',
    });
  }

  // 8. Soft-Block detected
  if (errLower.includes('soft-block') || errLower.includes('soft_block')) {
    findings.push({
      code: 'SOFT_BLOCK',
      severity: 'warning',
      title: 'شناسایی Soft-Block از سمت گوگل',
      detail: 'گوگل با کد 200 پاسخ رد/محدودیت ارسال کرده است. نیاز به چرخش کوکی یا تازه‌سازی اتمیک سشن است.',
      autoFixable: true,
      autoFixAction: 'اجرای چرخه نگهبان اتمیک برای جایگزینی یا چرخش کوکی',
      claudeHint: 'Run atomic watchdog cycle (POST /api/control/watchdog/run) and verify anti-ban preset is applied.',
    });
  }

  // 9. No active cookies when engine IS online
  if (engineOnline && input.upstream.healthyCookiesCount === 0) {
    findings.push({
      code: 'NO_ACTIVE_COOKIES',
      severity: 'critical',
      title: 'موتور روشن است اما هیچ کوکی سالمی ثبت نشده است',
      detail: 'بدون کوکی __Secure-1PSID / __Secure-1PSIDTS معتبر، مدل‌های Gemini Pro پاسخ نخواهند داد.',
      autoFixable: input.localEnv.firefoxProfiles.length > 0,
      autoFixAction:
        input.localEnv.firefoxProfiles.length > 0
          ? 'استخراج خودکار کوکی از پروفایل فایرفاکس محلی و ثبت در موتور'
          : 'باز کردن خودکار مرورگر برای لاگین یک‌باره و استخراج کوکی',
      claudeHint:
        'Run POST /api/control/cookies/auto-firefox (or POST /api/control/cookies/auto-login/start for Chrome/Edge CDP) to register fresh Google cookies.',
    });
  }

  // 10. Anti-ban non-compliant when engine is online
  const nonCompliant = input.upstream.antiBanAudit.filter((a) => a.current !== null && !a.compliant);
  if (engineOnline && nonCompliant.length > 0) {
    findings.push({
      code: 'ANTI_BAN_NON_COMPLIANT',
      severity: 'warning',
      title: `${nonCompliant.length} تنظیم ایمنی ضدبن روی موتور اعمال نشده است`,
      detail: `پارامترهای نیازمند سخت‌سازی: ${nonCompliant.map((x) => x.key).join(', ')}`,
      autoFixable: true,
      autoFixAction: 'اعمال یک‌کلیک و بدون تخریب پروفایل سخت‌شده ضدبن روی موتور 8093',
      claudeHint: 'POST /api/control/anti-ban/apply to harden upstream engine config.',
    });
  }

  // 11. Fallback generic network error if user saw an error but no specific finding matched
  if (input.contextError && findings.length === 0) {
    findings.push({
      code: 'UPSTREAM_NETWORK_ERROR',
      severity: 'critical',
      title: 'خطای ارتباطی هنگام اجرای تست',
      detail: input.contextError.slice(0, 240),
      autoFixable: true,
      autoFixAction: 'اجرای همگام‌سازی کامل، بررسی پورت‌ها و تست مجدد اتصال',
      claudeHint: 'Inspect GET /api/control/logs and run `npm run heal` to diagnose the failing request.',
    });
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const healthy = criticalCount === 0 && engineOnline && throttleOnline && input.upstream.healthyCookiesCount > 0;

  const summary = healthy
    ? 'تمام لایه‌های پل، پروکسی تراتل و کوکی‌های جمنای سالم و آماده پاسخ‌دهی هستند.'
    : criticalCount > 0
      ? `${criticalCount} مشکل بحرانی شناسایی شد: ${findings.find((f) => f.severity === 'critical')?.title}`
      : findings.length > 0
        ? `${findings.length} هشدار قابل اصلاح شناسایی شد: ${findings[0].title}`
        : 'اتصال آماده نیست — برای بررسی کامل دکمه تعمیر خودکار را بزنید.';

  const reportBase = {
    sampledAt: Date.now(),
    healthy,
    environment: (isCloudSandbox ? 'cloud-sandbox' : 'local') as 'local' | 'cloud-sandbox',
    summary,
    findings,
  };

  return {
    ...reportBase,
    suggestedClaudePrompt: buildClaudeCodePrompt(reportBase, {
      source: input.contextSource,
      error: input.contextError,
    }),
  };
}

/**
 * Generates an autonomous, actionable prompt tailored for Claude Code so it fixes the
 * detected issues end-to-end without telling the user to run manual steps.
 */
export function buildClaudeCodePrompt(
  report: Omit<DiagnosisReport, 'suggestedClaudePrompt'>,
  context?: { source?: string; error?: string }
): string {
  const issueLines =
    report.findings.length > 0
      ? report.findings.map((f, i) => `${i + 1}. [${f.code}] ${f.title}\n   Action: ${f.claudeHint}`).join('\n')
      : '1. Verify full stack end-to-end health.';

  const errPart = context?.error ? `\nObserved error (${context.source || 'UI test'}): ${context.error}\n` : '';

  return [
    'این پروژه (Gemini Web Bridge Control Center) را طبق دستورالعمل CLAUDE.md به‌صورت کامل و خودکار بالا بیاور و مشکل فعلی را خودت برطرف کن (از من نخواه دستورات را دستی اجرا کنم؛ فقط اگر لاگین مرورگر نیاز شد پنجره آن را خودت باز کن):',
    errPart.trim(),
    'مشکلات تشخیص‌داده‌شده توسط عیب‌یاب داخلی:',
    issueLines,
    '',
    'مراحل اجرایی موردانتظار از تو:',
    '1. دستور `npm run heal` را اجرا کن و خروجی `GET http://127.0.0.1:3000/api/control/diagnose` را بخوان.',
    '2. اگر باینری‌های gemini-web2api-go یا CLIProxyAPI نصب نیستند یا خاموش‌اند، خودت آن‌ها را راه‌اندازی کن.',
    '3. کلیدها/توکن‌ها و کوکی‌های فایرفاکس یا کروم را خودکار همگام و تست کن.',
    '4. در پایان با یک تست واقعی روی `/api/control/playground/chat` مطمئن شو پاسخ سالم JSON/SSE برمی‌گردد و سپس نتیجه را گزارش بده.',
  ]
    .filter(Boolean)
    .join('\n');
}
