import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clapperboard, MonitorPlay, Pause, Play, Repeat, SkipBack, SkipForward } from 'lucide-react';
import { useEditor } from '../store';
import { PreviewEngine } from '../lib/preview';
import { aspectRatio, fmtTime } from '../lib/utils';
import { clipAtTime, layoutClips, totalDuration } from '../lib/velocity';
import { SourceViewer } from './SourceViewer';
import { cn } from '../utils/cn';

function Hud() {
  const info = useEditor((s) => {
    const hit = clipAtTime(layoutClips(s.project.clips), s.time);
    if (!hit) return '';
    const c = hit.clip;
    const tags: string[] = [`#${hit.index + 1}`];
    if (Math.abs(c.speed - 1) > 0.001) tags.push(`${+c.speed.toFixed(2)}×`);
    if (c.reverse) tags.push('REVERSE');
    if (c.twixtor) tags.push('TWIXTOR');
    if (c.velocity.preset !== 'none') tags.push(c.velocity.preset.toUpperCase());
    return tags.join('|');
  });
  if (!info) return null;
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1">
      {info.split('|').map((t, i) => (
        <span key={i} className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider backdrop-blur', i === 0 ? 'bg-black/60 text-zinc-300' : 'bg-[#ff2d55]/80 text-white')}>
          {t}
        </span>
      ))}
    </div>
  );
}

function Transport() {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const total = useEditor((s) => totalDuration(s.project.clips));
  const fps = useEditor((s) => s.project.fps);
  const loop = useEditor((s) => s.loop);
  const quality = useEditor((s) => s.quality);
  const st = useEditor.getState();
  const step = (d: number) => {
    st.pause();
    st.setTime(Math.round((useEditor.getState().time + d) * fps) / fps);
  };
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-white/[0.06] bg-[#0b0b10] px-3">
      <div className="w-[150px] font-mono text-[12px] tabular-nums">
        <span className="text-white">{fmtTime(time, fps)}</span>
        <span className="text-zinc-600"> / {fmtTime(total, fps)}</span>
      </div>
      <div className="flex flex-1 items-center justify-center gap-1">
        <button type="button" title="Go to start (Home)" onClick={() => st.setTime(0)} className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white">
          <SkipBack size={15} />
        </button>
        <button type="button" title="Previous frame (←)" onClick={() => step(-1 / fps)} className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white">
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          title="Play / pause (Space)"
          onClick={st.togglePlay}
          className="mx-1 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#ff2d55] to-[#b026ff] text-white shadow-lg shadow-[#ff2d55]/30 transition-transform hover:scale-105 active:scale-95"
        >
          {playing ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" className="ml-0.5" />}
        </button>
        <button type="button" title="Next frame (→)" onClick={() => step(1 / fps)} className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white">
          <ChevronRight size={16} />
        </button>
        <button type="button" title="Go to end (End)" onClick={() => st.setTime(total)} className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white">
          <SkipForward size={15} />
        </button>
      </div>
      <div className="flex w-[150px] items-center justify-end gap-1">
        <button
          type="button"
          title="Loop playback"
          onClick={() => st.ui({ loop: !loop })}
          className={cn('rounded-md p-1.5 transition-colors', loop ? 'text-[#ff2d55]' : 'text-zinc-500 hover:text-zinc-300')}
        >
          <Repeat size={14} />
        </button>
        <button
          type="button"
          title="Preview resolution (half = faster on slow machines)"
          onClick={() => st.ui({ quality: quality === 'full' ? 'half' : 'full' })}
          className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400 hover:text-white"
        >
          {quality === 'full' ? 'FULL' : 'HALF'}
        </button>
      </div>
    </div>
  );
}

export function PreviewPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const aspect = useEditor((s) => s.project.aspect);
  const viewer = useEditor((s) => s.viewer);
  const sourceName = useEditor((s) => s.media.find((m) => m.id === s.sourceId)?.name);
  const empty = useEditor((s) => s.project.clips.length === 0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let eng: PreviewEngine | null = null;
    try {
      eng = new PreviewEngine(canvasRef.current!);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    return () => eng?.destroy();
  }, []);

  useEffect(() => {
    const el = areaRef.current!;
    const ar = aspectRatio(aspect);
    const fit = () => {
      const r = el.getBoundingClientRect();
      const pw = r.width - 32;
      const ph = r.height - 32;
      let w = pw;
      let h = pw / ar;
      if (h > ph) {
        h = ph;
        w = ph * ar;
      }
      setBox({ w: Math.max(0, Math.floor(w)), h: Math.max(0, Math.floor(h)) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  const st = useEditor.getState();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/[0.06] bg-[#0b0b10] px-2">
        <button
          type="button"
          onClick={() => st.ui({ viewer: 'program' })}
          className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold', viewer === 'program' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300')}
        >
          <MonitorPlay size={13} /> Program
        </button>
        <button
          type="button"
          disabled={!sourceName}
          onClick={() => st.ui({ viewer: 'source' })}
          className={cn(
            'flex max-w-[260px] items-center gap-1.5 truncate rounded-md px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40',
            viewer === 'source' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <Clapperboard size={13} /> Source{sourceName ? ` · ${sourceName}` : ''}
        </button>
        <div className="flex-1" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">{aspect} · live GPU preview</span>
      </div>
      <div ref={areaRef} className="bg-grid relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#08080c]">
        <div className="relative" style={{ width: box.w, height: box.h, display: viewer === 'program' ? 'block' : 'none' }}>
          <canvas ref={canvasRef} className="h-full w-full rounded-md bg-black shadow-2xl shadow-black/60 ring-1 ring-white/10" />
          <Hud />
          {empty && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <div className="text-3xl">🎬</div>
              <div className="text-[13px] font-semibold text-zinc-200">Your timeline is empty</div>
              <div className="text-[11px] text-zinc-500">Import clips in the Media tab, or click a demo clip and add it.</div>
            </div>
          )}
          {err && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[12px] text-red-300">Preview unavailable: {err}</div>}
        </div>
        {viewer === 'source' && <SourceViewer />}
      </div>
      <Transport />
    </div>
  );
}
