import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import type { MediaItem } from '../types';
import { seekVideo, uid, waitEvent } from './utils';
import { audio, DEMO_BEAT_ID } from './audio';
import { drawDemo } from './demo';
import { useEditor } from '../store';
import { storeMediaBlob } from './mediaStorage';

// Explicit extensions and MIME types tailored for iOS Safari/WebKit & Chrome
// iOS Safari requires explicit extensions (.mp3) to prevent greying out files in the Files app.
export const AUDIO_ACCEPT = '.mp3,audio/mpeg,audio/mp3,.wav,audio/wav,.m4a,audio/x-m4a,audio/aac,.aac,.flac,.ogg,.opus,.weba,.aif,.aiff';
export const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v,.webm,.mkv';
export const ALL_MEDIA_ACCEPT = `${VIDEO_ACCEPT},${AUDIO_ACCEPT},*/*`;

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|avi|3gp)$/i;
const AUDIO_EXT = /\.(mp3|wav|wave|ogg|m4a|aac|flac|opus|weba|aif|aiff|caf|wma|mp2|m4b|m4p)$/i;

export function detectKind(f: File): 'video' | 'audio' | null {
  const name = f.name || '';
  const type = (f.type || '').toLowerCase();

  // 1. Explicit extension match (highest priority, ignores browser MIME quirks on mobile)
  if (AUDIO_EXT.test(name)) return 'audio';
  if (VIDEO_EXT.test(name)) return 'video';

  // 2. MIME type match
  if (
    type.startsWith('audio/') ||
    type === 'audio/mpeg' ||
    type === 'audio/mp3' ||
    type === 'audio/x-m4a' ||
    type === 'audio/aac' ||
    type === 'audio/wav' ||
    type === 'audio/x-wav' ||
    type === 'application/ogg'
  ) {
    return 'audio';
  }

  if (type.startsWith('video/')) return 'video';

  return null;
}

/** Asynchronously sniffs binary file headers if filename / MIME was missing or ambiguous. */
export async function detectKindAsync(f: File): Promise<'video' | 'audio' | null> {
  const syncKind = detectKind(f);
  if (syncKind) return syncKind;

  try {
    const head = new Uint8Array(await f.slice(0, 16).arrayBuffer());
    // MP3 ID3 header: 'ID3'
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return 'audio';
    // MP3 sync frame: 0xFF followed by 0xE0 mask
    if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'audio';
    // RIFF .... WAVE
    if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) {
      if (head[8] === 0x57 && head[9] === 0x41 && head[10] === 0x56 && head[11] === 0x45) return 'audio';
    }
    // OggS
    if (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return 'audio';
    // fLaC
    if (head[0] === 0x66 && head[1] === 0x4c && head[2] === 0x61 && head[3] === 0x43) return 'audio';
    // MP4 / MOV: bytes 4..7 are 'ftyp' or 'moov'
    const tag = String.fromCharCode(head[4], head[5], head[6], head[7]);
    if (tag === 'ftyp' || tag === 'moov') return 'video';
  } catch {
    // ignore
  }

  return null;
}

async function probeVideo(url: string) {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'metadata';
  v.src = url;
  await waitEvent(v, 'loadedmetadata');
  let duration = v.duration;
  if (!isFinite(duration)) {
    v.currentTime = 1e7;
    await waitEvent(v, 'seeked', 'error', 6000).catch(() => undefined);
    duration = v.duration;
  }
  const r = { duration: isFinite(duration) ? duration : 0, width: v.videoWidth, height: v.videoHeight };
  v.removeAttribute('src');
  v.load();
  return r;
}

async function probeMediabunny(file: File) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    const at = await input.getPrimaryAudioTrack();
    let fps = 0;
    if (vt) fps = (await vt.computePacketStats(90)).averagePacketRate;
    const duration = await input.computeDuration().catch(() => 0);
    return { fps, hasAudio: !!at, duration };
  } finally {
    input.dispose();
  }
}

/** Decode the embedded audio track from a video container using WebCodecs. */
export async function decodeEmbeddedAudio(id: string, blob: Blob): Promise<AudioBuffer | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new AudioBufferSink(track);
    const chunks: { buffer: AudioBuffer; timestamp: number }[] = [];
    let first = Infinity;
    let last = 0;
    for await (const part of sink.buffers()) {
      chunks.push(part);
      first = Math.min(first, part.timestamp);
      last = Math.max(last, part.timestamp + part.buffer.duration);
    }
    if (!chunks.length || !isFinite(first)) return null;
    const sr = chunks[0].buffer.sampleRate;
    const channels = Math.max(...chunks.map((c) => c.buffer.numberOfChannels));
    const out = audio.getCtx().createBuffer(channels, Math.max(1, Math.ceil((last - first) * sr)), sr);
    for (const part of chunks) {
      const offset = Math.max(0, Math.round((part.timestamp - first) * sr));
      const n = Math.min(part.buffer.length, out.length - offset);
      if (n <= 0) continue;
      for (let ch = 0; ch < channels; ch++) {
        const src = part.buffer.getChannelData(Math.min(ch, part.buffer.numberOfChannels - 1));
        out.getChannelData(ch).set(src.subarray(0, n), offset);
      }
    }
    audio.register(id, out);
    return out;
  } finally {
    input.dispose();
  }
}

export async function importFiles(files: File[]) {
  const pid = useEditor.getState().currentProjectId;
  for (const file of files) {
    const st = useEditor.getState();
    let kind = detectKind(file);
    if (!kind) {
      kind = await detectKindAsync(file);
    }
    if (!kind) {
      st.toast(`Unsupported file: ${file.name}`, 'error');
      continue;
    }
    const id = uid();
    const url = URL.createObjectURL(file);
    st.addMedia({ id, name: file.name, kind, url, file, duration: 0, width: 0, height: 0, fps: 30, status: 'loading' });
    try {
      if (kind === 'video') {
        const info = await probeVideo(url);
        let fps = 30;
        let hasAudio = true;
        try {
          const mb = await probeMediabunny(file);
          if (mb.fps > 1 && mb.fps < 241) fps = mb.fps;
          hasAudio = mb.hasAudio;
          if (!info.duration && mb.duration) info.duration = mb.duration;
        } catch {
          /* container not parseable by mediabunny, fall back to defaults */
        }
        if (!info.width || !info.duration) throw new Error('Could not read this video (unsupported codec?)');
        useEditor.getState().updateMedia(id, { ...info, fps: Math.round(fps * 1000) / 1000, hasAudio, status: 'ready' });
        try {
          void storeMediaBlob(id, file, {
            id,
            name: file.name,
            kind: 'video',
            duration: info.duration,
            width: info.width,
            height: info.height,
            fps,
            projectIds: pid ? [pid] : [],
          });
          await decodeEmbeddedAudio(id, file);
          useEditor.getState().updateMedia(id, { hasAudio: true });
          const live = useEditor.getState();
          if (live.playing) audio.scheduleClips(live.project.clips, live.time);
        } catch {
          /* video with no decodable audio track */
        }
        useEditor.getState().toast(`Imported video "${file.name}"`, 'success');
      } else {
        const arrayBuf = await file.arrayBuffer();
        const buf = await audio.decode(id, arrayBuf);
        useEditor.getState().updateMedia(id, { duration: buf.duration, status: 'ready' });
        void storeMediaBlob(id, file, {
          id,
          name: file.name,
          kind: 'audio',
          duration: buf.duration,
          width: 0,
          height: 0,
          fps: 0,
          projectIds: pid ? [pid] : [],
        });
        const s2 = useEditor.getState();
        s2.toast(`Imported song "${file.name}"`, 'success');
        if (!s2.project.music || s2.project.music.mediaId === DEMO_BEAT_ID) {
          s2.setMusic(id);
        }
      }
    } catch (e) {
      useEditor.getState().updateMedia(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
      useEditor.getState().toast(`Failed to import ${file.name}`, 'error');
    }
  }
}

export async function extractAudioAsMusic(media: MediaItem) {
  if (!media.file) return;
  const id = media.id + '-audio';
  if (!audio.buffers.has(id)) {
    useEditor.getState().toast('Extracting audio…', 'info');
    try {
      const buf = await audio.decode(id, await media.file.arrayBuffer());
      useEditor.getState().addMedia({
        id,
        name: media.name.replace(/\.[^.]+$/, '') + ' (audio)',
        kind: 'audio',
        url: '',
        duration: buf.duration,
        width: 0,
        height: 0,
        fps: 0,
        status: 'ready',
      });
    } catch {
      useEditor.getState().toast('Could not decode audio from this video', 'error');
      return;
    }
  }
  useEditor.getState().setMusic(id);
  useEditor.getState().toast('Video audio set as music track', 'success');
}

/* ------------------------------------------------------------------ */
/* Thumbnail service                                                   */
/* ------------------------------------------------------------------ */
class ThumbService {
  private cache = new Map<string, string>();
  private queue: { media: MediaItem; t: number; key: string }[] = [];
  private pending = new Set<string>();
  private vids = new Map<string, HTMLVideoElement>();
  private busy = false;
  private canvas = document.createElement('canvas');
  private bumpTimer: number | null = null;

  get(media: MediaItem | undefined, t: number): string | undefined {
    if (!media || media.status !== 'ready' || media.kind === 'audio') return undefined;
    const q = Math.max(0, Math.round(t * 4) / 4);
    const key = media.id + '@' + q;
    if (this.cache.has(key)) return this.cache.get(key) || undefined;
    if (!this.pending.has(key)) {
      this.pending.add(key);
      this.queue.push({ media, t: q, key });
      if (this.queue.length > 400) {
        const dropped = this.queue.shift();
        if (dropped) this.pending.delete(dropped.key);
      }
      void this.pump();
    }
    return undefined;
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const job = this.queue.pop()!;
        try {
          this.cache.set(job.key, await this.make(job.media, job.t));
        } catch {
          this.cache.set(job.key, '');
        }
        this.pending.delete(job.key);
        this.scheduleBump();
      }
    } finally {
      this.busy = false;
    }
  }

  private async make(media: MediaItem, t: number): Promise<string> {
    const w = 160;
    const h = Math.max(2, Math.round((w * (media.height || 9)) / (media.width || 16)));
    const c = this.canvas;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    if (media.kind === 'demo') {
      drawDemo(ctx, media.demoId || 'swing', Math.min(t, media.duration), w, h);
    } else {
      let v = this.vids.get(media.url);
      if (!v) {
        v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.src = media.url;
        this.vids.set(media.url, v);
        await waitEvent(v, 'loadeddata').catch(() => undefined);
      }
      await seekVideo(v, Math.min(t, Math.max(0, media.duration - 0.05)));
      ctx.drawImage(v, 0, 0, w, h);
    }
    return c.toDataURL('image/jpeg', 0.72);
  }

  private scheduleBump() {
    if (this.bumpTimer !== null) return;
    this.bumpTimer = window.setTimeout(() => {
      this.bumpTimer = null;
      useEditor.getState().bumpThumbs();
    }, 150);
  }
}

export const thumbs = new ThumbService();
