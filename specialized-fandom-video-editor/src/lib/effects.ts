import type { FxItem, ParamValue } from '../types';
import { clamp, ease, hash1, hashStr, hexToRgb, noise1 } from './utils';
import { evalTrack, trackFor } from './keyframes';
import { cubicBezier } from './bezier';
import { FONT_DEFS, FONT_OPTS, type TextLayer } from './textEngine';

/* ------------------------------------------------------------------ */
/* Affine helpers: [a, b, c, d, e, f] -> x' = a x + c y + e, y' = b x + d y + f */
/* ------------------------------------------------------------------ */
export type Aff = [number, number, number, number, number, number];
export const affI = (): Aff => [1, 0, 0, 1, 0, 0];
export function affMul(A: Aff, B: Aff): Aff {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}
export function affInv(A: Aff): Aff {
  const det = A[0] * A[3] - A[1] * A[2] || 1e-9;
  const a = A[3] / det;
  const b = -A[1] / det;
  const c = -A[2] / det;
  const d = A[0] / det;
  return [a, b, c, d, -(a * A[4] + c * A[5]), -(b * A[4] + d * A[5])];
}
export const affT = (x: number, y: number): Aff => [1, 0, 0, 1, x, y];
export const affS = (sx: number, sy: number): Aff => [sx, 0, 0, sy, 0, 0];
export const affR = (r: number): Aff => {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
};
export const affApply = (A: Aff, x: number, y: number): [number, number] => [
  A[0] * x + A[2] * y + A[4],
  A[1] * x + A[3] * y + A[5],
];

/* ------------------------------------------------------------------ */
/* Render state produced by effects                                    */
/* ------------------------------------------------------------------ */
export type TextOverlay = TextLayer;

export interface FxState {
  geo: Aff; // in height-normalised output coords (x in [0, aspect], y in [0, 1])
  aspect: number;
  rcx: number;
  rcy: number;
  radialBlur: number;
  blur: number;
  blurRadius: number;
  exposure: number;
  contrast: number;
  saturation: number;
  hue: number;
  bw: number;
  temp: number;
  invert: number;
  flash: [number, number, number, number];
  rgbSplit: number; // px @1080p
  rgbAngle: number;
  glow: number;
  glowThreshold: number;
  vignette: number;
  grain: number;
  glitch: number;
  pixelate: number; // px @1080p
  halftone: number;
  halftoneSize: number;
  posterize: number;
  edges: number;
  scanlines: number;
  letterbox: number;
  mirror: number;
  echo: number;
  /** Reverse lens distortion (AE Optics Compensation). Positive bows the frame outward. */
  lens: number;
  lensCx: number;
  lensCy: number;
  texts: TextOverlay[];
}

export function newFxState(aspect: number): FxState {
  return {
    geo: affI(),
    aspect,
    rcx: 0.5,
    rcy: 0.5,
    radialBlur: 0,
    blur: 0,
    blurRadius: 0.012,
    exposure: 0,
    contrast: 0,
    saturation: 0,
    hue: 0,
    bw: 0,
    temp: 0,
    invert: 0,
    flash: [1, 1, 1, 0],
    rgbSplit: 0,
    rgbAngle: 0,
    glow: 0,
    glowThreshold: 0.6,
    vignette: 0,
    grain: 0,
    glitch: 0,
    pixelate: 0,
    halftone: 0,
    halftoneSize: 9,
    posterize: 0,
    edges: 0,
    scanlines: 0,
    letterbox: 0,
    mirror: 0,
    echo: 0,
    lens: 0,
    lensCx: 0.5,
    lensCy: 0.5,
    texts: [],
  };
}

/** Reverse lens distortion about a point. Positive amount bows the frame outward,
    which is what AE's Optics Compensation (Reverse Lens Distortion) does. */
export function addLens(s: FxState, amount: number, cx = 0.5, cy = 0.5) {
  if (amount <= 0.0005) return;
  if (amount > s.lens) {
    s.lensCx = cx;
    s.lensCy = cy;
  }
  s.lens += amount;
}

export function geoZoom(s: FxState, z: number, cx = 0.5, cy = 0.5) {
  const px = cx * s.aspect;
  s.geo = affMul(affMul(affT(px, cy), affMul(affS(z, z), affT(-px, -cy))), s.geo);
}
export function geoRotate(s: FxState, r: number, cx = 0.5, cy = 0.5) {
  const px = cx * s.aspect;
  s.geo = affMul(affMul(affT(px, cy), affMul(affR(r), affT(-px, -cy))), s.geo);
}
export function geoTranslate(s: FxState, tx: number, ty: number) {
  s.geo = affMul(affT(tx * s.aspect, ty), s.geo);
}
export function addFlash(s: FxState, r: number, g: number, b: number, a: number) {
  a = clamp(a, 0, 1);
  if (a <= 0.001) return;
  const A0 = s.flash[3];
  const A = 1 - (1 - A0) * (1 - a);
  const w0 = (A0 * (1 - a)) / A;
  const w1 = a / A;
  s.flash = [s.flash[0] * w0 + r * w1, s.flash[1] * w0 + g * w1, s.flash[2] * w0 + b * w1, A];
}
function addRadial(s: FxState, amount: number, cx: number, cy: number) {
  if (amount <= 0) return;
  if (amount > s.radialBlur) {
    s.rcx = cx;
    s.rcy = cy;
  }
  s.radialBlur += amount;
}

/* ------------------------------------------------------------------ */
/* Definitions                                                         */
/* ------------------------------------------------------------------ */
export type FxCategory = 'zoom' | 'transition' | 'motion' | 'light' | 'glitch' | 'time' | 'text';

export type ParamDef = (
  | { key: string; label: string; type: 'range'; min: number; max: number; step: number; def: number }
  | { key: string; label: string; type: 'select'; options: { v: string; l: string }[]; def: string }
  | { key: string; label: string; type: 'bool'; def: boolean }
  | { key: string; label: string; type: 'color'; def: string }
  | { key: string; label: string; type: 'text'; def: string }
) & { group?: string };

const grp = (group: string, ps: ParamDef[]): ParamDef[] => ps.map((p) => ({ ...p, group }));

export interface FxCtx {
  p: number;
  lt: number;
  dur: number;
  k: number;
  P: Record<string, ParamValue>;
  seed: number;
  T: number;
  beats: number[];
  start: number;
}

export interface FxDef {
  type: string;
  name: string;
  cat: FxCategory;
  icon: string;
  desc: string;
  dur: number;
  transition?: boolean;
  params: ParamDef[];
  apply?: (s: FxState, c: FxCtx) => void;
  remap?: (lt: number, dur: number, P: Record<string, ParamValue>, k: number) => [number, number];
}

export const FX_CATS: { id: FxCategory; name: string; color: string }[] = [
  { id: 'zoom', name: 'Zooms', color: '#22d3ee' },
  { id: 'transition', name: 'Transitions', color: '#a78bfa' },
  { id: 'motion', name: 'Shake & Motion', color: '#fb923c' },
  { id: 'light', name: 'Flash & Light', color: '#facc15' },
  { id: 'glitch', name: 'Glitch & Stylize', color: '#f472b6' },
  { id: 'time', name: 'Time FX', color: '#4ade80' },
  { id: 'text', name: 'Text', color: '#e5e7eb' },
];
export const catColor = (c: FxCategory) => FX_CATS.find((x) => x.id === c)?.color ?? '#888';

const TEXT_IN: [string, string][] = [
  ['impact', 'Impact (edit hit)'],
  ['blurReveal', 'Blur reveal'],
  ['fadeUp', 'Fade up'],
  ['trackIn', 'Tracking in'],
  ['zoomIn', 'Zoom in'],
  ['slam', 'Slam'],
  ['pop', 'Pop'],
  ['drop', 'Drop / cascade'],
  ['rise', 'Rise'],
  ['spin3d', '3D flip'],
  ['typewriter', 'Typewriter'],
  ['scramble', 'Scramble decode'],
  ['flicker', 'Flicker on'],
  ['glitch', 'Glitch in'],
  ['fade', 'Fade'],
  ['none', 'None'],
];
const TEXT_OUT: [string, string][] = [
  ['fade', 'Fade'],
  ['blurOut', 'Blur out'],
  ['trackOut', 'Tracking out'],
  ['zoomOut', 'Zoom out'],
  ['dropOut', 'Drop out'],
  ['flickerOff', 'Flicker off'],
  ['scramble', 'Scramble out'],
  ['cut', 'Hard cut'],
  ['none', 'Hold to end'],
];
const LEGACY_IN: Record<string, string> = { editImpact: 'impact', blurIn: 'blurReveal' };

const num = (c: FxCtx, k: string, d: number) => (typeof c.P[k] === 'number' ? (c.P[k] as number) : d);
const str = (c: FxCtx, k: string, d: string) => (typeof c.P[k] === 'string' ? (c.P[k] as string) : d);
const bool = (c: FxCtx, k: string, d: boolean) => (typeof c.P[k] === 'boolean' ? (c.P[k] as boolean) : d);
const pn = (P: Record<string, ParamValue>, k: string, d: number) => (typeof P[k] === 'number' ? (P[k] as number) : d);

const r = (key: string, label: string, min: number, max: number, step: number, def: number): ParamDef => ({
  key,
  label,
  type: 'range',
  min,
  max,
  step,
  def,
});
const sel = (key: string, label: string, options: [string, string][], def: string): ParamDef => ({
  key,
  label,
  type: 'select',
  options: options.map(([v, l]) => ({ v, l })),
  def,
});
const bo = (key: string, label: string, def: boolean): ParamDef => ({ key, label, type: 'bool', def });
const col = (key: string, label: string, def: string): ParamDef => ({ key, label, type: 'color', def });

const EASE_OPTS: [string, string][] = [
  ['good', 'Good zoom (smooth S)'],
  ['silk', 'Silk (long settle)'],
  ['snap', 'Snap (hit, then coast)'],
  ['land', 'Land on the beat'],
  ['crash', 'Crash'],
  ['over', 'Overshoot'],
  ['whip', 'Whip'],
  ['smooth', 'Smoothstep'],
  ['expo', 'Expo'],
  ['quint', 'Quint'],
  ['outBack', 'Bounce'],
  ['linear', 'Linear'],
];
const ENV_OPTS: [string, string][] = [
  ['hold', 'Hold'],
  ['fadeOut', 'Fade out'],
  ['fadeIn', 'Fade in'],
  ['bell', 'In & out'],
];
const CENTER = [r('cx', 'Center X', 0, 1, 0.01, 0.5), r('cy', 'Center Y', 0, 1, 0.01, 0.5)];

const edge = (lt: number, dur: number, f: number) => clamp(Math.min(lt / f, (dur - lt) / f), 0, 1);
function envelope(kind: string, c: FxCtx) {
  switch (kind) {
    case 'fadeOut':
      return Math.pow(1 - c.p, 2);
    case 'fadeIn':
      return c.p * c.p;
    case 'bell':
      return Math.sin(Math.PI * c.p);
    case 'jitter':
      return (0.25 + 0.75 * hash1(Math.floor(c.T * 24), c.seed)) * edge(c.lt, c.dur, 0.03);
    default:
      return edge(c.lt, c.dur, 0.04);
  }
}

function lnzVel(f: (q: number) => number, p: number, dur: number) {
  const h = 0.008;
  const a = Math.max(0, p - h);
  const b = Math.min(1, p + h);
  if (b <= a) return 0;
  return Math.abs(Math.log(Math.max(0.05, f(b))) - Math.log(Math.max(0.05, f(a)))) / ((b - a) * dur);
}
function applyZoom(s: FxState, c: FxCtx, f: (q: number) => number) {
  const cx = num(c, 'cx', 0.5);
  const cy = num(c, 'cy', 0.5);
  geoZoom(s, Math.max(0.12, f(c.p)), cx, cy);
  const bl = num(c, 'blur', 1);
  if (bl > 0) addRadial(s, Math.min(0.55, bl * lnzVel(f, c.p, c.dur) * 0.048), cx, cy);
  const rise = num(c, 'rise', 0);
  if (rise > 0.001) geoTranslate(s, 0, -rise * 0.014 * ease('smooth', c.p));
}

/* Real cubic-bezier zoom curves. A smooth zoom has ~zero speed at both ends;
   a snap zoom is fast at the start and coasts to a stop. */
const bezCache = new Map<string, (t: number) => number>();
function bez(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const k = `${x1}|${y1}|${x2}|${y2}`;
  let f = bezCache.get(k);
  if (!f) {
    f = cubicBezier(x1, y1, x2, y2);
    bezCache.set(k, f);
  }
  return f;
}
const Z = {
  good: bez(0.46, 0, 0.14, 1),
  silk: bez(0.3, 0, 0.1, 1),
  snap: bez(0.05, 0.72, 0.16, 1),
  crash: bez(0.015, 0.9, 0.2, 1),
  land: bez(0.7, 0, 0.2, 1),
  over: bez(0.14, 1.42, 0.34, 1),
  whip: bez(0.78, 0, 0.1, 1),
};
function zEase(name: string, t: number): number {
  const fn = (Z as Record<string, (t: number) => number>)[name];
  if (fn) return fn(t);
  if (name === 'aeFlow' || name === 'aeSnap') return Z.snap(t);
  if (name === 'aeSmooth') return Z.good(t);
  if (name === 'aeWhip') return Z.whip(t);
  return ease(name, t);
}
/* ------------------------------------------------------------------ */
/* AE Exponential Scale                                                */
/*                                                                    */
/* Scale is multiplicative, so interpolating 100→300% linearly in      */
/* scale space moves perceptually faster at the start and stalls at    */
/* the end. AE's "Exponential Scale" keyframe assistant interpolates   */
/* in log space, which is what makes big zooms read as smooth. Every   */
/* zoom here goes through it.                                          */
/* ------------------------------------------------------------------ */
export function expZoom(from: number, to: number, t: number): number {
  return Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * clamp(t, 0, 1));
}

/** 1 → zoomed, or zoomed → 1, in perceptually even log space. */
function zoomTo(amount: number, dir: string, curve: (q: number) => number) {
  const s1 = 1 + Math.max(0.01, amount);
  return dir === 'out'
    ? (q: number) => expZoom(s1, 1, curve(q))
    : (q: number) => expZoom(1, s1, curve(q));
}

const tin = (t: number) => Math.pow(clamp(t, 0, 1), 4.2);
const tout = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 4.2);
/** 0 -> 1 on first half (accelerating into cut), -1 -> 0 on second half (decelerating out of cut) */
const transCurve = (q: number) => (q < 0.5 ? tin(q * 2) : -(1 - tout((q - 0.5) * 2)));

function segmentAt(c: FxCtx, mode: string, count: number) {
  if (mode === 'beats') {
    const inner = c.beats.filter((b) => b > c.start + 0.04 && b < c.start + c.dur - 0.04);
    if (inner.length) {
      const pts = [c.start, ...inner, c.start + c.dur];
      const T = c.start + c.lt;
      for (let i = 0; i < pts.length - 1; i++) {
        if (T < pts[i + 1] || i === pts.length - 2) return { i, q: clamp((T - pts[i]) / (pts[i + 1] - pts[i]), 0, 1) };
      }
    }
  }
  const n = Math.max(1, Math.round(count));
  const x = c.p * n;
  const i = Math.min(n - 1, Math.floor(x));
  return { i, q: x - i };
}

const defs: FxDef[] = [
  /* ------------------------------ ZOOMS ------------------------------ */
  {
    type: 'zoomIn',
    name: 'Zoom In',
    cat: 'zoom',
    icon: '🔍',
    desc: 'Push-in on a real bezier. Default is the smooth S-curve — zero speed at both ends, so it never pops.',
    dur: 0.6,
    params: [r('amount', 'Amount', 0.05, 2, 0.01, 0.32), sel('ease', 'Easing', EASE_OPTS, 'good'), r('blur', 'Zoom blur', 0, 4, 0.05, 1.3), r('rise', 'Rise', 0, 1, 0.01, 0.2), ...CENTER],
    apply: (s, c) => applyZoom(s, c, zoomTo(num(c, 'amount', 0.32) * c.k, 'in', (q) => zEase(str(c, 'ease', 'good'), q))),
  },
  {
    type: 'zoomOut',
    name: 'Zoom Out',
    cat: 'zoom',
    icon: '🔭',
    desc: 'Starts zoomed and eases back to normal on the same curve, so the pull-out settles instead of stopping dead.',
    dur: 0.6,
    params: [r('amount', 'Amount', 0.05, 2, 0.01, 0.32), sel('ease', 'Easing', EASE_OPTS, 'good'), r('blur', 'Zoom blur', 0, 4, 0.05, 1.3), ...CENTER],
    apply: (s, c) => applyZoom(s, c, zoomTo(num(c, 'amount', 0.32) * c.k, 'out', (q) => zEase(str(c, 'ease', 'good'), q))),
  },
  {
    type: 'smoothZoom',
    name: 'Good Zoom',
    cat: 'zoom',
    icon: '🎯',
    desc: 'The edit zoom. Flat at the start, fast through the middle, long cushioned settle. Blur only while it is actually moving.',
    dur: 0.62,
    params: [
      r('amount', 'Amount', 0.08, 1.6, 0.01, 0.34),
      sel('dir', 'Direction', [['in', 'In'], ['out', 'Out']], 'in'),
      r('blur', 'Zoom blur', 0, 4, 0.05, 1.5),
      r('rise', 'Rise', 0, 1, 0.01, 0.35),
      ...CENTER,
    ],
    apply: (s, c) => applyZoom(s, c, zoomTo(num(c, 'amount', 0.34) * c.k, str(c, 'dir', 'in'), Z.good)),
  },
  {
    type: 'flowZoom',
    name: 'Silk Push',
    cat: 'zoom',
    icon: '🌊',
    desc: 'Slow cinematic push. Almost no acceleration, a long settle, and a slight rise so it does not feel locked to the frame.',
    dur: 1.6,
    params: [
      r('amount', 'Amount', 0.04, 0.8, 0.01, 0.16),
      sel('dir', 'Direction', [['in', 'In'], ['out', 'Out']], 'in'),
      r('blur', 'Zoom blur', 0, 2, 0.05, 0.35),
      r('rise', 'Rise', 0, 1.5, 0.01, 0.7),
      ...CENTER,
    ],
    apply: (s, c) => applyZoom(s, c, zoomTo(num(c, 'amount', 0.16) * c.k, str(c, 'dir', 'in'), Z.silk)),
  },
  {
    type: 'snapZoom',
    name: 'Snap Zoom',
    cat: 'zoom',
    icon: '💥',
    desc: 'Hits on the first frames, then coasts to a stop. Put the start of this on the beat.',
    dur: 0.4,
    params: [
      r('amount', 'Amount', 0.1, 1.8, 0.01, 0.42),
      sel('dir', 'Direction', [['in', 'In'], ['out', 'Out']], 'in'),
      r('blur', 'Zoom blur', 0, 4, 0.05, 2.1),
      ...CENTER,
    ],
    apply: (s, c) => applyZoom(s, c, zoomTo(num(c, 'amount', 0.42) * c.k, str(c, 'dir', 'in'), Z.snap)),
  },
  {
    type: 'crashZoom',
    name: 'Crash Zoom',
    cat: 'zoom',
    icon: '🚀',
    desc: 'Short and violent. Huge push, maximum zoom blur, still eases to a stop so the next frame is clean.',
    dur: 0.2,
    params: [
      r('amount', 'Amount', 0.3, 2.5, 0.01, 0.95),
      sel('dir', 'Direction', [['in', 'In'], ['out', 'Out']], 'in'),
      r('blur', 'Zoom blur', 0, 4, 0.05, 3.2),
      ...CENTER,
    ],
    apply: (s, c) => applyZoom(s, c, zoomTo(num(c, 'amount', 0.95) * c.k, str(c, 'dir', 'in'), Z.crash)),
  },
  {
    type: 'landZoom',
    name: 'Land on Beat',
    cat: 'zoom',
    icon: '🎯',
    desc: 'Barely moves, then arrives. Put the end of this on the beat — the landing is soft, not a hard stop.',
    dur: 0.55,
    params: [
      r('amount', 'Amount', 0.1, 1.6, 0.01, 0.4),
      sel('dir', 'Direction', [['in', 'In'], ['out', 'Out']], 'in'),
      r('blur', 'Zoom blur', 0, 4, 0.05, 1.8),
      ...CENTER,
    ],
    apply: (s, c) => applyZoom(s, c, zoomTo(num(c, 'amount', 0.4) * c.k, str(c, 'dir', 'in'), Z.land)),
  },
  {
    type: 'whipZoom',
    name: 'Whip Zoom',
    cat: 'zoom',
    icon: '⚡',
    desc: 'Slow wind-up, then it rips in and settles. The blur peaks only in the fast part.',
    dur: 0.5,
    params: [
      r('amount', 'Amount', 0.2, 2.2, 0.01, 0.72),
      sel('dir', 'Direction', [['in', 'In'], ['out', 'Out']], 'in'),
      r('blur', 'Zoom blur', 0, 4, 0.05, 2.3),
      ...CENTER,
    ],
    apply: (s, c) => applyZoom(s, c, zoomTo(num(c, 'amount', 0.72) * c.k, str(c, 'dir', 'in'), Z.whip)),
  },
  {
    type: 'hyperZoom',
    name: 'Hyper Zoom',
    cat: 'zoom',
    icon: '🌌',
    desc: 'The "super zoom": 100% → 300% in a handful of frames with 360° shutter streaking. Interpolated exponentially so it accelerates the whole way instead of stalling.',
    dur: 0.14,
    params: [
      r('amount', 'Amount', 0.5, 4, 0.05, 2),
      sel('dir', 'Direction', [['in', 'In'], ['out', 'Out']], 'in'),
      r('blur', 'Zoom blur', 0, 4, 0.05, 3.4),
      ...CENTER,
    ],
    apply: (s, c) => applyZoom(s, c, zoomTo(num(c, 'amount', 2) * c.k, str(c, 'dir', 'in'), Z.crash)),
  },
  {
    type: 'dollyZoom',
    name: 'Dolly Zoom',
    cat: 'zoom',
    icon: '🎭',
    desc: 'Hitchcock/vertigo: the frame scales one way while the lens warps the other, so the subject holds size while the background stretches. Lens distortion peaks in the middle.',
    dur: 0.7,
    params: [
      r('amount', 'Scale', 0.05, 1, 0.01, 0.3),
      r('lens', 'Lens counter-warp', 0, 1, 0.01, 0.55),
      r('blur', 'Zoom blur', 0, 2, 0.05, 0.6),
      ...CENTER,
    ],
    apply: (s, c) => {
      const cx = num(c, 'cx', 0.5);
      const cy = num(c, 'cy', 0.5);
      // Scale eases in while the lens bows out then flattens — the two fight,
      // which is what produces the background-stretch vertigo feel.
      applyZoom(s, c, zoomTo(num(c, 'amount', 0.3) * c.k, 'in', Z.good));
      addLens(s, num(c, 'lens', 0.55) * c.k * Math.sin(Math.PI * c.p), cx, cy);
    },
  },
  {
    type: 'microPush',
    name: 'Micro Push',
    cat: 'zoom',
    icon: '🫧',
    desc: 'A 2–5% scale push. Real editors layer this under almost every cut and transition to add depth without the zoom being visible. Peaks aligned with your motion.',
    dur: 1.2,
    params: [
      r('amount', 'Amount', 0.01, 0.12, 0.005, 0.04),
      sel('dir', 'Direction', [['in', 'In'], ['out', 'Out']], 'in'),
      r('rise', 'Rise', 0, 1, 0.01, 0.3),
      ...CENTER,
    ],
    apply: (s, c) => applyZoom(s, c, zoomTo(num(c, 'amount', 0.04) * c.k, str(c, 'dir', 'in'), Z.silk)),
  },
  {
    type: 'heroZoom',
    name: 'Hero Zoom',
    cat: 'zoom',
    icon: '🦸',
    desc: 'Two moves in one: a slow push, then a snap. The snap point is where the character lands.',
    dur: 0.85,
    params: [
      r('amount', 'Amount', 0.15, 1.8, 0.01, 0.6),
      r('snap', 'Snap point', 0.4, 0.85, 0.01, 0.68),
      r('blur', 'Zoom blur', 0, 4, 0.05, 1.6),
      r('rise', 'Rise', 0, 1, 0.01, 0.25),
      ...CENTER,
    ],
    apply: (s, c) => {
      const cut = num(c, 'snap', 0.68);
      const curve = (q: number) => (q <= cut ? 0.4 * Z.silk(q / cut) : 0.4 + 0.6 * Z.snap((q - cut) / (1 - cut)));
      applyZoom(s, c, zoomTo(num(c, 'amount', 0.6) * c.k, 'in', curve));
    },
  },
  {
    type: 'pulseZoom',
    name: 'Pulse Zoom',
    cat: 'zoom',
    icon: '💗',
    desc: 'In and back out on one beat. Fast in, smooth out, and the turnaround has no kink.',
    dur: 0.46,
    params: [
      r('amount', 'Amount', 0.05, 1.2, 0.01, 0.26),
      r('attack', 'In / out split', 0.12, 0.5, 0.01, 0.28),
      r('blur', 'Zoom blur', 0, 4, 0.05, 1.5),
      ...CENTER,
    ],
    apply: (s, c) => {
      const at = num(c, 'attack', 0.28);
      const peak = 1 + num(c, 'amount', 0.26) * c.k;
      const curve = (q: number) => (q < at ? Z.snap(q / at) : Z.silk(1 - (q - at) / (1 - at)));
      // Exponential both ways so the in and out legs feel equally weighted.
      applyZoom(s, c, (q) => expZoom(1, peak, curve(q)));
    },
  },
  {
    type: 'zoomPunch',
    name: 'Zoom Punch',
    cat: 'zoom',
    icon: '👊',
    desc: 'Beat hit. Snaps in, overshoots a touch, then eases back. Not a symmetric bounce.',
    dur: 0.36,
    params: [r('amount', 'Amount', 0.05, 1.5, 0.01, 0.3), r('attack', 'Peak', 0.08, 0.5, 0.01, 0.22), r('blur', 'Zoom blur', 0, 4, 0.05, 1.7), ...CENTER],
    apply: (s, c) => {
      const peak = 1 + num(c, 'amount', 0.3) * c.k;
      const at = num(c, 'attack', 0.22);
      // Overshoot past the target then settle back, both in log space.
      const curve = (q: number) => (q < at ? Z.over(q / at) : Z.silk(1 - (q - at) / (1 - at)));
      applyZoom(s, c, (q) => expZoom(1, peak, curve(q)));
    },
  },
  {
    type: 'microwave',
    name: 'Microwave',
    cat: 'zoom',
    icon: '🍿',
    desc: 'Microwave-edit pulses: side slam with reflect edges + zoom pulse on every beat (or N pulses).',
    dur: 2,
    params: [
      sel('mode', 'Sync', [['beats', 'Beat markers'], ['even', 'Even pulses']], 'beats'),
      r('count', 'Pulses (even)', 1, 16, 1, 4),
      r('zoom', 'Zoom pulse', 0, 0.6, 0.01, 0.16),
      r('slide', 'Side slam', 0, 1.2, 0.01, 0.55),
      r('flicker', 'Flicker', 0, 1, 0.01, 0.3),
    ],
    apply: (s, c) => {
      const { i, q } = segmentAt(c, str(c, 'mode', 'beats'), num(c, 'count', 4));
      const dir = i % 2 === 0 ? -1 : 1;
      const slide = num(c, 'slide', 0.55) * c.k * (1 - ease('outCubic', q / 0.38)) * dir;
      geoTranslate(s, slide, 0);
      const zq = q < 0.5 ? 0 : q < 0.84 ? ease('smooth', (q - 0.5) / 0.34) : 1 - ease('smooth', (q - 0.84) / 0.16);
      geoZoom(s, 1 + num(c, 'zoom', 0.16) * c.k * zq);
      const fl = num(c, 'flicker', 0.3) * c.k;
      if (fl > 0) s.exposure += fl * 0.35 * (hash1(Math.floor(c.T * 24), c.seed) - 0.5) * 2;
      geoTranslate(s, noise1(c.T * 9, c.seed) * 0.004 * c.k, noise1(c.T * 9, c.seed + 3) * 0.004 * c.k);
    },
  },
  {
    type: 'zoomBounce',
    name: 'Bounce In',
    cat: 'zoom',
    icon: '🏀',
    desc: 'Lands from a big zoom with an elastic wobble.',
    dur: 0.8,
    params: [r('amount', 'Amount', 0.05, 1.5, 0.01, 0.4), r('blur', 'Zoom blur', 0, 3, 0.05, 0.8), ...CENTER],
    apply: (s, c) => {
      const a = num(c, 'amount', 0.4) * c.k;
      applyZoom(s, c, (q) => Math.max(0.2, 1 + a * (1 - ease('elastic', q))));
    },
  },
  {
    type: 'zoomBlur',
    name: 'Zoom Blur',
    cat: 'zoom',
    icon: '💫',
    desc: 'Radial speed blur without moving the frame.',
    dur: 0.4,
    params: [r('amount', 'Amount', 0, 0.6, 0.01, 0.18), sel('env', 'Envelope', ENV_OPTS, 'bell'), ...CENTER],
    apply: (s, c) => {
      addRadial(s, num(c, 'amount', 0.18) * c.k * envelope(str(c, 'env', 'bell'), c), num(c, 'cx', 0.5), num(c, 'cy', 0.5));
    },
  },
  {
    type: 'kenBurns',
    name: 'Drift Push',
    cat: 'zoom',
    icon: '🎥',
    desc: 'A long silk push with a rise. Use it under a whole clip so the frame is never static.',
    dur: 2.8,
    params: [r('amount', 'Amount', 0.02, 0.5, 0.01, 0.14), r('rise', 'Rise', 0, 1.5, 0.01, 0.8), r('blur', 'Zoom blur', 0, 1.5, 0.05, 0.15), ...CENTER],
    apply: (s, c) => applyZoom(s, c, zoomTo(num(c, 'amount', 0.14) * c.k, 'in', Z.silk)),
  },

  /* --------------------------- TRANSITIONS --------------------------- */
  {
    type: 'zoomTrans',
    name: 'Zoom Through',
    cat: 'transition',
    icon: '🌀',
    desc: 'The pro zoom-through cut. Accelerates into the cut at peak velocity, decelerates out, with reverse lens distortion bowing the frame at the seam and mirrored edges filling the frame. Centre it on a cut.',
    dur: 0.46,
    transition: true,
    params: [
      r('amount', 'Amount', 0.2, 4, 0.05, 1.2),
      sel('dir', 'Direction', [['in', 'In'], ['out', 'Out']], 'in'),
      r('blur', 'Zoom blur', 0, 4, 0.05, 2),
      r('lens', 'Lens distortion', 0, 1, 0.01, 0.45),
      ...CENTER,
    ],
    apply: (s, c) => {
      const L = Math.log(1 + num(c, 'amount', 1.2) * c.k) * (str(c, 'dir', 'in') === 'in' ? 1 : -1);
      // Cut at peak velocity: accelerate in, decelerate out.
      applyZoom(s, c, (q) => Math.exp(L * transCurve(q)));
      // Lens warp bows hardest exactly at the cut, flat at both ends.
      const cx = num(c, 'cx', 0.5);
      const cy = num(c, 'cy', 0.5);
      addLens(s, num(c, 'lens', 0.45) * c.k * Math.pow(Math.sin(Math.PI * c.p), 1.5), cx, cy);
      // Mirrored edges fill the frame while the incoming clip is scaled past 100%.
      s.mirror = 1;
    },
  },
  {
    type: 'spinTrans',
    name: 'Spin',
    cat: 'transition',
    icon: '🔄',
    desc: '360° spin across the cut with rotational blur.',
    dur: 0.5,
    transition: true,
    params: [r('turns', 'Turns', 0.25, 3, 0.25, 1), sel('dir', 'Direction', [['cw', 'Clockwise'], ['ccw', 'Counter']], 'cw'), r('zoom', 'Zoom', 0, 1, 0.01, 0.3)],
    apply: (s, c) => {
      const A = num(c, 'turns', 1) * Math.PI * 2 * (str(c, 'dir', 'cw') === 'cw' ? 1 : -1) * c.k;
      geoRotate(s, (A / 2) * transCurve(c.p));
      geoZoom(s, 1 + num(c, 'zoom', 0.3) * Math.sin(Math.PI * c.p));
    },
  },
  {
    type: 'whipTrans',
    name: 'Whip Pan',
    cat: 'transition',
    icon: '💨',
    desc: 'Fast slide with directional motion blur and reflect edges.',
    dur: 0.4,
    transition: true,
    params: [sel('dir', 'Direction', [['left', 'Left'], ['right', 'Right'], ['up', 'Up'], ['down', 'Down']], 'left'), r('dist', 'Distance', 0.3, 2, 0.05, 1)],
    apply: (s, c) => {
      const d = num(c, 'dist', 1) * c.k * transCurve(c.p);
      const dir = str(c, 'dir', 'left');
      const v = dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : [0, 1];
      geoTranslate(s, v[0] * d, v[1] * d);
    },
  },
  {
    type: 'flashTrans',
    name: 'Flash Cut',
    cat: 'transition',
    icon: '⚡',
    desc: 'White flash peaking exactly on the cut.',
    dur: 0.4,
    transition: true,
    params: [col('color', 'Color', '#ffffff'), r('width', 'Softness', 0.1, 1, 0.01, 0.7)],
    apply: (s, c) => {
      const w = num(c, 'width', 0.7);
      const a = Math.pow(clamp(1 - (Math.abs(c.p - 0.5) * 2) / w, 0, 1), 2) * c.k;
      const [R, G, B] = hexToRgb(str(c, 'color', '#ffffff'));
      addFlash(s, R, G, B, a);
    },
  },
  {
    type: 'blurTrans',
    name: 'Blur Dissolve',
    cat: 'transition',
    icon: '🌫️',
    desc: 'Blurs out and back in around the cut.',
    dur: 0.6,
    transition: true,
    params: [r('amount', 'Amount', 0, 1, 0.01, 1), r('zoom', 'Zoom', 0, 0.4, 0.01, 0.08)],
    apply: (s, c) => {
      const e = Math.sin(Math.PI * c.p);
      s.blur = Math.max(s.blur, e * num(c, 'amount', 1) * c.k);
      s.blurRadius = Math.max(s.blurRadius, 0.035 * e);
      geoZoom(s, 1 + num(c, 'zoom', 0.08) * e);
    },
  },
  {
    type: 'glitchTrans',
    name: 'Glitch Cut',
    cat: 'transition',
    icon: '📺',
    desc: 'Digital tear + RGB split around the cut.',
    dur: 0.4,
    transition: true,
    params: [r('amount', 'Amount', 0, 1, 0.01, 0.8)],
    apply: (s, c) => {
      const e = Math.pow(Math.sin(Math.PI * c.p), 0.7) * num(c, 'amount', 0.8) * c.k;
      s.glitch += e;
      s.rgbSplit += 16 * e;
      const h = hash1(Math.floor(c.T * 20), c.seed);
      if (h < e * 0.5) geoTranslate(s, (hash1(Math.floor(c.T * 20), c.seed + 1) - 0.5) * 0.12 * e, 0);
    },
  },

  /* ----------------------------- MOTION ------------------------------ */
  {
    type: 'shake',
    name: 'Shake',
    cat: 'motion',
    icon: '📳',
    desc: 'Camera shake with rotation and motion blur.',
    dur: 0.6,
    params: [r('amount', 'Amount', 0, 1.5, 0.01, 0.35), r('freq', 'Frequency', 1, 40, 0.5, 14), r('rot', 'Rotation', 0, 1, 0.01, 0.3), bo('decay', 'Decay', false)],
    apply: (s, c) => {
      const env = (bool(c, 'decay', false) ? Math.pow(1 - c.p, 2) : 1) * edge(c.lt, c.dur, 0.04);
      const A = num(c, 'amount', 0.35) * c.k * env;
      const f = num(c, 'freq', 14);
      const t = c.lt + c.seed * 0.013;
      geoZoom(s, 1 + 0.1 * A);
      geoTranslate(s, noise1(t * f, c.seed) * 0.05 * A, noise1(t * f, c.seed + 17) * 0.05 * A);
      geoRotate(s, noise1(t * f * 0.8, c.seed + 33) * 0.07 * num(c, 'rot', 0.3) * A);
    },
  },
  {
    type: 'impact',
    name: 'Impact',
    cat: 'motion',
    icon: '💥',
    desc: 'Heavy decaying shake with a zoom slam — made for drops.',
    dur: 0.7,
    params: [r('amount', 'Amount', 0, 1.5, 0.01, 0.8), r('freq', 'Frequency', 4, 40, 0.5, 22), r('punch', 'Punch', 0, 0.6, 0.01, 0.18)],
    apply: (s, c) => {
      const A = num(c, 'amount', 0.8) * c.k * Math.pow(1 - c.p, 2.2);
      const f = num(c, 'freq', 22);
      const t = c.lt + c.seed * 0.013;
      const pu = num(c, 'punch', 0.18) * c.k;
      const q = c.lt / 0.3;
      geoZoom(s, 1 + 0.12 * A + pu * (q < 0.2 ? ease('outCubic', q / 0.2) : 1 - ease('cubic', (q - 0.2) / 0.8)) * (q < 1 ? 1 : 0));
      geoTranslate(s, noise1(t * f, c.seed) * 0.07 * A, noise1(t * f, c.seed + 9) * 0.07 * A);
      geoRotate(s, noise1(t * f * 0.7, c.seed + 5) * 0.06 * A);
    },
  },
  {
    type: 'wiggle',
    name: 'Swing',
    cat: 'motion',
    icon: '🎐',
    desc: 'Pendulum rotation wobble.',
    dur: 1,
    params: [r('angle', 'Angle', 1, 40, 0.5, 8), r('freq', 'Frequency', 0.5, 10, 0.1, 2.5), bo('decay', 'Decay', true)],
    apply: (s, c) => {
      const a = ((num(c, 'angle', 8) * Math.PI) / 180) * c.k * (bool(c, 'decay', true) ? 1 - c.p : 1) * edge(c.lt, c.dur, 0.05);
      const rr = Math.sin(2 * Math.PI * num(c, 'freq', 2.5) * c.lt) * a;
      geoRotate(s, rr);
      geoZoom(s, 1 + Math.abs(rr) * 0.9);
    },
  },
  {
    type: 'handheld',
    name: 'Handheld',
    cat: 'motion',
    icon: '🤳',
    desc: 'Slow organic camera drift.',
    dur: 3,
    params: [r('amount', 'Amount', 0, 2, 0.01, 0.5)],
    apply: (s, c) => {
      const A = num(c, 'amount', 0.5) * c.k;
      geoZoom(s, 1 + 0.05 * A);
      geoTranslate(s, noise1(c.T * 0.9, c.seed) * 0.018 * A, noise1(c.T * 0.8, c.seed + 7) * 0.018 * A);
      geoRotate(s, noise1(c.T * 0.6, c.seed + 13) * 0.012 * A);
    },
  },
  {
    type: 'spin',
    name: 'Spin 360',
    cat: 'motion',
    icon: '🌪️',
    desc: 'Full eased rotation inside the range.',
    dur: 0.7,
    params: [r('turns', 'Turns', 0.25, 4, 0.25, 1), sel('ease', 'Easing', EASE_OPTS, 'expo'), sel('dir', 'Direction', [['cw', 'Clockwise'], ['ccw', 'Counter']], 'cw')],
    apply: (s, c) => {
      const A = num(c, 'turns', 1) * Math.PI * 2 * (str(c, 'dir', 'cw') === 'cw' ? 1 : -1) * c.k;
      geoRotate(s, A * ease(str(c, 'ease', 'expo'), c.p));
      geoZoom(s, 1 + 0.25 * Math.sin(Math.PI * c.p));
    },
  },
  {
    type: 'bounce',
    name: 'Bounce',
    cat: 'motion',
    icon: '⤴️',
    desc: 'Vertical bounces with decay.',
    dur: 0.8,
    params: [r('height', 'Height', 0, 0.3, 0.005, 0.07), r('count', 'Bounces', 1, 6, 1, 2)],
    apply: (s, c) => {
      geoZoom(s, 1 + num(c, 'height', 0.07) * 1.2 * c.k);
      geoTranslate(s, 0, -Math.abs(Math.sin(Math.PI * num(c, 'count', 2) * c.p)) * num(c, 'height', 0.07) * c.k * (1 - c.p));
    },
  },
  {
    type: 'slideIn',
    name: 'Slide In',
    cat: 'motion',
    icon: '➡️',
    desc: 'Frame slams in from the side (reflect edges).',
    dur: 0.35,
    params: [sel('dir', 'From', [['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']], 'left'), r('dist', 'Distance', 0.2, 1.5, 0.05, 0.8)],
    apply: (s, c) => {
      const d = (1 - ease('outExpo', c.p)) * num(c, 'dist', 0.8) * c.k;
      const dir = str(c, 'dir', 'left');
      const v = dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'top' ? [0, -1] : [0, 1];
      geoTranslate(s, v[0] * d, v[1] * d);
    },
  },

  /* ------------------------------ LIGHT ------------------------------ */
  {
    type: 'flash',
    name: 'Flash',
    cat: 'light',
    icon: '⚪',
    desc: 'Colour flash overlay.',
    dur: 0.25,
    params: [col('color', 'Color', '#ffffff'), r('amount', 'Opacity', 0, 1, 0.01, 1), sel('env', 'Envelope', ENV_OPTS, 'fadeOut')],
    apply: (s, c) => {
      const [R, G, B] = hexToRgb(str(c, 'color', '#ffffff'));
      addFlash(s, R, G, B, num(c, 'amount', 1) * c.k * envelope(str(c, 'env', 'fadeOut'), c));
    },
  },
  {
    type: 'strobe',
    name: 'Strobe',
    cat: 'light',
    icon: '🚨',
    desc: 'Rapid on/off strobing.',
    dur: 0.5,
    params: [r('freq', 'Frequency', 2, 30, 0.5, 10), sel('mode', 'Mode', [['white', 'White'], ['black', 'Black'], ['invert', 'Invert'], ['color', 'Color']], 'white'), col('color', 'Color', '#ff1a2e')],
    apply: (s, c) => {
      if (Math.floor(c.lt * num(c, 'freq', 10) * 2) % 2 !== 0) return;
      const m = str(c, 'mode', 'white');
      if (m === 'white') addFlash(s, 1, 1, 1, 0.85 * c.k);
      else if (m === 'black') addFlash(s, 0, 0, 0, 0.95 * c.k);
      else if (m === 'invert') s.invert = Math.max(s.invert, c.k);
      else {
        const [R, G, B] = hexToRgb(str(c, 'color', '#ff1a2e'));
        addFlash(s, R, G, B, 0.7 * c.k);
      }
    },
  },
  {
    type: 'invert',
    name: 'Invert',
    cat: 'light',
    icon: '🔳',
    desc: 'Negative colours — hold or flicker.',
    dur: 0.2,
    params: [sel('mode', 'Mode', [['hold', 'Hold'], ['flicker', 'Flicker']], 'hold'), r('freq', 'Flicker rate', 2, 30, 0.5, 12)],
    apply: (s, c) => {
      if (str(c, 'mode', 'hold') === 'flicker' && Math.floor(c.lt * num(c, 'freq', 12) * 2) % 2 !== 0) return;
      s.invert = Math.max(s.invert, c.k);
    },
  },
  {
    type: 'glow',
    name: 'Glow',
    cat: 'light',
    icon: '✨',
    desc: 'Dreamy highlight bloom.',
    dur: 2,
    params: [r('amount', 'Amount', 0, 2, 0.01, 0.9), r('threshold', 'Threshold', 0, 0.95, 0.01, 0.5), r('radius', 'Radius', 0.004, 0.08, 0.001, 0.025), sel('env', 'Envelope', ENV_OPTS, 'hold')],
    apply: (s, c) => {
      s.glow += num(c, 'amount', 0.9) * c.k * envelope(str(c, 'env', 'hold'), c);
      s.glowThreshold = num(c, 'threshold', 0.5);
      s.blurRadius = Math.max(s.blurRadius, num(c, 'radius', 0.025));
    },
  },
  {
    type: 'exposure',
    name: 'Exposure Hit',
    cat: 'light',
    icon: '☀️',
    desc: 'Brightness punch that fades.',
    dur: 0.3,
    params: [r('amount', 'Stops', -3, 3, 0.05, 1.2), sel('env', 'Envelope', ENV_OPTS, 'fadeOut')],
    apply: (s, c) => {
      s.exposure += num(c, 'amount', 1.2) * c.k * envelope(str(c, 'env', 'fadeOut'), c);
    },
  },
  {
    type: 'bw',
    name: 'Black & White',
    cat: 'light',
    icon: '🖤',
    desc: 'Desaturate a section (with contrast boost).',
    dur: 1,
    params: [r('amount', 'Amount', 0, 1, 0.01, 1), r('contrast', 'Contrast', 0, 1, 0.01, 0.3), sel('env', 'Envelope', ENV_OPTS, 'hold')],
    apply: (s, c) => {
      const e = envelope(str(c, 'env', 'hold'), c) * c.k;
      s.bw = Math.max(s.bw, num(c, 'amount', 1) * e);
      s.contrast += num(c, 'contrast', 0.3) * e;
    },
  },
  {
    type: 'hueShift',
    name: 'Hue Shift',
    cat: 'light',
    icon: '🌈',
    desc: 'Rotate colours, optionally animated.',
    dur: 1,
    params: [r('deg', 'Degrees', -180, 180, 1, 120), bo('animate', 'Animate', true)],
    apply: (s, c) => {
      s.hue += num(c, 'deg', 120) * c.k * (bool(c, 'animate', true) ? c.p : 1);
    },
  },

  /* ------------------------- GLITCH / STYLIZE ------------------------ */
  {
    type: 'rgbSplit',
    name: 'RGB Split',
    cat: 'glitch',
    icon: '🟥',
    desc: 'Chromatic aberration.',
    dur: 0.35,
    params: [r('amount', 'Amount (px)', 0, 60, 0.5, 14), r('angle', 'Angle', 0, 360, 1, 0), sel('env', 'Envelope', [...ENV_OPTS, ['jitter', 'Jitter']], 'fadeOut')],
    apply: (s, c) => {
      s.rgbSplit += num(c, 'amount', 14) * c.k * envelope(str(c, 'env', 'fadeOut'), c);
      s.rgbAngle = (num(c, 'angle', 0) * Math.PI) / 180;
    },
  },
  {
    type: 'glitch',
    name: 'Glitch',
    cat: 'glitch',
    icon: '👾',
    desc: 'Slice displacement, RGB tearing, frame jumps.',
    dur: 0.5,
    params: [r('amount', 'Amount', 0, 1, 0.01, 0.6), r('rgb', 'RGB tear', 0, 40, 0.5, 10), sel('env', 'Envelope', ENV_OPTS, 'hold')],
    apply: (s, c) => {
      const A = num(c, 'amount', 0.6) * c.k * envelope(str(c, 'env', 'hold'), c);
      s.glitch += A;
      const j = hash1(Math.floor(c.T * 14), c.seed);
      s.rgbSplit += num(c, 'rgb', 10) * A * (0.3 + j);
      if (j > 1 - A * 0.45) geoTranslate(s, (hash1(Math.floor(c.T * 14), c.seed + 3) - 0.5) * 0.08 * A, 0);
    },
  },
  {
    type: 'vhs',
    name: 'VHS',
    cat: 'glitch',
    icon: '📼',
    desc: 'Scanlines, noise, colour bleed and tape wobble.',
    dur: 2,
    params: [r('amount', 'Amount', 0, 1, 0.01, 0.7)],
    apply: (s, c) => {
      const A = num(c, 'amount', 0.7) * c.k;
      s.scanlines += 0.7 * A;
      s.grain += 0.3 * A;
      s.rgbSplit += 5 * A;
      s.saturation -= 0.25 * A;
      s.contrast += 0.1 * A;
      s.glitch += 0.08 * A;
      geoTranslate(s, noise1(c.T * 3, c.seed) * 0.004 * A, 0);
    },
  },
  {
    type: 'pixelate',
    name: 'Pixelate',
    cat: 'glitch',
    icon: '🧱',
    desc: 'Mosaic blocks.',
    dur: 0.5,
    params: [r('size', 'Block size', 2, 120, 1, 28), sel('env', 'Envelope', ENV_OPTS, 'bell')],
    apply: (s, c) => {
      s.pixelate = Math.max(s.pixelate, num(c, 'size', 28) * c.k * envelope(str(c, 'env', 'bell'), c));
    },
  },
  {
    type: 'verse',
    name: 'Verse Comic',
    cat: 'glitch',
    icon: '🕸️',
    desc: 'Spider-Verse look: halftone dots, ink lines, offset print colours.',
    dur: 2,
    params: [r('amount', 'Amount', 0, 1, 0.01, 0.85), r('dots', 'Dot size', 4, 28, 0.5, 9), r('ink', 'Ink lines', 0, 1, 0.01, 0.6)],
    apply: (s, c) => {
      const A = num(c, 'amount', 0.85) * c.k;
      s.halftone = Math.max(s.halftone, 0.85 * A);
      s.halftoneSize = num(c, 'dots', 9);
      if (A > 0.2) s.posterize = Math.max(s.posterize, 7);
      s.edges += num(c, 'ink', 0.6) * A;
      s.rgbSplit += 6 * A;
      s.rgbAngle = 0.6;
      s.saturation += 0.3 * A;
      s.contrast += 0.15 * A;
    },
  },
  {
    type: 'halftone',
    name: 'Halftone',
    cat: 'glitch',
    icon: '⚫',
    desc: 'Print-style dot shading.',
    dur: 1,
    params: [r('amount', 'Amount', 0, 1, 0.01, 0.8), r('size', 'Dot size', 3, 30, 0.5, 8)],
    apply: (s, c) => {
      s.halftone = Math.max(s.halftone, num(c, 'amount', 0.8) * c.k);
      s.halftoneSize = num(c, 'size', 8);
    },
  },
  {
    type: 'posterize',
    name: 'Posterize',
    cat: 'glitch',
    icon: '🎨',
    desc: 'Reduce colour levels.',
    dur: 1,
    params: [r('levels', 'Levels', 2, 16, 1, 5)],
    apply: (s, c) => {
      if (c.k > 0.05) s.posterize = Math.max(s.posterize, num(c, 'levels', 5));
    },
  },
  {
    type: 'ink',
    name: 'Ink Lines',
    cat: 'glitch',
    icon: '✒️',
    desc: 'Comic outline edges.',
    dur: 1,
    params: [r('amount', 'Amount', 0, 1, 0.01, 0.7)],
    apply: (s, c) => {
      s.edges += num(c, 'amount', 0.7) * c.k;
    },
  },
  {
    type: 'grain',
    name: 'Film Grain',
    cat: 'glitch',
    icon: '🎞️',
    desc: 'Animated film grain.',
    dur: 3,
    params: [r('amount', 'Amount', 0, 1, 0.01, 0.35)],
    apply: (s, c) => {
      s.grain += num(c, 'amount', 0.35) * c.k;
    },
  },
  {
    type: 'vignette',
    name: 'Vignette',
    cat: 'glitch',
    icon: '⭕',
    desc: 'Darkened edges.',
    dur: 3,
    params: [r('amount', 'Amount', 0, 1, 0.01, 0.6)],
    apply: (s, c) => {
      s.vignette = Math.max(s.vignette, num(c, 'amount', 0.6) * c.k);
    },
  },
  {
    type: 'letterbox',
    name: 'Cinema Bars',
    cat: 'glitch',
    icon: '🎬',
    desc: 'Animated letterbox bars.',
    dur: 3,
    params: [r('size', 'Bar size', 0, 0.3, 0.005, 0.11), bo('animate', 'Slide in/out', true)],
    apply: (s, c) => {
      const e = bool(c, 'animate', true) ? ease('cubic', Math.min(c.lt / 0.4, (c.dur - c.lt) / 0.4, 1)) : 1;
      s.letterbox = Math.max(s.letterbox, num(c, 'size', 0.11) * c.k * e);
    },
  },
  {
    type: 'mirror',
    name: 'Mirror',
    cat: 'glitch',
    icon: '🪞',
    desc: 'Symmetric mirror split.',
    dur: 1,
    params: [],
    apply: (s, c) => {
      if (c.k > 0.05) s.mirror = 1;
    },
  },
  {
    type: 'echo',
    name: 'Echo Trails',
    cat: 'glitch',
    icon: '👻',
    desc: 'Ghosting frame trails.',
    dur: 1.5,
    params: [r('amount', 'Amount', 0, 0.95, 0.01, 0.75)],
    apply: (s, c) => {
      s.echo = Math.max(s.echo, num(c, 'amount', 0.75) * c.k * edge(c.lt, c.dur, 0.1));
    },
  },
  {
    type: 'blur',
    name: 'Blur',
    cat: 'glitch',
    icon: '💧',
    desc: 'Gaussian blur.',
    dur: 0.6,
    params: [r('amount', 'Amount', 0, 1, 0.01, 1), r('radius', 'Radius', 0.002, 0.06, 0.001, 0.02), sel('env', 'Envelope', ENV_OPTS, 'bell')],
    apply: (s, c) => {
      s.blur = Math.max(s.blur, num(c, 'amount', 1) * c.k * envelope(str(c, 'env', 'bell'), c));
      s.blurRadius = Math.max(s.blurRadius, num(c, 'radius', 0.02));
    },
  },

  /* ------------------------------- TIME ------------------------------ */
  {
    type: 'freeze',
    name: 'Freeze Frame',
    cat: 'time',
    icon: '🧊',
    desc: 'Holds the frame at the start of the range.',
    dur: 0.8,
    params: [bo('bw', 'Black & white', false), r('push', 'Slow push', 0, 0.4, 0.01, 0.06), bo('flash', 'Flash on hit', true)],
    remap: () => [0, 0],
    apply: (s, c) => {
      if (bool(c, 'bw', false)) s.bw = Math.max(s.bw, c.k);
      const push = num(c, 'push', 0.06);
      if (push > 0) geoZoom(s, 1 + push * c.k * ease('outCubic', c.p));
      if (bool(c, 'flash', true)) addFlash(s, 1, 1, 1, Math.pow(1 - clamp(c.lt / 0.22, 0, 1), 2) * c.k);
    },
  },
  {
    type: 'stutter',
    name: 'Stutter',
    cat: 'time',
    icon: '🔁',
    desc: 'Loops a tiny slice repeatedly.',
    dur: 0.5,
    params: [r('loop', 'Loop length (s)', 0.03, 0.5, 0.01, 0.1)],
    remap: (lt, _d, P) => [lt % Math.max(0.02, pn(P, 'loop', 0.1)), 1],
  },
  {
    type: 'rewind',
    name: 'Rewind',
    cat: 'time',
    icon: '⏪',
    desc: 'Plays forward, then rewinds back to the start.',
    dur: 1,
    params: [],
    remap: (lt, dur) => (lt < dur / 2 ? [lt, 1] : [dur - lt, -1]),
  },
  {
    type: 'reverseSection',
    name: 'Reverse Section',
    cat: 'time',
    icon: '◀️',
    desc: 'Plays this part of the timeline backwards.',
    dur: 1,
    params: [],
    remap: (lt, dur) => [dur - lt, -1],
  },
  {
    type: 'slowSection',
    name: 'Slow-Mo Hold',
    cat: 'time',
    icon: '🐢',
    desc: 'Slows the section in place (skips ahead after).',
    dur: 1,
    params: [r('factor', 'Speed', 0.05, 0.9, 0.01, 0.35)],
    remap: (lt, _d, P) => {
      const f = pn(P, 'factor', 0.35);
      return [lt * f, f];
    },
  },

  /* ------------------------------- TEXT ------------------------------ */
  {
    type: 'text',
    name: 'Text',
    cat: 'text',
    icon: '🔤',
    desc: 'After Effects-style text layer: per-character animators, motion blur, deep glow, turbulent displace.',
    dur: 2,
    params: [
      ...grp('Text', [
        { key: 'text', label: 'Text', type: 'text', def: 'YOUR TEXT' },
        sel('font', 'Font', FONT_OPTS, 'bebas'),
        bo('uppercase', 'Uppercase', false),
        bo('italic', 'Italic', false),
        r('size', 'Size', 0.02, 0.4, 0.005, 0.12),
        r('tracking', 'Tracking', -0.1, 0.6, 0.005, 0.03),
        r('leading', 'Line height', 0.7, 2, 0.01, 1.05),
        r('x', 'Position X', 0, 1, 0.005, 0.5),
        r('y', 'Position Y', 0, 1, 0.005, 0.5),
        bo('camera', 'Follow camera (shakes & zooms)', true),
      ]),
      ...grp('Fill & outline', [
        sel('style', 'Fill', [
          ['plain', 'Solid'],
          ['gradient', 'Gradient'],
          ['chrome', 'Chrome'],
          ['stamp', 'Hollow outline'],
          ['subtitle', 'Boxed'],
        ], 'plain'),
        col('color', 'Color', '#ffffff'),
        col('color2', 'Second color', '#8bd3ff'),
        bo('stroke', 'Outline', false),
        r('strokeWidth', 'Outline width', 0, 0.2, 0.005, 0.06),
        col('strokeColor', 'Outline color', '#050505'),
      ]),
      ...grp('Animate in', [
        sel('anim', 'Animator', TEXT_IN, 'impact'),
        r('inDur', 'Duration', 0, 1.5, 0.01, 0.35),
        sel('order', 'Order', [['forward', 'Left → right'], ['reverse', 'Right → left'], ['center', 'Centre out'], ['edges', 'Edges in'], ['random', 'Random']], 'forward'),
        r('smooth', 'Selector Smoothness', 0.02, 0.8, 0.01, 0.32),
      ]),
      ...grp('Animate out', [sel('animOut', 'Animator', TEXT_OUT, 'fade'), r('outDur', 'Duration', 0, 1.2, 0.01, 0.22)]),
      ...grp('Motion', [
        sel('drift', 'Drift', [['none', 'None'], ['push', 'Slow push'], ['track', 'Tracking expand'], ['float', 'Float up']], 'none'),
        r('driftAmt', 'Drift amount', 0, 2, 0.01, 1),
        sel('loop', 'Loop', [['none', 'None'], ['wave', 'Wave'], ['jitter', 'Jitter'], ['shake', 'Shake'], ['flicker', 'Flicker'], ['breath', 'Breathe']], 'none'),
        r('loopAmt', 'Loop amount', 0, 2, 0.01, 1),
        r('mblur', 'Motion blur', 0, 2, 0.05, 1),
      ]),
      ...grp('Glow & look', [
        r('glowAmt', 'Deep glow', 0, 2, 0.01, 0),
        r('glowRadius', 'Glow radius', 0.2, 3, 0.01, 1),
        col('glowColor', 'Glow color', '#6f9cff'),
        r('rgbSplit', 'RGB split', 0, 1, 0.01, 0),
        r('shadow', 'Drop shadow', 0, 2, 0.01, 0),
        r('depth', 'Layered depth', 0, 1, 0.01, 0),
      ]),
      ...grp('Turbulent displace', [
        r('turbAmount', 'Amount', 0, 80, 0.5, 0),
        r('turbSize', 'Size', 3, 180, 1, 35),
        r('turbComplexity', 'Complexity', 1, 5, 0.1, 2),
        r('turbEvolution', 'Evolution speed', 0, 12, 0.1, 2),
        r('turbFps', 'Evolution FPS (0 = smooth)', 0, 24, 1, 0),
        sel('turbEnv', 'Timing', [['hold', 'Constant'], ['impact', 'Impact decay'], ['in', 'Build in'], ['out', 'Fade out']], 'hold'),
      ]),
    ],
    apply: (s, c) => {
      const raw = str(c, 'text', 'YOUR TEXT');
      const fd = FONT_DEFS[str(c, 'font', 'bebas')] ?? FONT_DEFS.bebas;
      const animName = str(c, 'anim', 'impact');
      let animIn = LEGACY_IN[animName] ?? animName;
      let loop = str(c, 'loop', 'none');
      if (animName === 'shake') {
        animIn = 'fade';
        if (loop === 'none') loop = 'shake';
      }
      const style = str(c, 'style', 'plain');
      const fill = style === 'gradient' || style === 'chrome' || style === 'stamp' || style === 'subtitle' ? style : 'plain';
      s.texts.push({
        text: bool(c, 'uppercase', false) ? raw.toUpperCase() : raw,
        family: fd.family,
        weight: fd.weight,
        italic: !!fd.italic || bool(c, 'italic', false),
        size: num(c, 'size', 0.12),
        tracking: num(c, 'tracking', 0.03),
        leading: num(c, 'leading', 1.05),
        x: num(c, 'x', 0.5),
        y: num(c, 'y', 0.5),
        camera: bool(c, 'camera', true),
        fill,
        color: str(c, 'color', '#ffffff'),
        color2: str(c, 'color2', '#8bd3ff'),
        strokeWidth: bool(c, 'stroke', false) || fill === 'stamp' ? num(c, 'strokeWidth', 0.06) : 0,
        strokeColor: str(c, 'strokeColor', '#050505'),
        animIn,
        inDur: num(c, 'inDur', 0.35),
        stagger: 0,
        order: str(c, 'order', 'forward'),
        smooth: num(c, 'smooth', 0.32),
        animOut: str(c, 'animOut', 'fade'),
        outDur: num(c, 'outDur', 0.22),
        drift: str(c, 'drift', 'none'),
        driftAmt: num(c, 'driftAmt', 1),
        loop,
        loopAmt: num(c, 'loopAmt', 1),
        mblur: num(c, 'mblur', 1),
        glow: Math.max(num(c, 'glowAmt', 0), bool(c, 'glow', false) ? 0.7 : 0),
        glowRadius: num(c, 'glowRadius', 1),
        glowColor: str(c, 'glowColor', '#6f9cff'),
        rgb: num(c, 'rgbSplit', 0),
        shadow: num(c, 'shadow', 0),
        depth: num(c, 'depth', 0),
        lt: c.lt,
        dur: c.dur,
        T: c.T,
        alpha: clamp(c.k, 0, 1),
        turbAmount:
          num(c, 'turbAmount', 0) *
          (str(c, 'turbEnv', 'hold') === 'impact'
            ? Math.exp(-5.5 * c.p)
            : str(c, 'turbEnv', 'hold') === 'in'
              ? ease('smooth', c.p)
              : str(c, 'turbEnv', 'hold') === 'out'
                ? 1 - ease('smooth', c.p)
                : 1),
        turbSize: num(c, 'turbSize', 35),
        turbComplexity: num(c, 'turbComplexity', 2),
        turbEvolution: num(c, 'turbEvolution', 2),
        turbFps: num(c, 'turbFps', 0),
        seed: c.seed,
      });
    },
  },
];

export const FX_DEFS: Record<string, FxDef> = Object.fromEntries(defs.map((d) => [d.type, d]));

export function defaultParams(def: FxDef): Record<string, ParamValue> {
  const o: Record<string, ParamValue> = {};
  for (const p of def.params) o[p.key] = p.def;
  return o;
}

/* ------------------------------------------------------------------ */
/* Library (what the FX panel shows) and combos                         */
/* ------------------------------------------------------------------ */
export interface LibEntry {
  id: string;
  type: string;
  name: string;
  icon: string;
  desc: string;
  cat: FxCategory;
  params?: Record<string, ParamValue>;
  /** Multiple independently animated text layers used by designed title treatments. */
  layers?: { offset: number; duration: number; params: Record<string, ParamValue> }[];
  dur?: number;
  hot?: boolean;
}

function E(type: string, o: Partial<LibEntry> = {}): LibEntry {
  const d = FX_DEFS[type];
  return { id: o.id ?? type, type, name: d.name, icon: d.icon, desc: d.desc, cat: d.cat, ...o };
}

/** Designed text looks. Each is a full recipe: font, animators, timing, glow, motion. */
export const TEXT_PRESETS: Partial<LibEntry>[] = [
  {
    id: 'textGlow',
    name: 'Deep Glow Title',
    icon: '✨',
    hot: true,
    dur: 2.4,
    desc: 'Centre-out blur reveal through a smooth range selector, five-radius deep glow, slow tracking expand.',
    params: { text: 'AFTERGLOW', font: 'bebas', uppercase: true, size: 0.17, tracking: 0.08, anim: 'blurReveal', inDur: 0.6, smooth: 0.38, order: 'center', animOut: 'blurOut', outDur: 0.35, drift: 'track', driftAmt: 0.6, glowAmt: 1.1, glowRadius: 1.2, glowColor: '#4f8dff', color: '#ffffff', depth: 0.5 },
  },
  {
    id: 'textApple',
    name: 'Premium Cascade',
    icon: '🍏',
    hot: true,
    dur: 2.2,
    desc: 'The Apple-style reveal the research points to: Range Selector with Shape Ramp Up and 35% Smoothness, position + scale + opacity stacked so letters rise as they fade in. Reads as crafted, not popped on.',
    params: { text: 'PREMIUM', font: 'montserrat', uppercase: true, size: 0.1, tracking: 0.04, anim: 'fadeUp', inDur: 0.62, smooth: 0.35, order: 'forward', animOut: 'fade', outDur: 0.4, depth: 0.35, shadow: 0.4 },
  },
  {
    id: 'textTurb',
    name: 'Turbulent Impact',
    icon: '🌊',
    hot: true,
    dur: 1.8,
    desc: 'Hits with heavy turbulent displace that settles in a beat, then zooms out.',
    params: { text: 'IMPACT', font: 'bebas', uppercase: true, size: 0.19, tracking: 0.04, anim: 'impact', inDur: 0.32, smooth: 0.22, turbAmount: 40, turbSize: 50, turbComplexity: 2.2, turbEvolution: 3, turbEnv: 'impact', glowAmt: 0.35, glowColor: '#ffffff', shadow: 0.6, depth: 0.6, drift: 'push', driftAmt: 0.8, animOut: 'zoomOut', outDur: 0.25 },
  },
  {
    id: 'textCascade',
    name: 'Letter Cascade',
    icon: '🔻',
    hot: true,
    dur: 2.2,
    desc: 'Letters drop in one by one with overshoot, motion blur and a hard selector edge.',
    params: { text: 'SPIDER-MAN', font: 'montserrat', uppercase: true, size: 0.1, tracking: 0.02, anim: 'drop', inDur: 0.55, smooth: 0.16, animOut: 'dropOut', outDur: 0.4, mblur: 1.4, shadow: 0.8, depth: 0.45 },
  },
  {
    id: 'textDecode',
    name: 'Scramble Decode',
    icon: '🧬',
    hot: true,
    dur: 2.6,
    desc: 'Characters decode from random glyphs, hacker-style, with a green bloom.',
    params: { text: 'ACCESS GRANTED', font: 'mono', uppercase: true, size: 0.055, tracking: 0.12, anim: 'scramble', inDur: 0.5, smooth: 0.45, animOut: 'scramble', outDur: 0.35, glowAmt: 0.5, glowColor: '#7dffb1', color: '#e9fff1', rgbSplit: 0.25 },
  },
  {
    id: 'textSpread',
    name: 'Cinematic Spread',
    icon: '🎞️',
    hot: true,
    dur: 3,
    desc: 'Thin wide-tracked title that converges in, then keeps spreading. Trailer style.',
    params: { text: 'THE LAST STAND', font: 'montserratLight', uppercase: true, size: 0.05, tracking: 0.35, anim: 'trackIn', inDur: 1.1, smooth: 0.5, animOut: 'fade', outDur: 0.6, drift: 'track', driftAmt: 1.2, glowAmt: 0.25, glowColor: '#ffffff' },
  },
  {
    id: 'textZoom',
    name: 'Zoom Blur In',
    icon: '🌀',
    dur: 1.8,
    desc: 'Each letter flies in from huge scale with motion blur, centre first.',
    params: { text: 'VENOM', font: 'anton', uppercase: true, size: 0.17, tracking: 0.05, anim: 'zoomIn', inDur: 0.5, smooth: 0.3, order: 'center', mblur: 1.6, glowAmt: 0.3, depth: 0.5, animOut: 'zoomOut', outDur: 0.25 },
  },
  {
    id: 'textNeon',
    name: 'Neon Flicker',
    icon: '💜',
    dur: 2.4,
    desc: 'Random-order flicker-on with a buzzing loop and hot pink bloom.',
    params: { text: 'NIGHT CITY', font: 'oswald', uppercase: true, size: 0.13, tracking: 0.12, anim: 'flicker', inDur: 0.6, order: 'random', loop: 'flicker', loopAmt: 0.5, glowAmt: 1.2, glowRadius: 0.8, glowColor: '#ff2bd6', color: '#fff3fd', animOut: 'flickerOff', outDur: 0.35 },
  },
  {
    id: 'textGlitch',
    name: 'Glitch Title',
    icon: '👾',
    dur: 2,
    desc: 'Letters tear in with skew and offsets, RGB split and constant jitter.',
    params: { text: 'SYSTEM ERROR', font: 'archivo', uppercase: true, size: 0.11, tracking: 0.03, anim: 'glitch', inDur: 0.45, smooth: 0.2, order: 'random', rgbSplit: 0.7, loop: 'jitter', loopAmt: 0.35, animOut: 'flickerOff', outDur: 0.3 },
  },
  {
    id: 'textSlam',
    name: 'Slam Hit',
    icon: '💢',
    dur: 1.6,
    desc: 'Whole word crashes in from scale, red, with shadow and a shake loop.',
    params: { text: 'NO WAY HOME', font: 'bebas', uppercase: true, size: 0.18, tracking: 0.03, anim: 'slam', inDur: 0.28, color: '#ff2d55', shadow: 1, loop: 'shake', loopAmt: 0.35, glowAmt: 0.4, glowColor: '#ff2d55', animOut: 'zoomOut', outDur: 0.22 },
  },
  {
    id: 'textFlip',
    name: '3D Flip',
    icon: '🔄',
    dur: 2,
    desc: 'Letters swing round edge-on to face the camera, one after another.',
    params: { text: 'MULTIVERSE', font: 'montserrat', uppercase: true, size: 0.1, tracking: 0.05, anim: 'spin3d', inDur: 0.5, smooth: 0.3, mblur: 1, animOut: 'fade', shadow: 0.6, depth: 0.4 },
  },
  {
    id: 'textVillain',
    name: 'Villain',
    icon: '😈',
    dur: 2.8,
    desc: 'Serif title revealed from the edges with a red glow that breathes.',
    params: { text: 'THE VILLAIN', font: 'cinzel', uppercase: true, size: 0.1, tracking: 0.18, anim: 'blurReveal', inDur: 0.95, smooth: 0.5, order: 'edges', glowAmt: 0.9, glowColor: '#ff1a2e', color: '#ffe2e2', drift: 'push', driftAmt: 0.7, loop: 'breath', loopAmt: 0.6, shadow: 1.2, depth: 0.7, animOut: 'blurOut', outDur: 0.5 },
  },
  {
    id: 'textChrome',
    name: 'Chrome Slam',
    icon: '🪞',
    dur: 1.8,
    desc: 'Chrome gradient fill with a thin light outline, glow and slight RGB split.',
    params: { text: 'LEGEND', font: 'bebas', uppercase: true, size: 0.18, tracking: 0.06, style: 'chrome', color2: '#9bb8ff', anim: 'impact', stroke: true, strokeWidth: 0.02, strokeColor: '#dfe8ff', glowAmt: 0.3, glowColor: '#bcd0ff', rgbSplit: 0.2, shadow: 0.8 },
  },
  {
    id: 'textBoil',
    name: 'Line Boil',
    icon: '〰️',
    dur: 2,
    desc: 'AE line-boil recipe: Amount 9, Size 32, evolution posterised to 8 fps.',
    params: { text: 'LINE BOIL', font: 'anton', uppercase: true, size: 0.12, anim: 'fade', inDur: 0.15, turbAmount: 9, turbSize: 32, turbComplexity: 2, turbEvolution: 7, turbFps: 8, stroke: true, strokeWidth: 0.05 },
  },
  {
    id: 'textLiquid',
    name: 'Liquid Type',
    icon: '💧',
    dur: 2.4,
    desc: 'Big slow displacement on a gradient fill. Molten, underwater look.',
    params: { text: 'LIQUID', font: 'archivo', uppercase: true, size: 0.15, style: 'gradient', color: '#ffffff', color2: '#87bfff', anim: 'blurReveal', inDur: 0.6, turbAmount: 24, turbSize: 145, turbComplexity: 1.6, turbEvolution: 0.8, glowAmt: 0.35, glowColor: '#75aaff' },
  },
  {
    id: 'textStamp',
    name: 'Stamp',
    icon: '🔖',
    dur: 1.8,
    desc: 'Hollow outline that pops in, with a rough boiling edge.',
    params: { text: 'WANTED', font: 'anton', uppercase: true, size: 0.13, tracking: 0.14, style: 'stamp', strokeWidth: 0.04, color: '#ff2a2a', anim: 'pop', inDur: 0.35, turbAmount: 5, turbSize: 16, turbComplexity: 3, turbEvolution: 1, turbFps: 6 },
  },
  {
    id: 'textLyric',
    name: 'Lyric Wave',
    icon: '🎵',
    dur: 2.6,
    desc: 'Italic serif lyrics that fade up per letter and gently wave.',
    params: { text: 'lyrics go here', font: 'playfair', size: 0.06, tracking: 0.01, anim: 'fadeUp', inDur: 0.45, smooth: 0.55, loop: 'wave', loopAmt: 0.6, glowAmt: 0.35, glowColor: '#ffd8a8', y: 0.8, animOut: 'blurOut', outDur: 0.4 },
  },
  {
    id: 'textType',
    name: 'Typewriter',
    icon: '⌨️',
    dur: 2.6,
    desc: 'Types out with a blinking cursor. Hard selector edge, as AE Smoothness 0% would give.',
    params: { text: 'with great power...', font: 'mono', size: 0.045, tracking: 0.02, anim: 'typewriter', smooth: 0.04, y: 0.8, color: '#f2f2f2' },
  },
  {
    id: 'textSub',
    name: 'Lower Third',
    icon: '📰',
    dur: 2.6,
    desc: 'Boxed name tag that rises in per letter.',
    params: { text: 'PETER PARKER', font: 'oswald', uppercase: true, size: 0.04, tracking: 0.2, style: 'subtitle', anim: 'fadeUp', inDur: 0.4, smooth: 0.45, y: 0.86, camera: false },
  },
  {
    id: 'textTitle',
    name: 'Title Pop',
    icon: '🅰️',
    dur: 2,
    desc: 'Simple bold title that pops in letter by letter.',
    params: { text: 'TITLE', font: 'bebas', uppercase: true, size: 0.14, tracking: 0.04, anim: 'pop', inDur: 0.4, smooth: 0.3, shadow: 0.7 },
  },
];

export const LIBRARY: LibEntry[] = [
  E('smoothZoom', { hot: true }),
  E('hyperZoom', { hot: true }),
  E('dollyZoom', { hot: true }),
  E('snapZoom', { hot: true }),
  E('crashZoom', { hot: true }),
  E('landZoom', { hot: true }),
  E('heroZoom', { hot: true }),
  E('pulseZoom'),
  E('whipZoom'),
  E('flowZoom'),
  E('microPush'),
  E('zoomPunch'),
  E('microwave', { hot: true }),
  E('zoomIn'),
  E('zoomOut'),
  E('smoothZoom', { id: 'goodZoomOut', name: 'Good Zoom Out', icon: '🎯', params: { dir: 'out' }, desc: 'The good-zoom curve, pulling back out to normal.' }),
  E('snapZoom', { id: 'snapOut', name: 'Snap Zoom Out', icon: '💥', params: { dir: 'out' } }),
  E('zoomPunch', { id: 'megaPunch', name: 'Mega Punch', icon: '💢', params: { amount: 0.55, attack: 0.16, blur: 2.2 } }),
  E('zoomBounce'),
  E('zoomBlur'),
  E('kenBurns'),
  E('zoomTrans', { hot: true }),
  E('zoomTrans', { id: 'zoomTransBig', name: 'Hard Zoom Through', icon: '🌀', params: { amount: 1.35, blur: 2.8 }, desc: 'The same smooth through-cut, just much bigger. For drops.' }),
  E('spinTrans'),
  E('whipTrans'),
  E('whipTrans', { id: 'whipUp', name: 'Whip Up', icon: '⬆️', params: { dir: 'up' } }),
  E('flashTrans'),
  E('flashTrans', { id: 'dipBlack', name: 'Dip to Black', icon: '⬛', params: { color: '#000000', width: 0.95 } }),
  E('blurTrans'),
  E('glitchTrans'),
  E('shake', { hot: true }),
  E('impact', { hot: true }),
  E('wiggle'),
  E('handheld'),
  E('spin'),
  E('bounce'),
  E('slideIn'),
  E('flash', { hot: true }),
  E('flash', { id: 'flashBlack', name: 'Black Flash', icon: '⚫', params: { color: '#000000' } }),
  E('flash', { id: 'flashRed', name: 'Red Flash', icon: '🔴', params: { color: '#ff1a2e', amount: 0.75 } }),
  E('strobe'),
  E('invert'),
  E('glow'),
  E('exposure'),
  E('bw'),
  E('hueShift'),
  E('rgbSplit', { hot: true }),
  E('glitch'),
  E('verse', { hot: true }),
  E('vhs'),
  E('pixelate'),
  E('halftone'),
  E('posterize'),
  E('ink'),
  E('grain'),
  E('vignette'),
  E('letterbox'),
  E('mirror'),
  E('echo'),
  E('blur'),
  E('freeze', { hot: true }),
  E('stutter'),
  E('rewind'),
  E('reverseSection'),
  E('slowSection'),
  ...TEXT_PRESETS.map((t) => E('text', t)),
];
export const LIB_BY_ID: Record<string, LibEntry> = Object.fromEntries(LIBRARY.map((e) => [e.id, e]));

export interface Combo {
  id: string;
  name: string;
  icon: string;
  desc: string;
  items: { type: string; offset: number; dur: number; params?: Record<string, ParamValue>; intensity?: number }[];
}

export const COMBOS: Combo[] = [
  {
    id: 'beatDrop',
    name: 'Beat Drop',
    icon: '🔊',
    desc: 'Punch + flash + decaying shake + RGB split.',
    items: [
      { type: 'zoomPunch', offset: 0, dur: 0.4, params: { amount: 0.35 } },
      { type: 'flash', offset: 0, dur: 0.25 },
      { type: 'impact', offset: 0, dur: 0.7, params: { amount: 0.6 } },
      { type: 'rgbSplit', offset: 0, dur: 0.35, params: { amount: 18 } },
    ],
  },
  {
    id: 'spideySense',
    name: 'Spidey Sense',
    icon: '🕷️',
    desc: 'Tingling: jitter RGB, glitch, invert flicker, impact.',
    items: [
      { type: 'impact', offset: 0, dur: 0.7, params: { amount: 0.55 } },
      { type: 'rgbSplit', offset: 0, dur: 0.7, params: { amount: 16, env: 'jitter' } },
      { type: 'glitch', offset: 0, dur: 0.25, params: { amount: 0.7 } },
      { type: 'invert', offset: 0.05, dur: 0.18, params: { mode: 'flicker', freq: 14 } },
    ],
  },
  {
    id: 'villainIntro',
    name: 'Villain Intro',
    icon: '😈',
    desc: 'B&W freeze, cinema bars, vignette and slam text.',
    items: [
      { type: 'freeze', offset: 0, dur: 1.4, params: { bw: true, push: 0.1 } },
      { type: 'letterbox', offset: 0, dur: 1.4 },
      { type: 'vignette', offset: 0, dur: 1.4, params: { amount: 0.8 } },
      { type: 'text', offset: 0.1, dur: 1.3, params: { text: 'VILLAIN', anim: 'slam', size: 0.14, color: '#ff2d55' } },
    ],
  },
  {
    id: 'heroLanding',
    name: 'Hero Landing',
    icon: '🦸',
    desc: 'Good zoom into an impact slam with a flash.',
    items: [
      { type: 'smoothZoom', offset: 0, dur: 0.45, params: { amount: 0.8 } },
      { type: 'impact', offset: 0.45, dur: 0.6 },
      { type: 'flash', offset: 0.45, dur: 0.2 },
    ],
  },
  {
    id: 'dreamy',
    name: 'Dreamy Slowmo',
    icon: '☁️',
    desc: 'Glow + echo trails + grain. Pair with Twixtor.',
    items: [
      { type: 'glow', offset: 0, dur: 2, params: { amount: 1.1, threshold: 0.45 } },
      { type: 'echo', offset: 0, dur: 2, params: { amount: 0.6 } },
      { type: 'grain', offset: 0, dur: 2, params: { amount: 0.25 } },
    ],
  },
  {
    id: 'glitchHit',
    name: 'Glitch Hit',
    icon: '⚠️',
    desc: 'Glitch + strobe invert + RGB tear.',
    items: [
      { type: 'glitch', offset: 0, dur: 0.35, params: { amount: 0.9 } },
      { type: 'strobe', offset: 0, dur: 0.25, params: { mode: 'invert', freq: 12 } },
      { type: 'rgbSplit', offset: 0, dur: 0.35, params: { amount: 22 } },
    ],
  },
  {
    id: 'verseMode',
    name: 'Verse Mode',
    icon: '🕸️',
    desc: 'Comic halftone + grain + hue drift.',
    items: [
      { type: 'verse', offset: 0, dur: 2 },
      { type: 'grain', offset: 0, dur: 2, params: { amount: 0.2 } },
      { type: 'shake', offset: 0, dur: 2, params: { amount: 0.12, freq: 6 } },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */
const seedCache = new Map<string, number>();
const seedOf = (id: string) => {
  let s = seedCache.get(id);
  if (s === undefined) {
    s = hashStr(id) & 0xffff;
    seedCache.set(id, s);
  }
  return s;
};

const sortCache = new WeakMap<FxItem[], FxItem[]>();
function sorted(items: FxItem[]) {
  let s = sortCache.get(items);
  if (!s) {
    s = [...items].sort((a, b) => a.lane - b.lane || a.start - b.start);
    sortCache.set(items, s);
  }
  return s;
}

export function evaluateFx(items: FxItem[], T: number, beats: number[], s: FxState) {
  for (const fx of sorted(items)) {
    if (T < fx.start || T >= fx.start + fx.duration) continue;
    const def = FX_DEFS[fx.type];
    if (!def?.apply) continue;
    // Split layers keep evaluating against the original effect-time window.
    // Without this phase mapping text animators restart and zooms snap back at
    // every split even though the underlying effect looks like one layer.
    const localT = T - fx.start;
    const phaseStart = fx.phaseStart ?? 0;
    const phaseDuration = fx.phaseDuration ?? fx.duration;
    const lt = phaseStart + localT;
    const normP = clamp(lt / Math.max(0.001, phaseDuration), 0, 1);
    
    // Evaluate custom keyframes if present on this fx item (e.g. animated intensity)
    let intensity = fx.intensity;
    const intTrack = trackFor(fx.keyframes, 'intensity');
    if (intTrack && intTrack.keyframes.length) {
      intensity = evalTrack(intTrack, normP, fx.intensity);
    }

    def.apply(s, {
      p: normP,
      lt,
      dur: phaseDuration,
      k: intensity,
      P: fx.params,
      seed: seedOf(fx.seedId ?? fx.id),
      T,
      beats,
      start: fx.start - phaseStart,
    });
  }
}

export function remapTime(items: FxItem[], T: number): { t: number; rate: number } {
  let best: FxItem | null = null;
  for (const fx of items) {
    const def = FX_DEFS[fx.type];
    if (!def?.remap) continue;
    if (T >= fx.start && T < fx.start + fx.duration && (!best || fx.start >= best.start)) best = fx;
  }
  if (!best) return { t: T, rate: 1 };
  const phaseStart = best.phaseStart ?? 0;
  const phaseDuration = best.phaseDuration ?? best.duration;
  const localT = T - best.start;
  const [lt, rate] = FX_DEFS[best.type].remap!(phaseStart + localT, phaseDuration, best.params, best.intensity);
  return { t: best.start - phaseStart + lt, rate };
}

/** Clip-level visuals for the "Microwave" velocity preset. */
export function applyMicrowaveClip(s: FxState, u: number, center: number, intensity: number, index: number) {
  const c = clamp(center, 0.3, 0.92);
  const dir = index % 2 === 0 ? -1 : 1;
  const slide = (1 - ease('outCubic', clamp(u / 0.32, 0, 1))) * 0.5 * dir * (0.4 + intensity);
  if (Math.abs(slide) > 1e-4) geoTranslate(s, slide, 0);
  const zp = u < c - 0.22 ? 0 : u < c ? ease('outCubic', (u - (c - 0.22)) / 0.22) : 1 - ease('cubic', (u - c) / (1 - c));
  geoZoom(s, 1 + 0.15 * zp * (0.5 + intensity));
}
