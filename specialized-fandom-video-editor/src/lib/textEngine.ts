/**
 * Text engine modelled on After Effects text layers:
 *  - per-character animators (range selector style) with stagger + order
 *  - per-character motion blur (shutter based, like AE's layer motion blur)
 *  - Deep-Glow style multi-radius bloom with a hot core
 *  - coherent fractal Turbulent Displace (Amount / Size / Complexity / Evolution)
 *  - drop shadow, RGB split, gradient / chrome / hollow fills
 *  - optional "follow camera" so text inherits shakes & zooms like an adjustment layer
 */
import { clamp, hash1, noise1 } from './utils';
import { cubicBezier } from './bezier';

type Aff = [number, number, number, number, number, number];

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */
export interface FontDef {
  label: string;
  family: string;
  weight: number;
  italic?: boolean;
  load?: string;
}

export const FONT_DEFS: Record<string, FontDef> = {
  bebas: { label: 'Bebas Neue', family: '"Bebas Neue", Impact, sans-serif', weight: 400, load: '400 64px "Bebas Neue"' },
  anton: { label: 'Anton', family: 'Anton, Impact, sans-serif', weight: 400, load: '400 64px Anton' },
  montserrat: { label: 'Montserrat Heavy', family: 'Montserrat, "Arial Black", sans-serif', weight: 800, load: '800 64px Montserrat' },
  montserratLight: { label: 'Montserrat Light', family: 'Montserrat, Arial, sans-serif', weight: 300, load: '300 64px Montserrat' },
  oswald: { label: 'Oswald Bold', family: 'Oswald, "Arial Narrow", sans-serif', weight: 700, load: '700 64px Oswald' },
  oswaldLight: { label: 'Oswald Light', family: 'Oswald, "Arial Narrow", sans-serif', weight: 300, load: '300 64px Oswald' },
  archivo: { label: 'Archivo Black', family: '"Archivo Black", "Arial Black", sans-serif', weight: 400, load: '400 64px "Archivo Black"' },
  cinzel: { label: 'Cinzel', family: 'Cinzel, "Trajan Pro", Georgia, serif', weight: 700, load: '700 64px Cinzel' },
  playfair: { label: 'Playfair Italic', family: '"Playfair Display", Georgia, serif', weight: 700, italic: true, load: 'italic 700 64px "Playfair Display"' },
  marker: { label: 'Marker', family: '"Permanent Marker", "Brush Script MT", cursive', weight: 400, load: '400 64px "Permanent Marker"' },
  mono: { label: 'Space Mono', family: '"Space Mono", "Courier New", monospace', weight: 700, load: '700 64px "Space Mono"' },
  impact: { label: 'Impact', family: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', weight: 400 },
  serif: { label: 'Serif', family: 'Georgia, "Times New Roman", serif', weight: 700 },
  sans: { label: 'Sans', family: '"Trebuchet MS", "Segoe UI", sans-serif', weight: 700 },
  black: { label: 'Archivo Black', family: '"Archivo Black", "Arial Black", sans-serif', weight: 400 },
};

export const FONT_OPTS: [string, string][] = Object.entries(FONT_DEFS)
  .filter(([k]) => k !== 'black')
  .map(([k, f]) => [k, f.label]);

let fontsPromise: Promise<void> | null = null;
export function loadEditFonts(): Promise<void> {
  if (!fontsPromise) {
    if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
    fontsPromise = Promise.all(
      Object.values(FONT_DEFS)
        .filter((f) => f.load)
        .map((f) => document.fonts.load(f.load!).catch(() => []))
    ).then(() => undefined);
  }
  return fontsPromise;
}

/* ------------------------------------------------------------------ */
/* Layer description                                                   */
/* ------------------------------------------------------------------ */
export interface TextLayer {
  text: string;
  family: string;
  weight: number;
  italic: boolean;
  size: number; // fraction of frame height
  tracking: number; // em
  leading: number;
  x: number;
  y: number;
  camera: boolean;
  fill: string; // plain | gradient | chrome | stamp (hollow) | subtitle (boxed)
  color: string;
  color2: string;
  strokeWidth: number; // em, 0 = none
  strokeColor: string;
  animIn: string;
  inDur: number;
  stagger: number;
  order: string;
  animOut: string;
  outDur: number;
  drift: string;
  driftAmt: number;
  loop: string;
  loopAmt: number;
  mblur: number;
  glow: number;
  glowRadius: number;
  glowColor: string;
  rgb: number;
  shadow: number;
  /** Layered depth: darkened copy at ~93% scale behind the text (0 = off). */
  depth: number;
  turbAmount: number;
  turbSize: number;
  turbComplexity: number;
  turbEvolution: number;
  turbFps: number;
  /** Range Selector Smoothness (0 = hard pop-on, 0.2–0.5 = AE's recommended eased ramp). */
  smooth: number;
  lt: number;
  dur: number;
  T: number;
  seed: number;
  alpha: number;
}

/* ------------------------------------------------------------------ */
/* Curves                                                              */
/* ------------------------------------------------------------------ */
const C = {
  snap: cubicBezier(0.05, 0.72, 0.16, 1),
  silk: cubicBezier(0.3, 0, 0.1, 1),
  crash: cubicBezier(0.015, 0.9, 0.2, 1),
  over: cubicBezier(0.14, 1.42, 0.34, 1),
  good: cubicBezier(0.46, 0, 0.14, 1),
  inExpo: cubicBezier(0.7, 0, 0.84, 0),
  outBack: cubicBezier(0.2, 1.6, 0.4, 1),
};

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@*+=?/<>';

/* ------------------------------------------------------------------ */
/* Per-character state                                                 */
/* ------------------------------------------------------------------ */
interface CS {
  a: number;
  dx: number; // em
  dy: number; // em
  s: number;
  sx: number;
  rot: number;
  blur: number; // em
  skew: number;
  glyph?: string;
}

interface CharInfo {
  glyph: string;
  x: number; // px from plate centre
  y: number;
  w: number;
  g: number; // visible index
  rank: number;
  rel: number; // chars from line centre
}

interface Timing {
  inDur: number;
  stagger: number;
  outDur: number;
  outStagger: number;
  outStart: number;
  inEnd: number;
  maxRank: number;
}

function applyIn(st: CS, name: string, p: number, ch: CharInfo, seed: number, lt: number) {
  if (name === 'none' || p >= 1) return;
  const q = clamp(p, 0, 1);
  switch (name) {
    case 'fade':
      st.a *= C.silk(q);
      return;
    case 'fadeUp':
      st.a *= C.silk(q);
      st.dy += (1 - C.snap(q)) * 0.55;
      st.blur += (1 - q) * 0.05;
      return;
    case 'rise':
      st.a *= clamp(q * 3, 0, 1);
      st.dy += (1 - C.snap(q)) * 0.95;
      return;
    case 'blurReveal':
      st.a *= C.silk(q);
      st.blur += (1 - C.silk(q)) * 0.34;
      st.s *= 1 + 0.14 * (1 - C.silk(q));
      return;
    case 'zoomIn':
      st.a *= clamp(q * 4, 0, 1);
      st.s *= 1 + 2.6 * (1 - C.snap(q));
      st.blur += (1 - C.snap(q)) * 0.16;
      return;
    case 'slam':
      st.a *= clamp(q * 6, 0, 1);
      st.s *= 1 + 1.7 * (1 - C.crash(q));
      return;
    case 'impact':
      st.a *= clamp(q * 12, 0, 1);
      st.s *= 1 + 0.55 * (1 - C.snap(q));
      st.blur += 0.1 * (1 - C.snap(q));
      return;
    case 'pop':
      st.a *= clamp(q * 5, 0, 1);
      st.s *= 0.1 + 0.9 * C.over(q);
      return;
    case 'drop':
      st.a *= clamp(q * 3, 0, 1);
      st.dy -= (1 - C.outBack(q)) * 1.15;
      st.rot += (1 - C.snap(q)) * 0.5 * (hash1(ch.g, seed) - 0.5);
      return;
    case 'trackIn':
      st.a *= C.silk(q);
      st.dx += ch.rel * (1 - C.good(q)) * 0.9;
      st.blur += (1 - q) * 0.12;
      return;
    case 'spin3d':
      st.a *= clamp(q * 2.5, 0, 1);
      st.sx *= Math.max(0.03, Math.sin(C.snap(q) * Math.PI * 0.5));
      st.dy += (1 - C.snap(q)) * 0.15;
      return;
    case 'typewriter':
      if (p <= 0) st.a = 0;
      return;
    case 'scramble':
      if (p <= 0) {
        st.a = 0;
        return;
      }
      st.glyph = GLYPHS[Math.floor(hash1(Math.floor(lt * 24) * 31 + ch.g * 7, seed) * GLYPHS.length)];
      st.a *= 0.55 + 0.45 * q;
      return;
    case 'flicker': {
      if (p <= 0) {
        st.a = 0;
        return;
      }
      const on = hash1(Math.floor(lt * 26) * 17 + ch.g * 131, seed) < 0.05 + q * q * 0.95;
      st.a *= on ? 1 : 0.06;
      return;
    }
    case 'glitch': {
      const f = Math.floor(lt * 20);
      st.a *= p <= 0 ? 0 : hash1(f * 7 + ch.g, seed) < 0.15 + q ? 1 : 0;
      st.dx += (hash1(f * 13 + ch.g * 3, seed) - 0.5) * 0.9 * (1 - q);
      st.skew += (hash1(f + ch.g * 5, seed) - 0.5) * 0.7 * (1 - q);
      return;
    }
    default:
      st.a *= C.silk(q);
  }
}

function applyOut(st: CS, name: string, q: number, ch: CharInfo, seed: number, lt: number) {
  if (q <= 0) return;
  switch (name) {
    case 'fade':
      st.a *= 1 - C.silk(q);
      return;
    case 'blurOut':
      st.a *= 1 - C.silk(q);
      st.blur += C.silk(q) * 0.34;
      st.s *= 1 + 0.12 * q;
      return;
    case 'zoomOut':
      st.a *= 1 - clamp(q * 1.3, 0, 1);
      st.s *= 1 + 2.4 * C.inExpo(q);
      st.blur += q * 0.2;
      return;
    case 'trackOut':
      st.a *= 1 - C.silk(q);
      st.dx += ch.rel * C.good(q) * 0.85;
      st.blur += q * 0.1;
      return;
    case 'dropOut':
      st.dy += C.inExpo(q) * 1.3;
      st.a *= 1 - q * q;
      st.rot += q * 0.4 * (hash1(ch.g + 9, seed) - 0.5);
      return;
    case 'flickerOff': {
      if (q >= 1) {
        st.a = 0;
        return;
      }
      const on = hash1(Math.floor(lt * 26) * 19 + ch.g * 97, seed) > q * q;
      st.a *= on ? 1 : 0.05;
      return;
    }
    case 'scramble':
      if (q > 0.04) st.glyph = GLYPHS[Math.floor(hash1(Math.floor(lt * 24) * 29 + ch.g * 5, seed) * GLYPHS.length)];
      st.a *= 1 - C.silk(q);
      return;
    case 'cut':
      st.a = 0;
      return;
  }
}

/* ------------------------------------------------------------------ */
/* AE Range Selector                                                   */
/*                                                                    */
/* A range sweeps across the text. Each character's selection amount   */
/* is how far the range edge has passed it, spread by Smoothness.       */
/* Shape Ramp Up gives a graduated edge; Square gives a hard pop.       */
/* ------------------------------------------------------------------ */
function selectorAmount(sweep: number, charPos: number, smooth: number): number {
  // sweep runs 0 → 1 + smooth; charPos is the character's position in the string (0..1).
  // Characters are fully selected once the edge has moved past them by `smooth`.
  const s = Math.max(0.001, smooth);
  return clamp((sweep - charPos) / s, 0, 1);
}

function stateAt(L: TextLayer, ch: CharInfo, lt: number, T: number, tm: Timing): CS {
  const st: CS = { a: 1, dx: 0, dy: 0, s: 1, sx: 1, rot: 0, blur: 0, skew: 0 };
  const smooth = Math.max(0.001, L.smooth);

  // Range Selector: the Start edge sweeps 0 → 1 over the animator duration.
  // Each character's progress is its selection amount, so with Smoothness the
  // reveal graduates across neighbouring letters instead of popping.
  const sweep = tm.inDur > 1e-4 ? (lt / tm.inDur) * (1 + smooth) : 1;
  const charPos = ch.rank / Math.max(1, tm.maxRank);
  const pIn = selectorAmount(sweep, charPos, smooth);

  applyIn(st, L.animIn, pIn, ch, L.seed, lt);
  if (L.animOut !== 'none') {
    // Exit selector sweeps backwards.
    const eo = tm.outDur > 1e-4 ? clamp((lt - tm.outStart) / tm.outDur, 0, 1) : 1;
    const outSweep = eo * (1 + smooth);
    // Amount affected by the exit animator grows from 0 -> 1 as the range
    // passes each character. Inverting it here makes letters vanish before
    // the selector reaches them (and was the main reason text presets looked broken).
    const q = selectorAmount(outSweep, charPos, smooth);
    if (q > 0) applyOut(st, L.animOut, q, ch, L.seed, lt);
  }
  const u = clamp(lt / Math.max(0.01, L.dur), 0, 1);
  switch (L.drift) {
    case 'push':
      st.s *= 1 + L.driftAmt * 0.12 * u;
      break;
    case 'track':
      st.dx += ch.rel * L.driftAmt * 0.22 * u;
      break;
    case 'float':
      st.dy -= L.driftAmt * 0.35 * u;
      break;
  }
  const la = L.loopAmt;
  switch (L.loop) {
    case 'wave':
      st.dy += Math.sin(T * 5 - ch.g * 0.55) * 0.09 * la;
      break;
    case 'jitter': {
      const f = Math.floor(T * 12);
      st.dx += (hash1(f * 5 + ch.g, L.seed) - 0.5) * 0.14 * la;
      st.dy += (hash1(f * 9 + ch.g * 2, L.seed) - 0.5) * 0.14 * la;
      st.rot += (hash1(f * 3 + ch.g * 7, L.seed) - 0.5) * 0.14 * la;
      break;
    }
    case 'shake':
      st.dx += noise1(T * 18, L.seed) * 0.07 * la;
      st.dy += noise1(T * 18, L.seed + 5) * 0.07 * la;
      st.rot += noise1(T * 9, L.seed + 9) * 0.03 * la;
      break;
    case 'flicker':
      if (hash1(Math.floor(T * 18) * 3 + ch.g, L.seed) < 0.1 * la) st.a *= 0.12;
      break;
    case 'breath':
      st.s *= 1 + Math.sin(T * 2.6) * 0.035 * la;
      break;
  }
  return st;
}

function lerpState(a: CS, b: CS, f: number): CS {
  const m = (x: number, y: number) => x + (y - x) * f;
  return {
    a: m(a.a, b.a),
    dx: m(a.dx, b.dx),
    dy: m(a.dy, b.dy),
    s: m(a.s, b.s),
    sx: m(a.sx, b.sx),
    rot: m(a.rot, b.rot),
    blur: m(a.blur, b.blur),
    skew: m(a.skew, b.skew),
    glyph: b.glyph,
  };
}

/* ------------------------------------------------------------------ */
/* Canvas pool                                                         */
/* ------------------------------------------------------------------ */
const pool = new Map<string, HTMLCanvasElement>();
function pooled(key: string, w: number, h: number): HTMLCanvasElement {
  w = Math.max(2, Math.min(4096, Math.ceil(w)));
  h = Math.max(2, Math.min(4096, Math.ceil(h)));
  let c = pool.get(key);
  if (!c) {
    c = document.createElement('canvas');
    pool.set(key, c);
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  } else {
    const x = c.getContext('2d')!;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    x.filter = 'none';
    x.clearRect(0, 0, w, h);
  }
  return c;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

function tinted(key: string, src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = pooled(key, src.width, src.height);
  const x = c.getContext('2d')!;
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-over';
  return c;
}

/* ------------------------------------------------------------------ */
/* Turbulent displace (coherent fbm field)                             */
/* ------------------------------------------------------------------ */
function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 69069);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise2(x: number, y: number, seed: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return ((a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy) * 2 - 1;
}
function fbm(x: number, y: number, seed: number, complexity: number) {
  const whole = Math.floor(complexity);
  const frac = complexity - whole;
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  const count = Math.min(6, whole + (frac > 0.001 ? 1 : 0));
  for (let i = 0; i < count; i++) {
    const weight = i === whole ? frac : 1;
    if (weight <= 0) break;
    sum += noise2(x * freq, y * freq, seed + i * 31) * amp * weight;
    norm += amp * weight;
    freq *= 2.03;
    amp *= 0.5;
  }
  return norm > 0 ? sum / norm : 0;
}

function turbulentDisplace(src: HTMLCanvasElement, amount: number, size: number, complexity: number, evolution: number, fps: number, seed: number) {
  const w = src.width;
  const h = src.height;
  if (w < 2 || h < 2 || amount < 0.2) return;
  const sctx = src.getContext('2d');
  if (!sctx) return;
  const image = sctx.getImageData(0, 0, w, h);
  const out = sctx.createImageData(w, h);
  const input = image.data;
  const output = out.data;
  const qt = fps > 0 ? Math.floor(evolution * fps) / fps : evolution;
  const evoX = qt * 0.73;
  const evoY = qt * 0.51;
  const scale = 1 / Math.max(2, size);
  const step = Math.max(3, Math.min(8, Math.round(size / 8)));
  const gw = Math.ceil(w / step) + 1;
  const gh = Math.ceil(h / step) + 1;
  const dx = new Float32Array(gw * gh);
  const dy = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const px = gx * step;
      const py = gy * step;
      const nx = fbm(px * scale + evoX, py * scale - evoY, seed, complexity);
      const ny = fbm(px * scale - evoY + 19.7, py * scale + evoX + 7.3, seed + 101, complexity);
      const edge = Math.min(px, py, Math.max(0, w - px), Math.max(0, h - py));
      const pin = clamp(edge / Math.max(2, amount * 1.7), 0, 1);
      const i = gy * gw + gx;
      dx[i] = nx * amount * pin;
      dy[i] = ny * amount * pin;
    }
  }
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 2, Math.floor(y / step));
    const fy = y / step - gy;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 2, Math.floor(x / step));
      const fx = x / step - gx;
      const i00 = gy * gw + gx;
      const i10 = i00 + 1;
      const i01 = i00 + gw;
      const i11 = i01 + 1;
      const ox = (dx[i00] * (1 - fx) + dx[i10] * fx) * (1 - fy) + (dx[i01] * (1 - fx) + dx[i11] * fx) * fy;
      const oy = (dy[i00] * (1 - fx) + dy[i10] * fx) * (1 - fy) + (dy[i01] * (1 - fx) + dy[i11] * fx) * fy;
      const sx = clamp(x + ox, 0, w - 1.001);
      const sy = clamp(y + oy, 0, h - 1.001);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const tx = sx - x0;
      const ty = sy - y0;
      const a = (y0 * w + x0) * 4;
      const b = (y0 * w + x1) * 4;
      const c = (y1 * w + x0) * 4;
      const d = (y1 * w + x1) * 4;
      const o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) {
        output[o + k] = ((input[a + k] * (1 - tx) + input[b + k] * tx) * (1 - ty) + (input[c + k] * (1 - tx) + input[d + k] * tx) * ty) | 0;
      }
    }
  }
  sctx.putImageData(out, 0, 0);
}

/* ------------------------------------------------------------------ */
/* Deep glow                                                           */
/* ------------------------------------------------------------------ */
function deepGlow(p: CanvasRenderingContext2D, core: HTMLCanvasElement, color: string, amount: number, radius: number, size: number) {
  const w = core.width;
  const h = core.height;
  const sw = Math.max(2, Math.ceil(w / 4));
  const sh = Math.max(2, Math.ceil(h / 4));
  const mask = pooled('glowMask', sw, sh);
  const m = mask.getContext('2d')!;
  m.drawImage(core, 0, 0, sw, sh);
  m.globalCompositeOperation = 'source-in';
  m.fillStyle = color;
  m.fillRect(0, 0, sw, sh);
  m.globalCompositeOperation = 'source-over';
  const acc = pooled('glowAcc', sw, sh);
  const a = acc.getContext('2d')!;
  a.globalCompositeOperation = 'lighter';
  const base = (size * radius) / 4;
  const passes: [number, number][] = [
    [0.05, 0.9],
    [0.12, 0.66],
    [0.26, 0.48],
    [0.52, 0.36],
    [1.0, 0.26],
  ];
  for (const [r, al] of passes) {
    a.filter = `blur(${Math.max(0.5, r * base)}px)`;
    a.globalAlpha = Math.min(1, al * amount);
    a.drawImage(mask, 0, 0);
  }
  a.filter = 'none';
  a.globalAlpha = 1;
  p.save();
  p.globalCompositeOperation = 'lighter';
  p.imageSmoothingEnabled = true;
  p.imageSmoothingQuality = 'high';
  p.drawImage(acc, 0, 0, w, h);
  p.filter = `blur(${Math.max(1, size * 0.022)}px)`;
  p.globalAlpha = Math.min(1, 0.55 * amount);
  p.drawImage(core, 0, 0);
  p.restore();
}

/* ------------------------------------------------------------------ */
/* Layer rendering                                                     */
/* ------------------------------------------------------------------ */
const BIG_IN = new Set(['zoomIn', 'slam', 'drop', 'pop', 'impact', 'rise', 'glitch']);
const BIG_OUT = new Set(['zoomOut', 'dropOut']);

function renderLayer(ctx: CanvasRenderingContext2D, W: number, H: number, L: TextLayer, geo?: Aff) {
  if (L.alpha <= 0.002 || !L.text.trim()) return;
  const size = Math.max(6, L.size * H);
  const font = `${L.italic ? 'italic ' : ''}${L.weight} ${size}px ${L.family}`;
  const mctx = measurer();
  mctx.font = font;
  const tracking = L.tracking * size;
  const lineH = size * L.leading;
  const lines = L.text.split('\n');

  // ---- layout (prefix measurement keeps kerning) ----
  const chars: CharInfo[] = [];
  let maxW = 0;
  let maxRel = 0;
  lines.forEach((line, li) => {
    const glyphs = Array.from(line);
    const pre: number[] = [0];
    for (let k = 1; k <= glyphs.length; k++) pre.push(mctx.measureText(glyphs.slice(0, k).join('')).width);
    const lw = pre[glyphs.length] + tracking * Math.max(0, glyphs.length - 1);
    maxW = Math.max(maxW, lw);
    const y = (li - (lines.length - 1) / 2) * lineH;
    const mid = (glyphs.length - 1) / 2;
    glyphs.forEach((g, k) => {
      if (!g.trim()) return;
      const w = pre[k + 1] - pre[k];
      const rel = k - mid;
      maxRel = Math.max(maxRel, Math.abs(rel));
      chars.push({ glyph: g, x: -lw / 2 + pre[k] + k * tracking + w / 2, y, w, g: chars.length, rank: 0, rel });
    });
  });
  const n = chars.length;
  if (!n) return;

  // ---- order / ranks ----
  const mid = (n - 1) / 2;
  if (L.order === 'random') {
    const idx = chars.map((_, i) => i).sort((a, b) => hash1(a, L.seed + 77) - hash1(b, L.seed + 77));
    idx.forEach((ci, r) => (chars[ci].rank = r));
  } else {
    for (const ch of chars) {
      ch.rank =
        L.order === 'reverse'
          ? n - 1 - ch.g
          : L.order === 'center'
            ? Math.abs(ch.g - mid) * 2
            : L.order === 'edges'
              ? n - 1 - Math.abs(ch.g - mid) * 2
              : ch.g;
    }
  }
  const maxRank = Math.max(0, ...chars.map((c) => c.rank));

  // ---- timing ----
  // With the Range Selector the sweep itself staggers the characters, so a
  // per-character stagger is only needed for the typewriter/scramble looks.
  const inDur = L.animIn === 'typewriter' ? Math.min(L.inDur, 0.02) : L.inDur;
  const outTotal = L.outDur;
  const inEnd = inDur;
  const tm: Timing = { inDur, stagger: 0, outDur: L.outDur, outStagger: 0, outStart: Math.max(inEnd * 0.5, L.dur - outTotal), inEnd, maxRank };
  const animating = L.lt < inEnd || L.lt > tm.outStart;

  // ---- plate ----
  const big = animating && (BIG_IN.has(L.animIn) || BIG_OUT.has(L.animOut));
  const turbPx = L.turbAmount * (H / 1080);
  const extraW =
    size *
    Math.max(
      L.animIn === 'trackIn' ? maxRel * 0.9 : 0,
      L.animOut === 'trackOut' ? maxRel * 0.85 : 0,
      L.drift === 'track' ? maxRel * L.driftAmt * 0.22 : 0
    );
  const pad =
    size * (big ? 2.2 : 0.9) +
    turbPx * 2 +
    (L.glow > 0 ? size * L.glowRadius * 0.9 : 0) +
    (L.shadow > 0 ? size * 0.3 : 0) +
    (L.loop !== 'none' ? size * 0.2 : 0);
  const pw = Math.min(4096, maxW + 2 * (pad + extraW));
  const ph = Math.min(4096, lines.length * lineH + 2 * pad + (L.drift === 'float' ? size * L.driftAmt * 0.4 : 0));
  const cx0 = pw / 2;
  const cy0 = ph / 2;

  const core = pooled('core', pw, ph);
  const c = core.getContext('2d')!;
  const setup = (g: CanvasRenderingContext2D) => {
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.miterLimit = 3;
  };
  setup(c);

  const makeFill = (g: CanvasRenderingContext2D): string | CanvasGradient => {
    if (L.fill === 'gradient') {
      const gr = g.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
      gr.addColorStop(0, L.color);
      gr.addColorStop(1, L.color2);
      return gr;
    }
    if (L.fill === 'chrome') {
      const gr = g.createLinearGradient(0, -size * 0.55, 0, size * 0.55);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.3, L.color2);
      gr.addColorStop(0.5, '#141a2e');
      gr.addColorStop(0.53, '#3a4566');
      gr.addColorStop(0.75, '#ffffff');
      gr.addColorStop(1, '#8290ad');
      return gr;
    }
    return L.color;
  };
  const hollow = L.fill === 'stamp';
  const strokePx = Math.max(hollow ? size * Math.max(0.03, L.strokeWidth) : size * L.strokeWidth, 0);

  const drawGlyph = (g: CanvasRenderingContext2D, fill: string | CanvasGradient, ch: CharInfo, st: CS, alpha: number) => {
    if (alpha <= 0.002) return;
    g.save();
    g.globalAlpha = clamp(alpha, 0, 1);
    g.translate(cx0 + ch.x + st.dx * size, cy0 + ch.y + st.dy * size);
    if (st.rot) g.rotate(st.rot);
    if (st.skew) g.transform(1, 0, st.skew, 1, 0, 0);
    g.scale(st.s * st.sx, st.s);
    const blurPx = Math.min(size * 0.6, st.blur * size);
    if (blurPx > 0.4) g.filter = `blur(${blurPx}px)`;
    const glyph = st.glyph ?? ch.glyph;
    if (strokePx > 0.3) {
      g.lineWidth = strokePx / Math.max(0.05, st.s);
      g.strokeStyle = hollow ? L.color : L.strokeColor;
      g.strokeText(glyph, 0, 0);
    }
    if (!hollow) {
      g.fillStyle = fill;
      g.fillText(glyph, 0, 0);
    }
    g.restore();
  };

  const fillC = makeFill(c);
  const shutter = L.mblur > 0 ? L.mblur / 48 : 0;
  let scratch: HTMLCanvasElement | null = null;
  let sc: CanvasRenderingContext2D | null = null;
  let fillS: string | CanvasGradient = L.color;
  let maxAlpha = 0;
  let lastVisible: { ch: CharInfo; st: CS } | null = null;

  for (const ch of chars) {
    const st = stateAt(L, ch, L.lt, L.T, tm);
    maxAlpha = Math.max(maxAlpha, st.a);
    if (st.a > 0.02) lastVisible = { ch, st };
    let samples = 1;
    let pv: CS | null = null;
    if (shutter > 0) {
      pv = stateAt(L, ch, L.lt - shutter, L.T - shutter, tm);
      const mag =
        Math.hypot((st.dx - pv.dx) * size, (st.dy - pv.dy) * size) +
        Math.abs(st.s - pv.s) * size * 0.6 +
        Math.abs(st.sx - pv.sx) * ch.w * 0.5 +
        Math.abs(st.rot - pv.rot) * size * 0.5;
      samples = clamp(Math.ceil(mag / 1.8), 1, 14);
    }
    if (samples <= 1 || !pv) {
      drawGlyph(c, fillC, ch, st, st.a);
      continue;
    }
    if (st.a <= 0.002 && pv.a <= 0.002) continue;
    // Accumulate the shutter samples additively on a scratch plate: exact average.
    if (!scratch) {
      scratch = pooled('mblur', pw, ph);
      sc = scratch.getContext('2d')!;
      setup(sc);
      fillS = makeFill(sc);
    }
    const ext = Math.max(ch.w, size) * Math.max(st.s, pv.s, 1) * 0.85 + Math.max(st.blur, pv.blur) * size * 3 + strokePx + 6;
    const ax = cx0 + ch.x + pv.dx * size;
    const ay = cy0 + ch.y + pv.dy * size;
    const bx = cx0 + ch.x + st.dx * size;
    const by = cy0 + ch.y + st.dy * size;
    const rx = Math.max(0, Math.floor(Math.min(ax, bx) - ext));
    const ry = Math.max(0, Math.floor(Math.min(ay, by) - ext));
    const rw = Math.min(core.width - rx, Math.ceil(Math.abs(ax - bx) + ext * 2));
    const rh = Math.min(core.height - ry, Math.ceil(Math.abs(ay - by) + ext * 2));
    if (rw <= 0 || rh <= 0) continue;
    sc!.setTransform(1, 0, 0, 1, 0, 0);
    sc!.clearRect(rx, ry, rw, rh);
    sc!.globalCompositeOperation = 'lighter';
    for (let k = 0; k < samples; k++) {
      const s = lerpState(pv, st, samples === 1 ? 1 : k / (samples - 1));
      drawGlyph(sc!, fillS, ch, s, s.a / samples);
    }
    sc!.globalCompositeOperation = 'source-over';
    c.drawImage(scratch!, rx, ry, rw, rh, rx, ry, rw, rh);
  }

  // typewriter cursor
  if (L.animIn === 'typewriter' && lastVisible && L.lt < inEnd + 0.8 && Math.floor(L.T * 2.2) % 2 === 0) {
    const { ch, st } = lastVisible;
    c.save();
    c.globalAlpha = clamp(st.a, 0, 1);
    c.fillStyle = L.color;
    c.fillRect(cx0 + ch.x + ch.w / 2 + size * 0.08, cy0 + ch.y - size * 0.42, Math.max(2, size * 0.07), size * 0.84);
    c.restore();
  }

  // turbulent displace
  if (turbPx > 0.1) {
    turbulentDisplace(core, turbPx, Math.max(2, L.turbSize * (H / 1080)), L.turbComplexity, L.lt * L.turbEvolution, L.turbFps, L.seed);
  }

  // ---- composite plate ----
  const plate = pooled('plate', pw, ph);
  const p = plate.getContext('2d')!;
  if (L.fill === 'subtitle' && maxAlpha > 0.01) {
    p.globalAlpha = clamp(maxAlpha, 0, 1) * 0.72;
    p.fillStyle = '#000000';
    const bw = maxW + size * 0.9;
    const bh = lines.length * lineH + size * 0.25;
    p.fillRect(cx0 - bw / 2, cy0 - bh / 2, bw, bh);
    p.globalAlpha = 1;
  }
  // Layered depth: a slightly smaller darkened copy behind the text, the way
  // fandom editors fake dimension without a 3D extrude.
  if (L.depth > 0.01 && maxAlpha > 0.01) {
    const dk = tinted('tintDepth', core, '#000000');
    p.save();
    p.globalAlpha = Math.min(0.75, 0.62 * L.depth);
    // Scale about the plate centre so the copy sits just behind the letters.
    p.translate(cx0, cy0);
    p.scale(0.935, 0.935);
    p.translate(-cx0, -cy0);
    p.drawImage(dk, size * 0.012, size * 0.02);
    p.restore();
  }
  if (L.shadow > 0.01) {
    const sh = tinted('tintShadow', core, '#000000');
    p.save();
    p.filter = `blur(${Math.max(1, size * 0.07 * L.shadow)}px)`;
    p.globalAlpha = Math.min(0.9, 0.55 * L.shadow + 0.2);
    p.drawImage(sh, size * 0.04 * L.shadow, size * 0.07 * L.shadow);
    p.restore();
  }
  if (L.glow > 0.01) deepGlow(p, core, L.glowColor, L.glow, L.glowRadius, size);
  if (L.rgb > 0.01) {
    const d = L.rgb * size * 0.06;
    p.save();
    p.globalCompositeOperation = 'lighter';
    p.globalAlpha = 0.9;
    p.drawImage(tinted('tintR', core, '#ff1030'), -d, 0);
    p.drawImage(tinted('tintB', core, '#10c8ff'), d, 0);
    p.restore();
  }
  p.drawImage(core, 0, 0);

  // ---- place on frame ----
  ctx.save();
  if (L.camera && geo) ctx.setTransform(geo[0], geo[1], geo[2], geo[3], geo[4] * H, geo[5] * H);
  else ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = clamp(L.alpha, 0, 1);
  ctx.drawImage(plate, L.x * W - cx0, L.y * H - cy0);
  ctx.restore();
}

export function drawTexts(ctx: CanvasRenderingContext2D, W: number, H: number, layers: TextLayer[], geo?: Aff) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  for (const L of layers) renderLayer(ctx, W, H, L, geo);
}
