import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, CornerDownRight, Pause, Play } from 'lucide-react';
import { useEditor } from '../store';
import { drawDemo } from '../lib/demo';
import { thumbs } from '../lib/media';
import { clamp, fmtSec, fmtTime } from '../lib/utils';
import { Btn } from './ui';

export function SourceViewer() {
  const m = useEditor((s) => s.media.find((x) => x.id === s.sourceId));
  const srcIn = useEditor((s) => s.srcIn);
  const srcOut = useEditor((s) => s.srcOut);
  useEditor((s) => s.thumbVersion);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const vref = useRef<HTMLVideoElement>(null);
  const cref = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const tRef = useRef(0);
  tRef.current = t;
  const dur = m?.duration ?? 0;

  useEffect(() => {
    setT(0);
    setPlaying(false);
  }, [m?.id]);

  // playback clock
  useEffect(() => {
    if (!m || !playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (m.kind === 'demo') {
        let n = tRef.current + (now - last) / 1000;
        if (n >= m.duration) n = 0;
        setT(n);
      } else if (vref.current) setT(vref.current.currentTime);
      last = now;
    };
    raf = requestAnimationFrame(loop);
    if (vref.current) void vref.current.play().catch(() => undefined);
    return () => {
      cancelAnimationFrame(raf);
      vref.current?.pause();
    };
  }, [m, playing]);

  // demo drawing
  useEffect(() => {
    if (m?.kind === 'demo' && cref.current) {
      const ctx = cref.current.getContext('2d');
      if (ctx) drawDemo(ctx, m.demoId || 'swing', Math.floor(t * 24) / 24, 1280, 720);
    }
  }, [t, m]);

  const seek = (nt: number) => {
    const v = clamp(nt, 0, Math.max(0, dur - 0.001));
    setT(v);
    if (vref.current && !playing) vref.current.currentTime = v;
    else if (vref.current) vref.current.currentTime = v;
  };

  // keyboard: I / O / Space
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT')) return;
      const st = useEditor.getState();
      if (st.viewer !== 'source') return;
      const k = e.key.toLowerCase();
      if (k === 'i') st.ui({ srcIn: tRef.current, srcOut: Math.max(st.srcOut, tRef.current + 0.1) });
      else if (k === 'o') st.ui({ srcOut: tRef.current, srcIn: Math.min(st.srcIn, Math.max(0, tRef.current - 0.1)) });
      else if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!m) return <div className="text-[12px] text-zinc-500">Pick a clip from the Media tab.</div>;

  const toTime = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * dur, 0, dur);
  };
  const dragOn = (e: React.PointerEvent, fn: (t: number) => void) => {
    e.preventDefault();
    e.stopPropagation();
    fn(toTime(e.clientX));
    const mv = (ev: PointerEvent) => fn(toTime(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const st = useEditor.getState();
  const selLen = Math.max(0, srcOut - srcIn);
  const pct = (x: number) => `${(x / (dur || 1)) * 100}%`;
  const ar = (m.width || 16) / (m.height || 9);

  return (
    <div className="flex h-full w-full flex-col gap-3 p-4">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="relative max-h-full max-w-full overflow-hidden rounded-md bg-black shadow-2xl ring-1 ring-white/10" style={{ aspectRatio: String(ar), height: '100%' }}>
          {m.kind === 'demo' ? (
            <canvas ref={cref} width={1280} height={720} className="h-full w-full object-contain" />
          ) : (
            <video ref={vref} src={m.url} muted playsInline preload="auto" className="h-full w-full object-contain" onLoadedData={(e) => (e.currentTarget.currentTime = t)} />
          )}
          <div className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300">Source</div>
        </div>
      </div>
      <div className="shrink-0 space-y-2">
        <div ref={barRef} className="relative h-12 cursor-pointer select-none overflow-hidden rounded-md bg-black/60 ring-1 ring-white/10" onPointerDown={(e) => dragOn(e, seek)}>
          <div className="absolute inset-0 flex">
            {Array.from({ length: 12 }, (_, i) => {
              const src = thumbs.get(m, ((i + 0.5) / 12) * dur);
              return <div key={i} className="h-full flex-1 bg-cover bg-center opacity-70" style={{ backgroundImage: src ? `url(${src})` : undefined }} />;
            })}
          </div>
          <div className="absolute inset-y-0 bg-black/60" style={{ left: 0, width: pct(srcIn) }} />
          <div className="absolute inset-y-0 bg-black/60" style={{ left: pct(srcOut), right: 0 }} />
          <div className="absolute inset-y-0 border-y-2 border-[#ff2d55]" style={{ left: pct(srcIn), width: pct(selLen) }} />
          <div className="absolute inset-y-0 z-10 w-2.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-[#ff2d55]" style={{ left: pct(srcIn) }} onPointerDown={(e) => dragOn(e, (v) => st.ui({ srcIn: Math.min(v, useEditor.getState().srcOut - 0.05) }))} title="In point" />
          <div className="absolute inset-y-0 z-10 w-2.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-[#ff2d55]" style={{ left: pct(srcOut) }} onPointerDown={(e) => dragOn(e, (v) => st.ui({ srcOut: Math.max(v, useEditor.getState().srcIn + 0.05) }))} title="Out point" />
          <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_6px_white]" style={{ left: pct(t) }} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPlaying(!playing)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" title="Play / pause (Space)">
            {playing ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" className="ml-0.5" />}
          </button>
          <span className="font-mono text-[12px] tabular-nums text-zinc-300">
            {fmtTime(t, Math.round(m.fps || 30))} <span className="text-zinc-600">/ {fmtTime(dur, Math.round(m.fps || 30))}</span>
          </span>
          <Btn variant="soft" onClick={() => st.ui({ srcIn: t, srcOut: Math.max(srcOut, t + 0.1) })} title="Mark In (I)">
            [ In
          </Btn>
          <Btn variant="soft" onClick={() => st.ui({ srcOut: Math.min(dur, Math.max(t, srcIn + 0.05)) })} title="Mark Out (O)">
            Out ]
          </Btn>
          <span className="text-[11px] text-zinc-500">
            Selection <b className="text-zinc-200">{fmtSec(selLen)}</b>
          </span>
          <div className="flex-1" />
          <Btn variant="soft" onClick={() => st.addClip(m.id, srcIn, srcOut, st.insertIndexAtTime(st.time))} title="Insert at the cut nearest to the playhead">
            <CornerDownRight size={13} /> Insert at playhead
          </Btn>
          <Btn
            variant="primary"
            onClick={() => {
              st.addClip(m.id, srcIn, srcOut);
              st.toast('Clip added to the end of the timeline', 'success');
            }}
          >
            <ArrowDownToLine size={13} /> Add to timeline
          </Btn>
        </div>
      </div>
    </div>
  );
}
