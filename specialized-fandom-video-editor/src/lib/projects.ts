import type { Aspect, MediaItem, Project } from '../types';
import { emptyProject, makeClip, makeFx, useEditor } from '../store';
import {
  clearLegacyProject,
  flushAutosave,
  getMeta,
  listProjects,
  loadProjectData,
  patchMeta,
  readLegacyProject,
  removeMeta,
  removeProjectData,
  saveProjectData,
  setActiveProject,
  setExtrasProvider,
  setSaveListener,
  summarize,
  upsertMeta,
  type ProjectExtras,
} from './storage';
import { assignUntaggedMedia, loadMediaForProject, releaseProjectMedia, shareMedia } from './mediaStorage';
import { audio, DEMO_BEAT_ID } from './audio';
import { decodeEmbeddedAudio, importFiles, thumbs } from './media';
import { buildSampleProject } from './sample';
import { autoMicrowave, autoVelocity } from './tools';
import { clipSourceTime, layoutClips } from './velocity';
import { colorFromPreset } from './colorPresets';
import { LIB_BY_ID } from './effects';
import { uid } from './utils';

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */
export type TemplateId = 'blank' | 'showcase' | 'microwave' | 'velocity';

export const TEMPLATES: { id: TemplateId; name: string; desc: string; icon: string; accent: string }[] = [
  { id: 'blank', name: 'Blank edit', desc: 'Empty timeline. Bring your own scenes and song.', icon: '＋', accent: '#a1a1aa' },
  { id: 'showcase', name: 'Showcase', desc: 'Full demo: twixtor intro, velocity, microwave drop, titles.', icon: '🕷️', accent: '#ff2d55' },
  { id: 'microwave', name: 'Microwave starter', desc: 'Cut on every beat with the microwave time remap.', icon: '🍿', accent: '#fb923c' },
  { id: 'velocity', name: 'Velocity starter', desc: 'Cuts every 2 beats, speed ramps and zoom punches.', icon: '📈', accent: '#a78bfa' },
];

let demoBeat: { beats: number[]; bpm: number } | null = null;
export function setDemoBeat(beats: number[], bpm: number) {
  demoBeat = { beats, bpm };
}

function beatGrid() {
  const bpm = demoBeat?.bpm ?? 130;
  const beat = 60 / bpm;
  return { beat, beats: demoBeat?.beats ?? Array.from({ length: 32 }, (_, i) => i * beat) };
}

function starter(): Project {
  const { beat, beats } = beatGrid();
  const span = 4 * beat;
  const clips = [
    { ...makeClip('demo-swing', 0.4, 0.4 + span), color: colorFromPreset('spidey') },
    { ...makeClip('demo-rooftop', 4.4, 4.4 + span), color: colorFromPreset('golden') },
    { ...makeClip('demo-swing', 4.2, 4.2 + span), color: colorFromPreset('spidey') },
    { ...makeClip('demo-rooftop', 5.5, 5.5 + span), color: colorFromPreset('golden') },
  ];
  return { ...emptyProject(), clips, beats, music: { mediaId: DEMO_BEAT_ID, start: 0, volume: 0.9 } };
}

function withTitle(p: Project, presetId: string, text: string): Project {
  const e = LIB_BY_ID[presetId];
  if (!e) return p;
  return { ...p, fx: [...p.fx, makeFx('text', 0.05, e.dur ?? 1.8, 2, { ...(e.params ?? {}), text })] };
}

export function buildTemplate(t: TemplateId, aspect: Aspect): Project {
  const { beat, beats } = beatGrid();
  let p: Project;
  switch (t) {
    case 'showcase':
      p = buildSampleProject(beats, beat);
      break;
    case 'microwave':
      p = withTitle(autoMicrowave(starter()), 'textTurb', 'MICROWAVE');
      break;
    case 'velocity':
      p = withTitle(autoVelocity(starter()), 'textGlow', 'VELOCITY');
      break;
    default:
      p = emptyProject();
  }
  return { ...p, aspect };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const bumpLibrary = () => useEditor.setState((s) => ({ libraryVersion: s.libraryVersion + 1 }));
const isUserMedia = (m: MediaItem) => m.kind !== 'demo' && m.id !== DEMO_BEAT_ID;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Card thumbnails: three frames (start, middle, end) from the clips of the project. */
function extras(p: Project, mediaMap?: Map<string, MediaItem>): ProjectExtras {
  const media = mediaMap ?? new Map(useEditor.getState().media.map((m) => [m.id, m]));
  const l = layoutClips(p.clips);
  const picks = l.length <= 3 ? l : [l[0], l[Math.floor(l.length / 2)], l[l.length - 1]];
  const got = picks.map((x) => thumbs.get(media.get(x.clip.mediaId), clipSourceTime(x.clip, (x.end - x.start) * 0.5)));
  const ready = got.filter((s): s is string => !!s);
  return { thumbs: picks.length && ready.length === picks.length ? ready : [], music: p.music ? media.get(p.music.mediaId)?.name : undefined };
}

/** Wait briefly for thumbnails to render, then store them on the card without touching "last edited". */
async function refreshCard(id: string, project: Project, waitMs = 1500, media?: Map<string, MediaItem>) {
  let ex = extras(project, media);
  for (let waited = 0; project.clips.length && !ex.thumbs.length && waited < waitMs; waited += 150) {
    await sleep(150);
    ex = extras(project, media);
  }
  if (!getMeta(id)) return;
  const patch: Parameters<typeof patchMeta>[1] = { ...summarize(project) };
  if (ex.thumbs.length || !project.clips.length) patch.thumbs = ex.thumbs;
  if (ex.music) patch.music = ex.music;
  patchMeta(id, patch);
  bumpLibrary();
}

function unloadUserMedia(revoke = true) {
  const st = useEditor.getState();
  for (const m of st.media) {
    if (!isUserMedia(m)) continue;
    if (revoke && m.url) URL.revokeObjectURL(m.url);
    audio.buffers.delete(m.id);
    audio.peaks.delete(m.id);
  }
  useEditor.setState({ media: st.media.filter((m) => !isUserMedia(m)), sourceId: null, viewer: 'program', selection: null });
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */
export async function initProjects() {
  setExtrasProvider(extras);
  setSaveListener((s) => useEditor.getState().ui({ saveState: s }));
  window.addEventListener('beforeunload', () => flushAutosave());

  if (!listProjects().length) {
    const legacy = readLegacyProject();
    if (legacy) {
      const id = uid();
      const now = Date.now();
      upsertMeta({ id, name: 'My edit', createdAt: now, updatedAt: now, ...summarize(legacy), thumbs: [] });
      saveProjectData(id, legacy);
      await assignUntaggedMedia(id);
      clearLegacyProject();
    } else {
      await createProject('showcase', '9:16', { name: 'Spider-Verse showcase', open: false });
    }
  }
  bumpLibrary();
}

export async function openProject(id: string) {
  const st = useEditor.getState();
  if (st.opening) return;
  const meta = getMeta(id);
  if (!meta) {
    st.toast('That project no longer exists', 'error');
    bumpLibrary();
    return;
  }
  if (st.currentProjectId && st.currentProjectId !== id) await closeProject(false);
  st.ui({ opening: true });

  const project = loadProjectData(id) ?? { ...emptyProject(), aspect: meta.aspect };
  const stored = await loadMediaForProject(id);
  const musicId = project.music?.mediaId;
  const items: MediaItem[] = [];
  const jobs: { first: boolean; run: () => Promise<void> }[] = [];

  for (const it of stored) {
    const url = URL.createObjectURL(it.blob);
    const file = new File([it.blob], it.meta.name, { type: it.blob.type });
    if (it.meta.kind === 'audio') {
      items.push({ id: it.id, name: it.meta.name, kind: 'audio', url, file, duration: it.meta.duration, width: 0, height: 0, fps: 0, status: 'loading' });
      jobs.push({
        first: it.id === musicId,
        run: async () => {
          try {
            const buf = await audio.decode(it.id, await it.blob.arrayBuffer());
            useEditor.getState().updateMedia(it.id, { duration: buf.duration || it.meta.duration, status: 'ready' });
          } catch {
            useEditor.getState().updateMedia(it.id, { status: 'error', error: 'Could not decode audio' });
          }
        },
      });
    } else {
      items.push({ id: it.id, name: it.meta.name, kind: 'video', url, file, duration: it.meta.duration, width: it.meta.width, height: it.meta.height, fps: it.meta.fps || 30, status: 'ready' });
      const derived = it.id + '-audio';
      jobs.push({
        first: musicId === derived,
        run: async () => {
          try {
            const buf = await decodeEmbeddedAudio(it.id, it.blob);
            if (!buf) return;
            useEditor.getState().updateMedia(it.id, { hasAudio: true });
            if (musicId === derived) {
              audio.register(derived, buf);
              useEditor.getState().addMedia({ id: derived, name: it.meta.name.replace(/\.[^.]+$/, '') + ' (audio)', kind: 'audio', url: '', duration: buf.duration, width: 0, height: 0, fps: 0, status: 'ready' });
            }
          } catch {
            /* no audio track */
          }
        },
      });
    }
  }

  useEditor.setState((s) => ({ media: [...s.media.filter((m) => !isUserMedia(m)), ...items] }));
  setActiveProject(id);
  st.loadProject(project);
  st.ui({
    currentProjectId: id,
    projectName: meta.name,
    screen: 'editor',
    opening: false,
    saveState: 'saved',
    viewer: 'program',
    sourceId: null,
    time: 0,
    leftTab: 'media',
    mobileDrawer: project.clips.length === 0 ? 'clips' : 'none',
  });

  const known = new Set(useEditor.getState().media.map((m) => m.id));
  const missing = project.clips.filter((c) => !known.has(c.mediaId)).length;
  if (missing) st.toast(`${missing} clip${missing > 1 ? 's' : ''} reference media that is no longer stored`, 'error');

  // decode sound in the background — the song first, so playback has music straight away
  void (async () => {
    for (const j of [...jobs.filter((j) => j.first), ...jobs.filter((j) => !j.first)]) {
      if (useEditor.getState().currentProjectId !== id) return;
      await j.run();
    }
    const live = useEditor.getState();
    if (live.currentProjectId !== id) return;
    if (live.project.music && !live.project.beats.length) live.setMusic(live.project.music.mediaId);
    if (live.playing) audio.scheduleClips(live.project.clips, live.time);
    void refreshCard(id, live.project, 2500);
  })();
}

export async function closeProject(goHome = true) {
  const st = useEditor.getState();
  st.pause();
  const id = st.currentProjectId;
  const project = st.project;
  const media = new Map(st.media.map((m) => [m.id, m]));
  const urls = st.media.filter((m) => isUserMedia(m) && m.url).map((m) => m.url);
  if (id) flushAutosave();
  setActiveProject(null);
  unloadUserMedia(false);
  st.loadProject(emptyProject());
  st.ui({ currentProjectId: null, projectName: '', exportOpen: false, ...(goHome ? { screen: 'home' as const } : {}) });
  bumpLibrary();
  // capture card thumbnails in the background; clip URLs are released once that is done
  const card = id ? refreshCard(id, project, 1200, media) : Promise.resolve();
  void card.finally(() => urls.forEach((u) => URL.revokeObjectURL(u)));
}

function nextName(base: string) {
  const names = new Set(listProjects().map((m) => m.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

export async function createProject(t: TemplateId, aspect: Aspect, o: { name?: string; open?: boolean } = {}) {
  const id = uid();
  const project = buildTemplate(t, aspect);
  const now = Date.now();
  const tpl = TEMPLATES.find((x) => x.id === t);
  upsertMeta({ id, name: o.name?.trim() || nextName(t === 'blank' ? 'Untitled edit' : tpl?.name ?? 'Edit'), createdAt: now, updatedAt: now, ...summarize(project), thumbs: [], template: t });
  saveProjectData(id, project);
  bumpLibrary();
  if (o.open !== false) await openProject(id);
  else void refreshCard(id, project);
  return id;
}

/** Drop files on the start screen → new project named after the first clip, files imported. */
export async function createProjectFromFiles(files: File[], aspect: Aspect = '9:16') {
  const first = files.find((f) => f.type.startsWith('video/')) ?? files[0];
  const name = first ? first.name.replace(/\.[^.]+$/, '').slice(0, 40) : undefined;
  await createProject('blank', aspect, { name: name ? nextName(name) : undefined });
  await importFiles(files);
}

export function renameProject(id: string, name: string) {
  const clean = name.trim().slice(0, 80) || 'Untitled edit';
  patchMeta(id, { name: clean, updatedAt: Date.now() });
  if (useEditor.getState().currentProjectId === id) useEditor.getState().ui({ projectName: clean });
  bumpLibrary();
}

export async function duplicateProject(id: string) {
  const meta = getMeta(id);
  const data = id === useEditor.getState().currentProjectId ? useEditor.getState().project : loadProjectData(id);
  if (!meta || !data) return;
  const nid = uid();
  const now = Date.now();
  saveProjectData(nid, data);
  upsertMeta({ ...meta, id: nid, name: nextName(`${meta.name} copy`), createdAt: now, updatedAt: now });
  await shareMedia(id, nid);
  bumpLibrary();
  useEditor.getState().toast(`Duplicated “${meta.name}”`, 'success');
}

export async function deleteProject(id: string) {
  const meta = getMeta(id);
  if (useEditor.getState().currentProjectId === id) await closeProject();
  removeProjectData(id);
  removeMeta(id);
  await releaseProjectMedia(id);
  bumpLibrary();
  if (meta) useEditor.getState().toast(`Deleted “${meta.name}”`, 'info');
}
