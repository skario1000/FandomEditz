import type { Aspect, Project } from '../types';
import { totalDuration } from './velocity';

/* ------------------------------------------------------------------ */
/* Multi-project persistence (project JSON lives in localStorage;       */
/* media blobs live in IndexedDB, see mediaStorage.ts)                  */
/* ------------------------------------------------------------------ */

export const LEGACY_KEY = 'editverse_project_v1';
const INDEX_KEY = 'editverse_projects_v1';
const dataKey = (id: string) => `editverse_proj_${id}`;
const AUTO_SAVE_DELAY = 900;

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspect: Aspect;
  duration: number;
  clips: number;
  fx: number;
  thumbs: string[];
  music?: string;
  template?: string;
}

export interface ProjectExtras {
  thumbs: string[];
  music?: string;
}

let activeId: string | null = null;
let saveTimer: number | null = null;
let pending: Project | null = null;
let extrasProvider: ((p: Project) => ProjectExtras) | null = null;
let stateListener: ((s: 'saving' | 'saved' | 'error') => void) | null = null;

export function setExtrasProvider(fn: (p: Project) => ProjectExtras) {
  extrasProvider = fn;
}
export function setSaveListener(fn: (s: 'saving' | 'saved' | 'error') => void) {
  stateListener = fn;
}
export function setActiveProject(id: string | null) {
  activeId = id;
}
export function getActiveProject(): string | null {
  return activeId;
}

/* ------------------------------ index ------------------------------ */
export function listProjects(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const arr = raw ? (JSON.parse(raw) as ProjectMeta[]) : [];
    return Array.isArray(arr) ? arr.filter((m) => m && typeof m.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(list: ProjectMeta[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export function getMeta(id: string): ProjectMeta | undefined {
  return listProjects().find((m) => m.id === id);
}

export function upsertMeta(meta: ProjectMeta) {
  const list = listProjects().filter((m) => m.id !== meta.id);
  list.push(meta);
  writeIndex(list);
}

export function patchMeta(id: string, patch: Partial<ProjectMeta>) {
  const list = listProjects();
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch };
  writeIndex(list);
}

export function removeMeta(id: string) {
  writeIndex(listProjects().filter((m) => m.id !== id));
}

/* ------------------------------ data ------------------------------- */
export function saveProjectData(id: string, project: Project) {
  localStorage.setItem(dataKey(id), JSON.stringify(project));
}

export function loadProjectData(id: string): Project | null {
  try {
    const raw = localStorage.getItem(dataKey(id));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && Array.isArray(p.clips) && Array.isArray(p.fx) ? (p as Project) : null;
  } catch {
    return null;
  }
}

export function removeProjectData(id: string) {
  localStorage.removeItem(dataKey(id));
}

export function readLegacyProject(): Project | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && Array.isArray(p.clips) && Array.isArray(p.fx) ? (p as Project) : null;
  } catch {
    return null;
  }
}

export function clearLegacyProject() {
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(LEGACY_KEY + '_time');
}

/** Summary fields shown on project cards. */
export function summarize(project: Project): Pick<ProjectMeta, 'aspect' | 'duration' | 'clips' | 'fx'> {
  return { aspect: project.aspect, duration: totalDuration(project.clips), clips: project.clips.length, fx: project.fx.length };
}

/** Writes project data + refreshes its card metadata. Keeps old thumbnails if new ones are not ready yet. */
export function writeProject(id: string, project: Project) {
  saveProjectData(id, project);
  const prev = getMeta(id);
  const extras = extrasProvider ? extrasProvider(project) : { thumbs: [] as string[] };
  const thumbs = extras.thumbs.length ? extras.thumbs : (prev?.thumbs ?? []);
  const now = Date.now();
  upsertMeta({
    id,
    name: prev?.name ?? 'Untitled edit',
    createdAt: prev?.createdAt ?? now,
    template: prev?.template,
    ...summarize(project),
    updatedAt: now,
    thumbs,
    music: extras.music ?? prev?.music,
  });
}

/* ---------------------------- autosave ----------------------------- */
function doSave() {
  saveTimer = null;
  const p = pending;
  pending = null;
  if (!p || !activeId) return;
  try {
    writeProject(activeId, p);
    stateListener?.('saved');
  } catch (e) {
    console.warn('Editverse: autosave failed', e);
    stateListener?.('error');
  }
}

export function scheduleAutosave(project: Project): void {
  if (!activeId) return;
  pending = project;
  stateListener?.('saving');
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(doSave, AUTO_SAVE_DELAY);
}

/** Save immediately (leaving the editor, closing the tab). */
export function flushAutosave(project?: Project) {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (project) pending = project;
  doSave();
}

export function storageUsage(): { usedKB: number } {
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('editverse_')) bytes += (localStorage.getItem(k)?.length ?? 0) * 2;
    }
  } catch {
    /* ignore */
  }
  return { usedKB: Math.round(bytes / 1024) };
}
