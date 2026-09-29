import type { Aspect } from '../types';

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const pad = (n: number) => String(n).padStart(2, '0');
export function fmtTime(t: number, fps = 30) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * fps + 1e-6);
  return `${pad(m)}:${pad(s)}:${pad(f)}`;
}
export const fmtSec = (t: number) => `${(Math.round(t * 100) / 100).toFixed(2)}s`;

export const EASINGS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  quad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  cubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  quint: (t) => (t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2),
  expo: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  elastic: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  // High-end After Effects & Alight Motion curves for buttery smooth fandom edits
  aeFlow: (t) => {
    // cubic-bezier(0.12, 0.85, 0.2, 1.0) - fast explosive entry with long cushion
    return 1 - Math.pow(1 - t, 3.8);
  },
  aeSnap: (t) => {
    // Ultra snappy whip-punch: cubic-bezier(0.08, 0.82, 0.17, 1.0)
    return 1 - Math.pow(1 - t, 4.6);
  },
  aeSmooth: (t) => {
    // Symmetrical high-exponent S-curve: fast transition across middle, cushioned start & end
    return t < 0.5 ? 8 * Math.pow(t, 4) : 1 - Math.pow(-2 * t + 2, 4) / 2;
  },
  aeWhip: (t) => {
    // Exponential acceleration into sudden deceleration
    return t < 0.5 ? Math.pow(2 * t, 3.5) / 2 : 1 - Math.pow(2 * (1 - t), 3.5) / 2;
  },
};
export const ease = (name: string, t: number) => (EASINGS[name] ?? EASINGS.smooth)(clamp(t, 0, 1));

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function hash1(i: number, seed = 0): number {
  let h = Math.imul((i | 0) ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** smooth value noise in [-1, 1] */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u) * 2 - 1;
}

const rgbCache = new Map<string, [number, number, number]>();
export function hexToRgb(hex: string): [number, number, number] {
  const c = rgbCache.get(hex);
  if (c) return c;
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h, 16) || 0;
  const r: [number, number, number] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  rgbCache.set(hex, r);
  return r;
}

export const ASPECTS: Record<Aspect, [number, number]> = {
  '9:16': [9, 16],
  '16:9': [16, 9],
  '1:1': [1, 1],
  '4:5': [4, 5],
};
export const aspectRatio = (a: Aspect) => ASPECTS[a][0] / ASPECTS[a][1];

export function exportSize(aspect: Aspect, res: number): [number, number] {
  const [a, b] = ASPECTS[aspect];
  let w: number, h: number;
  if (a <= b) {
    w = res;
    h = (res * b) / a;
  } else {
    h = res;
    w = (res * a) / b;
  }
  const even = (x: number) => Math.round(x / 2) * 2;
  return [even(w), even(h)];
}

export function seekVideo(v: HTMLVideoElement, t: number, timeout = 3000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener('seeked', finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeout);
    v.addEventListener('seeked', finish);
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) {
      finish();
      return;
    }
    v.currentTime = t;
  });
}

export function waitEvent(el: EventTarget, ok: string, fail = 'error', timeout = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      el.removeEventListener(ok, onOk);
      el.removeEventListener(fail, onFail);
      clearTimeout(timer);
    };
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onFail = () => {
      cleanup();
      reject(new Error('Media could not be loaded'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out loading media'));
    }, timeout);
    el.addEventListener(ok, onOk);
    el.addEventListener(fail, onFail);
  });
}
