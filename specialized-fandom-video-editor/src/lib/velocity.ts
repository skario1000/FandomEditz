import type { Clip, VelocitySettings } from '../types';
import { clamp, ease, uid } from './utils';

/* ------------------------------------------------------------------ */
/*  Velocity / time-remap curves                                       */
/*  Map normalized clip time u (0..1) -> normalized source progress p  */
/* ------------------------------------------------------------------ */

const N = 400;
type LutEntry = { lut: Float32Array; norm: number; g: (u: number) => number };
const lutCache = new Map<string, LutEntry>();
const gauss = (x: number) => Math.exp(-x * x);

function profileFn(v: VelocitySettings): (u: number) => number {
  const k = clamp(v.intensity, 0, 1);
  const c = clamp(v.center, 0.05, 0.95);
  switch (v.preset) {
    case 'classic': {
      const A = 0.92 * k;
      return (u) => 1 - A * Math.cos(2 * Math.PI * (u - c));
    }
    case 'impact': {
      const slow = 1 - 0.93 * k;
      const fast = 1 + 1.6 * k;
      return (u) => fast + (slow - fast) * gauss((u - c) / 0.13);
    }
    case 'rampUp': {
      const a = 1 - 0.85 * k;
      const b = 1 + 2.2 * k;
      return (u) => a + (b - a) * Math.pow(u, 1.6);
    }
    case 'rampDown': {
      const a = 1 - 0.85 * k;
      const b = 1 + 2.2 * k;
      return (u) => a + (b - a) * Math.pow(1 - u, 1.6);
    }
    case 'double': {
      const A = 0.9 * k;
      return (u) => 1 - A * Math.cos(4 * Math.PI * (u - c / 2));
    }
    default:
      return () => 1;
  }
}

function getLut(v: VelocitySettings): LutEntry {
  const key = `${v.preset}|${v.intensity.toFixed(3)}|${v.center.toFixed(3)}`;
  let e = lutCache.get(key);
  if (!e) {
    const g = profileFn(v);
    const lut = new Float32Array(N + 1);
    let acc = 0;
    let prev = g(0);
    for (let i = 1; i <= N; i++) {
      const cur = g(i / N);
      acc += ((prev + cur) * 0.5) / N;
      lut[i] = acc;
      prev = cur;
    }
    for (let i = 1; i <= N; i++) lut[i] /= acc;
    e = { lut, norm: acc, g };
    if (lutCache.size > 300) lutCache.clear();
    lutCache.set(key, e);
  }
  return e;
}

export function velocityProgress(v: VelocitySettings, u: number): number {
  u = clamp(u, 0, 1);
  switch (v.preset) {
    case 'none':
      return u;
    case 'microwave': {
      // forward push, then an eased snap back (After-Effects "microwave" time remap)
      const c = clamp(v.center, 0.3, 0.92);
      const back = 0.25 + 0.6 * clamp(v.intensity, 0, 1);
      if (u < c) return ease('cubic', u / c);
      return 1 - back * ease('cubic', (u - c) / (1 - c));
    }
    case 'boomerang': {
      const c = clamp(v.center, 0.2, 0.8);
      if (u < c) return ease('smooth', u / c);
      return 1 - ease('smooth', (u - c) / (1 - c));
    }
    default: {
      const { lut } = getLut(v);
      const x = u * N;
      const i = Math.min(N - 1, Math.floor(x));
      const f = x - i;
      return lut[i] + (lut[i + 1] - lut[i]) * f;
    }
  }
}

/** dp/du */
export function velocitySlope(v: VelocitySettings, u: number): number {
  if (v.preset === 'none') return 1;
  if (v.preset !== 'microwave' && v.preset !== 'boomerang') {
    const { g, norm } = getLut(v);
    return g(clamp(u, 0, 1)) / norm;
  }
  const h = 2e-3;
  const a = clamp(u - h, 0, 1);
  const b = clamp(u + h, 0, 1);
  if (b - a < 1e-6) return 0;
  return (velocityProgress(v, b) - velocityProgress(v, a)) / (b - a);
}

/* ------------------------------------------------------------------ */
/*  Clip timing                                                         */
/* ------------------------------------------------------------------ */

export const clipDuration = (c: Clip) => Math.max(0.02, (c.srcOut - c.srcIn) / Math.max(0.01, c.speed));

export function clipSourceTime(c: Clip, localT: number): number {
  const u = clamp(localT / clipDuration(c), 0, 1);
  let p = velocityProgress(c.velocity, u);
  if (c.reverse) p = 1 - p;
  return c.srcIn + p * (c.srcOut - c.srcIn);
}

export function clipSourceRate(c: Clip, localT: number): number {
  const dur = clipDuration(c);
  const u = clamp(localT / dur, 0, 1);
  const r = (velocitySlope(c.velocity, u) * (c.srcOut - c.srcIn)) / dur;
  return c.reverse ? -r : r;
}

export interface ClipLayout {
  clip: Clip;
  start: number;
  end: number;
  index: number;
}

const layoutCache = new WeakMap<Clip[], ClipLayout[]>();
export function layoutClips(clips: Clip[]): ClipLayout[] {
  let l = layoutCache.get(clips);
  if (!l) {
    l = [];
    let t = 0;
    clips.forEach((clip, index) => {
      const d = clipDuration(clip);
      l!.push({ clip, start: t, end: t + d, index });
      t += d;
    });
    layoutCache.set(clips, l);
  }
  return l;
}

export const totalDuration = (clips: Clip[]) => {
  const l = layoutClips(clips);
  return l.length ? l[l.length - 1].end : 0;
};

export function clipAtTime(layout: ClipLayout[], t: number): ClipLayout | null {
  if (!layout.length || t < 0) return null;
  let lo = 0;
  let hi = layout.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (layout[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  const hit = layout[lo];
  return t < hit.end ? hit : null;
}

export function cutPoints(clips: Clip[]): number[] {
  const l = layoutClips(clips);
  return l.slice(0, -1).map((x) => x.end);
}

export function nearestCut(clips: Clip[], t: number): number | null {
  let best: number | null = null;
  for (const c of cutPoints(clips)) if (best === null || Math.abs(c - t) < Math.abs(best - t)) best = c;
  return best;
}

export function splitClip(clip: Clip, localT: number): [Clip, Clip] | null {
  const dur = clipDuration(clip);
  if (localT <= 0.02 || localT >= dur - 0.02) return null;
  const u = localT / dur;
  const span = clip.srcOut - clip.srcIn;
  const cut = clip.reverse ? clip.srcOut - u * span : clip.srcIn + u * span;
  const a: Clip = { ...clip, id: uid() };
  const b: Clip = { ...clip, id: uid() };
  if (!clip.reverse) {
    a.srcOut = cut;
    b.srcIn = cut;
  } else {
    a.srcIn = cut;
    b.srcOut = cut;
  }
  return [a, b];
}

export const VELOCITY_PRESETS: { id: VelocitySettings['preset']; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'classic', name: 'Velocity' },
  { id: 'impact', name: 'Impact' },
  { id: 'rampUp', name: 'Slow→Fast' },
  { id: 'rampDown', name: 'Fast→Slow' },
  { id: 'double', name: 'Double' },
  { id: 'microwave', name: 'Microwave' },
  { id: 'boomerang', name: 'Boomerang' },
];
