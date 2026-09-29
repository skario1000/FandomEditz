import type { Clip, Keyframe, KeyframeTrack } from '../types';
import { CLIP_PROPS } from '../types';
import { applyShapeToAll } from './keyframes';
import type { TProp } from './transform';

export interface MoveKey {
  t: number;
  scale?: number;
  rotation?: number;
  [k: string]: number | undefined;
}

export interface MovePreset {
  id: string;
  name: string;
  icon: string;
  hint: string;
  /** `clip` animates the whole clip, `window` animates a short move at the playhead. */
  mode: 'clip' | 'window';
  dur: number;
  shape: [number, number, number, number];
  /** Per-property curve overrides (a spin and a push want different shapes). */
  shapes?: Partial<Record<TProp, [number, number, number, number]>>;
  /** Start the move from whatever the clip is doing right now. */
  fromCurrent: boolean;
  keys: MoveKey[];
}

const AE_FLOW: [number, number, number, number] = [0.12, 0.85, 0.2, 1];
const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * One-click moves. These are the transforms fandom edits actually reach for:
 * a push under a cut, a barrel roll across a beat, a dutch angle that lands
 * square again. Each one writes real keyframes, so the curve editor can bend
 * it afterwards — nothing is baked.
 */
export const MOVE_PRESETS: MovePreset[] = [
  {
    id: 'pushIn',
    name: 'Push In',
    icon: '🔍',
    hint: 'A slow silk push across the whole clip — the move that makes every cut feel alive.',
    mode: 'clip',
    dur: 0,
    shape: [0.3, 0, 0.1, 1],
    fromCurrent: false,
    keys: [{ t: 0, scale: 1 }, { t: 1, scale: 1.3 }],
  },
  {
    id: 'pullOut',
    name: 'Pull Out',
    icon: '🔭',
    hint: 'Starts tight and eases back out to the full frame.',
    mode: 'clip',
    dur: 0,
    shape: [0.46, 0, 0.14, 1],
    fromCurrent: false,
    keys: [{ t: 0, scale: 1.3 }, { t: 1, scale: 1 }],
  },
  {
    id: 'breathe',
    name: 'Breathe',
    icon: '🫁',
    hint: 'In and back out once — a frame that never sits perfectly still.',
    mode: 'clip',
    dur: 0,
    shape: AE_FLOW,
    fromCurrent: false,
    keys: [{ t: 0, scale: 1 }, { t: 0.5, scale: 1.16 }, { t: 1, scale: 1 }],
  },
  {
    id: 'spin360',
    name: '360 Spin',
    icon: '🌀',
    hint: 'A full barrel roll across the clip, with a push to keep it moving.',
    mode: 'clip',
    dur: 0,
    shape: [0.45, 0, 0.4, 1],
    shapes: { scale: [0.3, 0, 0.1, 1] },
    fromCurrent: false,
    // one continuous pass: a stop at 180° would read as two spins, not one
    keys: [
      { t: 0, rotation: 0, scale: 1 },
      { t: 1, rotation: 360, scale: 1.12 },
    ],
  },
  {
    id: 'dutch',
    name: 'Dutch',
    icon: '🎬',
    hint: 'Tips into a dutch angle and levels out again by the end of the clip.',
    mode: 'clip',
    dur: 0,
    shape: [0.4, 0, 0.3, 1],
    fromCurrent: false,
    keys: [
      { t: 0, rotation: 0, scale: 1 },
      { t: 0.35, rotation: -13, scale: 1.08 },
      { t: 1, rotation: 0, scale: 1 },
    ],
  },
  {
    id: 'orbit',
    name: 'Orbit',
    icon: '🛰️',
    hint: 'Swings one way and out the other, like a camera arcing around the subject.',
    mode: 'clip',
    dur: 0,
    shape: [0.42, 0, 0.58, 1],
    fromCurrent: false,
    keys: [{ t: 0, rotation: 0 }, { t: 0.35, rotation: 17 }, { t: 0.7, rotation: -17 }, { t: 1, rotation: 0 }],
  },
  {
    id: 'whipLand',
    name: 'Whip Land',
    icon: '⚡',
    hint: 'A half-second whip that starts tilted and zoomed, then lands square on the beat.',
    mode: 'window',
    dur: 0.5,
    shape: [0.05, 0.72, 0.16, 1],
    fromCurrent: true,
    keys: [
      { t: 0, scale: 1.24, rotation: -15 },
      { t: 1, scale: 1, rotation: 0 },
    ],
  },
  {
    id: 'snapPunch',
    name: 'Snap Punch',
    icon: '👊',
    hint: 'A hard zoom that overshoots and settles — the beat-synced punch.',
    mode: 'window',
    dur: 0.36,
    shape: [0.14, 1.42, 0.34, 1],
    fromCurrent: true,
    keys: [
      { t: 0, scale: 1 },
      { t: 0.22, scale: 1.38 },
      { t: 1, scale: 1 },
    ],
  },
  {
    id: 'halfFlip',
    name: 'Half Flip',
    icon: '🔁',
    hint: 'A 180° roll at the playhead — the spin for a cut that ends up level again.',
    mode: 'window',
    dur: 0.6,
    shape: [0.45, 0, 0.4, 1],
    fromCurrent: true,
    keys: [
      { t: 0, rotation: 0, scale: 1.06 },
      { t: 1, rotation: 180, scale: 1.06 },
    ],
  },
  {
    id: 'swingIn',
    name: 'Swing In',
    icon: '💥',
    hint: 'Comes in tilted from off-level and straightens up on the hit.',
    mode: 'window',
    dur: 0.45,
    shape: [0.08, 0.82, 0.17, 1],
    fromCurrent: true,
    keys: [
      { t: 0, rotation: 22, scale: 1.16 },
      { t: 1, rotation: 0, scale: 1 },
    ],
  },
];

export const MOVE_BY_ID = new Map(MOVE_PRESETS.map((p) => [p.id, p]));

function track(prop: TProp, keys: MoveKey[], shape: [number, number, number, number]): KeyframeTrack {
  const kfs: Keyframe[] = keys.map((k) => ({
    id: uid(),
    t: Math.max(0, Math.min(1, k.t)),
    val: (k[prop] as number) ?? 0,
    interp: 'bezier' as const,
    out: [shape[0], shape[1]] as [number, number],
    inn: [shape[2], shape[3]] as [number, number],
  }));
  return applyShapeToAll({ id: `${prop}-${uid()}`, property: prop, keyframes: kfs }, shape);
}

/**
 * Build the clip patch for a preset. `from` maps each property to the value the
 * clip currently shows, so a window move starts exactly where the frame is
 * instead of jumping.
 */
export function presetToClip(clip: Clip, preset: MovePreset, from: Partial<Record<TProp, number>>, clipDur: number): Partial<Clip> {
  const props = CLIP_PROPS.map((p) => p.id as TProp).filter((id) => preset.keys.some((k) => k[id] !== undefined));
  if (!props.length) return {};
  // a window move occupies the tail of the clip, so the whole move stays on screen
  const width = preset.mode === 'window' ? Math.min(1, preset.dur / Math.max(0.05, clipDur)) : 1;
  const start = preset.mode === 'window' ? 1 - width : 0;
  const keys = preset.keys.map((k) => {
    const out: MoveKey = { t: start + k.t * width };
    for (const p of props) {
      const v = k[p];
      if (v === undefined) continue;
      const cur = from[p];
      out[p] = k.t === 0 && preset.fromCurrent && cur !== undefined ? cur : v;
    }
    return out;
  });
  const tracks = [...(clip.keyframes ?? []).filter((t) => !props.includes(t.property as TProp)), ...props.map((p) => track(p, keys, preset.shapes?.[p] ?? preset.shape))];
  return { keyframes: tracks };
}
