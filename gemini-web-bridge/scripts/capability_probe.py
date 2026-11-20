"""Capability benchmark: measures how strong the model behind a name actually is.

Every probe is RANDOMLY GENERATED at runtime and its correct answer is computed
locally by brute force. Nothing here is memorizable from training data, so a
model that answers correctly must have actually reasoned (or computed).

Run:  python -I capability_probe.py
"""

import argparse, json, os, random, re, time, urllib.request, urllib.error
from itertools import combinations

DEFAULT_GATEWAY = os.environ.get("PROBE_GATEWAY", "http://127.0.0.1:8094/v1/messages")
DEFAULT_API_KEY = os.environ.get("BRIDGE_KEY", "local-client-key-1")

DEFAULT_MODELS = [
    "gemini-4-carbon",
    "gemini-4-neon",
    "gemini-4-hydrogen",
    "gemini-3.5-flash-lite",
]

SEED = random.randrange(10**9)
rnd = random.Random(SEED)


# ---------------------------------------------------------------- generators
def probe_divisors():
    """Count n in [1,N] with exactly K divisors. Computed by brute force."""
    N = rnd.randint(600, 2500)
    K = rnd.choice([6, 8, 10, 12])
    cnt = 0
    for n in range(1, N + 1):
        d = 1
        for i in range(1, n // 2 + 1):
            if n % i == 0:
                d += 1
        if d == K:
            cnt += 1
    q = (f"How many integers n with 1 <= n <= {N} have exactly {K} positive "
         f"divisors? Compute it; do not guess. End with: ANSWER: <integer>")
    return q, str(cnt)


def probe_rooks():
    """Non-attacking rook placements on a random board with blocked cells."""
    size = 5
    blocked = set()
    while len(blocked) < rnd.randint(3, 6):
        blocked.add((rnd.randrange(size), rnd.randrange(size)))
    free = [(r, c) for r in range(size) for c in range(size) if (r, c) not in blocked]
    total = 0
    for chosen in combinations(free, size):
        rows = {r for r, _ in chosen}
        cols = {c for _, c in chosen}
        if len(rows) == size and len(cols) == size:
            total += 1
    bl = sorted(blocked)
    q = (f"A {size}x{size} board, 0-indexed. Blocked squares: {bl}. "
         f"How many ways can {size} identical rooks be placed on free squares so that "
         f"no two share a row or column? End with: ANSWER: <integer>")
    return q, str(total)


def probe_exponent():
    """Modular exponentiation with a large exponent."""
    base = rnd.randint(3, 97) | 1
    exp = rnd.randint(10**5, 10**6)
    mod = rnd.choice([1000, 9973, 12347])
    ans = pow(base, exp, mod)
    q = (f"Compute {base}^{exp} mod {mod}. Show no long working; be exact. "
         f"End with: ANSWER: <integer>")
    return q, str(ans)


def probe_recurrence():
    """A recurrence only tractable if reasoned about, not guessed."""
    a, b, c = rnd.randint(2, 9), rnd.randint(2, 9), rnd.randint(2, 9)
    mod = 1_000_007
    x, y, z = 1, 2, 3
    for _ in range(400):
        x, y, z = y, z, (a * z + b * y + c * x) % mod
    q = (f"Let f(1)=1, f(2)=2, f(3)=3 and f(n) = {a}*f(n-1) + {b}*f(n-2) + {c}*f(n-3) "
         f"for n > 3, over integers reduced mod {mod}. What is f(403)? "
         f"End with: ANSWER: <integer>")
    return q, str(z)


def probe_logic():
    """Simple conditional reasoning with a random assertion."""
    a, b, c, d, e = [rnd.randint(1, 20) for _ in range(5)]
    x = rnd.randint(1, 50)
    y = (a * x + b) % c if c else 1
    z = (d * y + e) % 100 if c else 1
    q = (f"Let x={x}. Define y = ({a}*x + {b}) mod {c}, and z = ({d}*y + {e}) mod 100. "
         f"What is z? End with: ANSWER: <integer>")
    return q, str(z)


def probe_aggregation():
    """Needle/aggregation over a generated document."""
    rows = []
    target_sum = 0
    needle_row = rnd.randrange(40, 60)
    for i in range(70):
        v = rnd.randint(10, 999)
        rows.append(f"[{i:02d}] sensor_{i:03d} reading={v} unit=bar")
        if i < needle_row and v % 7 == 0:
            target_sum += v
    doc = "\n".join(rows)
    q = (f"Document:\n{doc}\n\nFrom rows 00 through {needle_row-1:02d} inclusive, sum "
         f"every reading whose value is exactly divisible by 7. End with: ANSWER: <integer>")
    return q, str(target_sum)


PROBES = [
    ("divisor-count", probe_divisors),
    ("rook-placements", probe_rooks),
    ("mod-exp", probe_exponent),
    ("recurrence", probe_recurrence),
    ("logic-puzzle", probe_logic),
    ("doc-aggregate", probe_aggregation),
]


# ---------------------------------------------------------------- transport
def call(gateway, api_key, model, prompt, max_tokens=900):
    headers = {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
    }
    if api_key:
        headers["x-api-key"] = api_key
        headers["authorization"] = f"Bearer {api_key}"
    body = json.dumps({
        "model": model, "max_tokens": max_tokens, "stream": False,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request(gateway, data=body, headers=headers, method="POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            raw = r.read().decode("utf-8", "replace")
        dt = time.perf_counter() - t0
        # some gateways ignore stream:false; handle SSE too
        if raw.lstrip().startswith("event:") or '"data:"' in raw[:200]:
            text = "".join(
                json.loads(l[5:]).get("delta", {}).get("text", "")
                for l in raw.splitlines() if l.startswith("data: ") and '"text_delta"' in l
            )
            usage = {}
        else:
            j = json.loads(raw)
            if "choices" in j:
                text = j["choices"][0].get("message", {}).get("content", "")
            else:
                text = "".join(c.get("text", "") for c in j.get("content", []))
            usage = j.get("usage", {})
        return text, usage, dt, None
    except urllib.error.HTTPError as e:
        return "", {}, time.perf_counter() - t0, f"HTTP {e.code}: {e.read().decode('utf-8','replace')[:200]}"
    except Exception as e:
        return "", {}, time.perf_counter() - t0, f"{type(e).__name__}: {e}"[:200]


def extract(text, expected_is_num):
    m = re.findall(r"ANSWER\s*:\s*([^\n]+)", text, re.I)
    if not m:
        return None
    v = m[-1].strip().strip("*`. ").strip()
    if expected_is_num:
        n = re.findall(r"-?\d+", v.replace(",", "").replace("_", ""))
        return n[0] if n else None
    return v.lower()


def main():
    ap = argparse.ArgumentParser(description="Gemini Web Bridge Capability Probe")
    ap.add_argument("--gateway", default=DEFAULT_GATEWAY)
    ap.add_argument("--api-key", default=DEFAULT_API_KEY)
    ap.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    args = ap.parse_args()

    print(f"SEED={SEED}  GATEWAY={args.gateway}")
    probes = [(name, fn()) for name, fn in PROBES]
    print(f"Generated {len(probes)} probes with locally-computed answers.\n")

    scores = {}
    for model in args.models:
        right = 0
        print(f"=== {model} ===")
        for name, (q, ans) in probes:
            text, usage, dt, err = call(args.gateway, args.api_key, model, q)
            if err:
                print(f"  {name:16s} ERROR {err}")
                continue
            got = extract(text, ans.lstrip("-").isdigit())
            ok = got is not None and got.lower() == ans.lower()
            right += ok
            print(f"  {name:16s} {'PASS' if ok else 'FAIL'}  got={got!r} want={ans!r} ({dt:.1f}s)")
        scores[model] = right
        print(f"  --> {right}/{len(probes)}\n")

    print("=" * 62)
    print("SCORE MATRIX")
    for m, s in sorted(scores.items(), key=lambda kv: -kv[1]):
        bar = "#" * s + "-" * (len(probes) - s)
        print(f"{m:34s} {bar} {s}/{len(probes)}")


if __name__ == "__main__":
    main()
