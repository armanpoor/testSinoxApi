import { useMemo, useState, type ReactNode } from 'react';
import { Copy, Check, ShieldCheck } from 'lucide-react';
import { generateToolSnippets } from '../lib/configGenerator';
import type { BridgeSettings } from '../lib/types';

interface ConfigGeneratorViewProps {
  settings: BridgeSettings | null;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}

export function ConfigGeneratorView({ settings, onNotify }: ConfigGeneratorViewProps) {
  const [tool, setTool] = useState<'claude' | 'cline' | 'opencode' | '9router'>('claude');
  const [useThrottle, setUseThrottle] = useState(true);
  const [model, setModel] = useState('gemini-4-hydrogen');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const snippets = useMemo(
    () =>
      generateToolSnippets({
        useThrottle,
        throttlePort: settings?.throttlePort ?? 8095,
        bridgeUrl: settings?.bridgeUrl ?? 'http://127.0.0.1:8094',
        engineUrl: settings?.gw2apiUrl ?? 'http://127.0.0.1:8093',
        bridgeKey: settings?.bridgeKey ?? 'local-client-key-1',
        engineKey: settings?.gw2apiKey ?? 'sk-gemini-YOUR-KEY',
        model,
      }),
    [useThrottle, settings, model]
  );

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      onNotify('اسنیپت در کلیپ‌بورد کپی شد', 'ok');
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
    } catch {
      onNotify('کپی خودکار توسط مرورگر محدود شده است — متن را دستی کپی کنید', 'err');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              تولیدکننده خودکار کانفیگ هارنس‌ها و ابزارهای کدنویسی
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              اسنیپت‌های آماده اتصال اشتراک جمنای پرو به Claude Code، Cline/Roo، OpenCode، Aider و 9router
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="مدل انتخابی کانفیگ"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="gemini-4-hydrogen">gemini-4-hydrogen</option>
              <option value="gemini-4-hydrogen-thinking">gemini-4-hydrogen-thinking</option>
              <option value="gemini-4-neon">gemini-4-neon</option>
              <option value="gemini-4-carbon">gemini-4-carbon</option>
              <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite</option>
            </select>

            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={useThrottle}
                onChange={(e) => setUseThrottle(e.target.checked)}
                className="accent-blue-600"
              />
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>
                عبور از تراتل ضدبن (<span dir="ltr" className="font-mono">:{settings?.throttlePort ?? 8095}</span>)
              </span>
            </label>
          </div>
        </div>

        {/* Tool Selector Tabs */}
        <div className="mt-5 inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900" role="tablist">
          {(
            [
              ['claude', 'Claude Code'],
              ['cline', 'Cline / Roo Code'],
              ['opencode', 'OpenCode / Aider'],
              ['9router', '9router (Fallback)'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tool === id}
              onClick={() => setTool(id)}
              className={`rounded-md px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                tool === id
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Rendered Snippets */}
        <div className="mt-6 space-y-5">
          {tool === 'claude' && (
            <>
              <CodeCard
                title="PowerShell (ویندوز)"
                code={snippets.claudePowerShell}
                copied={copiedId === 'ps'}
                onCopy={() => void copyText('ps', snippets.claudePowerShell)}
              />
              <CodeCard
                title="Bash / Zsh (لینوکس و مک)"
                code={snippets.claudeBash}
                copied={copiedId === 'bash'}
                onCopy={() => void copyText('bash', snippets.claudeBash)}
              />
              <CodeCard
                title={
                  <>
                    فایل پروژه‌ای <span dir="ltr" className="font-mono">.claude/settings.json</span>
                  </>
                }
                code={snippets.claudeSettingsJson}
                copied={copiedId === 'json'}
                onCopy={() => void copyText('json', snippets.claudeSettingsJson)}
              />
            </>
          )}

          {tool === 'cline' && (
            <CodeCard
              title="پیکربندی OpenAI Compatible در Cline و Roo Code"
              code={snippets.clineConfig}
              copied={copiedId === 'cline'}
              onCopy={() => void copyText('cline', snippets.clineConfig)}
            />
          )}

          {tool === 'opencode' && (
            <>
              <CodeCard
                title={
                  <>
                    فایل <span dir="ltr" className="font-mono">opencode.json</span> (هارنس OpenCode)
                  </>
                }
                code={snippets.opencodeConfig}
                copied={copiedId === 'opencode'}
                onCopy={() => void copyText('opencode', snippets.opencodeConfig)}
              />
              <CodeCard
                title="اجرای Aider یا هر هارنس OpenAI-Compatible"
                code={snippets.aiderCommand}
                copied={copiedId === 'aider'}
                onCopy={() => void copyText('aider', snippets.aiderCommand)}
              />
            </>
          )}

          {tool === '9router' && (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-right text-xs">
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    <tr>
                      <td className="px-4 py-3 text-slate-500">Provider Type</td>
                      <td className="px-4 py-3 font-mono font-medium">OpenAI Compatible</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-slate-500">Name / Prefix</td>
                      <td className="px-4 py-3 font-mono">
                        {snippets.nineRouterGuide.name} · {snippets.nineRouterGuide.prefix}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-slate-500">Base URL</td>
                      <td className="px-4 py-3 font-mono" dir="ltr">
                        {snippets.nineRouterGuide.baseUrl}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-slate-500">ترتیب پیشنهادی Combo</td>
                      <td className="px-4 py-3 font-mono" dir="ltr">
                        {snippets.nineRouterGuide.comboOrder.join(' → ')}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <CodeCard
                title="اجرای Claude Code از طریق 9router"
                code={snippets.nineRouterGuide.claudeCommand}
                copied={copiedId === '9r'}
                onCopy={() => void copyText('9r', snippets.nineRouterGuide.claudeCommand)}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CodeCard({
  title,
  code,
  copied,
  onCopy,
}: {
  title: ReactNode;
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/70">
        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{title}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'کپی شد' : 'کپی'}
        </button>
      </div>
      <pre
        dir="ltr"
        className="overflow-x-auto bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100"
      >
        {code}
      </pre>
    </div>
  );
}
