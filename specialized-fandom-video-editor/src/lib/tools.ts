import type { Clip, MediaItem, ParamValue, Project, VelocityPreset } from '../types';
import { clipAtTime, clipDuration, layoutClips, splitClip } from './velocity';
import { FX_DEFS } from './effects';
import { freeLane, makeFx } from '../store';

export function cutOnBeats(p: Project, every: number, range?: [number, number]): Project {
  let clips = p.clips;
  const beats = p.beats.filter((_, i) => i % every === 0);
  for (const b of beats) {
    if (range && (b <= range[0] + 0.02 || b >= range[1] - 0.02)) continue;
    const hit = clipAtTime(layoutClips(clips), b);
    if (!hit) continue;
    const parts = splitClip(hit.clip, b - hit.start);
    if (!parts) continue;
    clips = [...clips.slice(0, hit.index), parts[0], parts[1], ...clips.slice(hit.index + 1)];
  }
  return clips === p.clips ? p : { ...p, clips };
}

/** Trim/stretch each clip so every cut lands on the nearest beat. */
export function snapCutsToBeats(p: Project, media: Map<string, MediaItem>): Project {
  if (!p.beats.length) return p;
  const clips: Clip[] = [];
  let t = 0;
  for (const c of p.clips) {
    const end = t + clipDuration(c);
    let best = end;
    let bd = Infinity;
    for (const b of p.beats) {
      if (b <= t + 0.08) continue;
      const d = Math.abs(b - end);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    let nc = c;
    if (bd < Infinity && Math.abs(best - end) > 0.001) {
      const newDur = best - t;
      const span = newDur * c.speed;
      const maxD = media.get(c.mediaId)?.duration ?? Infinity;
      if (!c.reverse) {
        const out = c.srcIn + span;
        nc = out <= maxD ? { ...c, srcOut: out } : { ...c, speed: (c.srcOut - c.srcIn) / newDur };
      } else {
        const inn = c.srcOut - span;
        nc = inn >= 0 ? { ...c, srcIn: inn } : { ...c, speed: (c.srcOut - c.srcIn) / newDur };
      }
    }
    clips.push(nc);
    t += clipDuration(nc);
  }
  return { ...p, clips };
}

export function fxOnBeats(
  p: Project,
  type: string,
  params: Record<string, ParamValue> | undefined,
  every: number,
  durFrac: number,
  range?: [number, number]
): Project {
  const def = FX_DEFS[type];
  if (!def) return p;
  const beats = p.beats.filter((_, i) => i % every === 0);
  const fx = [...p.fx];
  beats.forEach((b, i) => {
    if (range && (b < range[0] - 0.01 || b >= range[1])) return;
    const gap = beats[i + 1] !== undefined ? beats[i + 1] - b : i > 0 ? b - beats[i - 1] : def.dur;
    const dur = Math.max(0.08, Math.min(Math.max(def.dur, 0.25) * 1.6, gap * durFrac));
    fx.push(makeFx(type, b, dur, freeLane(fx, b, dur, 0), params));
  });
  return { ...p, fx };
}

export function autoMicrowave(p: Project): Project {
  const q = cutOnBeats(p, 1);
  return { ...q, clips: q.clips.map((c) => ({ ...c, velocity: { preset: 'microwave', intensity: 0.5, center: 0.7 } })) };
}

export function autoVelocity(p: Project): Project {
  let q = cutOnBeats(p, 2);
  const presets: VelocityPreset[] = ['classic', 'impact', 'rampDown', 'classic', 'rampUp'];
  q = { ...q, clips: q.clips.map((c, i) => ({ ...c, velocity: { preset: presets[i % presets.length], intensity: 0.85, center: 0.5 } })) };
  return fxOnBeats(q, 'zoomPunch', { amount: 0.18 }, 2, 0.6);
}

/**
 * One reactive layer over the whole edit: the frame breathes with the track's
 * low end for the entire timeline. It is a single effect, so the gizmo, the
 * inspector and undo all treat it like any other layer.
 */
export function autoBassPump(p: Project, params?: Record<string, ParamValue>): Project {
  const total = layoutClips(p.clips).reduce((a, l) => a + (l.end - l.start), 0);
  if (total <= 0) return p;
  const dur = Math.max(0.2, total - 0.02);
  if (p.fx.some((f) => f.type === 'bassPump' && f.start < 0.01)) return p;
  return { ...p, fx: [...p.fx, makeFx('bassPump', 0, dur, freeLane(p.fx, 0, dur, 0), params)] };
}
