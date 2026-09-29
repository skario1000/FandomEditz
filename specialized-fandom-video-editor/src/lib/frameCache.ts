import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Clip, MediaItem } from '../types';
import { clamp } from './utils';

export interface CacheEntry {
  key: string;
  frames: ImageBitmap[];
  a: number;
  fps: number;
  ready: boolean;
  failed: boolean;
  used: number;
  bytes: number;
  w: number;
  h: number;
}

interface Src {
  input: Input;
  big: CanvasSink;
  small: CanvasSink;
  offset: number;
}

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);
const BUDGET = 256 * 1024 * 1024;

/**
 * Decodes short source ranges into ImageBitmaps (WebCodecs via mediabunny) so reversed,
 * microwave, boomerang and twixtor clips preview smoothly with exact frame blending.
 */
export class FrameCache {
  private entries = new Map<string, CacheEntry>();
  private srcs = new Map<string, Promise<Src | null>>();
  private chain: Promise<void> = Promise.resolve();
  onReady: () => void = () => undefined;

  static wants(clip: Clip, media: MediaItem): boolean {
    if (media.kind !== 'video' || !media.file || media.status !== 'ready') return false;
    if (clip.srcOut - clip.srcIn > 4.5) return false;
    const p = clip.velocity.preset;
    return clip.reverse || clip.twixtor || p === 'microwave' || p === 'boomerang';
  }

  private getSrc(media: MediaItem): Promise<Src | null> {
    let p = this.srcs.get(media.id);
    if (!p) {
      p = (async () => {
        try {
          const input = new Input({ source: new BlobSource(media.file!), formats: ALL_FORMATS });
          const track = await input.getPrimaryVideoTrack();
          if (!track || !(await track.canDecode())) {
            input.dispose();
            return null;
          }
          const first = await track.getFirstTimestamp().catch(() => 0);
          const dw = track.displayWidth;
          const dh = track.displayHeight;
          const mk = (maxDim: number) => {
            const sc = Math.min(1, maxDim / Math.max(dw, dh));
            return new CanvasSink(track, { width: even(dw * sc), height: even(dh * sc), fit: 'fill', poolSize: 2 });
          };
          return { input, big: mk(900), small: mk(520), offset: first > 0 && first < 1 ? first : 0 };
        } catch {
          return null;
        }
      })();
      this.srcs.set(media.id, p);
    }
    return p;
  }

  get(clip: Clip, media: MediaItem): CacheEntry | null {
    const fps = Math.min(60, media.fps || 30);
    const key = `${media.id}|${clip.srcIn.toFixed(3)}|${clip.srcOut.toFixed(3)}`;
    let e = this.entries.get(key);
    if (!e) {
      const entry: CacheEntry = { key, frames: [], a: clip.srcIn, fps, ready: false, failed: false, used: performance.now(), bytes: 0, w: 0, h: 0 };
      this.entries.set(key, entry);
      this.chain = this.chain
        .then(() => this.decode(entry, media, clip.srcIn, clip.srcOut))
        .catch(() => {
          entry.failed = true;
        });
      e = entry;
    }
    e.used = performance.now();
    return e.ready ? e : null;
  }

  frameAt(e: CacheEntry, s: number) {
    const f = clamp((s - e.a) * e.fps, 0, e.frames.length - 1);
    const i0 = Math.floor(f);
    return { i0, i1: Math.min(e.frames.length - 1, i0 + 1), frac: f - i0 };
  }

  private async decode(e: CacheEntry, media: MediaItem, a: number, b: number) {
    if (!this.entries.has(e.key)) return;
    if (performance.now() - e.used > 700) {
      // no longer requested (e.g. intermediate range while trimming) — skip the work
      this.entries.delete(e.key);
      return;
    }
    const src = await this.getSrc(media);
    if (!src) {
      e.failed = true;
      return;
    }
    const n = Math.max(1, Math.ceil((b - a) * e.fps - 1e-6) + 1);
    const sink = n > 45 ? src.small : src.big;
    const ts = Array.from({ length: n }, (_, k) => Math.min(b, a + k / e.fps) + src.offset + 1e-4);
    const frames: ImageBitmap[] = [];
    for await (const wc of sink.canvasesAtTimestamps(ts)) {
      if (!this.entries.has(e.key)) {
        new Set(frames).forEach((f) => f.close());
        return;
      }
      if (wc) frames.push(await createImageBitmap(wc.canvas));
      else if (frames.length) frames.push(frames[frames.length - 1]);
    }
    if (!frames.length) {
      e.failed = true;
      return;
    }
    e.frames = frames;
    e.w = frames[0].width;
    e.h = frames[0].height;
    e.bytes = new Set(frames).size * e.w * e.h * 4;
    e.ready = true;
    this.evict();
    this.onReady();
  }

  private evict() {
    let total = 0;
    for (const e of this.entries.values()) total += e.bytes;
    if (total <= BUDGET) return;
    const now = performance.now();
    const list = [...this.entries.values()].filter((e) => e.ready).sort((x, y) => x.used - y.used);
    for (const e of list) {
      if (total <= BUDGET) break;
      if (now - e.used < 500) continue;
      total -= e.bytes;
      new Set(e.frames).forEach((f) => f.close());
      this.entries.delete(e.key);
    }
  }

  dispose() {
    for (const e of this.entries.values()) new Set(e.frames).forEach((f) => f.close());
    this.entries.clear();
    for (const p of this.srcs.values()) void p.then((s) => s?.input.dispose());
    this.srcs.clear();
  }
}
