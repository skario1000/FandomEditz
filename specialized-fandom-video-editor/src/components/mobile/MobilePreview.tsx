import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Diamond,
  Pause,
  Play,
  Plus,
  Repeat,
  Scissors,
} from 'lucide-react';
import { useEditor } from '../../store';
import { PreviewEngine } from '../../lib/preview';
import { aspectRatio, fmtTime } from '../../lib/utils';
import { clipAtTime, layoutClips, totalDuration } from '../../lib/velocity';
import { cn } from '../../utils/cn';

function MobileHud() {
  const info = useEditor((s) => {
    const hit = clipAtTime(layoutClips(s.project.clips), s.time);
    if (!hit) return '';
    const c = hit.clip;
    const tags: string[] = [`Clip ${hit.index + 1}`];
    if (Math.abs(c.speed - 1) > 0.001) tags.push(`${+c.speed.toFixed(2)}×`);
    if (c.reverse) tags.push('REV');
    if (c.twixtor) tags.push('TWX');
    if (c.velocity.preset !== 'none') tags.push(c.velocity.preset.toUpperCase());
    return tags.join(' • ');
  });

  if (!info) return null;
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center rounded-md bg-black/70 px-2 py-0.5 text-[9px] font-bold tracking-wider text-white backdrop-blur">
      {info}
    </div>
  );
}

function MobileTimeDisplay({ fps }: { fps: number }) {
  const time = useEditor((s) => s.time);
  const total = useEditor((s) => totalDuration(s.project.clips));
  return (
    <div className="font-mono text-[11.5px] tabular-nums leading-none">
      <span className="font-bold text-white">{fmtTime(time, fps)}</span>
      <span className="text-[10px] text-zinc-500"> / {fmtTime(total, fps)}</span>
    </div>
  );
}

export function MobilePreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const playing = useEditor((s) => s.playing);
  const fps = useEditor((s) => s.project.fps);
  const loop = useEditor((s) => s.loop);
  const aspect = useEditor((s) => s.project.aspect);
  const empty = useEditor((s) => s.project.clips.length === 0);
  const st = useEditor.getState();

  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let eng: PreviewEngine | null = null;
    try {
      if (canvasRef.current) {
        eng = new PreviewEngine(canvasRef.current);
      }
    } catch (e) {
      console.warn('Mobile preview engine init error:', e);
    }
    return () => eng?.destroy();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ar = aspectRatio(aspect);
    const fit = () => {
      const r = el.getBoundingClientRect();
      const pw = r.width - 16;
      const ph = r.height - 16;
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

  const step = (d: number) => {
    st.pause();
    st.setTime(Math.round((useEditor.getState().time + d) * fps) / fps);
  };

  return (
    <div className="flex shrink-0 flex-col bg-[#07070b]">
      {/* Video Viewport Area */}
      <div
        ref={containerRef}
        onClick={() => st.togglePlay()}
        className="relative flex h-[35vh] max-h-[340px] min-h-[190px] w-full items-center justify-center overflow-hidden bg-black/90 cursor-pointer select-none"
      >
        <div className="relative shadow-2xl" style={{ width: box.w, height: box.h }}>
          <canvas ref={canvasRef} className="h-full w-full rounded-md bg-black" />
          <MobileHud />

          {/* Centered Play overlay when paused */}
          {!playing && !empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur shadow-lg">
                <Play size={20} fill="white" className="ml-0.5" />
              </div>
            </div>
          )}

          {empty && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                st.ui({ mobileDrawer: 'clips' });
              }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center active:scale-95 transition-transform"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ff2d55]/20 text-[#ff2d55] shadow-lg">
                <Plus size={22} />
              </div>
              <div className="text-[13px] font-bold text-white">Empty timeline</div>
              <div className="rounded-full bg-[#ff2d55] px-3.5 py-1 text-[11px] font-black text-white shadow-md">
                Tap to add clips
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Touch-Friendly Transport Bar */}
      <div className="flex h-10 items-center justify-between border-y border-white/[0.08] bg-[#0c0c12] px-3 select-none">
        {/* Isolated Timecode: updates smoothly without re-rendering preview canvas */}
        <MobileTimeDisplay fps={fps} />

        {/* Center Transport Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(-1 / fps);
            }}
            className="rounded-lg p-1.5 text-zinc-400 hover:text-white active:scale-90"
            title="Step backward"
          >
            <ChevronLeft size={17} />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              st.togglePlay();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-[#ff2d55] to-[#b026ff] text-white shadow-md active:scale-95 transition-transform"
            title="Play / Pause"
          >
            {playing ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" className="ml-0.5" />}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              step(1 / fps);
            }}
            className="rounded-lg p-1.5 text-zinc-400 hover:text-white active:scale-90"
            title="Step forward"
          >
            <ChevronRight size={17} />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              st.ui({ loop: !loop });
            }}
            className={cn('rounded p-1 text-[11px] transition-colors', loop ? 'text-[#ff2d55]' : 'text-zinc-600')}
            title="Toggle loop"
          >
            <Repeat size={13} />
          </button>
        </div>

        {/* Quick Actions: Split & Beat Drop */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              st.splitAtPlayhead();
            }}
            className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[10.5px] font-bold text-zinc-200 active:bg-white/20 active:scale-95 transition-transform"
            title="Split clip at playhead"
          >
            <Scissors size={12} className="text-[#ff2d55]" />
            <span>Split</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              st.addBeat(useEditor.getState().time);
            }}
            className="flex items-center justify-center rounded-md bg-white/10 p-1 text-zinc-200 active:bg-white/20 active:scale-95"
            title="Add beat mark at playhead"
          >
            <Diamond size={13} className="text-[#ff5c7c]" />
          </button>
        </div>
      </div>
    </div>
  );
}
