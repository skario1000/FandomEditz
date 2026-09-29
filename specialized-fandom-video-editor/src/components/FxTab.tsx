import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Search, Sparkles } from 'lucide-react';
import { useEditor } from '../store';
import { COMBOS, FX_CATS, FX_DEFS, LIBRARY, catColor, defaultParams, newFxState, type FxCategory, type LibEntry } from '../lib/effects';
import { drawTexts, loadEditFonts } from '../lib/textEngine';
import { Chip } from './ui';

const PW = 150;
const PH = 84;

/** Renders a text preset at local time `lt` onto a canvas. */
function paintText(canvas: HTMLCanvasElement, e: LibEntry, lt: number) {
  const def = FX_DEFS.text;
  const dur = e.dur ?? def.dur;
  const dpr = 2;
  const W = PW * dpr;
  const H = PH * dpr;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const s = newFxState(W / H);
  const P: Record<string, string | number | boolean> = { ...defaultParams(def), ...(e.params ?? {}), y: 0.5 };
  // scale small lower-third / lyric sizes up so the preview is legible
  const size = typeof P.size === 'number' ? P.size : 0.12;
  P.size = Math.min(0.26, Math.max(size * 1.35, 0.075));
  def.apply!(s, { p: lt / dur, lt, dur, k: 1, P, seed: 7, T: lt, beats: [], start: 0 });
  drawTexts(ctx, W, H, s.texts);
}

function TextCard({ e }: { e: LibEntry }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);
  const dur = e.dur ?? FX_DEFS.text.dur;
  const stillAt = Math.min(dur * 0.55, 1.1);

  useEffect(() => {
    let alive = true;
    void loadEditFonts().then(() => alive && ref.current && paintText(ref.current, e, stillAt));
    return () => {
      alive = false;
    };
  }, [e, stillAt]);

  useEffect(() => {
    if (!hover) {
      if (ref.current) paintText(ref.current, e, stillAt);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const t = ((now - t0) / 1000) % (dur + 0.35);
      if (ref.current) paintText(ref.current, e, Math.min(t, dur - 0.001));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [hover, e, dur, stillAt]);

  return (
    <div
      role="button"
      draggable
      onDragStart={(ev) => {
        ev.dataTransfer.setData('application/x-ev', JSON.stringify({ kind: 'fx', id: e.id }));
        ev.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => useEditor.getState().addLib(e.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${e.desc}\nHover: preview · Click: add at playhead · Drag: drop on timeline`}
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-white/[0.06] bg-[#0b0b10] transition-all hover:-translate-y-px hover:border-white/25"
    >
      <div className="relative" style={{ aspectRatio: `${PW} / ${PH}`, background: 'radial-gradient(120% 90% at 50% 40%, #232336 0%, #0c0c12 70%)' }}>
        <canvas ref={ref} className="absolute inset-0 h-full w-full" />
        {e.hot && <span className="absolute right-1 top-1 rounded bg-[#ff2d55] px-1 text-[7.5px] font-black tracking-wider text-white">HOT</span>}
      </div>
      <div className="flex items-center gap-1 px-1.5 py-1">
        <span className="text-[11px]">{e.icon}</span>
        <span className="truncate text-[10.5px] font-semibold text-zinc-200">{e.name}</span>
      </div>
    </div>
  );
}

function FxCard({ e }: { e: LibEntry }) {
  const color = catColor(e.cat);
  return (
    <div
      role="button"
      draggable
      onDragStart={(ev) => {
        ev.dataTransfer.setData('application/x-ev', JSON.stringify({ kind: 'fx', id: e.id }));
        ev.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => useEditor.getState().addLib(e.id)}
      title={`${e.desc}\nClick: add at playhead · Drag: drop on timeline`}
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-white/[0.06] bg-[#13131a] px-2 pb-1.5 pt-2 transition-all hover:-translate-y-px hover:border-white/20 hover:bg-[#191922]"
    >
      <div className="absolute inset-x-0 top-0 h-[2px] opacity-80" style={{ background: color }} />
      <div className="text-[18px] leading-none">{e.icon}</div>
      <div className="mt-1 truncate text-[11px] font-semibold text-zinc-200">{e.name}</div>
      {e.hot && <span className="absolute right-1 top-1.5 rounded bg-[#ff2d55]/15 px-1 text-[8px] font-black tracking-wider text-[#ff5c7c]">HOT</span>}
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ background: `radial-gradient(120px 60px at 50% 0%, ${color}22, transparent)` }} />
    </div>
  );
}

export function FxTab() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<FxCategory | 'all' | 'combo'>('all');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return LIBRARY.filter((e) => (!s || e.name.toLowerCase().includes(s) || e.desc.toLowerCase().includes(s)) && (cat === 'all' || cat === e.cat));
  }, [q, cat]);
  const cats = FX_CATS.filter((c) => cat === 'all' || c.id === cat);
  return (
    <div className="space-y-3 p-3">
      {/* AI Mode quick banner */}
      <button
        type="button"
        onClick={() => useEditor.getState().ui({ aiOpen: true })}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#ff2d55]/40 bg-gradient-to-r from-[#ff2d55]/20 via-[#7b2dff]/20 to-transparent p-2.5 text-left transition-all hover:border-[#ff2d55]/70 active:scale-[0.98]"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#ff2d55] text-white shadow-sm">
            <Sparkles size={14} className="animate-pulse" />
          </div>
          <div>
            <div className="text-[12px] font-bold text-white leading-tight">AI Director Mode</div>
            <div className="text-[10px] text-zinc-400">Describe simple zooms or effects with OpenCode Go</div>
          </div>
        </div>
        <span className="rounded bg-[#ff2d55]/20 border border-[#ff2d55]/40 px-1.5 py-0.5 text-[8.5px] font-black tracking-wider text-[#ff5c7c] uppercase">
          Open
        </span>
      </button>

      <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#121218] px-2.5 py-1.5 focus-within:border-[#ff2d55]/50">
        <Search size={13} className="text-zinc-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search presets… (zoom, flash, twixtor)" className="w-full bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600" />
      </div>
      <div className="flex flex-wrap gap-1">
        <Chip active={cat === 'all'} onClick={() => setCat('all')}>
          All
        </Chip>
        <Chip active={cat === 'combo'} onClick={() => setCat('combo')} color="#ff2d55">
          Combos
        </Chip>
        {FX_CATS.map((c) => (
          <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)} color={c.color}>
            {c.name}
          </Chip>
        ))}
      </div>
      {(cat === 'all' || cat === 'combo') && !q && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            <Layers size={11} /> One-click combos
          </div>
          <div className="space-y-1.5">
            {COMBOS.map((c) => (
              <div
                key={c.id}
                role="button"
                draggable
                onDragStart={(ev) => ev.dataTransfer.setData('application/x-ev', JSON.stringify({ kind: 'combo', id: c.id }))}
                onClick={() => useEditor.getState().addCombo(c.id)}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/[0.06] bg-gradient-to-r from-[#ff2d55]/[0.07] to-transparent px-2.5 py-2 transition-colors hover:border-[#ff2d55]/40"
              >
                <span className="text-lg">{c.icon}</span>
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-zinc-100">{c.name}</div>
                  <div className="truncate text-[10.5px] text-zinc-500">{c.desc}</div>
                </div>
                <span className="ml-auto shrink-0 rounded bg-white/5 px-1.5 text-[9px] text-zinc-400">{c.items.length} fx</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {cat !== 'combo' &&
        cats.map((c) => {
          const items = list.filter((e) => e.cat === c.id);
          if (!items.length) return null;
          return (
            <div key={c.id}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: c.color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} /> {c.name}
              </div>
              {c.id === 'text' ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map((e) => (
                    <TextCard key={e.id} e={e} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {items.map((e) => (
                    <FxCard key={e.id} e={e} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      {!list.length && cat !== 'combo' && <div className="py-6 text-center text-[12px] text-zinc-500">No presets match “{q}”.</div>}
    </div>
  );
}
