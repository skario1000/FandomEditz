import { create } from 'zustand';
import type { Clip, FxItem, MediaItem, MusicTrack, ParamValue, Project, Selection } from './types';
import { CLIP_PROPS } from './types';
import { clamp, uid } from './lib/utils';
import { clipAtTime, clipDuration, layoutClips, nearestCut, splitClip, totalDuration } from './lib/velocity';
import { COMBOS, FX_DEFS, LIB_BY_ID, defaultParams } from './lib/effects';
import { defaultColor } from './lib/colorPresets';
import { audio, detectBeats, ensureMusicAnalysis } from './lib/audio';
import { scheduleAutosave } from './lib/storage';
import { getMusicClips, splitMusicClip, syncMusicProject } from './lib/music';
import { clampRot, clampScale, transformChanges, type TProp } from './lib/transform';
import { MOVE_BY_ID, presetToClip } from './lib/moves';
import { animatedValue } from './lib/keyframes';

export const LANES = 3;
const MAX_HISTORY = 120;

export const emptyProject = (): Project => ({
  aspect: '9:16',
  fps: 30,
  clips: [],
  fx: [],
  music: null,
  beats: [],
  motionBlur: 1,
});

export function makeClip(mediaId: string, srcIn: number, srcOut: number): Clip {
  return {
    id: uid(),
    mediaId,
    srcIn,
    srcOut,
    speed: 1,
    reverse: false,
    twixtor: false,
    velocity: { preset: 'none', intensity: 0.8, center: 0.5 },
    fit: 'cover',
    scale: 1,
    posX: 0,
    posY: 0,
    rotation: 0,
    flipX: false,
    mirrorEdges: true,
    audio: true,
    audioVolume: 1,
    color: defaultColor(),
  };
}

export function freeLane(fx: FxItem[], start: number, dur: number, pref = 0): number {
  for (let i = 0; i < LANES; i++) {
    const lane = (pref + i) % LANES;
    if (!fx.some((f) => f.lane === lane && f.start < start + dur - 1e-3 && f.start + f.duration > start + 1e-3)) return lane;
  }
  return pref;
}

export function makeFx(type: string, start: number, dur: number, lane: number, params?: Record<string, ParamValue>, intensity = 1): FxItem {
  const def = FX_DEFS[type];
  return { id: uid(), type, start: Math.max(0, start), duration: Math.max(0.05, dur), lane, intensity, params: { ...defaultParams(def), ...(params ?? {}) } };
}

export type LeftTab = 'media' | 'fx' | 'speed' | 'color' | 'beats';
export interface Toast {
  id: string;
  msg: string;
  kind: 'info' | 'success' | 'error';
}

interface UIState {
  time: number;
  playing: boolean;
  loop: boolean;
  pxPerSec: number;
  snap: boolean;
  leftTab: LeftTab;
  viewer: 'program' | 'source';
  sourceId: string | null;
  srcIn: number;
  srcOut: number;
  thumbVersion: number;
  quality: 'full' | 'half';
  gizmo: boolean;
  guides: 'off' | 'thirds' | 'safe';
  exportOpen: boolean;
  exporting: boolean;
  helpOpen: boolean;
  aiOpen: boolean;
  applyAll: boolean;
  screen: 'home' | 'editor';
  booted: boolean;
  currentProjectId: string | null;
  projectName: string;
  saveState: 'saved' | 'saving' | 'error';
  opening: boolean;
  libraryVersion: number;
  mobileDrawer: 'none' | 'clips' | 'speed' | 'fx' | 'text' | 'color' | 'beats' | 'keyframes' | 'fxSettings' | 'clipSettings' | 'ai';
}

export interface EditorState extends UIState {
  project: Project;
  past: Project[];
  future: Project[];
  txnBase: Project | null;
  media: MediaItem[];
  selection: Selection;
  toasts: Toast[];

  ui(patch: Partial<UIState>): void;
  commit(fn: (p: Project) => Project): void;
  beginTxn(): void;
  live(fn: (p: Project) => Project): void;
  endTxn(): void;
  undo(): void;
  redo(): void;

  setTime(t: number): void;
  tick(t: number): void;
  togglePlay(): void;
  pause(): void;
  select(s: Selection): void;

  addMedia(m: MediaItem): void;
  updateMedia(id: string, patch: Partial<MediaItem>): void;
  removeMedia(id: string): void;
  openSource(id: string): void;

  addClip(mediaId: string, srcIn: number, srcOut: number, index?: number): void;
  insertIndexAtTime(t: number): number;
  updateClip(id: string, patch: Partial<Clip>, live?: boolean): void;
  patchTargetClips(fn: (c: Clip) => Partial<Clip>, all?: boolean): void;
  /** The clip a transform edit applies to: the selection, else the one under the playhead. */
  targetClip(): { clip: Clip; start: number; dur: number; u: number } | null;
  /** Write scale / position / rotation, keyframing it when the property is animated. */
  setTransform(changes: Partial<Record<TProp, number>>, opts?: { live?: boolean; clipId?: string }): void;
  applyMove(presetId: string): void;
  resetTransform(): void;
  moveClip(from: number, to: number): void;
  removeSelected(): void;
  duplicateSelected(): void;
  splitAtPlayhead(): void;
  splitAtTime(target: { kind: 'clip' | 'fx' | 'music'; id: string }, time?: number): void;

  addFx(type: string, o?: { start?: number; duration?: number; lane?: number; params?: Record<string, ParamValue>; intensity?: number }): string;
  addLib(entryId: string, start?: number, lane?: number): void;
  addCombo(id: string, start?: number): void;
  updateFx(id: string, patch: Partial<FxItem>, live?: boolean): void;

  setMusic(mediaId: string | null): void;
  updateMusic(patch: Partial<MusicTrack>, live?: boolean): void;
  trimMusicToPlayhead(side: 'start' | 'end'): void;
  addBeat(t: number): void;
  removeBeatNear(t: number, tol?: number): void;
  setBeats(b: number[]): void;

  setProjectProps(p: Partial<Pick<Project, 'aspect' | 'fps' | 'motionBlur'>>): void;
  newProject(): void;
  loadProject(p: Project): void;

  toast(msg: string, kind?: Toast['kind']): void;
  dismissToast(id: string): void;
  bumpThumbs(): void;
}

const pushHist = (past: Project[], p: Project) => [...past.slice(-(MAX_HISTORY - 1)), p];

/** Lock a tempo grid (falling back to hit detection) as soon as a song is chosen. */
async function autoMarkBeats(mediaId: string) {
  const buf = audio.buffers.get(mediaId);
  if (!buf || buf.duration < 0.4) return;
  try {
    let found = await detectBeats(buf, { sensitivity: 0.62, band: 'bass', mode: 'grid' });
    if (found.beats.length < 4 || found.bpm < 60) {
      found = await detectBeats(buf, { sensitivity: 0.72, band: 'full', mode: 'onsets' });
    }
    const s = useEditor.getState();
    if (s.project.music?.mediaId !== mediaId) return;
    const start = s.project.music.start;
    const beats = found.beats.map((b) => b + start).filter((b) => b >= 0);
    if (beats.length < 2) {
      s.toast('No clear beat in this track — tap with B', 'info');
      return;
    }
    s.setBeats(beats);
    s.toast(`Beat grid · ${Math.round(found.bpm) || '—'} BPM · ${beats.length} marks`, 'success');
  } catch {
    useEditor.getState().toast('Could not mark beats on this track', 'error');
  }
}

export const useEditor = create<EditorState>((set, get) => ({
  project: emptyProject(),
  past: [],
  future: [],
  txnBase: null,
  media: [],
  selection: null,
  toasts: [],
  time: 0,
  playing: false,
  loop: true,
  pxPerSec: 90,
  snap: true,
  leftTab: 'media',
  viewer: 'program',
  sourceId: null,
  srcIn: 0,
  srcOut: 0,
  thumbVersion: 0,
  quality: 'full',
  gizmo: true,
  guides: 'off',
  exportOpen: false,
  exporting: false,
  helpOpen: false,
  aiOpen: false,
  applyAll: false,
  screen: 'home',
  booted: false,
  currentProjectId: null,
  projectName: '',
  saveState: 'saved',
  opening: false,
  libraryVersion: 0,
  mobileDrawer: 'none',

  ui: (patch) => set(patch),

  commit: (fn) =>
    set((s) => {
      const next = fn(s.project);
      if (next === s.project) return {};
      // fold a still-open transaction (e.g. a slider released outside) into history first
      const past = s.txnBase && s.txnBase !== s.project ? pushHist(s.past, s.txnBase) : s.past;
      scheduleAutosave(next);
      return { project: next, past: pushHist(past, s.project), future: [], txnBase: null };
    }),
  beginTxn: () => set((s) => ({ txnBase: s.project })),
  live: (fn) => set((s) => ({ project: fn(s.project) })),
  endTxn: () =>
    set((s) => {
      if (!s.txnBase) return {};
      if (s.txnBase === s.project) return { txnBase: null };
      scheduleAutosave(s.project);
      return { past: pushHist(s.past, s.txnBase), future: [], txnBase: null };
    }),
  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return { project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future].slice(0, MAX_HISTORY) };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const [next, ...rest] = s.future;
      return { project: next, past: pushHist(s.past, s.project), future: rest };
    }),

  setTime: (t) => {
    const s = get();
    const total = totalDuration(s.project.clips);
    const tt = clamp(t, 0, Math.max(0, total));
    if (s.playing) {
      audio.start(s.project.music, tt, s.project.musicClips);
      audio.scheduleClips(s.project.clips, tt);
    }
    set({ time: tt });
  },
  tick: (t) => set({ time: t }),
  togglePlay: () => {
    const s = get();
    if (s.playing) {
      audio.stop();
      set({ playing: false });
      return;
    }
    const total = totalDuration(s.project.clips);
    if (total <= 0) {
      get().toast('Add some clips to the timeline first', 'info');
      return;
    }
    let t = s.time;
    if (t >= total - 0.02) t = 0;
    audio.start(s.project.music, t, s.project.musicClips);
    audio.scheduleClips(s.project.clips, t);
    set({ playing: true, time: t, viewer: 'program' });
  },
  pause: () => {
    if (get().playing) {
      audio.stop();
      set({ playing: false });
    }
  },
  select: (sel) => set({ selection: sel }),

  addMedia: (m) => set((s) => ({ media: [...s.media.filter((x) => x.id !== m.id), m] })),
  updateMedia: (id, patch) => set((s) => ({ media: s.media.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  removeMedia: (id) => {
    const m = get().media.find((x) => x.id === id);
    get().commit((p) => ({
      ...p,
      clips: p.clips.filter((c) => c.mediaId !== id),
      music: p.music?.mediaId === id ? null : p.music,
    }));
    set((s) => ({ media: s.media.filter((x) => x.id !== id), sourceId: s.sourceId === id ? null : s.sourceId, viewer: s.sourceId === id ? 'program' : s.viewer }));
    if (m?.url && m.kind !== 'demo') URL.revokeObjectURL(m.url);
    void import('./lib/mediaStorage').then(({ detachMedia }) => detachMedia(id, get().currentProjectId));
  },
  openSource: (id) => {
    const m = get().media.find((x) => x.id === id);
    if (!m || m.kind === 'audio') return;
    get().pause();
    set({ sourceId: id, viewer: 'source', srcIn: 0, srcOut: Math.min(m.duration, 4) });
  },

  addClip: (mediaId, srcIn, srcOut, index) => {
    const m = get().media.find((x) => x.id === mediaId);
    if (!m || m.kind === 'audio' || m.status !== 'ready') return;
    const a = clamp(Math.min(srcIn, srcOut), 0, m.duration);
    let b = clamp(Math.max(srcIn, srcOut), 0, m.duration);
    if (b - a < 0.05) b = Math.min(m.duration, a + 1);
    const clip = makeClip(mediaId, a, b);
    get().commit((p) => {
      const clips = [...p.clips];
      clips.splice(index === undefined ? clips.length : clamp(index, 0, clips.length), 0, clip);
      return { ...p, clips };
    });
    set({ selection: { kind: 'clip', id: clip.id } });
  },
  insertIndexAtTime: (t) => {
    const l = layoutClips(get().project.clips);
    const bounds = [0, ...l.map((x) => x.end)];
    let best = 0;
    bounds.forEach((b, i) => {
      if (Math.abs(b - t) < Math.abs(bounds[best] - t)) best = i;
    });
    return best;
  },
  updateClip: (id, patch, live) => {
    const fn = (p: Project) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    if (live) get().live(fn);
    else get().commit(fn);
  },
  patchTargetClips: (fn, all) => {
    const s = get();
    let ids: string[];
    if (all ?? s.applyAll) ids = s.project.clips.map((c) => c.id);
    else {
      const id = s.selection?.kind === 'clip' ? s.selection.id : clipAtTime(layoutClips(s.project.clips), s.time)?.clip.id;
      if (!id) {
        get().toast('Select a clip first (or enable “Apply to all”)', 'info');
        return;
      }
      ids = [id];
      set({ selection: { kind: 'clip', id } });
    }
    get().commit((p) => ({ ...p, clips: p.clips.map((c) => (ids.includes(c.id) ? { ...c, ...fn(c) } : c)) }));
  },
  targetClip: () => {
    const s = get();
    const layout = layoutClips(s.project.clips);
    const hit =
      (s.selection?.kind === 'clip' ? layout.find((l) => l.clip.id === s.selection!.id) : undefined) ?? clipAtTime(layout, s.time);
    if (!hit) return null;
    const dur = Math.max(0.05, clipDuration(hit.clip));
    return { clip: hit.clip, start: hit.start, dur, u: clamp((s.time - hit.start) / dur, 0, 1) };
  },
  setTransform: (changes, opts) => {
    const s = get();
    const hit = (opts?.clipId ? s.project.clips.find((c) => c.id === opts.clipId) : null) ?? s.targetClip()?.clip;
    if (!hit) return;
    const layout = layoutClips(s.project.clips);
    const slot = layout.find((l) => l.clip.id === hit.id);
    const dur = Math.max(0.05, clipDuration(hit));
    const u = slot ? clamp((s.time - slot.start) / dur, 0, 1) : 0;
    const clean: Partial<Record<TProp, number>> = {};
    for (const [k, v] of Object.entries(changes) as [TProp, number][]) {
      if (v === undefined) continue;
      clean[k] = k === 'scale' ? clampScale(v) : k === 'rotation' ? clampRot(v) : clamp(v, -3, 3);
    }
    s.updateClip(hit.id, transformChanges(hit, clean, u), opts?.live);
  },
  applyMove: (presetId) => {
    const s = get();
    const preset = MOVE_BY_ID.get(presetId);
    const hit = s.targetClip();
    if (!preset || !hit) {
      s.toast('Add a clip to the timeline first', 'info');
      return;
    }
    const from: Partial<Record<TProp, number>> = {};
    for (const p of CLIP_PROPS) from[p.id as TProp] = animatedValue(hit.clip.keyframes, p, hit.u, (hit.clip as unknown as Record<string, number>)[p.id]);
    s.updateClip(hit.clip.id, presetToClip(hit.clip, preset, from, hit.dur));
    s.select({ kind: 'clip', id: hit.clip.id });
    s.toast(`${preset.icon} ${preset.name} — edit the curve in Keyframes`, 'success');
  },
  resetTransform: () => {
    const s = get();
    const hit = s.targetClip();
    if (!hit) return;
    s.updateClip(hit.clip.id, transformChanges(hit.clip, { scale: 1, posX: 0, posY: 0, rotation: 0 }, hit.u));
    s.toast('Transform reset', 'info');
  },
  moveClip: (from, to) =>
    get().commit((p) => {
      if (from === to || from + 1 === to) return p;
      const clips = [...p.clips];
      const [c] = clips.splice(from, 1);
      clips.splice(to > from ? to - 1 : to, 0, c);
      return { ...p, clips };
    }),
  removeSelected: () => {
    const sel = get().selection;
    if (!sel) return;
    const s = get();
    const mediaMap = new Map(s.media.map((m) => [m.id, m]));
    get().commit((p) => {
      if (sel.kind === 'clip') {
        return { ...p, clips: p.clips.filter((c) => c.id !== sel.id) };
      }
      if (sel.kind === 'fx') {
        return { ...p, fx: p.fx.filter((f) => f.id !== sel.id) };
      }
      if (sel.kind === 'music') {
        const musicList = getMusicClips(p, mediaMap);
        const filtered = musicList.filter((m) => m.id !== sel.id && sel.id !== 'music');
        return syncMusicProject(p, filtered);
      }
      return p;
    });
    set({ selection: null });
    const total = totalDuration(get().project.clips);
    if (get().time > total) set({ time: total });
    if (get().playing) {
      audio.start(get().project.music, get().time, get().project.musicClips);
    }
  },
  duplicateSelected: () => {
    const s = get();
    const sel = s.selection;
    if (!sel) return;
    if (sel.kind === 'clip') {
      const i = s.project.clips.findIndex((c) => c.id === sel.id);
      if (i < 0) return;
      const copy = { ...s.project.clips[i], id: uid() };
      get().commit((p) => {
        const clips = [...p.clips];
        clips.splice(i + 1, 0, copy);
        return { ...p, clips };
      });
      set({ selection: { kind: 'clip', id: copy.id } });
    } else if (sel.kind === 'fx') {
      const f = s.project.fx.find((x) => x.id === sel.id);
      if (!f) return;
      const start = f.start + f.duration;
      const copy = { ...f, id: uid(), start, lane: freeLane(s.project.fx, start, f.duration, f.lane) };
      get().commit((p) => ({ ...p, fx: [...p.fx, copy] }));
      set({ selection: { kind: 'fx', id: copy.id } });
    }
  },
  splitAtPlayhead: () => {
    const s = get();
    const t = s.time;
    const sel = s.selection;

    // Split the selected layer first. This makes the same S button/key work on
    // video, music, any zoom, text, transition, or other effect.
    if (sel) {
      get().splitAtTime(sel, t);
      return;
    }

    // With no selection, split the video under the playhead, then the topmost
    // active FX/text layer, then a music segment.
    const hit = clipAtTime(layoutClips(s.project.clips), t);
    if (hit) {
      get().splitAtTime({ kind: 'clip', id: hit.clip.id }, t);
      return;
    }
    const fx = [...s.project.fx]
      .filter((f) => t > f.start + 0.03 && t < f.start + f.duration - 0.03)
      .sort((a, b) => b.lane - a.lane || b.start - a.start)[0];
    if (fx) {
      get().splitAtTime({ kind: 'fx', id: fx.id }, t);
      return;
    }
    const mediaMap = new Map(s.media.map((m) => [m.id, m]));
    const music = getMusicClips(s.project, mediaMap).find((m) => t > m.start + 0.05 && t < m.start + (m.duration ?? 60) - 0.05);
    if (music) get().splitAtTime({ kind: 'music', id: music.id ?? 'music' }, t);
    else get().toast('Select a clip, effect, text, or music segment to split', 'info');
  },

  /** Split any timeline element at an explicit time, preserving animation phase. */
  splitAtTime: (target, t = get().time) => {
    const s = get();
    if (target.kind === 'fx') {
      const f = s.project.fx.find((x) => x.id === target.id);
      if (!f) return;
      const cutLocal = t - f.start;
      if (cutLocal <= 0.03 || cutLocal >= f.duration - 0.03) {
        get().toast('Put the playhead inside the selected effect to split it', 'info');
        return;
      }
      const phaseStart = f.phaseStart ?? 0;
      const phaseDuration = f.phaseDuration ?? f.duration;
      const seedId = f.seedId ?? f.id;
      const a = {
        ...f,
        duration: cutLocal,
        phaseStart,
        phaseDuration,
        seedId,
      };
      const b = {
        ...f,
        id: uid(),
        start: t,
        duration: f.duration - cutLocal,
        phaseStart: phaseStart + cutLocal,
        phaseDuration,
        seedId,
      };
      get().commit((p) => ({ ...p, fx: [...p.fx.filter((x) => x.id !== f.id), a, b] }));
      set({ selection: { kind: 'fx', id: b.id }, mobileDrawer: s.mobileDrawer === 'fxSettings' ? 'fxSettings' : s.mobileDrawer });
      get().toast(`Split ${f.type === 'text' ? 'text layer' : 'effect'} at playhead`, 'success');
      return;
    }

    if (target.kind === 'clip') {
      const hit = layoutClips(s.project.clips).find((x) => x.clip.id === target.id);
      if (!hit) return;
      const parts = splitClip(hit.clip, t - hit.start);
      if (!parts) {
        get().toast('Move the playhead inside the selected clip to split it', 'info');
        return;
      }
      get().commit((p) => {
        const clips = [...p.clips];
        clips.splice(hit.index, 1, parts[0], parts[1]);
        return { ...p, clips };
      });
      set({ selection: { kind: 'clip', id: parts[1].id } });
      get().toast('Split clip at playhead', 'success');
      return;
    }

    const mediaMap = new Map(s.media.map((m) => [m.id, m]));
    const musicList = getMusicClips(s.project, mediaMap);
    const targetMusic = musicList.find((m) => m.id === target.id || target.id === 'music');
    if (!targetMusic) return;
    const parts = splitMusicClip(targetMusic, t);
    if (!parts) {
      get().toast('Move the playhead inside the selected music segment to split it', 'info');
      return;
    }
    const nextList = musicList.flatMap((m) => (m.id === targetMusic.id ? [parts[0], parts[1]] : [m]));
    get().commit((p) => syncMusicProject(p, nextList));
    set({ selection: { kind: 'music', id: parts[1].id! } });
    get().toast('Split music at playhead', 'success');
    if (s.playing) {
      audio.start(s.project.music, t, nextList);
      audio.scheduleClips(s.project.clips, t);
    }
  },
  trimMusicToPlayhead: (side: 'start' | 'end') => {
    const s = get();
    const t = s.time;
    const mediaMap = new Map(s.media.map((m) => [m.id, m]));
    const musicList = getMusicClips(s.project, mediaMap);
    const target =
      musicList.find((m) => m.id === s.selection?.id || s.selection?.id === 'music') ||
      musicList.find((m) => t >= m.start && t <= m.start + (m.duration ?? 60));
    if (!target) return;

    if (side === 'start') {
      const oldStart = target.start;
      const oldDur = target.duration ?? 60;
      if (t <= oldStart || t >= oldStart + oldDur - 0.05) return;
      const delta = t - oldStart;
      const updated: MusicTrack = {
        ...target,
        start: t,
        srcIn: (target.srcIn ?? 0) + delta,
        duration: Math.max(0.1, oldDur - delta),
      };
      const nextList = musicList.map((m) => (m.id === target.id ? updated : m));
      get().commit((p) => syncMusicProject(p, nextList));
      get().toast('Cut music start to playhead', 'success');
      if (s.playing) audio.start(s.project.music, t, nextList);
    } else {
      const oldStart = target.start;
      if (t <= oldStart + 0.05) return;
      const newDur = Math.max(0.1, t - oldStart);
      const updated: MusicTrack = {
        ...target,
        duration: newDur,
      };
      const nextList = musicList.map((m) => (m.id === target.id ? updated : m));
      get().commit((p) => syncMusicProject(p, nextList));
      get().toast('Cut music end to playhead', 'success');
      if (s.playing) audio.start(s.project.music, t, nextList);
    }
  },

  addFx: (type, o = {}) => {
    const def = FX_DEFS[type];
    if (!def) return '';
    const s = get();
    const dur = o.duration ?? def.dur;
    let start = o.start ?? s.time;
    if (def.transition && o.start === undefined) {
      const cut = nearestCut(s.project.clips, start);
      if (cut !== null && Math.abs(cut - start) < 2.5) start = cut - dur / 2;
    }
    start = Math.max(0, start);
    const item = makeFx(type, start, dur, o.lane ?? freeLane(s.project.fx, start, dur, 0), o.params, o.intensity ?? 1);
    get().commit((p) => ({ ...p, fx: [...p.fx, item] }));
    set({ selection: { kind: 'fx', id: item.id } });
    return item.id;
  },
  addLib: (entryId, start, lane) => {
    const e = LIB_BY_ID[entryId];
    if (!e) return;
    get().addFx(e.type, { params: e.params, duration: e.dur, start, lane });
  },
  addCombo: (id, start) => {
    const c = COMBOS.find((x) => x.id === id);
    if (!c) return;
    const t0 = start ?? get().time;
    get().commit((p) => {
      const fx = [...p.fx];
      for (const it of c.items) {
        const st = t0 + it.offset;
        fx.push(makeFx(it.type, st, it.dur, freeLane(fx, st, it.dur, 0), it.params, it.intensity ?? 1));
      }
      return { ...p, fx };
    });
    get().toast(`Added “${c.name}” combo`, 'success');
  },
  updateFx: (id, patch, live) => {
    const fn = (p: Project) => ({ ...p, fx: p.fx.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
    if (live) get().live(fn);
    else get().commit(fn);
  },

  setMusic: (mediaId) => {
    const same = get().project.music?.mediaId === mediaId;
    const shouldDetect = !!mediaId && (!same || get().project.beats.length === 0);
    get().pause();
    const media = get().media.find((m) => m.id === mediaId);
    const mediaDur = media?.duration && media.duration > 0 ? media.duration : 300;
    const firstTrack: MusicTrack = {
      id: uid(),
      mediaId: mediaId || '',
      start: 0,
      volume: 1,
      srcIn: 0,
      duration: mediaDur,
    };
    get().commit((p) => ({
      ...p,
      music: mediaId ? firstTrack : null,
      musicClips: mediaId ? [firstTrack] : [],
      beats: mediaId === p.music?.mediaId ? p.beats : [],
    }));
    if (mediaId && shouldDetect) void autoMarkBeats(mediaId);
    if (mediaId) void ensureMusicAnalysis(mediaId);
  },
  updateMusic: (patch, live) => {
    const fn = (p: Project) => {
      const mediaMap = new Map(get().media.map((m) => [m.id, m]));
      const list = getMusicClips(p, mediaMap);
      const targetId = get().selection?.kind === 'music' ? get().selection?.id : null;
      const updatedList = list.map((m) => (targetId && m.id === targetId) || (!targetId && m === list[0]) ? { ...m, ...patch } : m);
      return syncMusicProject(p, updatedList);
    };
    if (live) get().live(fn);
    else get().commit(fn);
    if (patch.volume !== undefined) audio.setVolume(patch.volume);
  },
  addBeat: (t) =>
    get().commit((p) => {
      if (p.beats.some((b) => Math.abs(b - t) < 0.04)) return p;
      return { ...p, beats: [...p.beats, t].sort((a, b) => a - b) };
    }),
  removeBeatNear: (t, tol = 0.08) =>
    get().commit((p) => {
      let bi = -1;
      p.beats.forEach((b, i) => {
        if (Math.abs(b - t) < tol && (bi < 0 || Math.abs(b - t) < Math.abs(p.beats[bi] - t))) bi = i;
      });
      return bi < 0 ? p : { ...p, beats: p.beats.filter((_, i) => i !== bi) };
    }),
  setBeats: (b) => get().commit((p) => ({ ...p, beats: [...b].sort((x, y) => x - y) })),

  setProjectProps: (props) => get().commit((p) => ({ ...p, ...props })),
  newProject: () => {
    get().pause();
    get().commit((p) => ({ ...emptyProject(), aspect: p.aspect }));
    set({ selection: null, time: 0 });
  },
  loadProject: (p) => set({ project: p, past: [], future: [], selection: null, time: 0 }),

  toast: (msg, kind = 'info') => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, msg, kind }] }));
    setTimeout(() => get().dismissToast(id), 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  bumpThumbs: () => set((s) => ({ thumbVersion: s.thumbVersion + 1 })),
}));
