import type { AntiBanAuditItem } from './types';

export const ANTI_BAN_PRESET = {
  per_ip_concurrent: 1,
  per_ip_rpm: 3,
  per_ip_rph: 40,
  retry_attempts: 2,
  retry_delay_sec: 8,
  retry_on_timeout: false,
  temporary_chat: true,
  anon_first: true,
  strict_model: true,
  fallback_direct: false,
  stream_idle_timeout_sec: 120,
} as const;

interface AuditSpec {
  key: keyof typeof ANTI_BAN_PRESET;
  label: string;
  reason: string;
  check: (current: unknown, recommended: unknown) => boolean;
}

const AUDIT_SPECS: AuditSpec[] = [
  {
    key: 'per_ip_concurrent',
    label: 'همزمانی مجاز (Concurrent)',
    reason: 'فقط ۱ درخواست همزمان به گوگل تا الگوی رباتی ساخته نشود',
    check: (cur, rec) => typeof cur === 'number' && cur > 0 && cur <= (rec as number),
  },
  {
    key: 'per_ip_rpm',
    label: 'محدودیت در دقیقه (RPM)',
    reason: 'حداکثر ۳ درخواست در دقیقه برای مدل‌های Pro',
    check: (cur, rec) => typeof cur === 'number' && cur > 0 && cur <= (rec as number),
  },
  {
    key: 'per_ip_rph',
    label: 'محدودیت در ساعت (RPH)',
    reason: 'حاشیه ایمن زیر سقف تجربی ۸۰ درخواست در ساعت',
    check: (cur, rec) => typeof cur === 'number' && cur > 0 && cur <= (rec as number),
  },
  {
    key: 'retry_attempts',
    label: 'تعداد تلاش مجدد (Retries)',
    reason: 'کاهش تلاش مجدد فوری پس از خطا برای حذف امضای ربات',
    check: (cur, rec) => typeof cur === 'number' && cur <= (rec as number),
  },
  {
    key: 'retry_delay_sec',
    label: 'تاخیر تلاش مجدد (ثانیه)',
    reason: 'فاصله حداقل ۸ ثانیه پیش از تلاش مجدد',
    check: (cur, rec) => typeof cur === 'number' && cur >= (rec as number),
  },
  {
    key: 'temporary_chat',
    label: 'چت موقت (Temporary Chat)',
    reason: 'جلوگیری از انباشت تاریخچه غیرطبیعی در اکانت گوگل',
    check: (cur, rec) => cur === rec,
  },
  {
    key: 'anon_first',
    label: 'اولویت ناشناس (Anon First)',
    reason: 'ارسال درخواست‌های ساده بدون مصرف کوکی پریمیوم',
    check: (cur, rec) => cur === rec,
  },
  {
    key: 'strict_model',
    label: 'بررسی دقیق مدل (Strict Model)',
    reason: 'جلوگیری از تنزل خاموش مدل Pro به رایگان هنگام انقضای کوکی',
    check: (cur, rec) => cur === rec,
  },
  {
    key: 'stream_idle_timeout_sec',
    label: 'تایم‌اوت بیکاری استریم (ثانیه)',
    reason: 'بستن خودکار استریم‌های معلق پس از ۲ دقیقه',
    check: (cur, rec) => typeof cur === 'number' && cur > 0 && cur <= (rec as number),
  },
];

export function evaluateAntiBanAudit(currentConfig: Record<string, unknown> | null): AntiBanAuditItem[] {
  return AUDIT_SPECS.map((spec) => {
    const recommended = ANTI_BAN_PRESET[spec.key];
    const current =
      currentConfig && spec.key in currentConfig
        ? (currentConfig[spec.key] as string | number | boolean)
        : null;
    return {
      key: spec.key,
      label: spec.label,
      recommended,
      current,
      compliant: current !== null && spec.check(current, recommended),
      reason: spec.reason,
    };
  });
}

export interface SnippetOptions {
  useThrottle: boolean;
  throttlePort: number;
  bridgeUrl: string;
  engineUrl: string;
  bridgeKey: string;
  engineKey: string;
  model: string;
}

export function generateToolSnippets(opts: SnippetOptions) {
  const anthropicBase = opts.useThrottle
    ? `http://127.0.0.1:${opts.throttlePort}`
    : opts.bridgeUrl.replace(/\/+$/, '');
  const openaiBase = opts.useThrottle
    ? `http://127.0.0.1:${opts.throttlePort}/v1`
    : `${opts.engineUrl.replace(/\/+$/, '')}/v1`;
  const bridgeKey = opts.bridgeKey || 'local-client-key-1';
  const engineKey = opts.engineKey || 'sk-gemini-YOUR-KEY';
  const model = opts.model || 'gemini-4-hydrogen';

  const claudePowerShell = [
    `$env:ANTHROPIC_BASE_URL = "${anthropicBase}"`,
    `$env:ANTHROPIC_API_KEY = "${bridgeKey}"`,
    `$env:ANTHROPIC_MODEL = "${model}"`,
    `claude`,
  ].join('\n');

  const claudeBash = [
    `export ANTHROPIC_BASE_URL="${anthropicBase}"`,
    `export ANTHROPIC_API_KEY="${bridgeKey}"`,
    `export ANTHROPIC_MODEL="${model}"`,
    `claude`,
  ].join('\n');

  const claudeSettingsJson = JSON.stringify(
    {
      env: {
        ANTHROPIC_BASE_URL: anthropicBase,
        ANTHROPIC_API_KEY: bridgeKey,
        ANTHROPIC_MODEL: model,
      },
    },
    null,
    2
  );

  const clineConfig = JSON.stringify(
    {
      apiProvider: 'openai',
      openAiBaseUrl: openaiBase,
      openAiApiKey: opts.useThrottle ? bridgeKey : engineKey,
      openAiModelId: model,
    },
    null,
    2
  );

  const opencodeConfig = JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        'gemini-web-bridge': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Gemini Web Pro Bridge',
          options: {
            baseURL: openaiBase,
            apiKey: opts.useThrottle ? bridgeKey : engineKey,
          },
          models: {
            [model]: { name: model },
            'gemini-4-hydrogen-thinking': { name: 'gemini-4-hydrogen-thinking' },
            'gemini-4-neon': { name: 'gemini-4-neon' },
          },
        },
      },
      model: `gemini-web-bridge/${model}`,
    },
    null,
    2
  );

  const aiderCommand = [
    `# PowerShell / Bash (Aider / هر هارنس OpenAI-Compatible)`,
    `export OPENAI_API_BASE="${openaiBase}"`,
    `export OPENAI_API_KEY="${opts.useThrottle ? bridgeKey : engineKey}"`,
    `aider --model openai/${model}`,
  ].join('\n');

  const nineRouterGuide = {
    name: 'gw2gemini',
    prefix: 'gw2',
    apiType: 'chat',
    baseUrl: `${opts.engineUrl.replace(/\/+$/, '')}/v1`,
    apiKey: engineKey,
    comboOrder: ['gw2/gemini-4-carbon', 'gw2/gemini-4-neon', 'gw2/gemini-4-hydrogen'],
    claudeCommand: [
      `$env:ANTHROPIC_BASE_URL = "http://localhost:20128"`,
      `$env:ANTHROPIC_API_KEY = "YOUR_9ROUTER_KEY"`,
      `claude --model gw2/${model}`,
    ].join('\n'),
  };

  return {
    anthropicBase,
    openaiBase,
    claudePowerShell,
    claudeBash,
    claudeSettingsJson,
    clineConfig,
    opencodeConfig,
    aiderCommand,
    nineRouterGuide,
  };
}
