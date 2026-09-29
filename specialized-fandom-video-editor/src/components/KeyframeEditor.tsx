import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Diamond, Eye, EyeOff, Magnet, Maximize2, Minimize2, Trash2, Wand2 } from 'lucide-react';
import type { AnimProp, Keyframe, KeyframeTrack } from '../types';
import {
  CURVE_PRESETS,
  NEUTRAL_IN,
  NEUTRAL_OUT,
  applyShapeToAll as applyShapeAllToTrack,
  applyShapeToSegment,
  deleteKeyframe,
  evalTrack,
  initialTrack,
  segShape,
  smoothHandles,
  sortKeys,
  speedAt,
  trackFor,
  updateKeyframe,
  upsertTrack,
} from '../lib/keyframes';
import { clamp } from '../lib/utils';
import { Btn, Seg } from './ui';
import { cn } from '../utils/cn';

interface Props {
  props: AnimProp[];
  propId: string;
  onPropChange: (id: string) => void;
  tracks?: KeyframeTrack[];
  onTracksChange: (t: KeyframeTrack[] | undefined) => void;
  staticVals: Record<string, number>;
  normU: number;
  durationSec: number;
  onScrub: (u: number) => void;
}

const fmtSec = (t: number, dur: number) => `${(t * dur).toFixed(2)}s`;

export function KeyframeEditor({ props, propId, onPropChange, tracks, onTracksChange, staticVals, normU, durationSec, onScrub }: Props) {
  const prop = props.find((p) => p.id === propId) ?? props[0];
  const track = trackFor(tracks, prop.id);
  const keys = useMemo(() => sortKeys(track?.keyframes ?? []), [track]);
  const [selectedId, setSelectedId] = useState<string | null>(keys[0]?.id ?? null);
  const [mode, setMode] = useState<'value' | 'speed'>('value');
  const [expanded, setExpanded] = useState(false);
  const [snap, setSnap] = useState(true);
  const [showHandles, setShowHandles] = useState(true);
  const [view, setView] = useState<[number, number]>([0, 1]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ moved: boolean }>({ moved: false });

  const selected = keys.find((k) => k.id === selectedId) ?? null;
  const W = expanded ? 780 : 268;
  const H = expanded ? 300 : 162;
  const padL = 38;
  const padR = 10;
  const padT = 10;
  const padB = 20;
  const boxW = W - padL - padR;
  const boxH = H - padT - padB;

  const t2x = useCallback((t: number) => padL + ((t - view[0]) / (view[1] - view[0] || 1)) * boxW, [view, boxW]);
  const x2t = useCallback((x: number) => clamp(view[0] + ((x - padL) / boxW) * (view[1] - view[0]), 0, 1), [view, boxW]);
  const gMin = prop.gMin ?? prop.min;
  const gMax = prop.gMax ?? prop.max;
  const v2y = useCallback((v: number) => padT + (1 - clamp((v - gMin) / (gMax - gMin || 1), -0.6, 1.6)) * boxH, [gMin, gMax, boxH]);
  const y2v = useCallback((y: number) => gMin + (1 - (y - padT) / boxH) * (gMax - gMin), [gMin, gMax, boxH]);

  const setTracks = (next: KeyframeTrack[] | undefined) => onTracksChange(next && next.length ? next : undefined);
  const commitTrack = (nt: KeyframeTrack) => {
    const next = nt.keyframes.length ? upsertTrack(tracks, nt) : (tracks ?? []).filter((t) => t.property !== nt.property);
    setTracks(next.length ? next : undefined);
  };

  /* ------------------------------ key ops ------------------------------ */
  const addKeyAtPlayhead = () => {
    const val = evalTrack(track, normU, staticVals[prop.id] ?? (prop.min + prop.max) / 2);
    if (!track) {
      const nt = initialTrack(prop.id, val);
      const k = nt.keyframes.find((x) => Math.abs(x.t - normU) < 0.4) ?? nt.keyframes[0];
      setSelectedId(k.id);
      commitTrack(nt);
      return;
    }
    const nt = [...keys.map((k) => k), { id: Math.random().toString(36).slice(2), t: normU, val, interp: 'bezier' as const, out: [...NEUTRAL_OUT] as [number, number], inn: [...NEUTRAL_IN] as [number, number] }];
    const sorted = nt.sort((a, b) => a.t - b.t);
    setSelectedId(sorted.find((k) => Math.abs(k.t - normU) < 1e-3)!.id);
    commitTrack({ ...track, keyframes: sorted });
  };

  const enableAnimation = () => {
    const nt = initialTrack(prop.id, staticVals[prop.id] ?? 0);
    setSelectedId(nt.keyframes[0].id);
    commitTrack(nt);
  };

  const disableAnimation = () => {
    setTracks((tracks ?? []).filter((t) => t.property !== prop.id).length ? (tracks ?? []).filter((t) => t.property !== prop.id) : undefined);
  };

  const gotoKey = (dir: -1 | 1) => {
    if (!keys.length) return;
    const cur = selected ? selected.t : normU;
    const cand = dir > 0 ? keys.find((k) => k.t > cur + 1e-4) : [...keys].reverse().find((k) => k.t < cur - 1e-4);
    if (cand) {
      setSelectedId(cand.id);
      onScrub(cand.t);
    }
  };

  /* ----------------------------- interactions ---------------------------- */
  const timeFromEvent = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return x2t((clientX - r.left) * (W / r.width));
  };
  const valFromEvent = (clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return y2v(clamp((clientY - r.top) * (H / r.height), padT, padT + boxH));
  };

  const onBgPointerDown = (e: React.PointerEvent) => {
    const startU = timeFromEvent(e.clientX);
    dragRef.current = { moved: false };
    const mv = (ev: PointerEvent) => {
      if (Math.abs(timeFromEvent(ev.clientX) - startU) > 1e-3) dragRef.current.moved = true;
      onScrub(timeFromEvent(ev.clientX));
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    onScrub(startU);
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const onKeyPointerDown = (e: React.PointerEvent, kf: Keyframe) => {
    e.stopPropagation();
    setSelectedId(kf.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const t0 = kf.t;
    const v0 = kf.val;
    const others = keys.filter((k) => k.id !== kf.id).map((k) => k.t);
    const mv = (ev: PointerEvent) => {
      let t = clamp(t0 + ((ev.clientX - sx) / boxW) * (view[1] - view[0]), 0, 1);
      let v = clamp(v0 - ((ev.clientY - sy) / boxH) * (gMax - gMin), gMin, gMax);
      if (snap) {
        const th = 7 / boxW * (view[1] - view[0]);
        for (const o of [normU, ...others, 0, 0.25, 0.5, 0.75, 1]) {
          if (Math.abs(t - o) < th) t = o;
        }
      }
      commitTrack(updateKeyframe(track!, kf.id, { t, val: v }));
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  /** Drag a tangent handle in segment-normalised space (exactly matching the drawn curve). */
  const onHandlePointerDown = (e: React.PointerEvent, which: 'out' | 'inn', seg: [Keyframe, Keyframe]) => {
    e.stopPropagation();
    const [k1, k2] = seg;
    const x1 = t2x(k1.t);
    const x2 = t2x(k2.t);
    const y1 = v2y(k1.val);
    const y2 = v2y(k2.val);
    const dx = x2 - x1 || 1e-6;
    const dy = y2 - y1 || 1e-6;
    const mv = (ev: PointerEvent) => {
      const r = svgRef.current!.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (W / r.width);
      const py = (ev.clientY - r.top) * (H / r.height);
      const nx = clamp((px - x1) / dx, 0, 1);
      const ny = clamp((py - y1) / dy, -1, 2);
      if (which === 'out') commitTrack(updateKeyframe(track!, k1.id, { out: [nx, ny], interp: 'bezier' }));
      else commitTrack(updateKeyframe(track!, k2.id, { inn: [nx, ny], interp: 'bezier' }));
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const at = timeFromEvent(e.clientX);
    const k = Math.exp(e.deltaY * 0.0012);
    let [a, b] = view;
    const span = clamp((b - a) * k, 0.04, 1);
    const rel = (at - a) / (b - a || 1);
    let na = at - rel * span;
    let nb = na + span;
    if (na < 0) {
      nb -= na;
      na = 0;
    }
    if (nb > 1) {
      na -= nb - 1;
      nb = 1;
    }
    setView([Math.max(0, na), Math.min(1, nb)]);
  };

  /* ------------------------------- drawing ------------------------------- */
  const segments = keys.slice(0, -1).map((k, i) => [k, keys[i + 1]] as [Keyframe, Keyframe]);
  const path = useMemo(() => {
    if (!keys.length) return '';
    const out: string[] = [`M ${t2x(keys[0].t)} ${v2y(keys[0].val)}`];
    for (const [k1, k2] of segments) {
      const x1 = t2x(k1.t);
      const x2 = t2x(k2.t);
      const y1 = v2y(k1.val);
      const y2 = v2y(k2.val);
      if (k1.interp === 'hold') {
        out.push(`L ${x2} ${y1}`, `L ${x2} ${y2}`);
      } else if (k1.interp === 'linear' || !k1.out || !k2.inn) {
        out.push(`L ${x2} ${y2}`);
      } else {
        const [ox, oy, ix, iy] = segShape(k1, k2);
        out.push(`C ${x1 + ox * (x2 - x1)} ${y1 + oy * (y2 - y1)}, ${x1 + ix * (x2 - x1)} ${y1 + iy * (y2 - y1)}, ${x2} ${y2}`);
      }
    }
    return out.join(' ');
  }, [keys, segments, t2x, v2y]);

  const speedPath = useMemo(() => {
    if (mode !== 'speed' || !track) return '';
    const n = 120;
    let maxS = 1e-6;
    const raw: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const u = view[0] + ((view[1] - view[0]) * i) / n;
      const s = speedAt(track, u);
      maxS = Math.max(maxS, s);
      raw.push([u, s]);
    }
    return raw
      .map(([u, s], i) => `${i === 0 ? 'M' : 'L'} ${t2x(u)} ${padT + boxH - (s / maxS) * boxH}`)
      .join(' ');
  }, [mode, track, view, t2x, boxH]);

  const ticks = useMemo(() => {
    const span = view[1] - view[0];
    const step = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1].find((s) => (s / span) * boxW > 58) ?? 1;
    const arr: number[] = [];
    for (let t = Math.ceil(view[0] / step) * step; t <= view[1] + 1e-6; t += step) arr.push(Math.round(t / step) * step);
    return arr;
  }, [view, boxW]);

  const gridVals = [gMax, (gMax + gMin) / 2, gMin];

  const graph = (
    <div className={cn('relative rounded-lg border border-white/[0.08] bg-[#08080d]', expanded && 'shadow-2xl')} style={{ width: W, height: H }}>
      <svg ref={svgRef} width={W} height={H} className="absolute inset-0 touch-none" onWheel={onWheel}>
        <rect
          x={padL}
          y={padT}
          width={boxW}
          height={boxH}
          fill="rgba(255,255,255,0.012)"
          className="cursor-crosshair"
          onPointerDown={onBgPointerDown}
          onDoubleClick={(e) => {
            const r = svgRef.current!.getBoundingClientRect();
            const u = x2t((e.clientX - r.left) * (W / r.width));
            const v = valFromEvent(e.clientY);
            const nt = track ?? initialTrack(prop.id, v);
            commitTrack({ ...nt, keyframes: sortKeys([...nt.keyframes.filter((k) => !(nt === track && k.t === 0 && k.val === v && nt.keyframes.length === 1)), { id: Math.random().toString(36).slice(2), t: u, val: v, interp: 'bezier', out: [...NEUTRAL_OUT], inn: [...NEUTRAL_IN] }]) });
          }}
        />
        {/* value axis */}
        {gridVals.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={v2y(g)} x2={padL + boxW} y2={v2y(g)} stroke="rgba(255,255,255,0.07)" strokeDasharray={i === 1 ? '2 4' : undefined} />
            <text x={padL - 5} y={v2y(g) + 3} textAnchor="end" className="fill-zinc-500" style={{ fontSize: 9 }}>
              {prop.fmt(g)}
            </text>
          </g>
        ))}
        {/* time axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={t2x(t)} y1={padT} x2={t2x(t)} y2={padT + boxH} stroke="rgba(255,255,255,0.05)" />
            <text x={t2x(t)} y={H - 6} textAnchor="middle" className="fill-zinc-500" style={{ fontSize: 9 }}>
              {fmtSec(t, durationSec)}
            </text>
          </g>
        ))}
        {/* playhead */}
        <line x1={t2x(normU)} y1={0} x2={t2x(normU)} y2={padT + boxH} stroke="#22d3ee" strokeWidth="1.4" />
        <polygon points={`${t2x(normU) - 4},0 ${t2x(normU) + 4},0 ${t2x(normU)},7`} fill="#22d3ee" />
        {/* value or speed curve */}
        {path && mode === 'value' && <path d={path} fill="none" stroke="#ff2d55" strokeWidth="2.4" strokeLinejoin="round" />}
        {speedPath && mode === 'speed' && (
          <>
            <path d={`${speedPath} L ${t2x(view[1])} ${padT + boxH} L ${t2x(view[0])} ${padT + boxH} Z`} fill="rgba(34,211,238,0.14)" stroke="none" />
            <path d={speedPath} fill="none" stroke="#22d3ee" strokeWidth="2.2" />
          </>
        )}
        {/* tangent handles of the selected key, drawn on the exact control points */}
        {showHandles &&
          selected &&
          segments.map(([k1, k2]) => {
            const x1 = t2x(k1.t);
            const x2 = t2x(k2.t);
            const y1 = v2y(k1.val);
            const y2 = v2y(k2.val);
            const nodes = [];
            if (selected.id === k1.id && k1.interp !== 'hold') {
              const o = k1.out ?? NEUTRAL_OUT;
              nodes.push(
                <g key={`h-out-${k1.id}`}>
                  <line x1={x1} y1={y1} x2={x1 + o[0] * (x2 - x1)} y2={y1 + o[1] * (y2 - y1)} stroke="#fbbf24" strokeWidth="1.4" />
                  <circle
                    cx={x1 + o[0] * (x2 - x1)}
                    cy={y1 + o[1] * (y2 - y1)}
                    r="4.6"
                    fill="#fbbf24"
                    stroke="#0b0b10"
                    strokeWidth="1.2"
                    className="cursor-move"
                    onPointerDown={(e) => onHandlePointerDown(e, 'out', [k1, k2])}
                  />
                </g>
              );
            }
            if (selected.id === k2.id && k1.interp !== 'hold') {
              const i = k2.inn ?? NEUTRAL_IN;
              nodes.push(
                <g key={`h-inn-${k2.id}`}>
                  <line x1={x2} y1={y2} x2={x1 + i[0] * (x2 - x1)} y2={y1 + i[1] * (y2 - y1)} stroke="#38bdf8" strokeWidth="1.4" />
                  <circle
                    cx={x1 + i[0] * (x2 - x1)}
                    cy={y1 + i[1] * (y2 - y1)}
                    r="4.6"
                    fill="#38bdf8"
                    stroke="#0b0b10"
                    strokeWidth="1.2"
                    className="cursor-move"
                    onPointerDown={(e) => onHandlePointerDown(e, 'inn', [k1, k2])}
                  />
                </g>
              );
            }
            return nodes;
          })}
        {/* keyframes */}
        {keys.map((k) => {
          const cx = t2x(k.t);
          const cy = v2y(k.val);
          const sel = k.id === selectedId;
          return (
            <g key={k.id} className="cursor-grab active:cursor-grabbing" onPointerDown={(e) => onKeyPointerDown(e, k)}>
              <rect
                x={cx - 5.5}
                y={cy - 5.5}
                width="11"
                height="11"
                transform={`rotate(45 ${cx} ${cy})`}
                fill={sel ? '#ffffff' : k.interp === 'hold' ? '#9ca3af' : k.interp === 'linear' ? '#4ade80' : '#ff2d55'}
                stroke={sel ? '#22d3ee' : '#0b0b10'}
                strokeWidth="1.6"
              />
            </g>
          );
        })}
        <text x={padL} y={H - 6} textAnchor="start" className="fill-zinc-600" style={{ fontSize: 8 }}>
          0
        </text>
      </svg>
      <div className="pointer-events-none absolute right-2 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-400">
        {mode === 'value' ? `${prop.fmt(evalTrack(track, normU, staticVals[prop.id] ?? 0))} · ${prop.label}` : 'speed (units / sec)'}
      </div>
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-1">
      <button type="button" title="Previous keyframe" onClick={() => gotoKey(-1)} className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
        <ChevronLeft size={14} />
      </button>
      <button type="button" title="Add keyframe at playhead" onClick={addKeyAtPlayhead} className="rounded p-1 text-zinc-300 hover:bg-white/10 hover:text-white">
        <Diamond size={13} className="text-[#ff2d55]" />
      </button>
      <button type="button" title="Next keyframe" onClick={() => gotoKey(1)} className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
        <ChevronRight size={14} />
      </button>
      <button
        type="button"
        title="Delete selected keyframe"
        disabled={!selected}
        onClick={() => {
          if (!track || !selected) return;
          const nt = deleteKeyframe(track, selected.id);
          setSelectedId(nt.keyframes[0]?.id ?? null);
          commitTrack(nt);
        }}
        className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-red-300 disabled:opacity-30"
      >
        <Trash2 size={13} />
      </button>
      <div className="mx-0.5 h-4 w-px bg-white/10" />
      <button
        type="button"
        title={snap ? 'Snapping to playhead, keys & quarters' : 'Snapping off'}
        onClick={() => setSnap(!snap)}
        className={cn('rounded p-1 hover:bg-white/10', snap ? 'text-[#ff2d55]' : 'text-zinc-500')}
      >
        <Magnet size={13} />
      </button>
      <button
        type="button"
        title={showHandles ? 'Hide bezier handles' : 'Show bezier handles'}
        onClick={() => setShowHandles(!showHandles)}
        className={cn('rounded p-1 hover:bg-white/10', showHandles ? 'text-[#fbbf24]' : 'text-zinc-500')}
      >
        {showHandles ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
      <button
        type="button"
        title="Zoom time in"
        onClick={() => {
          const [a, b] = view;
          const span = Math.max(0.04, (b - a) / 2);
          const mid = (a + b) / 2;
          setView([clamp(mid - span / 2, 0, 1), clamp(mid + span / 2, 0, 1)]);
        }}
        className="rounded px-1 text-[10px] font-bold text-zinc-400 hover:bg-white/10 hover:text-white"
      >
        🔍+
      </button>
      <button
        type="button"
        title="Zoom time out"
        onClick={() => {
          const [a, b] = view;
          const span = Math.min(1, (b - a) * 2);
          const mid = (a + b) / 2;
          let na = mid - span / 2;
          let nb = mid + span / 2;
          if (na < 0) {
            nb += na;
            na = 0;
          }
          if (nb > 1) {
            na -= nb - 1;
            nb = 1;
          }
          setView([Math.max(0, na), Math.min(1, nb)]);
        }}
        className="rounded px-1 text-[10px] font-bold text-zinc-400 hover:bg-white/10 hover:text-white"
      >
        🔍−
      </button>
      <button type="button" title="Fit timeline" onClick={() => setView([0, 1])} className="rounded px-1 text-[10px] font-semibold text-zinc-400 hover:bg-white/10 hover:text-white">
        FIT
      </button>
      <div className="flex-1" />
      <button
        type="button"
        title={expanded ? 'Close large graph editor' : 'Open large graph editor'}
        onClick={() => setExpanded(!expanded)}
        className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
      >
        {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>
    </div>
  );

  const body = (
    <div className={cn('space-y-2', expanded && 'w-[780px] rounded-2xl border border-white/10 bg-[#0e0e14] p-4 shadow-2xl')}>
      {/* header */}
      <div className="flex items-center gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Keyframes</div>
        <div className="flex-1" />
        {!track ? (
          <Btn variant="primary" className="h-6 px-2 text-[10px]" onClick={enableAnimation} title="Turn on animation for this property">
            <Diamond size={11} /> Animate
          </Btn>
        ) : (
          <Btn variant="soft" className="h-6 px-2 text-[10px]" onClick={disableAnimation} title="Remove animation (keep current look)">
            <EyeOff size={11} /> Static
          </Btn>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {props.map((p) => {
          const animated = !!trackFor(tracks, p.id)?.keyframes.length;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPropChange(p.id)}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2 py-[3px] text-[10.5px] font-medium transition-colors',
                p.id === prop.id ? 'border-[#ff2d55]/60 bg-[#ff2d55]/15 text-white' : 'border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-zinc-100'
              )}
            >
              {animated && <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" />}
              {p.label}
              {animated ? <span className="text-[9px] text-zinc-500">{trackFor(tracks, p.id)!.keyframes.length}</span> : null}
            </button>
          );
        })}
      </div>

      {track ? (
        <>
          <div className="flex items-center gap-2">
            {toolbar}
            <div className="flex-1" />
            <Seg<'value' | 'speed'>
              value={mode}
              onChange={setMode}
              options={[
                { v: 'value', l: 'Value' },
                { v: 'speed', l: 'Speed' },
              ]}
              className="w-28"
            />
          </div>
          {graph}
          <div className="text-[9.5px] leading-relaxed text-zinc-500">
            Drag the <b className="text-zinc-300">squares</b> to move keys · drag the <b className="text-[#fbbf24]">amber</b> / <b className="text-[#38bdf8]">blue</b> dots to bend the curve · click the graph to scrub ·
            double-click to add a key · scroll to zoom time.
          </div>

          {/* keyframe list */}
          <div className="max-h-[104px] overflow-y-auto rounded-md border border-white/[0.06] bg-black/25">
            {keys.map((k, i) => (
              <div
                key={k.id}
                onClick={() => {
                  setSelectedId(k.id);
                  onScrub(k.t);
                }}
                className={cn('flex cursor-pointer items-center gap-2 border-b border-white/[0.04] px-2 py-[3px] text-[10.5px] last:border-0', k.id === selectedId ? 'bg-[#ff2d55]/12 text-white' : 'text-zinc-400 hover:bg-white/5')}
              >
                <span className="w-3 text-zinc-600">{i + 1}</span>
                <span className="w-11 font-mono text-zinc-300">{fmtSec(k.t, durationSec)}</span>
                <span className="w-14 font-mono text-zinc-300">{prop.fmt(k.val)}</span>
                <span className="flex-1 text-[9.5px] uppercase tracking-wider text-zinc-500">{k.interp ?? 'bezier'}</span>
                <div className="flex gap-0.5">
                  {(['bezier', 'linear', 'hold'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      title={m}
                      onClick={(e) => {
                        e.stopPropagation();
                        commitTrack(updateKeyframe(track, k.id, { interp: m }));
                      }}
                      className={cn('rounded px-1 text-[9px] font-bold', (k.interp ?? 'bezier') === m ? 'bg-white text-black' : 'bg-white/10 text-zinc-300 hover:bg-white/20')}
                    >
                      {m === 'bezier' ? 'EASE' : m === 'linear' ? 'LIN' : 'HOLD'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* curve shapes */}
          <div className="space-y-1 rounded-md border border-white/[0.06] bg-white/[0.02] p-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-semibold text-zinc-300">Curve shapes</div>
              <div className="text-[9px] text-zinc-500">{selected ? `applies from key ${keys.indexOf(selected) + 1}` : 'select a key'}</div>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {CURVE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  onClick={() => {
                    if (!track) return;
                    if (selected) commitTrack(applyShapeSegmentSafe(track, selected.id, p.shape));
                    else commitTrack(applyShapeAllToTrack(track, p.shape));
                  }}
                  className="rounded border border-white/[0.07] bg-[#141420] px-1 py-1 text-[9.5px] font-semibold text-zinc-300 transition-colors hover:border-[#ff2d55]/50 hover:text-white"
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className="flex gap-1 pt-0.5">
              <Btn variant="soft" className="h-6 flex-1 px-1 text-[9.5px]" onClick={() => selected && track && commitTrack(smoothHandles(track, selected.id))} disabled={!selected}>
                <Wand2 size={11} /> Smooth tangent
              </Btn>
              <Btn variant="soft" className="h-6 flex-1 px-1 text-[9.5px]" onClick={() => track && commitTrack(applyShapeAllToTrack(track, [0.12, 0.85, 0.2, 1]))}>
                AE Flow on all keys
              </Btn>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-white/10 p-3 text-center text-[11px] leading-relaxed text-zinc-500">
          <div className="mb-1 text-[16px]">💎</div>
          This property is static. Press <b className="text-zinc-300">Animate</b> to add keyframes, then stack keys and bend the curve (just like After Effects).
        </div>
      )}

      {expanded && (
        <div className="flex justify-end">
          <Btn variant="soft" onClick={() => setExpanded(false)}>
            Close graph
          </Btn>
        </div>
      )}
    </div>
  );

  if (!expanded) return body;
  return (
    <div className="fixed inset-0 z-[45] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onPointerDown={(e) => e.target === e.currentTarget && setExpanded(false)}>
      {body}
    </div>
  );
}

/** Applies a shape to the segment starting at a key, falling back to the whole track. */
function applyShapeSegmentSafe(track: KeyframeTrack, id: string, shape: [number, number, number, number]): KeyframeTrack {
  const keys = sortKeys(track.keyframes);
  const i = keys.findIndex((k) => k.id === id);
  if (i < 0 || i === keys.length - 1) return applyShapeAllToTrack(track, shape);
  return applyShapeToSegment(track, id, shape);
}
