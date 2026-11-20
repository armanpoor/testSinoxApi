import type { ProbeCase } from './types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function modPow(base: number, exp: number, mod: number): number {
  let result = 1n;
  let b = BigInt(base) % BigInt(mod);
  let e = BigInt(exp);
  const m = BigInt(mod);
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    e >>= 1n;
    b = (b * b) % m;
  }
  return Number(result);
}

export function generateCapabilityProbes(seed = Math.floor(Math.random() * 1_000_000_000)): {
  seed: number;
  probes: ProbeCase[];
} {
  const rng = mulberry32(seed);

  // 1. Divisor count
  const N = randInt(rng, 400, 1200);
  const K = [6, 8, 10, 12][randInt(rng, 0, 3)];
  let divCount = 0;
  for (let n = 1; n <= N; n++) {
    let d = 0;
    for (let i = 1; i * i <= n; i++) {
      if (n % i === 0) d += i * i === n ? 1 : 2;
    }
    if (d === K) divCount++;
  }

  // 2. Modular exponentiation
  const base = randInt(rng, 3, 97) | 1;
  const exp = randInt(rng, 100_000, 900_000);
  const mod = [1000, 9973, 12347][randInt(rng, 0, 2)];
  const modAns = modPow(base, exp, mod);

  // 3. Linear recurrence
  const a = randInt(rng, 2, 9);
  const b = randInt(rng, 2, 9);
  const c = randInt(rng, 2, 9);
  const rMod = 1_000_007;
  let x = 1, y = 2, z = 3;
  for (let i = 0; i < 400; i++) {
    const next = (a * z + b * y + c * x) % rMod;
    x = y;
    y = z;
    z = next;
  }

  // 4. Conditional arithmetic logic
  const la = randInt(rng, 2, 20);
  const lb = randInt(rng, 1, 20);
  const lc = randInt(rng, 3, 20);
  const ld = randInt(rng, 2, 20);
  const le = randInt(rng, 1, 20);
  const lx = randInt(rng, 1, 50);
  const ly = (la * lx + lb) % lc;
  const lz = (ld * ly + le) % 100;

  // 5. Needle / document aggregation
  const needleRow = randInt(rng, 25, 45);
  const rows: string[] = [];
  let sum = 0;
  for (let i = 0; i < 55; i++) {
    const v = randInt(rng, 10, 999);
    rows.push(`[${String(i).padStart(2, '0')}] sensor_${String(i).padStart(3, '0')} reading=${v} unit=bar`);
    if (i < needleRow && v % 7 === 0) sum += v;
  }

  const probes: ProbeCase[] = [
    {
      id: 'divisor-count',
      name: 'شمارش مقسوم‌علیه',
      prompt: `How many integers n with 1 <= n <= ${N} have exactly ${K} positive divisors? Compute it; do not guess. End with: ANSWER: <integer>`,
      expected: String(divCount),
    },
    {
      id: 'mod-exp',
      name: 'توان پیمانه‌ای بزرگ',
      prompt: `Compute ${base}^${exp} mod ${mod}. Be exact. End with: ANSWER: <integer>`,
      expected: String(modAns),
    },
    {
      id: 'recurrence',
      name: 'دنباله بازگشتی ۴۰۳',
      prompt: `Let f(1)=1, f(2)=2, f(3)=3 and f(n) = ${a}*f(n-1) + ${b}*f(n-2) + ${c}*f(n-3) mod ${rMod} for n > 3. What is f(403)? End with: ANSWER: <integer>`,
      expected: String(z),
    },
    {
      id: 'logic-math',
      name: 'استنتاج محاسباتی',
      prompt: `Let x=${lx}. Define y = (${la}*x + ${lb}) mod ${lc}, and z = (${ld}*y + ${le}) mod 100. What is z? End with: ANSWER: <integer>`,
      expected: String(lz),
    },
    {
      id: 'doc-aggregate',
      name: 'تجمیع دقیق سند',
      prompt: `Document:\n${rows.join('\n')}\n\nFrom rows 00 through ${String(needleRow - 1).padStart(2, '0')} inclusive, sum every reading whose value is divisible by 7. End with: ANSWER: <integer>`,
      expected: String(sum),
    },
  ];

  return { seed, probes };
}

export function extractProbeAnswer(text: string): string | null {
  const matches = [...text.matchAll(/ANSWER\s*:\s*([^\n]+)/gi)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1][1].trim().replace(/[*`.,_]/g, '');
  const num = last.match(/-?\d+/);
  return num ? num[0] : null;
}
