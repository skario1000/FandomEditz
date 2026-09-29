import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Copy, Diamond, Magnet, Minus, Music2, Plus, Scissors, Trash2 } from 'lucide-react';
import { LANES, useEditor } from '../store';
import type { FxItem, MediaItem, MusicTrack } from '../types';
import { clipSourceTime, layoutClips, totalDuration, type ClipLayout } from '../lib/velocity';
import { FX_DEFS, LIB_BY_ID, catColor } from '../lib/effects';
import { sortKeys } from '../lib/keyframes';
import { COLOR_PRESETS } from '../lib/colorPresets';
import { thumbs } from '../lib/media';
import { audio } from '../lib/audio';
import { getMusicClips, syncMusicProject } from '../lib/music';
import { clamp, fmtSec, fmtTime } from '../lib/utils';
import { Btn } from './ui';
import { cn } from '../utils/cn';

const HEADER_W = 84;
const RULER_H = 24;
const LANE_H = 22;
const FX_TOP = RULER_H + 4;
const VIDEO_TOP = FX_TOP + LANE_H * LANES + 6;
const VIDEO_H = 58;
const MUSIC_TOP = VIDEO_TOP + VIDEO_H + 6;
const MUSIC_H = 44;
const CONTENT_H = MUSIC_TOP + MUSIC_H + 8;

function startDrag(e: React.PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onUp?: (moved: boolean, ev: PointerEvent) => void) {
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  const mv = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (!moved && Math.hypot(dx, dy) > 3) moved = true;
    if (moved) onMove(dx, dy, ev);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    onUp?.(moved, ev);
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

type DragVis = { id: string; dx: number; insertAt: number } | null;

function TrackRow({ top, height, label, icon }: { top: number; height: number; label: string; icon?: React.ReactNode }) {
  return (
    <div className="absolute left-0 right-0" style={{ top, height }}>
      <div className="absolute inset-y-0 right-0 border-y border-white/[0.03] bg-white/[0.015]" style={{ left: HEADER_W }} onPointerDown={() => useEditor.getState().select(null)} />
      <div className="sticky left-0 z-20 flex h-full items-center gap-1.5 border-r border-white/[0.06] bg-[#0d0d12] px-2.5 text-[9.5px] font-bold tracking-[0.16em] text-zinc-500" style={{ width: HEADER_W }}>
        {icon}
        {label}
      </div>
    </div>
  );
}

function WaveTile({
  id,
  pps,
  x0,
  w,
  h,
  sampleOffset = 0,
}: {
  id: string;
  pps: number;
  x0: number;
  w: number;
  h: number;
  /** Pixel offset into the source audio where sampling starts (for trimmed segments). */
  sampleOffset?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const peaks = audio.peaks.get(id);
    if (!c || !peaks) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ff2d55');
    g.addColorStop(1, '#b026ff');
    ctx.fillStyle = g;
    const mid = h / 2 + 5;
    for (let x = 0; x < w; x += 2) {
      const a = Math.floor(((sampleOffset + x) / pps) * 100);
      const b = Math.max(a + 1, Math.floor(((sampleOffset + x + 2) / pps) * 100));
      let m = 0;
      for (let i = a; i < b && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const bh = Math.max(0.5, m * (h - 16) * 0.5);
      ctx.fillRect(x, mid - bh, 1.4, bh * 2);
    }
  }, [id, pps, x0, w, h, sampleOffset]);
  return <canvas ref={ref} className="pointer-events-none absolute top-0 opacity-80" style={{ left: x0, width: w, height: h }} />;
}

function Playhead({ pps, scrollRef }: { pps: number; scrollRef: RefObject<HTMLDivElement | null> }) {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const x = HEADER_W + time * pps;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + HEADER_W) el.scrollLeft = x - HEADER_W - 60;
  }, [x, playing, scrollRef]);
  return (
    <div className="pointer-events-none absolute top-0 z-[15]" style={{ left: x, height: CONTENT_H }}>
      <div className="absolute -left-[6px] top-0 h-[13px] w-[13px] bg-[#ff2d55] [clip-path:polygon(0_0,100%_0,100%_55%,50%_100%,0_55%)]" />
      <div className="h-full w-px bg-[#ff2d55] shadow-[0_0_6px_#ff2d55]" />
    </div>
  );
}

const velLabel: Record<string, string> = { classic: 'VEL', impact: 'IMP', rampUp: 'RMP↑', rampDown: 'RMP↓', double: 'DBL', microwave: 'MW', boomerang: 'BMR' };

export function Timeline() {
  const project = useEditor((s) => s.project);
  const media = useEditor((s) => s.media);
  const pps = useEditor((s) => s.pxPerSec);
  const sel = useEditor((s) => s.selection);
  const snap = useEditor((s) => s.snap);
  useEditor((s) => s.thumbVersion);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDragState] = useState<DragVis>(null);
  const dragRef = useRef<DragVis>(null);
  const setDrag = (d: DragVis) => {
    dragRef.current = d;
    setDragState(d);
  };
  const mediaMap = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const layout = layoutClips(project.clips);
  const total = totalDuration(project.clips);
  const musicClips = useMemo(() => getMusicClips(project, mediaMap), [project, mediaMap]);
  const musicEnd = musicClips.reduce((max, mc) => Math.max(max, mc.start + (mc.duration ?? 60)), 0);
  const fxEnd = project.fx.reduce((m, f) => Math.max(m, f.start + f.duration), 0);
  const contentDur = Math.max(total, musicEnd, fxEnd, 10) + 6;
  const width = HEADER_W + contentDur * pps;
  const st = useEditor.getState();

  const xToTime = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return (clientX - r.left + el.scrollLeft - HEADER_W) / pps;
  };
  const yInContent = (clientY: number) => {
    const el = scrollRef.current!;
    return clientY - el.getBoundingClientRect().top + el.scrollTop;
  };
  const snapPts = (excludeFx?: string) => {
    const s = useEditor.getState();
    return [0, ...layoutClips(s.project.clips).map((l) => l.end), ...s.project.fx.filter((f) => f.id !== excludeFx).flatMap((f) => [f.start, f.start + f.duration]), ...s.project.beats, s.time];
  };
  const doSnap = (t: number, pts: number[]) => {
    if (!useEditor.getState().snap) return t;
    const th = 8 / pps;
    let best = t;
    let bd = th;
    for (const p of pts) {
      const d = Math.abs(p - t);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };

  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const s = useEditor.getState();
        const old = s.pxPerSec;
        const next = clamp(old * Math.exp(-e.deltaY * 0.0015), 12, 600);
        const x = e.clientX - el.getBoundingClientRect().left - HEADER_W;
        const tAt = (x + el.scrollLeft) / old;
        s.ui({ pxPerSec: next });
        requestAnimationFrame(() => {
          el.scrollLeft = tAt * next - x;
        });
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ------------------------------ handlers ------------------------------ */
  const onRulerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    st.pause();
    const setT = (cx: number, shift: boolean) => {
      let t = Math.max(0, xToTime(cx));
      if (shift || useEditor.getState().snap) t = doSnap(t, useEditor.getState().project.beats);
      st.setTime(t);
    };
    setT(e.clientX, e.shiftKey);
    startDrag(e, (_dx, _dy, ev) => setT(ev.clientX, ev.shiftKey));
  };

  const onClipDown = (e: React.PointerEvent, l: ClipLayout) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    st.select({ kind: 'clip', id: l.clip.id });
    const L = layout;
    startDrag(
      e,
      (dx, _dy, ev) => {
        const t = xToTime(ev.clientX);
        let idx = L.length;
        for (let i = 0; i < L.length; i++) {
          if (t < (L[i].start + L[i].end) / 2) {
            idx = i;
            break;
          }
        }
        setDrag({ id: l.clip.id, dx, insertAt: idx });
      },
      (moved) => {
        const d = dragRef.current;
        setDrag(null);
        if (moved && d) st.moveClip(l.index, d.insertAt);
      }
    );
  };

  const onTrimDown = (e: React.PointerEvent, l: ClipLayout, side: 'l' | 'r') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const c0 = l.clip;
    st.select({ kind: 'clip', id: c0.id });
    st.beginTxn();
    const maxD = mediaMap.get(c0.mediaId)?.duration ?? c0.srcOut;
    const startT = l.start;
    const pts = snapPts();
    const edgeRight = side === 'r';
    const movesOut = edgeRight !== c0.reverse;
    startDrag(
      e,
      (dx) => {
        const dt = dx / pps;
        if (movesOut) {
          let out = clamp(c0.srcOut + (edgeRight ? 1 : -1) * dt * c0.speed, c0.srcIn + 0.05, maxD);
          if (edgeRight) {
            const endT = doSnap(startT + (out - c0.srcIn) / c0.speed, pts);
            out = clamp(c0.srcIn + (endT - startT) * c0.speed, c0.srcIn + 0.05, maxD);
          }
          st.updateClip(c0.id, { srcOut: out }, true);
        } else {
          let inn = clamp(c0.srcIn + (edgeRight ? -1 : 1) * dt * c0.speed, 0, c0.srcOut - 0.05);
          if (edgeRight) {
            const endT = doSnap(startT + (c0.srcOut - inn) / c0.speed, pts);
            inn = clamp(c0.srcOut - (endT - startT) * c0.speed, 0, c0.srcOut - 0.05);
          }
          st.updateClip(c0.id, { srcIn: inn }, true);
        }
      },
      () => st.endTxn()
    );
  };

  const onKeyDrag = (e: React.PointerEvent, l: ClipLayout, keyId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const clip = l.clip;
    if (!clip.keyframes) return;
    st.select({ kind: 'clip', id: clip.id });
    st.beginTxn();
    const dur = l.end - l.start;
    const startKeys = clip.keyframes.map((tr) => ({ ...tr, keyframes: tr.keyframes.map((k) => ({ ...k })) }));
    const home = startKeys.find((tr) => tr.keyframes.some((k) => k.id === keyId))?.keyframes.find((k) => k.id === keyId);
    if (!home) return st.endTxn();
    const t0 = home.t;
    const others = startKeys.flatMap((tr) => tr.keyframes.filter((k) => k.id !== keyId).map((k) => k.t));
    startDrag(e, (dx) => {
      const u0 = t0 + dx / (dur * pps);
      const u = clamp(doSnap(u0, others.concat([0, 1])), 0, 1);
      st.updateClip(
        clip.id,
        {
          keyframes: startKeys.map((tr) => ({
            ...tr,
            keyframes: sortKeys(tr.keyframes.map((k) => (k.id === keyId ? { ...k, t: u } : k))),
          })),
        },
        true
      );
    }, () => st.endTxn());
  };

  const onFxDown = (e: React.PointerEvent, f: FxItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    st.select({ kind: 'fx', id: f.id });
    st.beginTxn();
    const pts = snapPts(f.id);
    startDrag(
      e,
      (dx, _dy, ev) => {
        let start = Math.max(0, f.start + dx / pps);
        const s1 = doSnap(start, pts);
        if (s1 !== start) start = s1;
        else {
          const e1 = doSnap(start + f.duration, pts);
          if (e1 !== start + f.duration) start = e1 - f.duration;
        }
        const lane = clamp(Math.floor((yInContent(ev.clientY) - FX_TOP) / LANE_H), 0, LANES - 1);
        st.updateFx(f.id, { start: Math.max(0, start), lane }, true);
      },
      () => st.endTxn()
    );
  };

  const onFxEdge = (e: React.PointerEvent, f: FxItem, side: 'l' | 'r') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    st.select({ kind: 'fx', id: f.id });
    st.beginTxn();
    const pts = snapPts(f.id);
    const end = f.start + f.duration;
    startDrag(
      e,
      (dx) => {
        if (side === 'l') {
          const ns = clamp(doSnap(f.start + dx / pps, pts), 0, end - 0.05);
          st.updateFx(f.id, { start: ns, duration: end - ns }, true);
        } else {
          const ne = Math.max(f.start + 0.05, doSnap(end + dx / pps, pts));
          st.updateFx(f.id, { duration: ne - f.start }, true);
        }
      },
      () => st.endTxn()
    );
  };

  const onMusicDown = (e: React.PointerEvent, m0: MusicTrack) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-mtrim]')) return;
    e.stopPropagation();
    st.select({ kind: 'music', id: m0.id || 'music' });
    st.beginTxn();
    const b0 = project.beats;
    const pts = [0, ...layout.map((l) => l.end), ...project.beats, useEditor.getState().time];
    startDrag(
      e,
      (dx) => {
        const ns = Math.max(0, doSnap(m0.start + dx / pps, pts));
        const delta = ns - m0.start;
        const updated = { ...m0, start: ns };
        const nextList = musicClips.map((item) => (item.id === m0.id ? updated : item));
        st.live((p) => ({
          ...syncMusicProject(p, nextList),
          beats: b0.map((b) => b + delta),
        }));
      },
      () => st.endTxn()
    );
  };

  const onMusicEdge = (e: React.PointerEvent, m0: MusicTrack, side: 'l' | 'r') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    st.select({ kind: 'music', id: m0.id || 'music' });
    st.beginTxn();
    const m = mediaMap.get(m0.mediaId);
    const maxSrc = m?.duration ?? 300;
    const srcIn0 = m0.srcIn ?? 0;
    const dur0 = m0.duration ?? Math.max(0.1, maxSrc - srcIn0);
    const start0 = m0.start;
    const end0 = start0 + dur0;
    const edgeRight = side === 'r';
    const pts = [0, ...layout.map((l) => l.end), ...project.beats, useEditor.getState().time];
    startDrag(
      e,
      (dx) => {
        const dt = dx / pps;
        let next: MusicTrack;
        if (edgeRight) {
          let newEnd = end0 + dt;
          newEnd = doSnap(newEnd, pts);
          let newDur = Math.max(0.1, newEnd - start0);
          if (srcIn0 + newDur > maxSrc) newDur = maxSrc - srcIn0;
          next = { ...m0, duration: newDur };
        } else {
          let newStart = doSnap(start0 + dt, pts);
          let newSrcIn = srcIn0 + (newStart - start0);
          let newDur = dur0 - (newStart - start0);
          if (newSrcIn < 0) {
            newStart -= newSrcIn;
            newDur += newSrcIn;
            newSrcIn = 0;
          }
          if (newDur < 0.1) {
            newDur = 0.1;
            newStart = end0 - 0.1;
            newSrcIn = Math.max(0, srcIn0 - (dur0 - 0.1));
          }
          next = { ...m0, start: newStart, srcIn: newSrcIn, duration: newDur };
        }
        const nextList = musicClips.map((item) => (item.id === m0.id ? next : item));
        st.live((p) => syncMusicProject(p, nextList));
      },
      () => st.endTxn()
    );
  };

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-ev')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/x-ev');
    if (!raw) return;
    e.preventDefault();
    let d: { kind: string; id: string };
    try {
      d = JSON.parse(raw);
    } catch {
      return;
    }
    const t = Math.max(0, xToTime(e.clientX));
    const y = yInContent(e.clientY);
    if (d.kind === 'fx') {
      const entry = LIB_BY_ID[d.id];
      if (!entry) return;
      const def = FX_DEFS[entry.type];
      const dur = entry.dur ?? def.dur;
      let start = doSnap(t, snapPts());
      if (def.transition) start = Math.max(0, start - dur / 2);
      const lane = y >= FX_TOP && y < FX_TOP + LANES * LANE_H ? Math.floor((y - FX_TOP) / LANE_H) : undefined;
      st.addLib(d.id, start, lane);
    } else if (d.kind === 'combo') st.addCombo(d.id, doSnap(t, snapPts()));
    else if (d.kind === 'media') {
      const m = mediaMap.get(d.id);
      if (!m || m.status !== 'ready') return;
      if (m.kind === 'audio') st.setMusic(m.id);
      else st.addClip(m.id, 0, Math.min(m.duration, 3), st.insertIndexAtTime(t));
    }
  };

  /* ------------------------------- ruler -------------------------------- */
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  const major = steps.find((s) => s * pps >= 64) ?? 60;
  const labels: number[] = [];
  for (let t = 0; t <= contentDur; t += major) labels.push(t);
  const minorPx = (major / 4) * pps;

  return (
    <div className="flex h-full flex-col bg-[#0a0a0e]">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/[0.06] px-2">
        <Btn
          title={sel?.kind === 'music' ? 'Split selected music segment at playhead (S)' : 'Split selected clip, effect or music at playhead (S)'}
          onClick={st.splitAtPlayhead}
          variant={sel?.kind === 'music' ? 'soft' : 'ghost'}
          className={sel?.kind === 'music' ? 'border-[#b026ff]/40 text-[#d4a4ff]' : undefined}
        >
          <Scissors size={14} /> {sel?.kind === 'music' ? 'Split music' : 'Split'}
        </Btn>
        <Btn title="Duplicate (Ctrl+D)" onClick={st.duplicateSelected} disabled={!sel || sel.kind === 'music'}>
          <Copy size={14} />
        </Btn>
        <Btn title="Delete (Del)" onClick={st.removeSelected} disabled={!sel}>
          <Trash2 size={14} />
        </Btn>
        <div className="mx-1 h-5 w-px bg-white/10" />
        <Btn title="Snap to beats, cuts & playhead" onClick={() => st.ui({ snap: !snap })} className={snap ? 'text-[#ff2d55]' : 'text-zinc-500'}>
          <Magnet size={14} /> Snap
        </Btn>
        <Btn title="Add beat marker at playhead (B)" onClick={() => st.addBeat(useEditor.getState().time)}>
          <Diamond size={13} /> Beat
        </Btn>
        <div className="flex-1" />
        <span className="hidden text-[10.5px] text-zinc-500 md:inline">
          {project.clips.length} clips · {project.fx.length} fx · {musicClips.length} music · {project.beats.length} beats
        </span>
        <div className="mx-1 h-5 w-px bg-white/10" />
        <Btn title="Zoom out" onClick={() => st.ui({ pxPerSec: clamp(pps / 1.4, 12, 600) })}>
          <Minus size={14} />
        </Btn>
        <input type="range" className="ev-range w-24" min={Math.log(12)} max={Math.log(600)} step={0.01} value={Math.log(pps)} onChange={(e) => st.ui({ pxPerSec: Math.exp(parseFloat(e.target.value)) })} onPointerUp={(e) => e.currentTarget.blur()} />
        <Btn title="Zoom in" onClick={() => st.ui({ pxPerSec: clamp(pps * 1.4, 12, 600) })}>
          <Plus size={14} />
        </Btn>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width, height: CONTENT_H }} onDragOver={onDragOver} onDrop={onDrop}>
          {/* ruler */}
          <div className="absolute left-0 right-0 top-0" style={{ height: RULER_H }}>
            <div
              className="absolute inset-y-0 right-0 cursor-pointer border-b border-white/[0.06] bg-[#0d0d12]"
              style={{
                left: HEADER_W,
                backgroundImage: `repeating-linear-gradient(to right, rgba(255,255,255,0.13) 0 1px, transparent 1px ${minorPx}px)`,
                backgroundSize: `100% 6px`,
                backgroundRepeat: 'repeat-x',
                backgroundPosition: 'left bottom',
              }}
              onPointerDown={onRulerDown}
              onDoubleClick={(e) => st.removeBeatNear(xToTime(e.clientX), 7 / pps)}
            >
              {labels.map((t) => (
                <div key={t} className="pointer-events-none absolute top-0 h-full border-l border-white/20 pl-1 text-[9px] tabular-nums text-zinc-500" style={{ left: t * pps }}>
                  {fmtTime(t, project.fps).slice(0, major < 1 ? 8 : 5)}
                </div>
              ))}
              {project.beats.map((b, i) => (
                <div key={i} className="pointer-events-none absolute bottom-0 h-2 w-2 -translate-x-1/2 rotate-45 bg-[#ff2d55]" style={{ left: b * pps, bottom: -4 }} />
              ))}
            </div>
            <div className="sticky left-0 z-20 flex h-full items-center border-b border-r border-white/[0.06] bg-[#0d0d12] px-2 text-[9px] font-bold tracking-[0.16em] text-zinc-600" style={{ width: HEADER_W }}>
              TIME
            </div>
          </div>

          <TrackRow top={FX_TOP} height={LANE_H * LANES} label="FX" icon={<span className="text-[11px]">✨</span>} />
          <TrackRow top={VIDEO_TOP} height={VIDEO_H} label="VIDEO" icon={<span className="text-[11px]">🎞️</span>} />
          <TrackRow top={MUSIC_TOP} height={MUSIC_H} label="MUSIC" icon={<Music2 size={11} />} />
          {[1, 2].map((l) => (
            <div key={l} className="pointer-events-none absolute right-0 h-px bg-white/[0.04]" style={{ left: HEADER_W, top: FX_TOP + l * LANE_H }} />
          ))}

          {/* beat lines */}
          {project.beats.map((b, i) => (
            <div key={i} className="pointer-events-none absolute w-px bg-[#ff2d55]/20" style={{ left: HEADER_W + b * pps, top: RULER_H, height: CONTENT_H - RULER_H }} />
          ))}

          {/* fx */}
          {project.fx.map((f) => {
            const def = FX_DEFS[f.type];
            const color = catColor(def?.cat ?? 'zoom');
            const selected = sel?.kind === 'fx' && sel.id === f.id;
            const w = Math.max(6, f.duration * pps);
            return (
              <div
                key={f.id}
                onPointerDown={(e) => onFxDown(e, f)}
                title={`${def?.name ?? f.type} · ${f.duration.toFixed(2)}s`}
                className={cn('absolute z-10 flex cursor-grab items-center gap-1 overflow-hidden rounded-[5px] px-1.5 text-[10px] font-bold text-black/80 active:cursor-grabbing', selected ? 'ring-2 ring-white' : 'ring-1 ring-black/40')}
                style={{ left: HEADER_W + f.start * pps, width: w, top: FX_TOP + f.lane * LANE_H + 1, height: LANE_H - 2, background: `linear-gradient(180deg, ${color}, ${color}bb)` }}
              >
                <span className="shrink-0">{def?.icon}</span>
                {w > 40 && <span className="truncate">{f.type === 'text' ? `“${String(f.params.text)}”` : def?.name}</span>}
                {def?.transition && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-black/40" />}
                <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-black/20" onPointerDown={(e) => onFxEdge(e, f, 'l')} />
                <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-black/20" onPointerDown={(e) => onFxEdge(e, f, 'r')} />
              </div>
            );
          })}

          {/* clips */}
          {layout.map((l) => (
            <ClipBlock
              key={l.clip.id}
              l={l}
              media={mediaMap.get(l.clip.mediaId)}
              pps={pps}
              selected={sel?.kind === 'clip' && sel.id === l.clip.id}
              dx={drag?.id === l.clip.id ? drag.dx : 0}
              dragging={drag?.id === l.clip.id}
              onDown={(e) => onClipDown(e, l)}
              onTrim={(e, side) => onTrimDown(e, l, side)}
              onKeyDrag={(keyId, e) => onKeyDrag(e, l, keyId)}
            />
          ))}
          {drag && (
            <div
              className="pointer-events-none absolute z-30 w-[3px] rounded bg-white shadow-[0_0_10px_white]"
              style={{ left: HEADER_W + (drag.insertAt < layout.length ? layout[drag.insertAt].start : total) * pps - 1, top: VIDEO_TOP - 4, height: VIDEO_H + 8 }}
            />
          )}
          {!layout.length && (
            <div className="pointer-events-none absolute flex items-center text-[11px] text-zinc-600" style={{ left: HEADER_W + 12, top: VIDEO_TOP, height: VIDEO_H }}>
              Drag clips here from the Media tab, or open one and press “Add to timeline”.
            </div>
          )}

          {/* music — supports multiple cut segments */}
          {musicClips.map((mc) => {
            const m = mediaMap.get(mc.mediaId);
            if (!m) return null;
            const isSel = sel?.kind === 'music' && (sel.id === mc.id || (!mc.id && sel.id === 'music'));
            const clipDur = mc.duration ?? Math.max(0.1, m.duration - (mc.srcIn ?? 0));
            const w = Math.max(6, clipDur * pps);
            const tiles = Array.from({ length: Math.ceil(w / 2000) + 1 }, (_, i) => i);
            return (
              <div
                key={mc.id || mc.mediaId}
                onPointerDown={(e) => onMusicDown(e, mc)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  st.setTime(mc.start + 0.01);
                }}
                className={cn('absolute z-10 cursor-grab overflow-hidden rounded-md border bg-[#1a0f24] active:cursor-grabbing', isSel ? 'border-white ring-2 ring-[#ff2d55]' : 'border-[#b026ff]/30')}
                style={{ left: HEADER_W + mc.start * pps, width: w, top: MUSIC_TOP, height: MUSIC_H }}
                title="Drag to move · drag edges to trim · S splits at playhead"
              >
                {tiles.map((i) => (
                  <WaveTile
                    key={i}
                    id={m.id}
                    pps={pps}
                    x0={i * 2000}
                    w={Math.min(2000, w - i * 2000)}
                    h={MUSIC_H}
                    sampleOffset={(mc.srcIn ?? 0) * pps + i * 2000}
                  />
                ))}
                <div className="sticky left-0 inline-flex max-w-full items-center gap-1 px-2 pt-1 text-[10px] font-semibold text-white/90">
                  <Music2 size={10} className="shrink-0" />
                  <span className="truncate">{m.name}</span>
                  <span className="rounded bg-black/50 px-1 text-[8px] font-mono text-violet-200">{fmtSec(clipDur)}</span>
                  {(mc.srcIn ?? 0) > 0.05 && <span className="shrink-0 rounded bg-black/60 px-1 text-[8px] text-zinc-400">+{fmtTime(mc.srcIn ?? 0, project.fps).slice(3)}</span>}
                </div>

                {isSel && (
                  <>
                    <div
                      data-mtrim="true"
                      onPointerDown={(e) => onMusicEdge(e, mc, 'l')}
                      className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40"
                      title="Drag to trim music in-point"
                    />
                    <div
                      data-mtrim="true"
                      onPointerDown={(e) => onMusicEdge(e, mc, 'r')}
                      className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40"
                      title="Drag to trim music out-point"
                    />
                  </>
                )}
              </div>
            );
          })}
          {!musicClips.length && (
            <div className="pointer-events-none absolute flex items-center text-[11px] text-zinc-600" style={{ left: HEADER_W + 12, top: MUSIC_TOP, height: MUSIC_H }}>
              Import a song — it becomes the music track automatically.
            </div>
          )}

          <Playhead pps={pps} scrollRef={scrollRef} />
        </div>
      </div>
    </div>
  );
}

function ClipBlock({
  l,
  media,
  pps,
  selected,
  dx,
  dragging,
  onDown,
  onTrim,
  onKeyDrag,
}: {
  l: ClipLayout;
  media: MediaItem | undefined;
  pps: number;
  selected: boolean;
  dx: number;
  dragging: boolean;
  onDown: (e: React.PointerEvent) => void;
  onTrim: (e: React.PointerEvent, side: 'l' | 'r') => void;
  onKeyDrag: (id: string, e: React.PointerEvent) => void;
}) {
  const c = l.clip;
  const dur = l.end - l.start;
  const w = Math.max(4, dur * pps);
  const n = clamp(Math.floor(w / 56), 1, 40);
  const imgs = Array.from({ length: n }, (_, i) => thumbs.get(media, clipSourceTime(c, ((i + 0.5) / n) * dur)));
  const grade = COLOR_PRESETS.find((p) => p.id === c.color.preset);
  const badges: [string, string][] = [];
  if (Math.abs(c.speed - 1) > 0.001) badges.push([`${+c.speed.toFixed(2)}×`, '#ffffff']);
  if (c.reverse) badges.push(['REV', '#facc15']);
  if (c.twixtor) badges.push(['TWX', '#22d3ee']);
  if (c.velocity.preset !== 'none') badges.push([velLabel[c.velocity.preset] ?? 'VEL', '#4ade80']);
  return (
    <div
      onPointerDown={onDown}
      className={cn(
        'absolute cursor-grab overflow-hidden rounded-md border active:cursor-grabbing',
        selected ? 'z-[12] border-white ring-2 ring-[#ff2d55]' : 'z-10 border-black/50',
        dragging && 'z-30 opacity-80 shadow-2xl shadow-black'
      )}
      style={{ left: HEADER_W + l.start * pps + dx, width: w, top: VIDEO_TOP, height: VIDEO_H }}
      title={`${media?.name ?? ''} · ${dur.toFixed(2)}s`}
    >
      <div className="absolute inset-0 flex bg-[#1a1a24]">
        {imgs.map((src, i) => (
          <div key={i} className="h-full flex-1 bg-cover bg-center" style={{ backgroundImage: src ? `url(${src})` : undefined }} />
        ))}
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/65" />
      {w > 30 && (
        <div className="absolute left-1.5 right-1.5 top-0.5 truncate text-[10px] font-semibold text-white drop-shadow">
          {l.index + 1}
          {w > 70 ? ` · ${media?.name ?? 'missing'}` : ''}
        </div>
      )}
      {w > 24 && (
        <div className="absolute bottom-1 left-1.5 flex gap-0.5">
          {badges.map(([t, col]) => (
            <span key={t} className="rounded-sm bg-black/70 px-1 text-[8.5px] font-black leading-[13px]" style={{ color: col }}>
              {t}
            </span>
          ))}
        </div>
      )}
      {grade && grade.id !== 'none' && <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${grade.swatch.join(',')})` }} />}
      {/* keyframes, draggable straight on the clip */}
      {c.keyframes?.length
        ? c.keyframes.flatMap((tr) =>
            tr.keyframes.map((k) => (
              <button
                key={tr.property + k.id}
                type="button"
                title={`${tr.property} keyframe @ ${(k.t * dur).toFixed(2)}s — drag sideways to retime`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onKeyDrag(k.id, e);
                }}
                className="absolute z-[3] h-2 w-2 rotate-45 cursor-ew-resize border border-black/70 bg-[#4ade80] hover:bg-white"
                style={{ left: Math.max(1, k.t * dur * pps - 3), top: VIDEO_H - 11 }}
              />
            ))
          )
        : null}
      <div className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40" onPointerDown={(e) => onTrim(e, 'l')} />
      <div className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40" onPointerDown={(e) => onTrim(e, 'r')} />
    </div>
  );
}
