import { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Wand2,
  WifiOff,
  X,
} from 'lucide-react';
import { useEditor } from '../store';
import {
  type AiConfig,
  type AiPlan,
  DEFAULT_AI_CONFIG,
  OPENCODE_MODELS,
  applyAiPlan,
  callOpenCodeGo,
  loadAiConfig,
  saveAiConfig,
  testConnection,
} from '../lib/ai';
import { cn } from '../utils/cn';

const EXAMPLE_PROMPTS = [
  'Make simple zooms over the edit',
  'Add a spin zoom roll on every clip',
  'Tip the frame into a dutch angle across the edit',
  'Make the whole edit breathe with the music',
  'Add smooth AE Flow zooms alternating in and out',
  'Create a Spidey-Sense glitch with red flash and shake',
  'Add turbulent displace text saying SPIDER',
  'Apply dramatic microwave pulses on every beat',
  'Add cinema bars, dreamy glow and film grain',
  'Crash zoom into an explosive beat drop',
  'Stutter and reverse the climax',
];

export function AiModal() {
  const open = useEditor((s) => s.aiOpen);
  const project = useEditor((s) => s.project);
  const st = useEditor.getState();

  const [cfg, setCfg] = useState<AiConfig>(loadAiConfig);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [stepMsg, setStepMsg] = useState('');
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [checking, setChecking] = useState(false);

  const [showKey, setShowKey] = useState(false);
  const [showConfig, setShowConfig] = useState(!cfg.apiKey);
  const [customModel, setCustomModel] = useState(
    OPENCODE_MODELS.some((m) => m.id === cfg.model) ? '' : cfg.model
  );

  if (!open) return null;

  const close = () => {
    st.ui({ aiOpen: false });
    setPlan(null);
    setError(null);
  };

  const updateCfg = (patch: Partial<AiConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    saveAiConfig(patch);
  };

  const handleGenerate = async (customPromptText?: string) => {
    const textToRun = (customPromptText ?? prompt).trim();
    if (!textToRun) return;

    setLoading(true);
    setError(null);
    setPlan(null);
    setDiag(null);
    setStepMsg('Analyzing timeline...');

    try {
      const activeModel =
        cfg.model === 'custom' && customModel.trim() ? customModel.trim() : cfg.model;
      const activeCfg = { ...cfg, model: activeModel };

      const result = await callOpenCodeGo(
        textToRun,
        project,
        activeCfg,
        (msg) => setStepMsg(msg)
      );

      // Surface why we fell back so the failure is never silent again.
      if (result.isFallback && cfg.apiKey.trim()) {
        const match = result.explanation.match(/Live model unreachable: ([\s\S]*)$/);
        setDiag(match ? match[1].trim() : 'The live model could not be reached from this browser.');
      }

      setPlan(result);
    } catch (err) {
      console.error('AI generation error:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setStepMsg('');
    }
  };

  /** Tests whether the key + endpoint + relay chain can actually reach the API. */
  const runConnectionTest = async () => {
    setChecking(true);
    setDiag(null);
    try {
      const probe = await testConnection(cfg);
      setDiag(probe.report);
      if (probe.ok) st.toast('Connected to OpenCode Go ✓', 'success');
      else st.toast('Connection failed — see diagnostics', 'error');
    } catch (err) {
      setDiag(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const handleApply = () => {
    if (!plan) return;
    st.commit((p) => applyAiPlan(plan, p));
    st.toast(`Applied AI edit: ${plan.summary}`, 'success');
    close();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-md"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="ev-in relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0e0e16] shadow-2xl shadow-[#ff2d55]/10">
        {/* Modal Top Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-gradient-to-r from-[#ff2d55]/15 via-transparent to-[#7b2dff]/15 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#ff2d55] to-[#7b2dff] text-white shadow-lg shadow-[#ff2d55]/30">
              <Bot size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-black tracking-tight text-white">
                  AI Edit Director
                </span>
                <span className="rounded-full bg-[#ff2d55]/20 border border-[#ff2d55]/40 px-2 py-0.5 text-[8.5px] font-black tracking-wider text-[#ff5c7c] uppercase">
                  OpenCode Go
                </span>
              </div>
              <p className="text-[10.5px] text-zinc-400">
                Describe desired zooms, rhythms, text, or effects in plain English
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Modal Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          {/* OpenCode Go API Key & Settings accordion */}
          <div className="rounded-xl border border-white/[0.08] bg-[#12121c] p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowConfig(!showConfig)}
                className="flex items-center gap-2 text-left text-[12px] font-bold text-zinc-200 hover:text-white"
              >
                <KeyRound size={14} className="text-[#ff2d55]" />
                <span>OpenCode Go API Key & Model Configuration</span>
                {cfg.apiKey ? (
                  <span className="flex items-center gap-1 rounded bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                    <Check size={9} /> Key Saved
                  </span>
                ) : (
                  <span className="rounded bg-yellow-950/60 border border-yellow-500/30 px-1.5 py-0.5 text-[9px] font-bold text-yellow-300">
                    Optional (Local AI active)
                  </span>
                )}
                {showConfig ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              <a
                href="https://opencode.ai/auth"
                target="_blank"
                rel="noreferrer"
                className="text-[10.5px] font-semibold text-[#ff5c7c] hover:underline"
              >
                Get OpenCode Key →
              </a>
            </div>

            {showConfig && (
              <div className="pt-2 border-t border-white/[0.06] space-y-3 ev-in">
                {/* API Key Input */}
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
                    <span>OpenCode Go API Key:</span>
                    <span className="text-[9.5px] text-zinc-500">Stored only in this browser</span>
                  </div>
                  <div className="relative flex items-center">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={cfg.apiKey}
                      onChange={(e) => updateCfg({ apiKey: e.target.value })}
                      placeholder="sk-..."
                      className="w-full rounded-lg border border-white/[0.08] bg-black/40 px-3 py-1.5 pr-9 text-[12px] text-zinc-200 outline-none focus:border-[#ff2d55]/60 placeholder:text-zinc-600 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>

                  <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-950/25 p-2 text-[10.5px] leading-relaxed text-amber-200/90">
                    <WifiOff size={13} className="mt-0.5 shrink-0 text-amber-400" />
                    <span>
                      <b>Browser limitation:</b> opencode.ai sends no CORS headers, so a web page
                      cannot call it directly. EDITVERSE relays through public CORS proxies, which
                      are often rate-limited or offline. If the live model fails, the built-in
                      offline director takes over and still builds your edit.
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={checking || !cfg.apiKey.trim()}
                    onClick={() => void runConnectionTest()}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] py-1.5 text-[11.5px] font-bold text-zinc-200 hover:bg-white/10 disabled:opacity-40"
                  >
                    {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    <span>{checking ? 'Testing connection…' : 'Test connection & diagnose'}</span>
                  </button>

                  {diag && (
                    <div className="mt-2 overflow-hidden rounded-lg border border-white/[0.08] bg-black/50">
                      <button
                        type="button"
                        onClick={() => setShowDiag(!showDiag)}
                        className="flex w-full items-center justify-between px-2.5 py-1.5 text-[10.5px] font-bold text-zinc-300 hover:text-white"
                      >
                        <span>Diagnostics</span>
                        {showDiag ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      {showDiag && (
                        <pre className="max-h-52 overflow-auto border-t border-white/[0.06] px-2.5 py-2 text-[10px] leading-relaxed whitespace-pre-wrap text-zinc-400 font-mono">
                          {diag}
                        </pre>
                      )}
                    </div>
                  )}
                </div>

                {/* Model and Endpoint Selection */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <label className="block mb-1 text-zinc-400">Model:</label>
                    <select
                      value={cfg.model}
                      onChange={(e) => updateCfg({ model: e.target.value })}
                      className="w-full rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-1.5 text-[11.5px] text-zinc-200 outline-none focus:border-[#ff2d55]/60"
                    >
                      {OPENCODE_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>

                    {cfg.model === 'custom' && (
                      <input
                        type="text"
                        value={customModel}
                        onChange={(e) => {
                          setCustomModel(e.target.value);
                          updateCfg({ model: e.target.value });
                        }}
                        placeholder="Enter model id (e.g. qwen3.5-plus)"
                        className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-1 text-[11px] text-zinc-200 outline-none"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block mb-1 text-zinc-400">Endpoint Base URL:</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={cfg.endpoint}
                        onChange={(e) => updateCfg({ endpoint: e.target.value })}
                        placeholder="https://opencode.ai/zen/go/v1"
                        className="w-full rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-[#ff2d55]/60 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => updateCfg({ endpoint: DEFAULT_AI_CONFIG.endpoint })}
                        title="Reset to default OpenCode Go URL"
                        className="shrink-0 rounded bg-white/5 px-2 py-1.5 text-[10px] text-zinc-400 hover:text-white"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </div>

                {/* Browser CORS proxy toggle */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <Globe size={13} className="text-[#22d3ee]" />
                    <span>Auto-proxy for browser CORS compatibility</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateCfg({ corsProxy: !cfg.corsProxy })}
                    className={cn(
                      'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                      cfg.corsProxy ? 'bg-[#ff2d55]' : 'bg-zinc-700'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                        cfg.corsProxy ? 'left-[18px]' : 'left-0.5'
                      )}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quick Idea Prompts */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                <Sparkles size={11} className="text-[#ff2d55]" /> Quick Ideas (Tap to run)
              </span>
              <span className="text-[10px] text-zinc-500">Popular fandom edit recipes</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setPrompt(ex);
                    void handleGenerate(ex);
                  }}
                  className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] text-zinc-300 hover:border-[#ff2d55]/50 hover:bg-[#ff2d55]/10 hover:text-white active:scale-95 transition-all text-left"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Description Area */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <label htmlFor="ai-prompt-input" className="font-bold text-zinc-300">
                Describe the edit or effect you want:
              </label>
              <span className="text-[10px] text-zinc-500">
                {project.clips.length} clips on timeline
              </span>
            </div>

            <div className="relative">
              <textarea
                id="ai-prompt-input"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void handleGenerate();
                  }
                }}
                placeholder="e.g. 'make simple zooms over the edit' or 'describe an effect you want, like a dark Spider-Sense glitch with heavy shake on the beat'..."
                className="w-full resize-none rounded-xl border border-white/[0.08] bg-[#12121c] p-3 text-[13px] text-zinc-100 outline-none focus:border-[#ff2d55] placeholder:text-zinc-600 shadow-inner"
              />

              <button
                type="button"
                disabled={loading || !prompt.trim()}
                onClick={() => void handleGenerate()}
                className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff2d55] to-[#7b2dff] px-3.5 py-1.5 text-[11.5px] font-bold text-white shadow-md hover:brightness-110 active:scale-95 transition-transform disabled:opacity-40"
              >
                {loading ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Thinking...</span>
                  </>
                ) : (
                  <>
                    <Send size={13} />
                    <span>Generate</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Loading status banner */}
          {loading && (
            <div className="ev-in flex items-center gap-2.5 rounded-xl border border-[#ff2d55]/30 bg-[#ff2d55]/10 p-3 text-[12px] text-zinc-200">
              <Loader2 size={16} className="animate-spin text-[#ff2d55]" />
              <div className="min-w-0">
                <div className="font-bold">{stepMsg || 'Processing request with AI...'}</div>
                <div className="text-[10.5px] text-zinc-400">
                  Calculating speed curves, timing, and effect parameters
                </div>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="ev-in flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-[11.5px] text-red-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
              <div>
                <div className="font-bold">Generation failed</div>
                <div className="mt-0.5 text-zinc-400">{error}</div>
              </div>
            </div>
          )}

          {/* Fallback notice when a key was set but the live model was unreachable */}
          {diag && plan && !loading && (
            <div className="ev-in flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-[11.5px] text-amber-100">
              <WifiOff size={15} className="mt-0.5 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <div className="font-bold">Offline director produced this edit</div>
                <div className="mt-0.5 text-[10.5px] leading-relaxed text-amber-200/70">
                  Your key was set, but the live model could not be reached from the browser.{' '}
                  <button type="button" onClick={() => setShowDiag(true)} className="font-bold underline">
                    Open the key settings
                  </button>{' '}
                  and run <i>Test connection &amp; diagnose</i> to see the exact failure.
                </div>
              </div>
            </div>
          )}

          {/* Generated Plan Review */}
          {plan && (
            <div className="ev-in rounded-xl border border-white/[0.08] bg-[#12121a] p-3.5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-[13px] font-black text-white">
                    <Wand2 size={14} className="text-[#ff2d55]" />
                    <span>{plan.summary}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-zinc-400">
                    {plan.explanation}
                  </p>
                </div>
                {plan.isFallback && (
                  <span className="shrink-0 rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[9px] font-semibold text-zinc-400">
                    Built-in Director
                  </span>
                )}
              </div>

              {/* Actions List Preview */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                  <Layers size={11} className="text-[#22d3ee]" />
                  <span>Timeline Changes ({plan.actions.length} items)</span>
                </div>

                <div className="max-h-44 overflow-y-auto space-y-1 rounded-lg border border-white/[0.06] bg-black/40 p-1.5">
                  {plan.actions.map((act, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded bg-white/[0.03] px-2.5 py-1 text-[11px]"
                    >
                      <div className="flex items-center gap-2 truncate min-w-0">
                        <span className="text-[#ff5c7c] font-mono text-[9px]">#{idx + 1}</span>
                        <span className="font-semibold text-zinc-200 truncate">
                          {act.description ||
                            (act.type === 'add_fx'
                              ? `Add ${act.fxType}`
                              : act.type === 'add_text'
                              ? `Add Text: "${act.text}"`
                              : act.type === 'apply_velocity'
                              ? `Apply ${act.velocityPreset} velocity`
                              : act.type)}
                        </span>
                      </div>

                      {act.start !== undefined && (
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
                          @{act.start.toFixed(2)}s ({act.duration?.toFixed(2)}s)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Apply / Cancel Footer */}
              <div className="flex items-center justify-end gap-2 pt-1 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setPlan(null)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-[11.5px] font-semibold text-zinc-300 hover:text-white"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff2d55] to-[#7b2dff] px-4 py-1.5 text-[12px] font-bold text-white shadow-lg shadow-[#ff2d55]/30 hover:brightness-110 active:scale-95 transition-transform"
                >
                  <Check size={14} />
                  <span>Apply to Timeline</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Bottom Footer / Tips */}
        <div className="flex shrink-0 items-center justify-between border-t border-white/[0.06] bg-[#0c0c12] px-4 py-2 text-[10px] text-zinc-500">
          <div className="flex items-center gap-1.5">
            <Cpu size={12} className="text-[#22d3ee]" />
            <span>OpenCode Go Subscription ($10/mo) or local intelligent parser</span>
          </div>
          <span>Ctrl + Enter to run</span>
        </div>
      </div>
    </div>
  );
}
