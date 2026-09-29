export type Aspect = '9:16' | '16:9' | '1:1' | '4:5';
export type MediaKind = 'video' | 'audio' | 'demo';
export type ParamValue = number | string | boolean;

export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  url: string;
  file?: File;
  duration: number;
  width: number;
  height: number;
  fps: number;
  demoId?: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  hasAudio?: boolean;
}

export type VelocityPreset =
  | 'none'
  | 'classic'
  | 'impact'
  | 'rampUp'
  | 'rampDown'
  | 'double'
  | 'microwave'
  | 'boomerang';

export type KeyframeInterpolation = 'linear' | 'bezier' | 'hold';

/**
 * A keyframe. `out` is the outgoing tangent (driving the segment to its right)
 * and `inn` the incoming tangent (driving the segment to its left). Both are
 * normalised to that segment's box: x in 0..1 across the segment, y in 0..1
 * from this key's value to the other key's value — the same model as CSS
 * cubic-bezier and After Effects temporal easing.
 */
export interface Keyframe {
  id: string;
  t: number; // 0..1 normalised within the clip / effect duration
  val: number;
  interp?: KeyframeInterpolation;
  out?: [number, number];
  inn?: [number, number];
}

export interface KeyframeTrack {
  id: string;
  property: string;
  keyframes: Keyframe[];
}

export interface VelocitySettings {
  preset: VelocityPreset;
  intensity: number;
  center: number;
}

export interface ColorSettings {
  preset: string;
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  hue: number;
  fade: number;
  bw: number;
  shadowTint: string;
  highTint: string;
  split: number;
}

export interface Clip {
  id: string;
  mediaId: string;
  srcIn: number;
  srcOut: number;
  speed: number;
  reverse: boolean;
  twixtor: boolean;
  velocity: VelocitySettings;
  fit: 'cover' | 'contain';
  scale: number;
  posX: number;
  posY: number;
  rotation: number;
  flipX: boolean;
  mirrorEdges: boolean;
  /** Clip's own audio. Defaults to on. */
  audio?: boolean;
  /** Gain for the clip's own audio. Defaults to 1. */
  audioVolume?: number;
  color: ColorSettings;
  keyframes?: KeyframeTrack[];
}

export interface FxItem {
  id: string;
  /** Stable identity for deterministic noise/randomness across splits. */
  seedId?: string;
  type: string;
  start: number;
  duration: number;
  /** Original effect-time window. Keeps text/zoom/effect animation continuous after splitting. */
  phaseStart?: number;
  phaseDuration?: number;
  lane: number;
  intensity: number;
  params: Record<string, ParamValue>;
  keyframes?: KeyframeTrack[];
}

export interface MusicTrack {
  id?: string;
  mediaId: string;
  start: number;
  volume: number;
  srcIn?: number;
  duration?: number;
}

export interface Project {
  aspect: Aspect;
  fps: number;
  clips: Clip[];
  fx: FxItem[];
  music: MusicTrack | null;
  musicClips?: MusicTrack[];
  beats: number[];
  motionBlur: number;
}

export type Selection = { kind: 'clip' | 'fx' | 'music'; id: string } | null;

/** A property that can be animated with keyframes. */
export interface AnimProp {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  fmt: (v: number) => string;
  /** Graph-editor value range; defaults to min/max. */
  gMin?: number;
  gMax?: number;
}

export const CLIP_PROPS: AnimProp[] = [
  { id: 'scale', label: 'Scale', min: 0.1, max: 12, step: 0.01, unit: '%', fmt: (v) => `${Math.round(v * 100)}%`, gMin: 0.4, gMax: 2.4 },
  { id: 'posX', label: 'Position X', min: -2, max: 2, step: 0.01, unit: '', fmt: (v) => v.toFixed(2) },
  { id: 'posY', label: 'Position Y', min: -2, max: 2, step: 0.01, unit: '', fmt: (v) => v.toFixed(2) },
  { id: 'rotation', label: 'Rotation', min: -720, max: 720, step: 0.5, unit: '°', fmt: (v) => `${Math.round(v * 10) / 10}°`, gMin: -400, gMax: 400 },
];

export const FX_PROPS: AnimProp[] = [
  { id: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.01, unit: '%', fmt: (v) => `${Math.round(v * 100)}%` },
];
