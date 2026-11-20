export const WANTED_COOKIES = [
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-1PSIDTS',
  '__Secure-1PSIDCC',
  'NID',
] as const;

export const WANTED_SET = new Set<string>(WANTED_COOKIES);

export interface ParsedCookieResult {
  format: 'json' | 'netscape' | 'header' | 'unknown';
  cookies: Record<string, string>;
  cookieHeader: string;
  foundCount: number;
  has1PSID: boolean;
  has1PSIDTS: boolean;
  hasSIDCC: boolean;
  sapisidHash: string | null;
  warnings: string[];
  errors: string[];
  valid: boolean;
}

function shortFingerprint(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function parseJsonCookies(raw: string): Record<string, string> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const list: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.cookies)
        ? parsed.cookies
        : [];
    if (list.length === 0) return null;
    const out: Record<string, string> = {};
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name.trim() : '';
      const value = typeof obj.value === 'string' ? obj.value.trim() : '';
      const domain = typeof obj.domain === 'string' ? obj.domain.toLowerCase() : '';
      if (!name || !value) continue;
      if (domain && !domain.includes('google.com')) continue;
      if (WANTED_SET.has(name) && !(name in out)) {
        out[name] = value;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function parseNetscapeCookies(raw: string): Record<string, string> | null {
  const lines = raw.split(/\r?\n/);
  const out: Record<string, string> = {};
  let matchedNetscapeRow = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const parts = t.split('\t');
    if (parts.length >= 7) {
      matchedNetscapeRow = true;
      const domain = parts[0].toLowerCase();
      const name = parts[5].trim();
      const value = parts[6].trim();
      if (domain.includes('google.com') && WANTED_SET.has(name) && value && !(name in out)) {
        out[name] = value;
      }
    }
  }
  return matchedNetscapeRow ? out : null;
}

function parseHeaderCookies(raw: string): Record<string, string> {
  const cleaned = raw.replace(/^cookie\s*:\s*/i, '').trim();
  const out: Record<string, string> = {};
  for (const chunk of cleaned.split(/;\s*|\r?\n/)) {
    const idx = chunk.indexOf('=');
    if (idx <= 0) continue;
    const name = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    if (WANTED_SET.has(name) && value && !(name in out)) {
      out[name] = value;
    }
  }
  return out;
}

export function parseCookieInput(raw: string): ParsedCookieResult {
  const input = (raw || '').trim();
  if (!input) {
    return {
      format: 'unknown',
      cookies: {},
      cookieHeader: '',
      foundCount: 0,
      has1PSID: false,
      has1PSIDTS: false,
      hasSIDCC: false,
      sapisidHash: null,
      warnings: [],
      errors: ['ورودی کوکی خالی است.'],
      valid: false,
    };
  }

  let format: ParsedCookieResult['format'] = 'header';
  let cookies = parseJsonCookies(input);
  if (cookies) {
    format = 'json';
  } else {
    cookies = parseNetscapeCookies(input);
    if (cookies) {
      format = 'netscape';
    } else {
      cookies = parseHeaderCookies(input);
      format = Object.keys(cookies).length > 0 ? 'header' : 'unknown';
    }
  }

  const sortedKeys = Object.keys(cookies).sort();
  const cookieHeader = sortedKeys.map((k) => `${k}=${cookies![k]}`).join('; ');
  const has1PSID = Boolean(cookies['__Secure-1PSID']);
  const has1PSIDTS = Boolean(cookies['__Secure-1PSIDTS']);
  const hasSIDCC = Boolean(cookies['__Secure-1PSIDCC']);
  const sapisidHash = cookies['SAPISID'] ? shortFingerprint(cookies['SAPISID']) : null;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!has1PSID) {
    errors.push('کوکی حیاتی __Secure-1PSID پیدا نشد — یعنی لاگین گوگل در ورودی موجود نیست.');
  }
  if (has1PSID && !has1PSIDTS) {
    warnings.push(
      'کوکی __Secure-1PSIDTS موجود نیست؛ بدون آن مدل‌های Pro و گزارش سهمیه کار نمی‌کنند و به Flash-Lite تنزل می‌یابد.'
    );
  }
  if (has1PSID && !hasSIDCC) {
    warnings.push('کوکی __Secure-1PSIDCC یافت نشد؛ چرخش خودکار سشن ممکن است کوتاه‌تر شود.');
  }
  if (has1PSID && !cookies['SAPISID']) {
    warnings.push('کوکی SAPISID موجود نیست؛ تشخیص اکانت تکراری غیرفعال خواهد بود.');
  }

  return {
    format,
    cookies,
    cookieHeader,
    foundCount: sortedKeys.length,
    has1PSID,
    has1PSIDTS,
    hasSIDCC,
    sapisidHash,
    warnings,
    errors,
    valid: errors.length === 0,
  };
}
