import cityUrl from '../assets/demo-city.jpg';
import sunsetUrl from '../assets/demo-sunset.jpg';
import { clamp, fmtTime, hash1, noise1 } from './utils';

export interface DemoInfo {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
}

export const DEMOS: DemoInfo[] = [
  { id: 'swing', name: 'Demo · Night Swing', duration: 12, width: 1280, height: 720, fps: 24 },
  { id: 'rooftop', name: 'Demo · Rooftop Leap', duration: 10, width: 1280, height: 720, fps: 24 },
];

const images: Record<string, HTMLImageElement> = {};
let loadPromise: Promise<void> | null = null;
export function loadDemoImages() {
  if (!loadPromise) {
    loadPromise = Promise.all(
      ([
        ['city', cityUrl],
        ['sunset', sunsetUrl],
      ] as const).map(
        ([k, url]) =>
          new Promise<void>((res) => {
            const img = new Image();
            img.onload = () => res();
            img.onerror = () => res();
            img.src = url;
            images[k] = img;
          })
      )
    ).then(() => undefined);
  }
  return loadPromise;
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | undefined, W: number, H: number, zoom: number, fx: number, fy: number, fallback: [string, string]) {
  if (img && img.complete && img.naturalWidth) {
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom;
    const iw = img.naturalWidth * s;
    const ih = img.naturalHeight * s;
    ctx.drawImage(img, -(iw - W) * clamp(fx, 0, 1), -(ih - H) * clamp(fy, 0, 1), iw, ih);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, fallback[0]);
    g.addColorStop(1, fallback[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

type Pt = [number, number];
function limb(ctx: CanvasRenderingContext2D, pts: Pt[], w: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

/** A generic masked hero silhouette. Local origin = web hand (hang) or hips (crouch). */
function drawHero(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, pose: 'hang' | 'crouch', t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const RED = '#d3162f';
  const BLUE = '#1e3190';
  const OUT = '#05050a';
  let P: Record<string, Pt>;
  if (pose === 'hang') {
    const k = Math.sin(t * 5) * 6;
    P = {
      hand: [0, 0],
      sh: [2, 28],
      head: [-11, 24],
      hip: [-2, 72],
      el2: [-24, 42],
      ha2: [-30, 62],
      kn1: [12 + k * 0.5, 96],
      ft1: [4 + k, 120],
      kn2: [-16, 94],
      ft2: [-26 - k * 0.5, 116],
    };
  } else {
    const b = Math.sin(t * 2.2) * 1.5;
    P = {
      hand: [30, -8 + b],
      sh: [14, -30 + b],
      head: [27, -40 + b],
      hip: [0, 0],
      el2: [4, -12 + b],
      ha2: [14, 8],
      kn1: [18, -14],
      ft1: [12, 14],
      kn2: [4, -10],
      ft2: [-10, 14],
    };
  }
  const draw = (o: number, body: string, legs: string, headC: string) => {
    limb(ctx, [P.hip, P.kn2, P.ft2], 11 + o, legs);
    limb(ctx, [P.sh, P.el2, P.ha2], 8 + o, body);
    limb(ctx, [P.sh, P.hip], 20 + o, body);
    limb(ctx, [P.hip, P.kn1, P.ft1], 11 + o, legs);
    limb(ctx, pose === 'hang' ? [P.hand, P.sh] : [P.sh, [22, -20 + Math.sin(t * 2.2)], P.hand], 8 + o, body);
    ctx.fillStyle = headC;
    ctx.beginPath();
    ctx.arc(P.head[0], P.head[1], 11 + o / 2, 0, Math.PI * 2);
    ctx.fill();
  };
  draw(5, OUT, OUT, OUT);
  draw(0, RED, BLUE, RED);
  // eye lenses
  ctx.fillStyle = '#f4f6ff';
  const [hx, hy] = P.head;
  const dir = pose === 'hang' ? -1 : 1;
  for (const ex of [-4, 4]) {
    ctx.save();
    ctx.translate(hx + ex + dir * 2, hy - 1);
    ctx.rotate(ex * 0.08 * -dir);
    ctx.beginPath();
    ctx.ellipse(0, 0, 3.6, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function rain(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, n: number, k: number) {
  ctx.strokeStyle = 'rgba(200,220,255,0.33)';
  ctx.lineWidth = Math.max(0.6, 1.2 * k);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const sp = (1100 + hash1(i, 2) * 600) * k;
    const len = (14 + hash1(i, 4) * 22) * k;
    const y = ((hash1(i, 3) * H * 1.2 + t * sp) % (H * 1.2)) - H * 0.1;
    const x = ((((hash1(i, 1) * W * 1.3 - t * sp * 0.18) % (W * 1.3)) + W * 1.3) % (W * 1.3)) - W * 0.15;
    ctx.moveTo(x, y);
    ctx.lineTo(x + len * 0.18, y - len);
  }
  ctx.stroke();
}

function timecode(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, k: number) {
  ctx.font = `600 ${Math.round(20 * k)}px ui-monospace, monospace`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(18 * k, H - 44 * k, 190 * k, 30 * k);
  ctx.fillStyle = Math.floor(t * 2) % 2 ? '#ff3b4f' : '#7a1020';
  ctx.beginPath();
  ctx.arc(34 * k, H - 29 * k, 6 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(fmtTime(t, 24), 48 * k, H - 22 * k);
  void W;
}

function drawSwing(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  const k = H / 720;
  cover(ctx, images.city, W, H, 1.2, 0.5 + 0.38 * Math.sin(t * 0.3 - 0.6), 0.45 + 0.12 * Math.sin(t * 0.5), ['#0a1030', '#02030a']);
  ctx.fillStyle = 'rgba(4,6,22,0.18)';
  ctx.fillRect(0, 0, W, H);
  // swinging hero
  const px = W * 0.5 - 140 * k * Math.sin(t * 0.3 - 0.6);
  const py = -H * 0.25;
  const L = H * 0.95;
  const th = 0.8 * Math.sin((2 * Math.PI * t) / 2.6);
  const hx = px + Math.sin(th) * L;
  const hy = py + Math.cos(th) * L;
  ctx.strokeStyle = 'rgba(240,244,255,0.9)';
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  drawHero(ctx, hx, hy, 1.1 * k, -th, 'hang', t);
  rain(ctx, W, H, t, 170, k);
  // lightning
  const flashes = [3.1, 8.4];
  for (const f of flashes) {
    const d = t - f;
    if (d > 0 && d < 0.22) {
      ctx.fillStyle = `rgba(210,225,255,${(d < 0.05 || (d > 0.1 && d < 0.14) ? 0.38 : 0.12).toFixed(2)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
  timecode(ctx, W, H, t, k);
}

function drawRooftop(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
  const k = H / 720;
  const shx = noise1(t * 0.8, 3) * 0.02;
  const shy = noise1(t * 0.7, 9) * 0.02;
  cover(ctx, images.sunset, W, H, 1.08 + t * 0.012, 0.35 + t * 0.03 + shx, 0.5 + shy, ['#ff8a3c', '#2a0a2a']);
  // sun glow
  const g = ctx.createRadialGradient(W * 0.7, H * 0.45, 0, W * 0.7, H * 0.45, H * 0.6);
  g.addColorStop(0, `rgba(255,190,110,${(0.25 + 0.05 * Math.sin(t * 3)).toFixed(3)})`);
  g.addColorStop(1, 'rgba(255,120,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // birds
  ctx.strokeStyle = 'rgba(20,10,20,0.85)';
  ctx.lineWidth = 2 * k;
  for (let i = 0; i < 9; i++) {
    const sp = (70 + hash1(i, 7) * 70) * k;
    const x = ((hash1(i, 5) * (W + 200 * k) + t * sp) % (W + 200 * k)) - 100 * k;
    const y = H * (0.12 + hash1(i, 6) * 0.28) + Math.sin(t * 2 + i) * 6 * k;
    const w = (7 + hash1(i, 8) * 5) * k;
    const a = Math.sin(t * 11 + i * 1.7) * 0.6;
    ctx.beginPath();
    ctx.moveTo(x - w, y - w * a);
    ctx.lineTo(x, y);
    ctx.lineTo(x + w, y - w * a);
    ctx.stroke();
  }
  // ledge
  ctx.fillStyle = '#120812';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.74);
  ctx.lineTo(W * 0.52, H * 0.74);
  ctx.lineTo(W * 0.52, H * 0.78);
  ctx.lineTo(W * 0.56, H);
  ctx.lineTo(0, H);
  ctx.fill();
  const x0 = W * 0.36;
  const y0 = H * 0.74;
  const anchor: Pt = [W * 1.02, -H * 0.1];
  if (t < 5.5) {
    drawHero(ctx, x0, y0, 1.25 * k, 0, 'crouch', t);
    if (t > 4.2) {
      const q = clamp((t - 4.2) / 0.3, 0, 1);
      const hx = x0 + 30 * 1.25 * k;
      const hy = y0 - 8 * 1.25 * k;
      ctx.strokeStyle = 'rgba(245,248,255,0.95)';
      ctx.lineWidth = 2.2 * k;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + (anchor[0] - hx) * q, hy + (anchor[1] - hy) * q);
      ctx.stroke();
    }
  } else {
    const tau = t - 5.5;
    const x = x0 + tau * 300 * k;
    const y = y0 - 60 * k - 420 * k * tau + 250 * k * tau * tau;
    const ang = Math.atan2(anchor[0] - x, -(anchor[1] - y));
    ctx.strokeStyle = 'rgba(245,248,255,0.95)';
    ctx.lineWidth = 2.2 * k;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(anchor[0], anchor[1]);
    ctx.stroke();
    drawHero(ctx, x, y, 1.25 * k, ang, 'hang', t);
  }
  // warm grade + dust
  ctx.fillStyle = 'rgba(255,200,150,0.35)';
  for (let i = 0; i < 40; i++) {
    const x = (hash1(i, 11) * W + t * 20 * k * (hash1(i, 12) - 0.3)) % W;
    const y = (hash1(i, 13) * H + Math.sin(t + i) * 10 * k) % H;
    ctx.fillRect(x, y, 2 * k, 2 * k);
  }
  timecode(ctx, W, H, t, k);
}

export function drawDemo(ctx: CanvasRenderingContext2D, id: string, t: number, W: number, H: number) {
  ctx.save();
  if (id === 'rooftop') drawRooftop(ctx, t, W, H);
  else drawSwing(ctx, t, W, H);
  ctx.restore();
}

export class DemoRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  constructor(w = 1280, h = 720) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
  }
  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }
  render(id: string, t: number) {
    drawDemo(this.ctx, id, t, this.canvas.width, this.canvas.height);
    return this.canvas;
  }
}
