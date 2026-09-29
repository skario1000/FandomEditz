import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Diamond,
  Grid3x3,
  MoveDiagonal,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Scissors,
} from 'lucide-react';
import { useEditor } from '../../store';
import { PreviewEngine } from '../../lib/preview';
import { aspectRatio, fmtTime } from '../../lib/utils';
import { clipAtTime, clipDuration, layoutClips, totalDuration } from '../../lib/velocity';
import { animatedValue } from '../../lib/keyframes';
import { CLIP_PROPS } from '../../types';
import { TransformGizmo } from '../TransformGizmo';
import { cn } from '../../utils/cn';

function MobileHud() {
  const info = useEditor((s) => {
    const hit = clipAtTime(layoutClips(s.project.clips), s.time);
    if (!hit) return '';
    const c = hit.clip;
    const dur = Math.max(0.001, clipDuration(c));
    const u = Math.max(0, Math.min(1, (s.time - hit.start) / dur));
    const rot = animatedValue(c.keyframes, CLIP_PROPS[3], u, c.rotation);
    const sc = animatedValue(c.keyframes, CLIP_PROPS[0], u, c.scale);
    const tags: string[] = [`Clip ${hit.index + 1}`];
    if (Math.abs(rot) > 0.05) tags.push(`⟳ ${Math.round(rot * 10) / 10}°`);
    if (Math.abs(sc - 1) > 0.005) tags.push(`${Math.round(sc * 100)}%`);
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
  const guides = useEditor((s) => s.guides);
  const st = useEditor.getState();
  // On a phone the gizmo is a mode, not a permanent overlay: one finger pans
  // the frame, two fingers pinch-zoom and twist, and a tap still plays.
  const [xf, setXf] = useState(false);

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
        onClick={() => {
          if (!xf) st.togglePlay();
        }}
        className="relative flex h-[35vh] max-h-[340px] min-h-[190px] w-full items-center justify-center overflow-hidden bg-black/90 cursor-pointer select-none"
      >
        <div className="relative shadow-2xl" style={{ width: box.w, height: box.h }}>
          <canvas ref={canvasRef} className="h-full w-full rounded-md bg-black" />
          {guides !== 'off' && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              {guides === 'thirds' ? (
                <>
                  <line x1="33.33" y1="0" x2="33.33" y2="100" stroke="rgba(255,255,255,0.22)" strokeWidth="0.25" />
                  <line x1="66.66" y1="0" x2="66.66" y2="100" stroke="rgba(255,255,255,0.22)" strokeWidth="0.25" />
                  <line x1="0" y1="33.33" x2="100" y2="33.33" stroke="rgba(255,255,255,0.22)" strokeWidth="0.25" />
                  <line x1="0" y1="66.66" x2="100" y2="66.66" stroke="rgba(255,255,255,0.22)" strokeWidth="0.25" />
                </>
              ) : (
                <>
                  <rect x="6" y="6" width="88" height="88" fill="none" stroke="rgba(255,45,85,0.5)" strokeWidth="0.3" strokeDasharray="1.6 1.4" />
                  <rect x="14" y="16" width="72" height="68" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.25" strokeDasharray="1.2 1.2" />
                </>
              )}
            </svg>
          )}
          <TransformGizmo boxW={box.w} boxH={box.h} touch enabled={xf} />
          {/* Transform mode strip — thumb-reachable, out of the way of the HUD */}
          {!empty && (
            <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-center gap-1.5 p-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setXf((v) => !v);
                }}
                className={cn(
                  'flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold shadow-lg backdrop-blur transition-colors',
                  xf ? 'bg-[#22d3ee] text-black' : 'bg-black/55 text-zinc-300'
                )}
              >
                <MoveDiagonal size={11} /> {xf ? 'Done' : 'Transform'}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  st.ui({ guides: guides === 'off' ? 'thirds' : guides === 'thirds' ? 'safe' : 'off' });
                }}
                className={cn(
                  'flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold shadow-lg backdrop-blur transition-colors',
                  guides === 'off' ? 'bg-black/55 text-zinc-300' : 'bg-white/85 text-black'
                )}
              >
                <Grid3x3 size={11} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  st.resetTransform();
                }}
                className="flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold text-zinc-300 shadow-lg backdrop-blur"
              >
                <RotateCcw size={11} /> Reset
              </button>
            </div>
          )}
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
