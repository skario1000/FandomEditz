import type { Clip, MediaItem, Project } from '../types';
import { CLIP_PROPS } from '../types';
import { clipAtTime, clipDuration, clipSourceRate, clipSourceTime, layoutClips } from './velocity';
import {
  affApply,
  affInv,
  affMul,
  affR,
  affS,
  affT,
  applyMicrowaveClip,
  evaluateFx,
  newFxState,
  remapTime,
  type Aff,
  type FxState,
} from './effects';
import { clamp, hexToRgb } from './utils';
import { defaultColor } from './colorPresets';
import { animatedValue } from './keyframes';

export interface ColorUniforms {
  exposure: number;
  contrast: number;
  saturation: number;
  hue: number;
  temp: number;
  tint: number;
  fade: number;
  bw: number;
  split: number;
  shadow: [number, number, number];
  high: [number, number, number];
}

export interface FrameDesc {
  T: number;
  W: number;
  H: number;
  clip: Clip | null;
  media: MediaItem | null;
  clipIndex: number;
  clipStart: number;
  srcTime: number;
  srcRate: number;
  fx: FxState;
  M1: Float32Array;
  M0: Float32Array;
  samples: number;
  shutter: number;
  radialPx: [number, number];
  mirrorEdges: boolean;
  color: ColorUniforms;
}

const DEF_COLOR = defaultColor();
const IDENT = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/**
 * Which music segment is playing at timeline time T, and how far into it we
 * are. Music-reactive effects read the envelopes at that source position, so
 * trimming the song or splitting it into segments keeps them in sync.
 */
export function musicAt(project: Project, T: number): { mediaId: string; t: number } | null {
  const list = project.musicClips && project.musicClips.length ? project.musicClips : project.music ? [project.music] : [];
  for (const m of list) {
    if (!m.mediaId) continue;
    const dur = m.duration ?? Infinity;
    if (T >= m.start && T < m.start + dur) return { mediaId: m.mediaId, t: (m.srcIn ?? 0) + (T - m.start) };
  }
  return null;
}

/**
 * Everything the renderer needs to place a clip, and everything the on-canvas
 * gizmo needs to draw and drag it. `s0` is the fit scale, `s` includes the
 * clip's own scale, and `ovX/ovY` are how far the frame overhangs the output —
 * which is exactly the unit posX/posY are measured in.
 */
export interface ClipGeom {
  sw: number;
  sh: number;
  s0: number;
  s: number;
  scale: number;
  posX: number;
  posY: number;
  rotation: number;
  cx: number;
  cy: number;
  ovX: number;
  ovY: number;
}

export function clipGeom(clip: Clip, sw: number, sh: number, W: number, H: number, u = 0): ClipGeom {
  const s0 = clip.fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  // animated keyframe tracks on the clip (scale / position / rotation)
  const scale = animatedValue(clip.keyframes, CLIP_PROPS[0], u, clip.scale);
  const posX = animatedValue(clip.keyframes, CLIP_PROPS[1], u, clip.posX);
  const posY = animatedValue(clip.keyframes, CLIP_PROPS[2], u, clip.posY);
  const rotation = animatedValue(clip.keyframes, CLIP_PROPS[3], u, clip.rotation);
  const s = s0 * scale;
  const ovX = Math.abs(sw * s - W) / 2;
  const ovY = Math.abs(sh * s - H) / 2;
  return {
    sw,
    sh,
    s0,
    s,
    scale,
    posX,
    posY,
    rotation,
    cx: W / 2 + posX * (ovX > 1 ? ovX : W / 2),
    cy: H / 2 + posY * (ovY > 1 ? ovY : H / 2),
    ovX,
    ovY,
  };
}

/** Source-pixel → output-pixel matrix of a clip's own transform (no effects). */
export function clipLayerMatrix(g: ClipGeom, flipX = false): Aff {
  let A = affT(-g.sw / 2, -g.sh / 2);
  A = affMul(affS(g.s * (flipX ? -1 : 1), g.s), A);
  A = affMul(affR((g.rotation * Math.PI) / 180), A);
  return affMul(affT(g.cx, g.cy), A);
}

function baseTransform(clip: Clip, sw: number, sh: number, W: number, H: number, u: number = 0): Aff {
  return clipLayerMatrix(clipGeom(clip, sw, sh, W, H, u), clip.flipX);
}

const toPx = (G: Aff, H: number): Aff => affMul(affS(H, H), affMul(G, affS(1 / H, 1 / H)));

function uvMat(F: Aff, sw: number, sh: number): Float32Array {
  const M = affMul(affS(1 / sw, 1 / sh), affInv(F));
  return new Float32Array([M[0], M[1], 0, M[2], M[3], 0, M[4], M[5], 1]);
}

export function computeFrame(
  project: Project,
  mediaMap: Map<string, MediaItem>,
  T: number,
  W: number,
  H: number,
  maxSamples = 32,
  /** Actual dimensions of the texture that will be sampled. Must match what was uploaded. */
  srcWOverride?: number,
  srcHOverride?: number
): FrameDesc {
  const aspect = W / H;
  const layout = layoutClips(project.clips);
  const { t: Tm, rate: rateMul } = remapTime(project.fx, T);
  const hit = clipAtTime(layout, Tm);

  // Where we are *inside* the track under the playhead, so a music-reactive
  // effect follows the song even when it is trimmed, offset or split.
  const mus = musicAt(project, T);
  const musicId = mus?.mediaId ?? null;
  const musicT = mus ? mus.t : T;

  const fx = newFxState(aspect);
  evaluateFx(project.fx, T, project.beats, fx, musicId, musicT);
  const dt = 0.5 / Math.max(12, project.fps);
  const fxPrev = newFxState(aspect);
  evaluateFx(project.fx, T - dt, project.beats, fxPrev, musicAt(project, T - dt)?.mediaId ?? null, musicAt(project, T - dt)?.t ?? T - dt);

  let M1: Float32Array = IDENT;
  let M0: Float32Array = IDENT;
  let samples = 1;
  let srcTime = 0;
  let srcRate = 0;
  let media: MediaItem | null = null;

  if (hit) {
    const clip = hit.clip;
    media = mediaMap.get(clip.mediaId) ?? null;
    const dur = clipDuration(clip);
    const localT = Tm - hit.start;
    srcTime = clipSourceTime(clip, localT);
    srcRate = clipSourceRate(clip, localT) * rateMul;
    if (clip.velocity.preset === 'microwave') {
      applyMicrowaveClip(fx, localT / dur, clip.velocity.center, clip.velocity.intensity, hit.index);
      applyMicrowaveClip(fxPrev, Math.max(0, localT - dt) / dur, clip.velocity.center, clip.velocity.intensity, hit.index);
    }
    // The transform must be built from the dimensions of the texture that is actually
    // sampled. For rotated iPhone video or files whose probe failed, videoWidth/Height
    // differs from the declared media size — using the declared one stretches the image.
    const sw = srcWOverride && srcWOverride > 1 ? srcWOverride : media?.width || 1280;
    const sh = srcHOverride && srcHOverride > 1 ? srcHOverride : media?.height || 720;
    const normU = clamp(localT / dur, 0, 1);
    const normUPrev = clamp((localT - dt) / dur, 0, 1);
    const B = baseTransform(clip, sw, sh, W, H, normU);
    const BPrev = baseTransform(clip, sw, sh, W, H, normUPrev);
    const F1 = affMul(toPx(fx.geo, H), B);
    const F0 = affMul(toPx(fxPrev.geo, H), BPrev);
    M1 = uvMat(F1, sw, sh);
    M0 = uvMat(F0, sw, sh);

    // estimate on-screen motion in px between T-dt and T for motion blur sampling
    const F1i = affInv(F1);
    let disp = 0;
    const pts: [number, number][] = [
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
      [W / 2, H / 2],
    ];
    for (const [x, y] of pts) {
      const s = affApply(F1i, x, y);
      const q = affApply(F0, s[0], s[1]);
      disp = Math.max(disp, Math.hypot(q[0] - x, q[1] - y));
    }
    const blurPx = disp * project.motionBlur;
    const radialPx = clamp(fx.radialBlur, 0, 0.6) * Math.hypot(W, H) * 0.5;
    const need = Math.max(blurPx, radialPx);
    if (need > 0.8) samples = clamp(Math.ceil(need / 1.6), 2, maxSamples);
  }

  const cs = hit?.clip.color ?? DEF_COLOR;
  return {
    T,
    W,
    H,
    clip: hit?.clip ?? null,
    media,
    clipIndex: hit?.index ?? -1,
    clipStart: hit?.start ?? 0,
    srcTime,
    srcRate,
    fx,
    M1,
    M0,
    samples,
    shutter: project.motionBlur,
    radialPx: [fx.rcx * W, fx.rcy * H],
    mirrorEdges: hit?.clip.mirrorEdges ?? true,
    color: {
      exposure: cs.exposure + fx.exposure,
      contrast: cs.contrast + fx.contrast,
      saturation: cs.saturation + fx.saturation,
      hue: ((cs.hue + fx.hue) * Math.PI) / 180,
      temp: cs.temperature + fx.temp,
      tint: cs.tint,
      fade: cs.fade,
      bw: clamp(cs.bw + fx.bw, 0, 1),
      split: cs.split,
      shadow: hexToRgb(cs.shadowTint),
      high: hexToRgb(cs.highTint),
    },
  };
}
