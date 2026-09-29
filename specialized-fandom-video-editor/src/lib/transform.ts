import type { Clip } from '../types';
import { clipGeom, clipLayerMatrix, type ClipGeom } from './compose';
import { affApply } from './effects';
import { hasTrack, setKeyframe, trackFor, upsertTrack } from './keyframes';
import { clamp } from './utils';

/** The four clip transform properties that can be dragged on the canvas. */
export type TProp = 'scale' | 'posX' | 'posY' | 'rotation';

export const SCALE_MIN = 0.1;
export const SCALE_MAX = 12;
export const ROT_MIN = -720;
export const ROT_MAX = 720;

/**
 * Where a clip's layer sits in the program monitor, in CSS pixels.
 *
 * Everything (drag maths, the drawn gizmo) works from the clip's own transform
 * rather than the composited frame, exactly like a layer gizmo in After
 * Effects: if a zoom or spin effect is on top of the clip, the handles still
 * describe the thing you are actually editing.
 */
export interface LayerView {
  geom: ClipGeom;
  /** Corners in CSS px, clockwise from top-left. */
  corners: [number, number][];
  center: [number, number];
  W: number;
  H: number;
}

export function layerView(clip: Clip, sw: number, sh: number, boxW: number, boxH: number, u: number): LayerView | null {
  if (boxW < 8 || boxH < 8 || sw < 2 || sh < 2) return null;
  const W = 1000;
  const H = Math.max(1, (W * boxH) / boxW);
  const geom = clipGeom(clip, sw, sh, W, H, u);
  const F = clipLayerMatrix(geom, clip.flipX);
  const sx = boxW / W;
  const sy = boxH / H;
  const corners: [number, number][] = [
    [0, 0],
    [geom.sw, 0],
    [geom.sw, geom.sh],
    [0, geom.sh],
  ].map(([x, y]) => {
    const p = affApply(F, x, y);
    return [p[0] * sx, p[1] * sy] as [number, number];
  });
  const c = affApply(F, geom.sw / 2, geom.sh / 2);
  return { geom, corners, center: [c[0] * sx, c[1] * sy], W, H };
}

/**
 * Convert an output-pixel centre back into the clip's posX/posY.
 * posX is measured in half-overhang units, which is what makes a drag feel
 * like the frame is moving at the same speed under the finger at any zoom.
 */
export function posFromCenter(g: ClipGeom, W: number, H: number, cx: number, cy: number, scale = g.scale): { posX: number; posY: number } {
  const s = g.s0 * scale;
  const ovX = (Math.abs(g.sw * s - W) / 2) > 1 ? Math.abs(g.sw * s - W) / 2 : W / 2;
  const ovY = (Math.abs(g.sh * s - H) / 2) > 1 ? Math.abs(g.sh * s - H) / 2 : H / 2;
  return { posX: (cx - W / 2) / ovX, posY: (cy - H / 2) / ovY };
}

/**
 * Write a transform value the way the app expects it: onto the keyframe track
 * at the playhead when the property is animated, otherwise as a static value.
 * Everything that touches scale / position / rotation goes through here, so the
 * gizmo, the inspector sliders and the keyboard shortcuts can never disagree.
 */
export function transformPatch(clip: Clip, prop: TProp, value: number, u: number): Partial<Clip> {
  if (hasTrack(clip.keyframes, prop)) {
    const tr = trackFor(clip.keyframes, prop)!;
    return { keyframes: upsertTrack(clip.keyframes, setKeyframe(tr, u, value)) };
  }
  return { [prop]: value } as Partial<Clip>;
}

/**
 * Write several transform properties in one go. Keyframed properties are
 * stamped at the playhead instead of being overwritten, and all of them land
 * in a single history entry so undo treats one drag as one action.
 */
export function transformChanges(clip: Clip, changes: Partial<Record<TProp, number>>, u: number): Partial<Clip> {
  const patch: Partial<Clip> = {};
  let tracks = clip.keyframes;
  for (const prop of Object.keys(changes) as TProp[]) {
    const v = changes[prop];
    if (v === undefined) continue;
    if (hasTrack(tracks, prop)) {
      tracks = upsertTrack(tracks, setKeyframe(trackFor(tracks, prop)!, u, v));
    } else {
      (patch as Record<string, unknown>)[prop] = v;
    }
  }
  if (tracks !== clip.keyframes) patch.keyframes = tracks;
  return patch;
}

export const clampScale = (v: number) => clamp(v, SCALE_MIN, SCALE_MAX);
/** Multi-turn spins are legal, so rotation is clamped rather than wrapped. */
export const clampRot = (v: number) => clamp(v, ROT_MIN, ROT_MAX);

/** Snap helpers shared by the mouse, touch and keyboard paths. */
export function snapAngle(a: number, free: boolean): number {
  if (free) return a;
  const step = 15;
  const snapped = Math.round(a / step) * step;
  return Math.abs(a - snapped) < 2.5 ? snapped : a;
}
export function snapScale(s: number, free: boolean): number {
  if (free) return s;
  return Math.abs(s - 1) < 0.025 ? 1 : Math.round(s * 100) / 100;
}
export function snapCentre(c: [number, number], mid: [number, number], free: boolean): [number, number] {
  if (free) return c;
  return [Math.abs(c[0] - mid[0]) < 3 ? mid[0] : c[0], Math.abs(c[1] - mid[1]) < 3 ? mid[1] : c[1]];
}

export const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
/** Signed angle in degrees from `a` to `b` around `o`. */
export function angleTo(o: [number, number], a: [number, number], b: [number, number]): number {
  const a1 = Math.atan2(a[1] - o[1], a[0] - o[0]);
  const a2 = Math.atan2(b[1] - o[1], b[0] - o[0]);
  return ((a2 - a1) * 180) / Math.PI;
}
