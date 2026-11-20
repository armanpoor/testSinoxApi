import { useEffect, useRef, useState } from 'react';
import {
  Send,
  Square,
  FlaskConical,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type { ProbeCase, ProbeResult } from '../lib/types';

interface PlaygroundProbeViewProps {
  availableModels: string[];
  online: boolean;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCall?: string;
  latencyMs?: number;
  error?: string;
}

const DEFAULT_MODELS = [
  'gemini-4-hydrogen',
  'gemini-4-hydrogen-thinking',
  'gemini-4-neon',
  'gemini-4-carbon',
  'gemini-3.5-flash-lite',
];

export function PlaygroundProbeView({ availableModels, online, onNotify }: PlaygroundProbeViewProps) {
  const [subTab, setSubTab] = useState<'playground' | 'probe'>('playground');
  const models = availableModels.length > 0 ? availableModels : DEFAULT_MODELS;

  // Playground state
  const [selectedModel, setSelectedModel] = useState(models[0] || 'gemini-4-hydrogen');
  const [prompt, setPrompt] = useState('');
  const [useThrottle, setUseThrottle] = useState(true);
  const [enableToolTest, setEnableToolTest] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);

  // Capability Probe state
  const [probeSeed, setProbeSeed] = useState<number>(0);
  const [probePreview, setProbePreview] = useState<ProbeCase[]>([]);
  const [probeModels, setProbeModels] = useState<string[]>(['gemini-4-hydrogen', 'gemini-3.5-flash-lite']);
  const [probeRunning, setProbeRunning] = useState(false);
  const [probeResults, setProbeResults] = useState<ProbeResult[]>([]);

  const loadProbePreview = async (seed?: number) => {
    try {
      const url = seed ? `/api/control/probes/preview?seed=${seed}` : '/api/control/probes/preview';
      const r = await fetch(url);
      const j = (await r.json()) as { seed: number; probes: ProbeCase[] };
      setProbeSeed(j.seed);
      setProbePreview(j.probes || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadProbePreview();
  }, []);

  const handleSendChat = async () => {
    const text = prompt.trim();
    if (!text || streaming) return;

    const userTurn: ChatTurn = { id: `u-${Date.now()}`, role: 'user', content: text };
    const assistantId = `a-${Date.now() + 1}`;
    const nextHistory = [...turns, userTurn];
    setTurns([...nextHistory, { id: assistantId, role: 'assistant', content: '' }]);
    setPrompt('');
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t0 = performance.now();

    try {
      const r = await fetch('/api/control/playground/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          stream: true,
          useThrottle,
          enableToolTest,
          messages: nextHistory.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: ctrl.signal,
      });

      const ct = r.headers.get('content-type') || '';
      if (!r.ok) {
        const errText = await r.text();
        let msg = `HTTP ${r.status}`;
        try {
          const parsed = JSON.parse(errText) as { error?: string | { message?: string } };
          msg = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message || msg;
        } catch {
          if (errText) msg = errText.slice(0, 180);
        }
        setTurns((prev) =>
          prev.map((t) => (t.id === assistantId ? { ...t, error: msg, latencyMs: Math.round(performance.now() - t0) } : t))
        );
        return;
      }

      if (ct.includes('text/event-stream') && r.body) {
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accContent = '';
        let accReasoning = '';
        let accTools = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr || dataStr === '[DONE]') continue;
            try {
              const ev = JSON.parse(dataStr) as {
                choices?: Array<{
                  delta?: { content?: string; reasoning_content?: string; tool_calls?: unknown[] };
                }>;
              };
              const delta = ev.choices?.[0]?.delta;
              if (delta?.content) accContent += delta.content;
              if (delta?.reasoning_content) accReasoning += delta.reasoning_content;
              if (delta?.tool_calls) accTools += JSON.stringify(delta.tool_calls);
              setTurns((prev) =>
                prev.map((t) =>
                  t.id === assistantId
                    ? {
                        ...t,
                        content: accContent,
                        reasoning: accReasoning || undefined,
                        toolCall: accTools || undefined,
                        latencyMs: Math.round(performance.now() - t0),
                      }
                    : t
                )
              );
            } catch {
              // ignore non-json SSE keepalives
            }
          }
        }
      } else {
        const j = (await r.json()) as {
          choices?: Array<{
            message?: { content?: string; reasoning_content?: string; tool_calls?: unknown[] };
          }>;
        };
        const msg = j.choices?.[0]?.message;
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  content: msg?.content || '(پاسخ خالی)',
                  reasoning: msg?.reasoning_content,
                  toolCall: msg?.tool_calls ? JSON.stringify(msg.tool_calls, null, 2) : undefined,
                  latencyMs: Math.round(performance.now() - t0),
                }
              : t
          )
        );
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  error: err instanceof Error ? err.message : 'خطای ارتباط',
                  latencyMs: Math.round(performance.now() - t0),
                }
              : t
          )
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const toggleProbeModel = (m: string) => {
    setProbeModels((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  const handleRunProbes = async () => {
    if (probeModels.length === 0) {
      onNotify('حداقل یک مدل برای سنجش انتخاب کنید', 'err');
      return;
    }
    setProbeRunning(true);
    setProbeResults([]);
    try {
      const r = await fetch('/api/control/probes/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: probeSeed, models: probeModels, limit: 3 }),
      });
      const j = (await r.json()) as { ok?: boolean; results?: ProbeResult[]; error?: string };
      if (!r.ok || !j.ok) {
        onNotify(j.error || 'اجرای پروب ناموفق بود', 'err');
      } else {
        setProbeResults(j.results || []);
        onNotify(`سنجش توانمندی پایان یافت (${j.results?.length ?? 0} آزمون)`, 'ok');
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'خطا', 'err');
    } finally {
      setProbeRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation Tabs */}
      <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'playground'}
          onClick={() => setSubTab('playground')}
          className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-medium transition-colors ${
            subTab === 'playground'
              ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          آزمایشگاه چت استریم (SSE Playground)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'probe'}
          onClick={() => setSubTab('probe')}
          className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-medium transition-colors ${
            subTab === 'probe'
              ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
          }`}
        >
          <FlaskConical className="h-3.5 w-3.5" />
          سنجش توانمندی مدل‌ها (Capability Probe)
        </button>
      </div>

      {subTab === 'playground' ? (
        <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
          {/* Controls bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="pg-model" className="text-xs font-medium text-slate-600 dark:text-slate-400">
                مدل:
              </label>
              <select
                id="pg-model"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={useThrottle}
                  onChange={(e) => setUseThrottle(e.target.checked)}
                  className="accent-blue-600"
                />
                عبور از تراتل ضدبن
              </label>

              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={enableToolTest}
                  onChange={(e) => setEnableToolTest(e.target.checked)}
                  className="accent-blue-600"
                />
                تزریق ابزار تست (get_time)
              </label>
            </div>

            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => setTurns([])}
                className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                پاک کردن گفتگو
              </button>
            )}
          </div>

          {/* Messages Viewport */}
          <div className="min-h-[320px] max-h-[480px] space-y-4 overflow-y-auto p-6">
            {turns.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  آماده تست زنده استریم SSE و زنجیره تفکر
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {online
                    ? 'پیام خود را بنویسید تا پاسخ به‌صورت زنده از طریق پل استریم شود.'
                    : 'توجه: موتور وب (8093) هم‌اکنون آفلاین است — پس از روشن کردن آن می‌توانید چت زنده بگیرید.'}
                </p>
              </div>
            ) : (
              turns.map((t) => (
                <div
                  key={t.id}
                  className={`rounded-xl border p-4 text-sm ${
                    t.role === 'user'
                      ? 'border-blue-200/70 bg-blue-50/40 dark:border-blue-900/50 dark:bg-blue-950/20'
                      : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/50'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium">{t.role === 'user' ? 'کاربر' : selectedModel}</span>
                    {t.latencyMs !== undefined && <span className="font-mono tabular-nums">{t.latencyMs}ms</span>}
                  </div>

                  {t.reasoning && (
                    <div className="mb-3 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/60">
                      <button
                        type="button"
                        onClick={() => setOpenReasoning((p) => ({ ...p, [t.id]: !p[t.id] }))}
                        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        <span>زنجیره تفکر (reasoning_content)</span>
                        {openReasoning[t.id] ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                      {openReasoning[t.id] && (
                        <pre className="whitespace-pre-wrap border-t border-slate-200 p-3 font-mono text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          {t.reasoning}
                        </pre>
                      )}
                    </div>
                  )}

                  {t.error ? (
                    <p className="font-mono text-xs text-red-600 dark:text-red-400">{t.error}</p>
                  ) : (
                    <div className="whitespace-pre-wrap leading-relaxed text-slate-900 dark:text-slate-100">
                      {t.content || (streaming ? 'در حال دریافت استریم...' : '')}
                    </div>
                  )}

                  {t.toolCall && (
                    <pre
                      dir="ltr"
                      className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-emerald-700 dark:border-slate-800 dark:bg-slate-950 dark:text-emerald-400"
                    >
                      {t.toolCall}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Input Bar */}
          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-end gap-3">
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendChat();
                  }
                }}
                placeholder="پیامی برای تست مدل یا فراخوانی ابزار بنویسید (Enter برای ارسال)..."
                aria-label="متن پیام آزمایشگاه"
                className="flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-xs font-medium text-white hover:bg-red-700 whitespace-nowrap"
                >
                  <Square className="h-3.5 w-3.5" />
                  توقف
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!prompt.trim()}
                  onClick={() => void handleSendChat()}
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-blue-600 px-5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <Send className="h-3.5 w-3.5" />
                  ارسال
                </button>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                سنجش واقعی توانمندی و تشخیص تنزل خاموش مدل‌ها
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                آزمون‌های محاسباتی غیرقابل حفظ با بذر تصادفی <span className="font-mono">SEED={probeSeed}</span> — پاسخ صحیح به‌صورت محلی محاسبه می‌شود
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadProbePreview()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                بذر جدید
              </button>
              <button
                type="button"
                disabled={probeRunning}
                onClick={() => void handleRunProbes()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                {probeRunning ? 'در حال اجرا...' : 'اجرای آزمون روی مدل‌ها'}
              </button>
            </div>
          </div>

          <div className="space-y-6 p-6">
            {/* Model selector */}
            <div>
              <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                مدل‌های هدف سنجش (اصلاح‌شده برای مدل‌های Gemini 4 به‌جای مقادیر قبلی):
              </p>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_MODELS.map((m) => {
                  const active = probeModels.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleProbeModel(m)}
                      className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-600/10 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Generated Probes Preview */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                    <th className="px-4 py-2.5 font-medium">نام آزمون</th>
                    <th className="px-4 py-2.5 font-medium">پرامپت تولیدشده</th>
                    <th className="px-4 py-2.5 font-medium">پاسخ دقیق محلی</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {probePreview.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {p.name}
                      </td>
                      <td className="max-w-xl truncate px-4 py-3 font-mono text-slate-600 dark:text-slate-300" dir="ltr">
                        {p.prompt.split('\n')[0]}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {p.expected}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Results Matrix */}
            {probeResults.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                      <th className="px-4 py-2.5 font-medium">مدل</th>
                      <th className="px-4 py-2.5 font-medium">آزمون</th>
                      <th className="px-4 py-2.5 font-medium">نتیجه</th>
                      <th className="px-4 py-2.5 font-medium">پاسخ مدل / موردانتظار</th>
                      <th className="px-4 py-2.5 font-medium">زمان</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {probeResults.map((res, idx) => (
                      <tr key={`${res.model}-${res.probeId}-${idx}`}>
                        <td className="px-4 py-2.5 font-mono text-slate-900 dark:text-slate-100">{res.model}</td>
                        <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{res.probeName}</td>
                        <td className="px-4 py-2.5">
                          {res.passed ? (
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              قبول
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-400">
                              <XCircle className="h-3.5 w-3.5" />
                              رد
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-300">
                          {res.error ? (
                            <span className="text-red-500">{res.error}</span>
                          ) : (
                            `${res.got ?? '—'} / ${res.expected}`
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono tabular-nums text-slate-500">
                          {(res.durationMs / 1000).toFixed(1)}s
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
