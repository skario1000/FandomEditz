import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { MediaItem, Project } from '../types';
import { Renderer } from '../gl/renderer';
import { computeFrame } from './compose';
import { totalDuration } from './velocity';
import { DemoRenderer } from './demo';
import { drawTexts } from './overlay';
import { mixTimelineAudio, ensureMusicAnalysis } from './audio';
import { seekVideo, waitEvent } from './utils';

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  quality: 'medium' | 'high' | 'very-high';
  format: 'mp4' | 'webm';
}

export interface ExportProgress {
  frame: number;
  total: number;
  phase: string;
}

interface FrameSource {
  sink: CanvasSink | null;
  input: Input | null;
  offset: number;
  el: HTMLVideoElement | null;
}

async function openSource(media: MediaItem): Promise<FrameSource> {
  if (media.file) {
    try {
      const input = new Input({ source: new BlobSource(media.file), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (track && (await track.canDecode())) {
        const dw = track.displayWidth;
        const dh = track.displayHeight;
        const sc = Math.min(1, 1920 / Math.max(dw, dh));
        const first = await track.getFirstTimestamp().catch(() => 0);
        const sink = new CanvasSink(track, { width: Math.max(2, Math.round((dw * sc) / 2) * 2), height: Math.max(2, Math.round((dh * sc) / 2) * 2), fit: 'fill', poolSize: 4 });
        return { sink, input, offset: first > 0 && first < 1 ? first : 0, el: null };
      }
      input.dispose();
    } catch {
      /* fall back to the video element */
    }
  }
  const el = document.createElement('video');
  el.muted = true;
  el.preload = 'auto';
  el.src = media.url;
  await waitEvent(el, 'loadeddata').catch(() => undefined);
  return { sink: null, input: null, offset: 0, el };
}

export async function runExport(
  project: Project,
  media: MediaItem[],
  opts: ExportOptions,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal
): Promise<Blob> {
  const mediaMap = new Map(media.map((m) => [m.id, m]));
  const total = totalDuration(project.clips);
  if (total <= 0) throw new Error('The timeline is empty.');
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser does not support WebCodecs video encoding. Please use a recent Chrome, Edge or Safari.');
  const { width: W, height: H, fps } = opts;
  const N = Math.max(1, Math.round(total * fps));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const renderer = new Renderer(canvas, true);
  renderer.resize(W, H);
  const demoA = new DemoRenderer(1280, 720);
  const demoB = new DemoRenderer(1280, 720);
  const overlay = document.createElement('canvas');
  overlay.width = W;
  overlay.height = H;
  const octx = overlay.getContext('2d')!;

  const format = opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
  const vcodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width: W, height: H });
  if (!vcodec) throw new Error(`No ${opts.format.toUpperCase()} video encoder available in this browser at ${W}×${H}. Try the other format or a lower resolution.`);
  const output = new Output({ format, target: new BufferTarget() });
  const vsrc = new CanvasSource(canvas, { codec: vcodec, quality: new Quality(opts.quality), keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: fps });

  const mix = await mixTimelineAudio(project, total);
  // Music-reactive effects are baked from the track's envelopes — make sure they
  // exist before the first frame is rendered, or the export would be flat.
  await ensureMusicAnalysis(project.music?.mediaId);
  let asrc: AudioBufferSource | null = null;
  if (mix) {
    const acodec = await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), { numberOfChannels: 2, sampleRate: 48000 });
    if (acodec) {
      asrc = new AudioBufferSource({ codec: acodec, quality: new Quality('high') });
      output.addAudioTrack(asrc);
    }
  }

  const sources = new Map<string, FrameSource>();
  const cleanup = () => {
    for (const s of sources.values()) {
      s.input?.dispose();
      if (s.el) {
        s.el.removeAttribute('src');
        s.el.load();
      }
    }
    renderer.dispose();
  };

  try {
    await output.start();
    if (asrc && mix) {
      onProgress({ frame: 0, total: N, phase: 'Mixing audio' });
      await asrc.add(mix);
      asrc.close();
    }

    // plan every frame's source requests
    type Req = { mediaId: string; ts: number[]; blend: number; kind: 'video' | 'demo' } | null;
    const reqs: Req[] = [];
    for (let i = 0; i < N; i++) {
      const d = computeFrame(project, mediaMap, i / fps, W, H);
      const m = d.media;
      if (!d.clip || !m || m.status !== 'ready' || m.kind === 'audio') {
        reqs.push(null);
        continue;
      }
      const sfps = m.fps || 30;
      const maxT = Math.max(0, m.duration - 0.5 / sfps);
      const s = Math.min(Math.max(0, d.srcTime), maxT);
      if (d.clip.twixtor) {
        const f = s * sfps;
        const i0 = Math.floor(f + 1e-6);
        reqs.push({ mediaId: m.id, ts: [i0 / sfps, Math.min(maxT, (i0 + 1) / sfps)], blend: f - i0, kind: m.kind });
      } else reqs.push({ mediaId: m.id, ts: [s], blend: 0, kind: m.kind });
    }

    const renderFrame = async (i: number, hasSource: boolean, useAccum: boolean, srcW?: number, srcH?: number) => {
      const d = computeFrame(project, mediaMap, i / fps, W, H, 32, srcW, srcH);
      const hasOverlay = d.fx.texts.length > 0;
      if (hasOverlay) {
        drawTexts(octx, W, H, d.fx.texts, d.fx.geo);
        renderer.uploadOverlay(overlay);
      }
      renderer.render(d, { useAccum, hasSource, time: i / fps, overlay: hasOverlay });
      await vsrc.add(i / fps, 1 / fps);
      onProgress({ frame: i + 1, total: N, phase: 'Rendering' });
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
    };

    const applyBlend = (req: NonNullable<Req>, gotB: boolean) => {
      if (req.ts.length < 2) return false;
      renderer.accumulate('A', 1, true);
      if (gotB && req.blend > 0.01) renderer.accumulate('B', req.blend, false);
      return true;
    };

    let i = 0;
    while (i < N) {
      const r0 = reqs[i];
      if (!r0) {
        await renderFrame(i, false, false);
        i++;
        continue;
      }
      if (r0.kind === 'demo') {
        const m = mediaMap.get(r0.mediaId)!;
        const fpsD = m.fps || 24;
        renderer.upload('A', demoA.render(m.demoId || 'swing', r0.ts.length > 1 ? r0.ts[0] : Math.floor(r0.ts[0] * fpsD + 1e-6) / fpsD), 1280, 720);
        let useAccum = false;
        if (r0.ts.length > 1) {
          renderer.upload('B', demoB.render(m.demoId || 'swing', r0.ts[1]), 1280, 720);
          useAccum = applyBlend(r0, true);
        }
        await renderFrame(i, true, useAccum);
        i++;
        continue;
      }
      // contiguous run of frames from the same video media
      let j = i;
      const tsList: number[] = [];
      while (j < N && reqs[j]?.mediaId === r0.mediaId && reqs[j]?.kind === 'video') {
        tsList.push(...reqs[j]!.ts);
        j++;
      }
      let src = sources.get(r0.mediaId);
      if (!src) {
        onProgress({ frame: i, total: N, phase: 'Opening media' });
        src = await openSource(mediaMap.get(r0.mediaId)!);
        sources.set(r0.mediaId, src);
      }
      if (src.sink) {
        const it = src.sink.canvasesAtTimestamps(tsList.map((t) => t + src!.offset + 1e-4));
        try {
          for (let f = i; f < j; f++) {
            const req = reqs[f]!;
            let got = 0;
            let cw = 0;
            let ch = 0;
            for (let k = 0; k < req.ts.length; k++) {
              const res = await it.next();
              const wc = res.value;
              if (wc && wc.canvas) {
                renderer.upload(k === 0 ? 'A' : 'B', wc.canvas as HTMLCanvasElement, wc.canvas.width, wc.canvas.height);
                if (k === 0) {
                  cw = wc.canvas.width;
                  ch = wc.canvas.height;
                }
                got++;
              }
            }
            const useAccum = got > 0 ? applyBlend(req, got > 1) : false;
            await renderFrame(f, got > 0, useAccum, cw, ch);
          }
        } finally {
          await it.return?.(undefined);
        }
      } else if (src.el) {
        const el = src.el;
        for (let f = i; f < j; f++) {
          const req = reqs[f]!;
          for (let k = 0; k < req.ts.length; k++) {
            await seekVideo(el, req.ts[k]);
            renderer.upload(k === 0 ? 'A' : 'B', el, el.videoWidth, el.videoHeight);
          }
          await renderFrame(f, el.readyState >= 2, applyBlend(req, true), el.videoWidth, el.videoHeight);
        }
      }
      i = j;
    }

    vsrc.close();
    onProgress({ frame: N, total: N, phase: 'Finalizing' });
    await output.finalize();
    const buf = output.target.buffer;
    if (!buf) throw new Error('Export produced no data.');
    return new Blob([buf], { type: opts.format === 'mp4' ? 'video/mp4' : 'video/webm' });
  } catch (e) {
    try {
      await output.cancel();
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    cleanup();
  }
}
