import type { MediaItem, MusicTrack, Project } from '../types';
import { uid } from './utils';

/**
 * Normalizes music clips from a project.
 * If project has `musicClips`, returns them with defaults.
 * Otherwise falls back to `project.music`.
 */
export function getMusicClips(p: Project, mediaMap?: Map<string, MediaItem>): MusicTrack[] {
  let list: MusicTrack[] = [];
  if (p.musicClips && p.musicClips.length > 0) {
    list = p.musicClips;
  } else if (p.music) {
    list = [p.music];
  }

  return list.map((mc, idx) => {
    const m = mediaMap?.get(mc.mediaId);
    const srcIn = Math.max(0, mc.srcIn ?? 0);
    const mediaDur = m?.duration ?? 300;
    const defaultDur = Math.max(0.5, mediaDur - srcIn);
    const duration = mc.duration !== undefined ? Math.max(0.1, mc.duration) : defaultDur;

    return {
      ...mc,
      id: mc.id || `music-seg-${idx + 1}`,
      srcIn,
      duration,
      volume: mc.volume ?? 1,
    };
  });
}

/**
 * Split a music clip into two segments at timeline timestamp `t`.
 */
export function splitMusicClip(mc: MusicTrack, t: number): [MusicTrack, MusicTrack] | null {
  const start = mc.start;
  const dur = mc.duration ?? 60;
  const end = start + dur;

  // Need at least 0.05s on both sides
  if (t <= start + 0.05 || t >= end - 0.05) {
    return null;
  }

  const offset = t - start;
  const originalSrcIn = mc.srcIn ?? 0;

  const a: MusicTrack = {
    ...mc,
    id: uid(),
    start,
    srcIn: originalSrcIn,
    duration: offset,
  };

  const b: MusicTrack = {
    ...mc,
    id: uid(),
    start: t,
    srcIn: originalSrcIn + offset,
    duration: dur - offset,
  };

  return [a, b];
}

/**
 * Syncs the music clips back onto a project.
 * Keeps `project.musicClips` up to date and keeps `project.music` pointing to the first active clip for backward compatibility.
 */
export function syncMusicProject(p: Project, clips: MusicTrack[]): Project {
  const filtered = clips.filter((c) => (c.duration ?? 1) > 0.04);
  return {
    ...p,
    musicClips: filtered,
    music: filtered[0] || null,
  };
}
