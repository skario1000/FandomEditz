import type { AnimProp, Keyframe, KeyframeTrack } from '../types';
import { clamp, uid } from './utils';
import { cubicBezier } from './bezier';

/** Neutral tangents: classic symmetric "easy ease". */
export const NEUTRAL_OUT: [number, number] = [0.33, 0];
export const NEUTRAL_IN: [number, number] = [0.67, 1];

export function sortKeys(ks: Keyframe[]): Keyframe[] {
  return [...ks].sort((a, b) => a.t - b.t);
}

export function trackFor(tracks: KeyframeTrack[] | undefined, prop: string): KeyframeTrack | undefined {
  return tracks?.find((t) => t.property === prop);
}

export function hasTrack(tracks: KeyframeTrack[] | undefined, prop: string): boolean {
  const tr = trackFor(tracks, prop);
  return !!tr && tr.keyframes.length > 0;
}

/** The cubic-bezier shape of the segment k1 -> k2. */
export function segShape(k1: Keyframe, k2: Keyframe): [number, number, number, number] {
  const o = k1.out ?? NEUTRAL_OUT;
  const i = k2.inn ?? NEUTRAL_IN;
  return [o[0], o[1], i[0], i[1]];
}

/** Evaluate an animated property at normalised time u (0..1). */
export function evalTrack(track: KeyframeTrack | undefined, u: number, def: number): number {
  if (!track || track.keyframes.length === 0) return def;
  const kfs = sortKeys(track.keyframes);
  if (kfs.length === 1) return kfs[0].val;
  if (u <= kfs[0].t) return kfs[0].val;
  const last = kfs[kfs.length - 1];
  if (u >= last.t) return last.val;

  let i = 0;
  for (let j = 0; j < kfs.length - 1; j++) {
    if (u >= kfs[j].t && u <= kfs[j + 1].t) {
      i = j;
      break;
    }
  }
  const k1 = kfs[i];
  const k2 = kfs[i + 1];
  const span = k2.t - k1.t;
  if (span < 1e-9) return k2.val;
  const p = clamp((u - k1.t) / span, 0, 1);
  if (k1.interp === 'hold') return k1.val;
  if (k1.interp === 'linear') return k1.val + (k2.val - k1.val) * p;
  const [x1, y1, x2, y2] = segShape(k1, k2);
  return k1.val + (k2.val - k1.val) * cubicBezier(x1, y1, x2, y2)(p);
}

/** Numeric speed (value units per unit of normalised time) — used by the speed graph. */
export function speedAt(track: KeyframeTrack | undefined, u: number, def = 0): number {
  const h = 1 / 500;
  const a = clamp(u - h, 0, 1);
  const b = clamp(u + h, 0, 1);
  if (b - a < 1e-6) return 0;
  return Math.abs((evalTrack(track, b, def) - evalTrack(track, a, def)) / (b - a));
}

/** Enable animation on a property: seeds a key at 0 and 1 holding the current value. */
export function initialTrack(prop: string, val: number, shape: [number, number, number, number] = [0.12, 0.85, 0.2, 1]): KeyframeTrack {
  const k1: Keyframe = { id: uid(), t: 0, val, interp: 'bezier', out: [shape[0], shape[1]] };
  const k2: Keyframe = { id: uid(), t: 1, val, interp: 'bezier', inn: [shape[2], shape[3]] };
  return { id: uid(), property: prop, keyframes: [k1, k2] };
}

export function upsertTrack(tracks: KeyframeTrack[] | undefined, track: KeyframeTrack): KeyframeTrack[] {
  const others = (tracks ?? []).filter((t) => t.property !== track.property);
  return [...others, track].filter((t) => t.keyframes.length > 0);
}

export function removeTrack(tracks: KeyframeTrack[] | undefined, prop: string): KeyframeTrack[] | undefined {
  const next = (tracks ?? []).filter((t) => t.property !== prop);
  return next.length ? next : undefined;
}

/** Add a keyframe, or update the key already sitting (nearly) on that time. */
export function setKeyframe(track: KeyframeTrack, t: number, val: number, interp: Keyframe['interp'] = 'bezier'): KeyframeTrack {
  const tt = clamp(t, 0, 1);
  const keys = sortKeys(track.keyframes);
  const near = keys.find((k) => Math.abs(k.t - tt) < 1e-3);
  if (near) {
    return { ...track, keyframes: sortKeys(keys.map((k) => (k.id === near.id ? { ...k, val } : k))) };
  }
  const kf: Keyframe = { id: uid(), t: tt, val, interp, out: [...NEUTRAL_OUT], inn: [...NEUTRAL_IN] };
  return { ...track, keyframes: sortKeys([...keys, kf]) };
}

export function updateKeyframe(track: KeyframeTrack, id: string, patch: Partial<Keyframe>): KeyframeTrack {
  return { ...track, keyframes: sortKeys(track.keyframes.map((k) => (k.id === id ? { ...k, ...patch } : k))) };
}

export function deleteKeyframe(track: KeyframeTrack, id: string): KeyframeTrack {
  return { ...track, keyframes: sortKeys(track.keyframes.filter((k) => k.id !== id)) };
}

export function moveKeyframe(track: KeyframeTrack, id: string, t: number, val: number): KeyframeTrack {
  return updateKeyframe(track, id, { t: clamp(t, 0, 1), val });
}

/** Apply a segment shape to the segment starting at key `id`. */
export function applyShapeToSegment(track: KeyframeTrack, id: string, shape: [number, number, number, number]): KeyframeTrack {
  const keys = sortKeys(track.keyframes);
  const i = keys.findIndex((k) => k.id === id);
  if (i < 0) return track;
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const next = keys.map((k) => {
    if (k.id === k1.id) return { ...k, interp: 'bezier' as const, out: [shape[0], shape[1]] as [number, number] };
    if (k2 && k.id === k2.id) return { ...k, interp: 'bezier' as const, inn: [shape[2], shape[3]] as [number, number] };
    return k;
  });
  return { ...track, keyframes: next };
}

/** Apply a shape to every segment of a track. */
export function applyShapeToAll(track: KeyframeTrack, shape: [number, number, number, number]): KeyframeTrack {
  const keys = sortKeys(track.keyframes).map((k, i, arr) => {
    const kf: Keyframe = { ...k, interp: 'bezier', out: [shape[0], shape[1]], inn: [shape[2], shape[3]] };
    if (i === 0) delete kf.inn;
    if (i === arr.length - 1) delete kf.out;
    return kf;
  });
  return { ...track, keyframes: keys };
}

/** Mirror the two tangents of a key so the curve stays smooth through it. */
export function smoothHandles(track: KeyframeTrack, id: string): KeyframeTrack {
  const keys = sortKeys(track.keyframes);
  const i = keys.findIndex((k) => k.id === id);
  if (i < 0) return track;
  const k = keys[i];
  const prev = keys[i - 1];
  const next = keys[i + 1];
  const out = k.out ?? NEUTRAL_OUT;
  const inn = k.inn ?? NEUTRAL_IN;
  // average the slopes of both neighbours, mirrored through the key
  const slopeL = prev ? (k.val - prev.val) / Math.max(1e-6, k.t - prev.t) : 0;
  const slopeR = next ? (next.val - k.val) / Math.max(1e-6, next.t - k.t) : 0;
  const slope = (slopeL + slopeR) / 2;
  const lenL = Math.max(0.08, Math.min(0.45, (k.t - (prev?.t ?? 0)) / 2));
  const lenR = Math.max(0.08, Math.min(0.45, ((next?.t ?? 1) - k.t) / 2));
  const spanL = k.val - (prev?.val ?? k.val);
  const spanR = (next?.val ?? k.val) - k.val;
  const yL = Math.abs(spanL) > 1e-6 ? clamp(1 - (slope * (lenL / Math.max(1e-6, k.t - (prev?.t ?? 0))) * (k.t - (prev?.t ?? 0))) / spanL, -1, 2) : inn[1];
  const yR = Math.abs(spanR) > 1e-6 ? clamp((slope * lenR) / spanR, -1, 2) : out[1];
  return updateKeyframe(track, id, { inn: [1 - lenL, yL], out: [lenR, yR] });
}

export interface CurvePreset {
  id: string;
  name: string;
  shape: [number, number, number, number];
  hint: string;
}

export const CURVE_PRESETS: CurvePreset[] = [
  { id: 'aeFlow', name: 'AE Flow', shape: [0.12, 0.85, 0.2, 1], hint: 'Fandom edit staple: explosive start, long cushion' },
  { id: 'aeSnap', name: 'AE Snap', shape: [0.08, 0.82, 0.17, 1], hint: 'Crisp whip hit on beats' },
  { id: 'aeWhip', name: 'AE Whip', shape: [0.65, 0, 0.05, 1], hint: 'Slow build then violent finish' },
  { id: 'easyEase', name: 'Easy Ease', shape: [0.33, 0, 0.67, 1], hint: 'After Effects default' },
  { id: 'expoOut', name: 'Expo Out', shape: [0.16, 1, 0.3, 1], hint: 'Fast then very long settle' },
  { id: 'expoIn', name: 'Expo In', shape: [0.7, 0, 0.84, 0], hint: 'Barely moves, then launches' },
  { id: 'quint', name: 'Smooth S', shape: [0.83, 0, 0.17, 1], hint: 'Symmetrical in & out' },
  { id: 'overshoot', name: 'Overshoot', shape: [0.34, 1.56, 0.64, 1], hint: 'Springs past the value and back' },
  { id: 'anticipate', name: 'Anticipate', shape: [0.6, -0.6, 0.2, 1], hint: 'Pulls back before moving' },
  { id: 'linear', name: 'Linear', shape: [0, 0, 1, 1], hint: 'Constant speed' },
];

/** Value of the property at the playhead, or the static value when not animated. */
export function animatedValue(tracks: KeyframeTrack[] | undefined, prop: AnimProp, u: number, staticVal: number): number {
  const tr = trackFor(tracks, prop.id);
  return tr && tr.keyframes.length ? evalTrack(tr, u, staticVal) : staticVal;
}
