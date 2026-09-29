import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, RotateCw } from 'lucide-react';
import { useEditor } from '../store';
import { clipAtTime, clipDuration, layoutClips } from '../lib/velocity';
import {
  angleTo,
  clampRot,
  clampScale,
  dist,
  layerView,
  mid,
  posFromCenter,
  snapAngle,
  snapCentre,
  snapScale,
  transformChanges,
  type TProp,
} from '../lib/transform';
import { clamp } from '../lib/utils';
import { cn } from '../utils/cn';

type Mode = 'pan' | 'scale' | 'rotate' | 'pinch';

interface Drag {
  mode: Mode;
  clipId: string;
  u: number;
  startScale: number;
  startRot: number;
  startCenter: [number, number];
  /** pointer position when the drag began (scale/rotate/pan) */
  grab: [number, number];
  /** the fixed corner a scale drag pivots around */
  anchor: [number, number];
  startDist: number;
  startAngle: number;
  startMid: [number, number];
}

const DEFAULT_TRANSFORM: Record<TProp, number> = { scale: 1, posX: 0, posY: 0, rotation: 0 };

/**
 * Direct on-canvas transform for the clip under the playhead: drag to pan,
 * pull a corner to zoom, twist the ring to rotate, wheel to zoom, and pinch
 * with two fingers on touch. Writes through the same path as the inspector
 * sliders, so a keyframed property gets a key instead of a dead value.
 */
export function TransformGizmo({ boxW, boxH, touch = false, enabled = true }: { boxW: number; boxH: number; touch?: boolean; enabled?: boolean }) {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const media = useEditor((s) => s.media);
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const viewer = useEditor((s) => s.viewer);
  const exporting = useEditor((s) => s.exporting);

  const layout = useMemo(() => layoutClips(project.clips), [project.clips]);
  const target = useMemo(() => {
    if (selection?.kind === 'clip') {
      const hit = layout.find((l) => l.clip.id === selection.id);
      if (hit) return hit;
    }
    return clipAtTime(layout, time);
  }, [selection, layout, time]);

  const m = target ? media.find((x) => x.id === target.clip.mediaId) : undefined;
  const sw = m?.width || 1280;
  const sh = m?.height || 720;
  const dur = target ? clipDuration(target.clip) : 1;
  const u = target ? clamp((time - target.start) / Math.max(0.001, dur), 0, 1) : 0;
  const view = useMemo(
    () => (target && !playing ? layerView(target.clip, sw, sh, boxW, boxH, u) : null),
    [target?.clip, sw, sh, boxW, boxH, u, playing]
  );

  const visible = enabled && !exporting && !playing && viewer === 'program' && !!view && project.clips.length > 0;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, [number, number]>());
  const ref = useRef<HTMLDivElement>(null);

  const local = useCallback((e: { clientX: number; clientY: number }): [number, number] => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return [0, 0];
    return [e.clientX - r.left, e.clientY - r.top];
  }, []);

  const beginDrag = useCallback(
    (mode: Mode, grab: [number, number], extra?: Partial<Drag>) => {
      if (!view || !target) return;
      const st = useEditor.getState();
      const d: Drag = {
        mode,
        clipId: target.clip.id,
        u,
        startScale: view.geom.scale,
        startRot: view.geom.rotation,
        startCenter: view.center,
        grab,
        anchor: view.center,
        startDist: 1,
        startAngle: 0,
        startMid: grab,
        ...extra,
      };
      dragRef.current = d;
      setDrag(d);
      st.beginTxn();
      st.pause();
      if (st.selection?.kind !== 'clip' || st.selection.id !== d.clipId) st.select({ kind: 'clip', id: d.clipId });
    },
    [view, target, u]
  );

  /** Turn a live gesture into clip values, always relative to where it started. */
  const applyDrag = useCallback(
    (d: Drag, p: [number, number], free: boolean, pair?: [[number, number], [number, number]]) => {
      const st = useEditor.getState();
      const clip = st.project.clips.find((c) => c.id === d.clipId);
      if (!clip || !view) return;
      const g = view.geom;
      const frameMid: [number, number] = [boxW / 2, boxH / 2];
      const changes: Partial<Record<TProp, number>> = {};
      let centre = d.startCenter;

      if (d.mode === 'scale') {
        const k = clamp(dist(p, d.anchor) / Math.max(6, dist(d.grab, d.anchor)), 0.05, 20);
        changes.scale = snapScale(clampScale(d.startScale * k), free);
        centre = snapCentre([d.anchor[0] + (d.startCenter[0] - d.anchor[0]) * k, d.anchor[1] + (d.startCenter[1] - d.anchor[1]) * k], frameMid, free);
      } else if (d.mode === 'rotate') {
        changes.rotation = clampRot(snapAngle(d.startRot + angleTo(d.startCenter, d.grab, p), free));
      } else if (d.mode === 'pinch' && pair) {
        const [a, b] = pair;
        const k = clamp(dist(a, b) / Math.max(6, d.startDist), 0.05, 20);
        const twist = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI - d.startAngle;
        changes.scale = snapScale(clampScale(d.startScale * k), free);
        changes.rotation = clampRot(snapAngle(d.startRot + twist, free));
        const m = mid(a, b);
        centre = snapCentre([d.startCenter[0] + (m[0] - d.startMid[0]), d.startCenter[1] + (m[1] - d.startMid[1])], frameMid, free);
      } else {
        centre = snapCentre([d.startCenter[0] + (p[0] - d.grab[0]), d.startCenter[1] + (p[1] - d.grab[1])], frameMid, free);
      }

      if (d.mode !== 'rotate') {
        // CSS px → output px, so the drag matches what the finger sees
        const cx = centre[0] * (view.W / boxW);
        const cy = centre[1] * (view.H / boxH);
        const pos = posFromCenter(g, view.W, view.H, cx, cy, changes.scale ?? g.scale);
        changes.posX = clamp(pos.posX, -3, 3);
        changes.posY = clamp(pos.posY, -3, 3);
      }
      st.updateClip(d.clipId, transformChanges(clip, changes, d.u), true);
    },
    [view, boxW, boxH]
  );

  const endDrag = useCallback(() => {
    if (dragRef.current) useEditor.getState().endTxn();
    dragRef.current = null;
    setDrag(null);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!visible || !view) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      beginDrag('pinch', mid(a, b), { startDist: Math.max(8, dist(a, b)), startAngle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI, startMid: mid(a, b) });
      return;
    }
    const handle = (e.target as HTMLElement).dataset?.handle;
    if (handle === 'rotate') beginDrag('rotate', p);
    else if (handle?.startsWith('corner')) {
      const i = Number(handle.slice(6));
      beginDrag('scale', p, { anchor: view.corners[(i + 2) % 4] });
    } else beginDrag('pan', p);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const known = pointers.current.has(e.pointerId);
    const p = local(e);
    if (known) pointers.current.set(e.pointerId, p);
    const d = dragRef.current;
    if (!d) return;
    const pair = pointers.current.size >= 2 ? ([...pointers.current.values()] as [[number, number], [number, number]]) : undefined;
    applyDrag(d, p, e.altKey, pair);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) endDrag();
  };

  /* wheel zoom / shift+wheel rotate — non-passive so the page never scrolls */
  const wheelTxn = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const closeTxn = () => {
      clearTimeout(wheelTxn.current);
      // a wheel gesture is one undo step, not one per notch
      wheelTxn.current = window.setTimeout(() => {
        wheelTxn.current = 0;
        useEditor.getState().endTxn();
      }, 450);
    };
    const onWheel = (e: WheelEvent) => {
      if (!visible) return;
      e.preventDefault();
      const st = useEditor.getState();
      if (!view) return;
      const hit = layout.find((l) => st.selection?.kind === 'clip' && l.clip.id === st.selection.id) ?? clipAtTime(layout, st.time);
      if (!hit) return;
      const clip = st.project.clips.find((c) => c.id === hit.clip.id);
      if (!clip) return;
      const d = clipDuration(clip);
      const cu = clamp((st.time - hit.start) / Math.max(0.001, d), 0, 1);
      if (!wheelTxn.current) {
        st.beginTxn();
        if (st.selection?.kind !== 'clip' || st.selection.id !== clip.id) st.select({ kind: 'clip', id: clip.id });
      }
      closeTxn();
      const step = e.deltaY > 0 ? -1 : 1;
      if (e.shiftKey) {
        st.updateClip(clip.id, transformChanges(clip, { rotation: clampRot(view.geom.rotation + step * (e.altKey ? 1 : 5)) }, cu), true);
      } else {
        const k = Math.exp(step * (e.altKey ? 0.01 : 0.06));
        st.updateClip(clip.id, transformChanges(clip, { scale: clampScale(snapScale(view.geom.scale * k, e.altKey)) }, cu), true);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(wheelTxn.current);
    };
  }, [enabled, visible, view, layout, boxW, boxH]);

  if (!visible || !view || !target) return null;

  const g = view.geom;
  const [tl, tr, br, bl] = view.corners;
  const c = view.center;
  const topMid = mid(tl, tr);
  // outward normal of the top edge
  const ex = tr[0] - tl[0];
  const ey = tr[1] - tl[1];
  const el = Math.max(1e-3, Math.hypot(ex, ey));
  let nx = ey / el;
  let ny = -ex / el;
  if (nx * (c[0] - topMid[0]) + ny * (c[1] - topMid[1]) > 0) {
    nx = -nx;
    ny = -ny;
  }
  const rotH: [number, number] = [topMid[0] + nx * (touch ? 30 : 26), topMid[1] + ny * (touch ? 30 : 26)];
  const hs = touch ? 13 : 9;
  const poly = [tl, tr, br, bl].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  const shown = drag
    ? `⟳ ${g.rotation.toFixed(1)}°  ·  ${Math.round(g.scale * 100)}%${Math.abs(g.posX) > 0.001 || Math.abs(g.posY) > 0.001 ? `  ·  ${g.posX >= 0 ? '+' : ''}${g.posX.toFixed(2)}, ${g.posY >= 0 ? '+' : ''}${g.posY.toFixed(2)}` : ''}`
    : `⟳ ${g.rotation.toFixed(1)}°  ·  ${Math.round(g.scale * 100)}%`;

  return (
    <div
      ref={ref}
      className={cn('absolute inset-0 z-20', touch ? '' : 'cursor-default')}
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onDoubleClick={() => {
        const st = useEditor.getState();
        st.beginTxn();
        st.updateClip(target.clip.id, transformChanges(target.clip, { ...DEFAULT_TRANSFORM }, u));
        st.endTxn();
        st.toast('Transform reset', 'info');
      }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <polygon points={poly} fill="none" stroke="#22d3ee" strokeWidth="1.25" strokeDasharray="5 4" opacity="0.85" />
        <line x1={topMid[0]} y1={topMid[1]} x2={rotH[0]} y2={rotH[1]} stroke="#22d3ee" strokeWidth="1.2" opacity="0.8" />
        <circle cx={rotH[0]} cy={rotH[1]} r={touch ? 13 : 10} fill="#0b0b10" stroke="#22d3ee" strokeWidth="1.6" />
        <RotateCw x={rotH[0] - (touch ? 8 : 6)} y={rotH[1] - (touch ? 8 : 6)} width={touch ? 16 : 12} height={touch ? 16 : 12} className="text-[#22d3ee]" />
        <Crosshair x={c[0] - 7} y={c[1] - 7} width={14} height={14} className="text-white/70" />
        <line x1={c[0] - 11} y1={c[1]} x2={c[0] + 11} y2={c[1]} stroke="#fff" strokeWidth="1" opacity="0.5" />
        <line x1={c[0]} y1={c[1] - 11} x2={c[0]} y2={c[1] + 11} stroke="#fff" strokeWidth="1" opacity="0.5" />
      </svg>
      {/* hit areas sit above the SVG so they receive the pointer events */}
      {view.corners.map(([x, y], i) => (
        <div
          key={i}
          data-handle={`corner${i}`}
          className={cn('absolute rounded-[2px] border border-[#22d3ee] bg-black/40', i % 2 === 0 ? 'cursor-nwse-resize' : 'cursor-nesw-resize')}
          style={{ left: x - hs, top: y - hs, width: hs * 2, height: hs * 2 }}
        />
      ))}
      <div data-handle="rotate" className="absolute cursor-grab rounded-full" style={{ left: rotH[0] - hs * 1.5, top: rotH[1] - hs * 1.5, width: hs * 3, height: hs * 3 }} />
      <div
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 py-[1px] font-mono text-[9px] tabular-nums',
          drag ? 'bg-[#22d3ee] font-bold text-black' : 'bg-black/55 text-zinc-300 opacity-0 transition-opacity'
        )}
        style={{ left: c[0], top: c[1] + (touch ? 26 : 20) }}
      >
        {shown}
      </div>
      {hover && !drag && !touch && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-black/65 px-2 py-1 text-[9.5px] font-medium text-zinc-300 backdrop-blur">
          Drag to move · corners to zoom · ring to rotate · wheel zooms · shift+wheel rotates · ⌥ frees the snapping
        </div>
      )}
    </div>
  );
}
