export interface SerializedMediaMeta {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'demo';
  duration: number;
  width: number;
  height: number;
  fps: number;
  demoId?: string;
  /** Projects that use this file. A blob is shared (not copied) when a project is duplicated. */
  projectIds?: string[];
}

export interface StoredMedia {
  id: string;
  blob: Blob;
  meta: SerializedMediaMeta;
}

const DB_NAME = 'editverse_db';
const DB_VERSION = 1;
const STORE_NAME = 'media_blobs';

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

export async function storeMediaBlob(id: string, file: Blob, meta: SerializedMediaMeta): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id, blob: file, meta });
    await done(tx);
  } catch (e) {
    console.warn('Editverse: failed to persist media blob', e);
  }
}

export async function loadAllMediaBlobs(): Promise<StoredMedia[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    return await new Promise((res, rej) => {
      req.onsuccess = () => res((req.result as StoredMedia[]) || []);
      req.onerror = () => rej(req.error);
    });
  } catch (e) {
    console.warn('Editverse: failed to read media from IndexedDB', e);
    return [];
  }
}

export async function loadMediaForProject(pid: string): Promise<StoredMedia[]> {
  return (await loadAllMediaBlobs()).filter((m) => (m.meta.projectIds ?? []).includes(pid));
}

/** Rewrite media records in one transaction. `fn` returns the new meta, or null to delete the blob. */
async function rewrite(fn: (m: StoredMedia) => SerializedMediaMeta | null | undefined): Promise<void> {
  try {
    const all = await loadAllMediaBlobs();
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const m of all) {
      const next = fn(m);
      if (next === undefined) continue;
      if (next === null) store.delete(m.id);
      else store.put({ ...m, meta: next });
    }
    await done(tx);
  } catch (e) {
    console.warn('Editverse: media update failed', e);
  }
}

/** Legacy records (pre multi-project) get attached to the migrated project. */
export function assignUntaggedMedia(pid: string) {
  return rewrite((m) => (m.meta.projectIds?.length ? undefined : { ...m.meta, projectIds: [pid] }));
}

/** A duplicated project shares its source's files. */
export function shareMedia(fromPid: string, toPid: string) {
  return rewrite((m) => {
    const ids = m.meta.projectIds ?? [];
    return ids.includes(fromPid) && !ids.includes(toPid) ? { ...m.meta, projectIds: [...ids, toPid] } : undefined;
  });
}

/** Detach every file from a deleted project; blobs nobody uses any more are removed. */
export function releaseProjectMedia(pid: string) {
  return rewrite((m) => {
    const ids = m.meta.projectIds ?? [];
    if (!ids.includes(pid)) return undefined;
    const rest = ids.filter((x) => x !== pid);
    return rest.length ? { ...m.meta, projectIds: rest } : null;
  });
}

/** Remove one file from one project's bin. */
export function detachMedia(id: string, pid: string | null) {
  return rewrite((m) => {
    if (m.id !== id) return undefined;
    const rest = pid ? (m.meta.projectIds ?? []).filter((x) => x !== pid) : [];
    return rest.length ? { ...m.meta, projectIds: rest } : null;
  });
}

export async function mediaUsageMB(): Promise<number> {
  const all = await loadAllMediaBlobs();
  return Math.round(all.reduce((s, m) => s + (m.blob?.size ?? 0), 0) / (1024 * 1024));
}
