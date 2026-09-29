import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Magnet,
  Minus,
  Music2,
  Plus,
  Scissors,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useEditor } from '../../store';
import { clipSourceTime, layoutClips, totalDuration, type ClipLayout } from '../../lib/velocity';
import { FX_DEFS, catColor } from '../../lib/effects';
import { COLOR_PRESETS } from '../../lib/colorPresets';
import { thumbs } from '../../lib/media';
import { clamp, fmtTime } from '../../lib/utils';
import { getMusicClips, syncMusicProject } from '../../lib/music';
import { cn } from '../../utils/cn';
import type { FxItem, MusicTrack } from '../../types';

type DragVis = { id: string; dx: number; insertAt: number } | null;

function startDrag(
  e: React.PointerEvent,
  onMove: (dx: number, dy: number, ev: PointerEvent) => void,
  onUp?: (moved: boolean, ev: PointerEvent) => void
) {
  const sx = e.clientX;
  const sy = e.clientY;
  const pointerId = e.pointerId;
  const target = e.currentTarget as Element;
  let moved = false;

  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    // ignore
  }

  const mv = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (!moved && Math.hypot(dx, dy) > 5) {
      moved = true;
    }
    if (moved) {
      onMove(dx, dy, ev);
    }
  };

  const cleanup = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    try {
      target.releasePointerCapture?.(pointerId);
    } catch {
      // ignore
    }
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', cleanup);
    window.removeEventListener('pointercancel', cleanup);
    onUp?.(moved, ev);
  };

  window.addEventListener('pointermove', mv, { passive: true });
  window.addEventListener('pointerup', cleanup);
  window.addEventListener('pointercancel', cleanup);
}

const RULER_H = 22;
const FX_H = 24;
const VIDEO_H = 54;
const MUSIC_H = 34;
const TOTAL_H = RULER_H + FX_H + VIDEO_H + MUSIC_H + 12;

export function MobileTimeline() {
  const project = useEditor((s) => s.project);
  const media = useEditor((s) => s.media);
  const pps = useEditor((s) => s.pxPerSec);
  const sel = useEditor((s) => s.selection);
  const snap = useEditor((s) => s.snap);
  useEditor((s) => s.thumbVersion);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ dist: number; pps: number } | null>(null);

  const mediaMap = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const layout = layoutClips(project.clips);
  const total = totalDuration(project.clips);

  const musicClips = useMemo(() => getMusicClips(project, mediaMap), [project, mediaMap]);
  const musicEnd = musicClips.reduce((max, mc) => Math.max(max, mc.start + (mc.duration ?? 60)), 0);
  const fxEnd = project.fx.reduce((m, f) => Math.max(m, f.start + f.duration), 0);
  const contentDur = Math.max(total, musicEnd, fxEnd, 10) + 4;

  // Margin at left and right so playhead can be centered
  const padX = typeof window !== 'undefined' ? window.innerWidth / 2 : 180;
  const contentWidth = contentDur * pps + padX * 2;
  const st = useEditor.getState();

  // Touch scrubbing on ruler / background
  const onTouchScrub = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scrollX = el.scrollLeft + (clientX - rect.left);
    let t = Math.max(0, (scrollX - padX) / pps);

    if (useEditor.getState().snap) {
      const snapPoints = [0, ...layout.map((l) => l.end), ...project.beats];
      t = doSnap(t, snapPoints);
    }
    st.setTime(clamp(t, 0, contentDur));
  };

  const doSnap = (tVal: number, pts: number[]) => {
    if (!snap) return tVal;
    const th = 8 / pps;
    let best = tVal;
    let bd = th;
    for (const p of pts) {
      const d = Math.abs(p - tVal);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };

  const [drag, setDragState] = useState<DragVis>(null);
  const dragRef = useRef<DragVis>(null);
  const setDrag = (d: DragVis) => {
    dragRef.current = d;
    setDragState(d);
  };

  const xToTime = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const scrollX = el.scrollLeft + (clientX - el.getBoundingClientRect().left);
    return Math.max(0, (scrollX - padX) / pps);
  };

  const lastClipTap = useRef<{ id: string; time: number } | null>(null);

  const onClipPointerDown = (e: React.PointerEvent, l: ClipLayout) => {
    if ((e.target as HTMLElement).closest('[data-trim]')) return;

    // Double-tap on clip on mobile opens clip settings
    const now = Date.now();
    if (lastClipTap.current?.id === l.clip.id && now - lastClipTap.current.time < 350) {
      e.stopPropagation();
      st.select({ kind: 'clip', id: l.clip.id });
      st.ui({ mobileDrawer: 'clipSettings' });
      lastClipTap.current = null;
      return;
    }
    lastClipTap.current = { id: l.clip.id, time: now };

    e.stopPropagation();
    st.select({ kind: 'clip', id: l.clip.id });
    const currentLayout = layout;

    startDrag(
      e,
      (dx, _dy, ev) => {
        const touchTime = xToTime(ev.clientX);
        let idx = currentLayout.length;
        for (let i = 0; i < currentLayout.length; i++) {
          if (touchTime < (currentLayout[i].start + currentLayout[i].end) / 2) {
            idx = i;
            break;
          }
        }
        setDrag({ id: l.clip.id, dx, insertAt: idx });
      },
      (moved) => {
        const d = dragRef.current;
        setDrag(null);
        if (moved && d && d.insertAt !== l.index && d.insertAt !== l.index + 1) {
          st.moveClip(l.index, d.insertAt);
          st.toast(`Moved to clip #${Math.min(currentLayout.length, d.insertAt > l.index ? d.insertAt : d.insertAt + 1)}`, 'info');
        }
      }
    );
  };

  const lastFxTap = useRef<{ id: string; time: number } | null>(null);

  const onFxPointerDown = (e: React.PointerEvent, f: FxItem) => {
    if ((e.target as HTMLElement).closest('[data-trim]')) return;

    const now = Date.now();
    if (lastFxTap.current?.id === f.id && now - lastFxTap.current.time < 350) {
      e.stopPropagation();
      st.select({ kind: 'fx', id: f.id });
      st.ui({ mobileDrawer: 'fxSettings' });
      lastFxTap.current = null;
      return;
    }
    lastFxTap.current = { id: f.id, time: now };

    e.stopPropagation();
    st.select({ kind: 'fx', id: f.id });
    st.beginTxn();
    const pts = [0, ...layout.map((l) => l.start), ...layout.map((l) => l.end), ...project.beats];
    startDrag(
      e,
      (dx) => {
        let newStart = Math.max(0, f.start + dx / pps);
        if (snap) newStart = doSnap(newStart, pts);
        st.updateFx(f.id, { start: newStart }, true);
      },
      () => {
        st.endTxn();
      }
    );
  };

  const onFxTrimDown = (e: React.PointerEvent, f: FxItem, side: 'l' | 'r') => {
    e.stopPropagation();
    st.select({ kind: 'fx', id: f.id });
    st.beginTxn();
    const startT0 = f.start;
    const dur0 = f.duration;
    const endT0 = startT0 + dur0;
    const edgeRight = side === 'r';
    const pts = [0, ...layout.map((item) => item.start), ...layout.map((item) => item.end), ...project.beats];

    startDrag(
      e,
      (dx) => {
        const dt = dx / pps;
        if (edgeRight) {
          let newEnd = endT0 + dt;
          if (snap) newEnd = doSnap(newEnd, pts);
          const newDur = Math.max(0.05, newEnd - startT0);
          st.updateFx(f.id, { duration: newDur }, true);
        } else {
          let newStart = startT0 + dt;
          if (snap) newStart = doSnap(newStart, pts);
          newStart = Math.min(newStart, endT0 - 0.05);
          newStart = Math.max(0, newStart);
          const newDur = endT0 - newStart;
          st.updateFx(f.id, { start: newStart, duration: Math.max(0.05, newDur) }, true);
        }
      },
      () => st.endTxn()
    );
  };

  const onMusicPointerDown = (e: React.PointerEvent, mc: MusicTrack) => {
    if ((e.target as HTMLElement).closest('[data-trim]')) return;
    e.stopPropagation();
    st.select({ kind: 'music', id: mc.id || 'music' });
    const startT0 = mc.start;
    const b0 = project.beats;
    const pts = [0, ...layout.map((l) => l.start), ...layout.map((l) => l.end), ...project.beats];

    startDrag(
      e,
      (dx) => {
        let newStart = Math.max(0, startT0 + dx / pps);
        if (snap) newStart = doSnap(newStart, pts);
        const shift = newStart - startT0;
        const updated = { ...mc, start: newStart };
        const nextList = musicClips.map((item) => (item.id === mc.id ? updated : item));
        st.live((p) => ({
          ...syncMusicProject(p, nextList),
          beats: b0.map((b) => b + shift),
        }));
      },
      () => st.endTxn()
    );
  };

  const onMusicTrimDown = (e: React.PointerEvent, mc: MusicTrack, side: 'l' | 'r') => {
    e.stopPropagation();
    st.select({ kind: 'music', id: mc.id || 'music' });
    st.beginTxn();
    const m = mediaMap.get(mc.mediaId);
    const maxSrcDur = m?.duration ?? 300;
    const startT0 = mc.start;
    const srcIn0 = mc.srcIn ?? 0;
    const dur0 = mc.duration ?? Math.max(0.1, maxSrcDur - srcIn0);
    const edgeRight = side === 'r';
    const pts = [0, ...layout.map((item) => item.end), ...project.beats];

    startDrag(
      e,
      (dx) => {
        const dt = dx / pps;
        if (edgeRight) {
          let newDur = Math.max(0.1, dur0 + dt);
          if (srcIn0 + newDur > maxSrcDur) newDur = maxSrcDur - srcIn0;
          if (snap) {
            const snappedEnd = doSnap(startT0 + newDur, pts);
            newDur = Math.max(0.1, snappedEnd - startT0);
          }
          const updated = { ...mc, duration: newDur };
          const nextList = musicClips.map((item) => (item.id === mc.id ? updated : item));
          st.live((p) => syncMusicProject(p, nextList));
        } else {
          let newStart = startT0 + dt;
          let newSrcIn = srcIn0 + dt;
          let newDur = dur0 - dt;
          if (newSrcIn < 0) {
            const under = -newSrcIn;
            newSrcIn = 0;
            newStart += under;
            newDur -= under;
          }
          if (newDur < 0.1) {
            newDur = 0.1;
            newStart = startT0 + dur0 - 0.1;
          }
          if (snap) {
            const snappedStart = doSnap(newStart, pts);
            const shift = snappedStart - startT0;
            newStart = snappedStart;
            newSrcIn = Math.max(0, srcIn0 + shift);
            newDur = Math.max(0.1, dur0 - shift);
          }
          const updated = { ...mc, start: newStart, srcIn: newSrcIn, duration: newDur };
          const nextList = musicClips.map((item) => (item.id === mc.id ? updated : item));
          st.live((p) => syncMusicProject(p, nextList));
        }
      },
      () => st.endTxn()
    );
  };

  const onTrimDown = (e: React.PointerEvent, l: ClipLayout, side: 'l' | 'r') => {
    e.stopPropagation();
    const c0 = l.clip;
    st.select({ kind: 'clip', id: c0.id });
    st.beginTxn();
    const maxD = mediaMap.get(c0.mediaId)?.duration ?? c0.srcOut;
    const startT = l.start;
    const edgeRight = side === 'r';
    const movesOut = edgeRight !== c0.reverse;
    const pts = [0, ...layout.map((item) => item.end), ...project.beats];
    startDrag(
      e,
      (dx) => {
        const dt = dx / pps;
        if (movesOut) {
          let out = clamp(c0.srcOut + (edgeRight ? 1 : -1) * dt * c0.speed, c0.srcIn + 0.05, maxD);
          if (edgeRight && snap) {
            const endT = doSnap(startT + (out - c0.srcIn) / c0.speed, pts);
            out = clamp(c0.srcIn + (endT - startT) * c0.speed, c0.srcIn + 0.05, maxD);
          }
          st.updateClip(c0.id, { srcOut: out }, true);
        } else {
          let inn = clamp(c0.srcIn + (edgeRight ? -1 : 1) * dt * c0.speed, 0, c0.srcOut - 0.05);
          if (edgeRight && snap) {
            const endT = doSnap(startT + (c0.srcOut - inn) / c0.speed, pts);
            inn = clamp(c0.srcOut - (endT - startT) * c0.speed, 0, c0.srcOut - 0.05);
          }
          st.updateClip(c0.id, { srcIn: inn }, true);
        }
      },
      () => st.endTxn()
    );
  };

  // Pinch to zoom timeline
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), pps };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / (pinchRef.current.dist || 1);
      const nextPps = clamp(pinchRef.current.pps * ratio, 20, 300);
      st.ui({ pxPerSec: nextPps });
    }
  };

  const onTouchEnd = () => {
    pinchRef.current = null;
  };

  // Ruler time marks
  const step = pps < 50 ? 2 : pps < 100 ? 1 : 0.5;
  const timeLabels: number[] = [];
  for (let t = 0; t <= contentDur; t += step) timeLabels.push(t);

  return (
    <div className="relative flex flex-1 flex-col bg-[#09090e] select-none min-h-0">
      {/* Mini Controls Toolbar */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0c0c14] px-3 text-[10px]">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <button
            type="button"
            onClick={() => st.ui({ mobileDrawer: 'clips' })}
            className="flex items-center gap-1 rounded bg-[#ff2d55] px-2 py-0.5 font-bold text-white shadow-sm active:scale-95 transition-transform"
          >
            <Plus size={11} />
            <span>Add Clip</span>
          </button>

          <button
            type="button"
            onClick={() => st.splitAtPlayhead()}
            className="flex items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-white active:scale-95"
            title="Split selected item or clip/music under playhead"
          >
            <Scissors size={11} className="text-[#ff2d55]" />
            <span>Split</span>
          </button>

          {sel?.kind === 'music' && (
            <>
              <button
                type="button"
                onClick={() => st.trimMusicToPlayhead('start')}
                className="flex items-center gap-0.5 rounded bg-white/10 px-1.5 py-0.5 text-[9.5px] font-bold text-zinc-300 active:scale-95"
                title="Cut music start to playhead"
              >
                <span>&lt; Cut L</span>
              </button>
              <button
                type="button"
                onClick={() => st.trimMusicToPlayhead('end')}
                className="flex items-center gap-0.5 rounded bg-white/10 px-1.5 py-0.5 text-[9.5px] font-bold text-zinc-300 active:scale-95"
                title="Cut music end to playhead"
              >
                <span>Cut R &gt;</span>
              </button>
            </>
          )}

          {sel?.kind === 'fx' && (
            <button
              type="button"
              onClick={() => st.ui({ mobileDrawer: 'fxSettings' })}
              className="flex items-center gap-1 rounded bg-[#ff2d55]/20 px-2 py-0.5 font-bold text-[#ff5c7c] active:scale-95"
            >
              <SlidersHorizontal size={11} />
              <span>Settings</span>
            </button>
          )}

          {sel && (
            <button
              type="button"
              onClick={() => st.removeSelected()}
              className="flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-red-300 active:scale-95"
            >
              <Trash2 size={11} />
              <span>Delete</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Snap Button */}
          <button
            type="button"
            onClick={() => st.ui({ snap: !snap })}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-0.5 font-bold transition-colors',
              snap ? 'bg-[#ff2d55]/20 text-[#ff5c7c]' : 'text-zinc-500'
            )}
          >
            <Magnet size={11} />
            <span>Snap</span>
          </button>

          {/* Quick Zoom buttons */}
          <div className="flex items-center gap-0.5 rounded bg-white/5 p-0.5">
            <button
              type="button"
              onClick={() => st.ui({ pxPerSec: clamp(pps / 1.3, 20, 300) })}
              className="rounded p-1 text-zinc-400 active:text-white"
            >
              <Minus size={11} />
            </button>
            <button
              type="button"
              onClick={() => st.ui({ pxPerSec: clamp(pps * 1.3, 20, 300) })}
              className="rounded p-1 text-zinc-400 active:text-white"
            >
              <Plus size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Touch Scroll Area */}
      <div
        ref={scrollRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="relative flex-1 overflow-x-auto overflow-y-hidden"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div
          className="relative"
          style={{ width: contentWidth, height: TOTAL_H }}
          onClick={(e) => {
            if ((e.target as HTMLElement).tagName === 'BUTTON') return;
            onTouchScrub(e.clientX);
          }}
        >
          {/* Timeline Ruler */}
          <div
            className="absolute inset-x-0 top-0 border-b border-white/[0.06] bg-[#0d0d14]"
            style={{ height: RULER_H }}
            onTouchMove={(e) => onTouchScrub(e.touches[0].clientX)}
          >
            {timeLabels.map((t) => (
              <div
                key={t}
                className="pointer-events-none absolute top-0 border-l border-white/20 pl-1 text-[8.5px] tabular-nums text-zinc-500"
                style={{ left: padX + t * pps }}
              >
                {fmtTime(t, project.fps).slice(3)}
              </div>
            ))}

            {/* Beat Diamond Markers on Ruler */}
            {project.beats.map((b, i) => (
              <div
                key={i}
                className="pointer-events-none absolute bottom-0 h-2 w-2 -translate-x-1/2 rotate-45 bg-[#ff2d55] shadow-sm shadow-[#ff2d55]"
                style={{ left: padX + b * pps, bottom: -3 }}
              />
            ))}
          </div>

          {/* Beat Lines down the tracks */}
          {project.beats.map((b, i) => (
            <div
              key={i}
              className="pointer-events-none absolute w-px bg-[#ff2d55]/15"
              style={{ left: padX + b * pps, top: RULER_H, height: TOTAL_H - RULER_H }}
            />
          ))}

          {/* FX Lane */}
          <div className="absolute inset-x-0" style={{ top: RULER_H + 2, height: FX_H }}>
            {project.fx.map((f) => {
              const def = FX_DEFS[f.type];
              const color = catColor(def?.cat ?? 'zoom');
              const isSel = sel?.kind === 'fx' && sel.id === f.id;
              const w = Math.max(16, f.duration * pps);
              return (
                <div
                  key={f.id}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => onFxPointerDown(e, f)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    st.select({ kind: 'fx', id: f.id });
                    st.ui({ mobileDrawer: 'fxSettings' });
                  }}
                  className={cn(
                    'absolute flex items-center gap-1 overflow-hidden rounded-md px-1.5 text-[9.5px] font-bold text-black shadow-sm active:scale-95 transition-transform touch-none cursor-grab active:cursor-grabbing select-none',
                    isSel ? 'ring-2 ring-white z-10' : 'ring-1 ring-black/40'
                  )}
                  style={{
                    left: padX + f.start * pps,
                    width: w,
                    height: FX_H - 4,
                    background: color,
                  }}
                  title="Tap to select • Double-tap for settings • Drag handles to shorten/lengthen"
                >
                  <span className="shrink-0 pointer-events-none">{def?.icon || '✨'}</span>
                  {w > 45 && <span className="truncate pointer-events-none">{def?.name || f.type}</span>}

                  {/* Left and Right Trim Handles on FX when selected to shorten or lengthen */}
                  {isSel && (
                    <>
                      <div
                        data-trim="true"
                        onPointerDown={(e) => onFxTrimDown(e, f, 'l')}
                        className="absolute inset-y-0 left-0 w-5 z-20 flex items-center justify-center bg-black/40 active:bg-white cursor-ew-resize touch-none rounded-l-md"
                        title="Drag to trim effect start"
                      >
                        <div className="h-3 w-1 rounded-full bg-white shadow-sm" />
                      </div>
                      <div
                        data-trim="true"
                        onPointerDown={(e) => onFxTrimDown(e, f, 'r')}
                        className="absolute inset-y-0 right-0 w-5 z-20 flex items-center justify-center bg-black/40 active:bg-white cursor-ew-resize touch-none rounded-r-md"
                        title="Drag to trim effect duration"
                      >
                        <div className="h-3 w-1 rounded-full bg-white shadow-sm" />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Video Clips Lane */}
          <div className="absolute inset-x-0" style={{ top: RULER_H + FX_H + 4, height: VIDEO_H }}>
            {layout.length === 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  st.ui({ mobileDrawer: 'clips' });
                }}
                className="absolute inset-x-6 top-1/2 -translate-y-1/2 flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#ff2d55]/50 bg-[#ff2d55]/10 py-2.5 text-[11px] font-bold text-white shadow-lg active:scale-95 transition-transform"
              >
                <Plus size={14} className="text-[#ff2d55]" />
                <span>Empty timeline — Tap here to add clips</span>
              </button>
            )}
            {layout.map((l) => {
              const isSel = sel?.kind === 'clip' && sel.id === l.clip.id;
              const isDragging = drag?.id === l.clip.id;
              const dur = l.end - l.start;
              const w = Math.max(16, dur * pps);
              const m = mediaMap.get(l.clip.mediaId);
              const thumb = thumbs.get(m, clipSourceTime(l.clip, dur / 2));
              const grade = COLOR_PRESETS.find((p) => p.id === l.clip.color.preset);

              return (
                <div
                  key={l.clip.id}
                  onPointerDown={(e) => onClipPointerDown(e, l)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    st.select({ kind: 'clip', id: l.clip.id });
                    st.ui({ mobileDrawer: 'clipSettings' });
                  }}
                  className={cn(
                    'absolute overflow-hidden rounded-lg border bg-[#161622] transition-all touch-none select-none cursor-grab active:cursor-grabbing',
                    isDragging
                      ? 'z-30 border-white ring-4 ring-[#ff2d55] shadow-2xl scale-105 opacity-90'
                      : isSel
                      ? 'z-10 border-white ring-2 ring-[#ff2d55] shadow-lg'
                      : 'border-white/10 active:border-white/30'
                  )}
                  style={{
                    left: padX + l.start * pps + (isDragging ? drag.dx : 0),
                    width: w,
                    height: VIDEO_H,
                  }}
                  title="Tap to select • Double-tap for clip settings • Drag to reorder"
                >
                  {/* Thumb background */}
                  {thumb ? (
                    <div
                      className="absolute inset-0 bg-cover bg-center opacity-85"
                      style={{ backgroundImage: `url(${thumb})` }}
                    />
                  ) : (
                    <div className="absolute inset-0 bg-zinc-900" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40" />

                  {/* Title & Badges */}
                  <div className="absolute left-1.5 top-1 truncate text-[9.5px] font-black text-white drop-shadow">
                    {l.index + 1}
                    {w > 60 && m ? ` • ${m.name}` : ''}
                  </div>

                  <div className="absolute bottom-1 left-1.5 flex gap-1">
                    {l.clip.reverse && (
                      <span className="rounded bg-yellow-500/80 px-1 text-[8px] font-black text-black">
                        REV
                      </span>
                    )}
                    {l.clip.twixtor && (
                      <span className="rounded bg-[#22d3ee]/80 px-1 text-[8px] font-black text-black">
                        TWX
                      </span>
                    )}
                    {l.clip.velocity.preset !== 'none' && (
                      <span className="rounded bg-[#4ade80]/80 px-1 text-[8px] font-black text-black">
                        {l.clip.velocity.preset.slice(0, 3).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Color Preset stripe */}
                  {grade && grade.id !== 'none' && (
                    <div
                      className="absolute inset-x-0 bottom-0 h-1"
                      style={{ background: `linear-gradient(90deg, ${grade.swatch.join(',')})` }}
                    />
                  )}

                  {/* Left and Right Trim Handles when clip is selected */}
                  {isSel && !isDragging && (
                    <>
                      <div
                        data-trim="true"
                        onPointerDown={(e) => onTrimDown(e, l, 'l')}
                        className="absolute inset-y-0 left-0 w-6 z-20 flex items-center justify-center bg-white/25 active:bg-[#ff2d55] cursor-ew-resize touch-none"
                        title="Drag to trim start"
                      >
                        <div className="h-5 w-1 rounded-full bg-white shadow-sm" />
                      </div>
                      <div
                        data-trim="true"
                        onPointerDown={(e) => onTrimDown(e, l, 'r')}
                        className="absolute inset-y-0 right-0 w-6 z-20 flex items-center justify-center bg-white/25 active:bg-[#ff2d55] cursor-ew-resize touch-none"
                        title="Drag to trim end"
                      >
                        <div className="h-5 w-1 rounded-full bg-white shadow-sm" />
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* Insertion Indicator line while dragging */}
            {drag && (
              <div
                className="pointer-events-none absolute z-30 w-1 rounded-full bg-white shadow-[0_0_12px_white]"
                style={{
                  left: padX + (drag.insertAt < layout.length ? layout[drag.insertAt].start : total) * pps - 2,
                  top: -2,
                  height: VIDEO_H + 4,
                }}
              />
            )}
          </div>

          {/* Music Waveform Lane */}
          <div className="absolute inset-x-0" style={{ top: RULER_H + FX_H + VIDEO_H + 6, height: MUSIC_H }}>
            {musicClips.map((mc) => {
              const m = mediaMap.get(mc.mediaId);
              if (!m) return null;
              const isSel = sel?.kind === 'music' && (sel.id === mc.id || (!mc.id && sel.id === 'music'));
              const isDragging = drag?.id === mc.id;
              const clipDur = mc.duration ?? Math.max(0.1, m.duration - (mc.srcIn ?? 0));
              const w = Math.max(16, clipDur * pps);

              return (
                <div
                  key={mc.id || mc.mediaId}
                  onPointerDown={(e) => onMusicPointerDown(e, mc)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    st.select({ kind: 'music', id: mc.id || 'music' });
                    st.ui({ mobileDrawer: 'beats' });
                  }}
                  className={cn(
                    'absolute flex items-center overflow-hidden rounded-md border bg-[#190f24] px-2 text-[10px] font-bold text-white touch-none cursor-grab active:cursor-grabbing select-none',
                    isDragging
                      ? 'z-30 border-white ring-4 ring-[#b026ff] shadow-2xl scale-105 opacity-90'
                      : isSel
                      ? 'z-10 border-[#ff2d55] ring-2 ring-[#ff2d55]'
                      : 'border-[#b026ff]/30 active:border-white/40'
                  )}
                  style={{
                    left: padX + mc.start * pps + (isDragging && drag ? drag.dx : 0),
                    width: w,
                    height: MUSIC_H,
                  }}
                  title="Drag to move • Double-tap for beats • Trim handles when selected"
                >
                  <div className="flex items-center gap-1 min-w-0 pointer-events-none">
                    <Music2 size={11} className="shrink-0 text-[#b026ff]" />
                    <span className="truncate">{m.name}</span>
                    {mc.srcIn && mc.srcIn > 0.05 ? (
                      <span className="rounded bg-black/60 px-1 text-[8px] text-zinc-400">+{mc.srcIn.toFixed(1)}s</span>
                    ) : null}
                  </div>

                  {/* Left and Right Trim Handles on Music when selected */}
                  {isSel && !isDragging && (
                    <>
                      <div
                        data-trim="true"
                        onPointerDown={(e) => onMusicTrimDown(e, mc, 'l')}
                        className="absolute inset-y-0 left-0 w-6 z-20 flex items-center justify-center bg-white/25 active:bg-[#ff2d55] cursor-ew-resize touch-none"
                        title="Drag to cut/trim start of music"
                      >
                        <div className="h-4 w-1 rounded-full bg-white shadow-sm" />
                      </div>
                      <div
                        data-trim="true"
                        onPointerDown={(e) => onMusicTrimDown(e, mc, 'r')}
                        className="absolute inset-y-0 right-0 w-6 z-20 flex items-center justify-center bg-white/25 active:bg-[#ff2d55] cursor-ew-resize touch-none"
                        title="Drag to cut/trim end of music"
                      >
                        <div className="h-4 w-1 rounded-full bg-white shadow-sm" />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Isolated Playhead: renders smoothly at 60Hz without re-rendering the whole timeline */}
          <MobilePlayhead padX={padX} pps={pps} totalH={TOTAL_H} scrollRef={scrollRef} />
        </div>
      </div>
    </div>
  );
}

function MobilePlayhead({
  padX,
  pps,
  totalH,
  scrollRef,
}: {
  padX: number;
  pps: number;
  totalH: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const targetLeft = padX + time * pps - el.clientWidth / 2;
    el.scrollLeft = targetLeft;
  }, [time, playing, padX, pps, scrollRef]);

  return (
    <div
      className="pointer-events-none absolute top-0 z-20 -translate-x-1/2"
      style={{ left: padX + time * pps, height: totalH }}
    >
      <div className="h-3 w-3 bg-[#ff2d55] shadow-lg shadow-[#ff2d55] [clip-path:polygon(0_0,100%_0,100%_50%,50%_100%,0_50%)]" />
      <div className="h-full w-0.5 bg-[#ff2d55] shadow-[0_0_8px_#ff2d55]" />
    </div>
  );
}
