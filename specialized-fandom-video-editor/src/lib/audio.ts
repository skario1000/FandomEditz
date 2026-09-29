import type { Clip, MusicTrack, Project } from '../types';
import { clipSourceRate, clipSourceTime, layoutClips } from './velocity';

export const DEMO_BEAT_ID = 'demo-beat';

/* ------------------------------------------------------------------ */
/* Music reactivity: band envelopes                                     */
/*                                                                     */
/* After Effects has no built-in audio reactivity — it needs a plugin  */
/* (or a 3rd-party expression) to make a layer breathe with the music. */
/* We bake it instead: every track is analysed once into percussive and */
/* sustained envelopes, so music-reactive effects are deterministic and  */
/* render identically in the preview and in the exported file.         */
/* ------------------------------------------------------------------ */

export type Band = 'bass' | 'mid' | 'high' | 'full' | 'hit';
const BANDS: Exclude<Band, 'hit'>[] = ['bass', 'mid', 'high', 'full'];
export const BAND_LABELS: Record<Band, string> = {
  bass: 'Bass / kick',
  mid: 'Mid / vocal',
  high: 'Hi-hats / air',
  full: 'Whole mix',
  hit: 'Hits / transients',
};

/** Envelope frames per second. 90 Hz is finer than a frame at 60 fps. */
const ENV_RATE = 90;

export interface BandAnalysis {
  rate: number;
  duration: number;
  /** Sustained energy, normalised 0..1. */
  env: Record<Exclude<Band, 'hit'>, Float32Array>;
  /** Instantaneous (unsmoothed) energy, normalised 0..1. */
  raw: Record<Exclude<Band, 'hit'>, Float32Array>;
  /** Percussive transient detector, normalised 0..1. */
  hit: Float32Array;
}

const analyses = new Map<string, BandAnalysis>();
const analysisJobs = new Map<string, Promise<BandAnalysis | null>>();

function onePole(sr: number, hz: number) {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / sr);
  return (x: number, y: number) => y + a * (x - y);
}

/** Normalise by a high percentile so quiet tracks still drive the effect fully. */
function normalise(a: Float32Array): Float32Array {
  const sorted = Float32Array.from(a).sort();
  const hi = sorted[Math.floor(sorted.length * 0.97)] || 1;
  const lo = sorted[Math.floor(sorted.length * 0.12)] || 0;
  const span = Math.max(0.04, hi - lo);
  for (let i = 0; i < a.length; i++) a[i] = Math.max(0, Math.min(1, (a[i] - lo) / span));
  return a;
}

/** Asymmetric smoothing: snap up on the transient, ease back down. */
function envFollow(src: Float32Array, attack: number, release: number): Float32Array {
  const out = new Float32Array(src.length);
  let y = 0;
  for (let i = 0; i < src.length; i++) {
    const target = src[i];
    const k = target > y ? attack : release;
    y += (target - y) * k;
    out[i] = y;
  }
  return out;
}

async function analyseBuffer(buf: AudioBuffer): Promise<BandAnalysis> {
  const sr = 11025;
  const len = Math.max(1, Math.ceil(buf.duration * sr));
  const off = new OfflineAudioContext(1, len, sr);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const d = (await off.startRendering()).getChannelData(0);

  const frames = Math.max(2, Math.ceil(buf.duration * ENV_RATE));
  const hop = d.length / frames;
  const lpLo = onePole(sr, 160);
  const lpMidHi = onePole(sr, 3200);
  const raw = {
    bass: new Float32Array(frames),
    mid: new Float32Array(frames),
    high: new Float32Array(frames),
    full: new Float32Array(frames),
  };
  let yLo = 0;
  let yMid = 0;
  for (let f = 0; f < frames; f++) {
    const a = Math.floor(f * hop);
    const b = Math.min(d.length, Math.max(a + 1, Math.floor((f + 1) * hop)));
    let el = 0;
    let eh = 0;
    let ef = 0;
    for (let i = a; i < b; i += 2) {
      const x = d[i] || 0;
      yLo = lpLo(x, yLo);
      yMid = lpMidHi(x, yMid);
      const low = yLo;
      const air = x - yMid;
      const band = yMid - yLo;
      el += low * low;
      eh += air * air;
      ef += band * band;
    }
    const n = Math.max(1, Math.ceil((b - a) / 2));
    raw.bass[f] = Math.sqrt(el / n);
    raw.mid[f] = Math.sqrt(ef / n);
    raw.high[f] = Math.sqrt(eh / n);
    raw.full[f] = Math.sqrt((el + ef + eh) / n);
  }
  const env = {} as BandAnalysis['env'];
  for (const b of BANDS) {
    normalise(raw[b]);
    env[b] = envFollow(raw[b], 0.55, 0.12);
  }
  // Percussive = how far the instant energy sits above its own slow average.
  const hit = new Float32Array(frames);
  const w = Math.max(2, Math.round(ENV_RATE * 0.42));
  for (let f = 0; f < frames; f++) {
    const a = Math.max(0, f - w);
    const b = Math.min(frames, f + w + 1);
    let avg = 0;
    for (let i = a; i < b; i++) avg += raw.bass[i];
    avg /= b - a;
    hit[f] = Math.max(0, raw.bass[f] - avg * 0.94);
  }
  normalise(hit);
  return { rate: ENV_RATE, duration: buf.duration, env, raw, hit };
}

/** Analyse a registered track (cached). Returns null while it is still running. */
export function musicAnalysis(mediaId: string | null | undefined): BandAnalysis | null {
  if (!mediaId) return null;
  return analyses.get(mediaId) ?? null;
}

/** Kick off analysis for a track; safe to call repeatedly. */
export function ensureMusicAnalysis(mediaId: string | null | undefined): Promise<BandAnalysis | null> {
  if (!mediaId) return Promise.resolve(null);
  const done = analyses.get(mediaId);
  if (done) return Promise.resolve(done);
  const job = analysisJobs.get(mediaId);
  if (job) return job;
  const buf = audio.buffers.get(mediaId);
  if (!buf) return Promise.resolve(null);
  const p = analyseBuffer(buf)
    .then((a) => {
      analyses.set(mediaId, a);
      analysisJobs.delete(mediaId);
      return a;
    })
    .catch(() => {
      analysisJobs.delete(mediaId);
      return null;
    });
  analysisJobs.set(mediaId, p);
  return p;
}

/**
 * Energy of a band at timeline time `t`, 0..1. `smooth` 0 = raw, 1 = fully
 * enveloped (0.5 blends the two). `floor` sets how much the effect idles at
 * when the track is quiet, so a reactive effect still has a base look.
 */
export function bandEnergy(mediaId: string | null | undefined, band: Band, t: number, smooth = 0.5, floor = 0): number {
  const a = musicAnalysis(mediaId);
  if (!a) return 0;
  if (band === 'hit') {
    const v = sampleArr(a.hit, t, a.rate);
    return clamp01(floor + (1 - floor) * v);
  }
  const raw = sampleArr(a.raw[band], t, a.rate);
  const env = sampleArr(a.env[band], t, a.rate);
  const v = raw + (env - raw) * clamp01(smooth);
  return clamp01(floor + (1 - floor) * v);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
function sampleArr(arr: Float32Array, t: number, rate: number): number {
  const x = t * rate;
  if (!(x > 0)) return arr[0] ?? 0;
  if (x >= arr.length - 1) return arr[arr.length - 1] ?? 0;
  const i = Math.floor(x);
  const f = x - i;
  return (arr[i] ?? 0) * (1 - f) + (arr[i + 1] ?? 0) * f;
}

export function computePeaks(buf: AudioBuffer, perSec = 100): Float32Array {
  const n = Math.max(1, Math.ceil(buf.duration * perSec));
  const out = new Float32Array(n);
  const chs = Math.min(2, buf.numberOfChannels);
  const size = buf.length / n;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * size);
      const b = Math.min(d.length, Math.floor((i + 1) * size));
      let m = 0;
      for (let j = a; j < b; j += 3) {
        const v = d[j] < 0 ? -d[j] : d[j];
        if (v > m) m = v;
      }
      if (m > out[i]) out[i] = m;
    }
  }
  let mx = 0;
  for (let i = 0; i < n; i++) if (out[i] > mx) mx = out[i];
  if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx;
  return out;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  buffers = new Map<string, AudioBuffer>();
  peaks = new Map<string, Float32Array>();
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private musicNodes: AudioBufferSourceNode[] = [];
  private musicGains: GainNode[] = [];
  private clipNodes: AudioBufferSourceNode[] = [];
  private clipGains: GainNode[] = [];
  private clipBus: GainNode | null = null;
  private t0 = 0;
  private c0 = 0;
  private p0 = 0;
  private useCtx = false;
  private running = false;

  getCtx(): AudioContext {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  async decode(id: string, data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.getCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => undefined);
    }
    // WebKit/Safari compatibility: clone array buffer so original isn't detached,
    // and support both promise and callback styles.
    const copy = data.slice(0);
    const buf = await new Promise<AudioBuffer>((resolve, reject) => {
      let settled = false;
      const onOk = (decoded: AudioBuffer) => {
        if (!settled) {
          settled = true;
          resolve(decoded);
        }
      };
      const onFail = (err: unknown) => {
        if (!settled) {
          settled = true;
          reject(err instanceof Error ? err : new Error('Audio decode failed'));
        }
      };
      try {
        const ret = ctx.decodeAudioData(copy, onOk, onFail);
        if (ret && typeof (ret as Promise<AudioBuffer>).then === 'function') {
          (ret as Promise<AudioBuffer>).then(onOk).catch(onFail);
        }
      } catch (err) {
        onFail(err);
      }
    });
    this.register(id, buf);
    return buf;
  }

  register(id: string, buf: AudioBuffer) {
    this.buffers.set(id, buf);
    this.peaks.set(id, computePeaks(buf, 100));
    // Pre-bake the band envelopes so music-reactive effects are ready to use.
    if (buf.duration < 900) void ensureMusicAnalysis(id);
  }

  start(music: MusicTrack | null, fromT: number, musicClips?: MusicTrack[]) {
    this.stop();
    this.t0 = fromT;
    this.running = true;
    const ctx = this.getCtx();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime + 0.04;
    this.c0 = now;
    this.useCtx = true;

    const list = musicClips && musicClips.length > 0 ? musicClips : music ? [music] : [];
    for (const mc of list) {
      const buf = this.buffers.get(mc.mediaId);
      if (!buf) continue;
      const srcIn = Math.max(0, mc.srcIn ?? 0);
      const segDur = mc.duration !== undefined ? mc.duration : Math.max(0, buf.duration - srcIn);
      const segStart = mc.start;
      const segEnd = segStart + segDur;

      if (fromT >= segEnd || segDur <= 0.01) continue;

      const g = ctx.createGain();
      g.gain.value = mc.volume;
      g.connect(ctx.destination);
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(g);

      if (fromT < segStart) {
        s.start(now + (segStart - fromT), srcIn, segDur);
      } else {
        const elapsed = fromT - segStart;
        const remaining = segDur - elapsed;
        s.start(now, srcIn + elapsed, remaining);
      }

      this.musicNodes.push(s);
      this.musicGains.push(g);
    }
  }

  /** Play each clip's own audio in sync with the timeline (speed, reverse, ramps). */
  scheduleClips(clips: Clip[], fromT: number) {
    this.stopClips();
    if (!this.running) return;
    const ctx = this.getCtx();
    if (!this.clipBus) {
      this.clipBus = ctx.createGain();
      this.clipBus.connect(ctx.destination);
    }
    this.clipBus.gain.value = 0.9;
    const dest = this.clipBus;
    const layout = layoutClips(clips);
    // Lookahead: only schedule clips within the next 8 seconds to avoid mass buffer allocations
    for (const hit of layout) {
      if (hit.end <= fromT + 0.02) continue;
      if (hit.start > fromT + 8.0) break;
      if (hit.clip.audio === false) continue;
      const buf = this.buffers.get(hit.clip.mediaId);
      if (!buf) continue;
      this.placeClip(ctx, dest, hit.clip, hit.start, hit.end, buf, fromT, this.c0);
    }
  }

  placeClip(
    ctx: BaseAudioContext,
    dest: AudioNode,
    clip: Clip,
    start: number,
    end: number,
    buf: AudioBuffer,
    fromT: number,
    when0: number
  ) {
    const begin = Math.max(fromT, start);
    const clipGain = ctx.createGain();
    clipGain.gain.value = Math.max(0, Math.min(2, clip.audioVolume ?? 1));
    clipGain.connect(dest);
    if (ctx instanceof AudioContext) this.clipGains.push(clipGain);
    const constant = clip.velocity.preset === 'none';
    if (constant) {
      const local = begin - start;
      const src = clipSourceTime(clip, local);
      const rate = Math.abs(clipSourceRate(clip, local));
      const timelineLeft = end - begin;
      if (rate < 0.05 || timelineLeft < 0.02) return;
      const reverse = clipSourceRate(clip, local) < 0;
      const srcDur = Math.min(rate * timelineLeft, reverse ? src : buf.duration - src);
      if (srcDur < 0.02) return;
      const node = ctx.createBufferSource();
      node.playbackRate.value = clampRate(rate);
      if (reverse) {
        node.buffer = sliceBuffer(ctx, buf, src - srcDur, srcDur, true);
        node.start(when0 + (begin - fromT));
      } else {
        node.buffer = buf;
        node.start(when0 + (begin - fromT), Math.max(0, src), srcDur);
      }
      node.connect(clipGain);
      if (ctx instanceof AudioContext) this.clipNodes.push(node);
      return;
    }
    const step = 0.1;
    for (let t = begin; t < end - 0.015; t += step) {
      const dt = Math.min(step, end - t);
      const local = t - start;
      const rate = clipSourceRate(clip, local);
      const src = clipSourceTime(clip, local);
      const srcDur = Math.abs(rate) * dt;
      if (srcDur < 0.012 || Math.abs(rate) < 0.05) continue;
      const slice = sliceBuffer(ctx, buf, rate < 0 ? src - srcDur : src, srcDur, rate < 0);
      fadeEdges(slice, 5);
      const node = ctx.createBufferSource();
      node.buffer = slice;
      node.playbackRate.value = clampRate(Math.abs(rate));
      node.connect(clipGain);
      node.start(when0 + (t - fromT));
      if (ctx instanceof AudioContext) this.clipNodes.push(node);
    }
  }

  private stopClips() {
    for (const n of this.clipNodes) {
      try {
        n.stop();
      } catch {
        /* already ended */
      }
      n.disconnect();
    }
    this.clipNodes = [];
    for (const g of this.clipGains) g.disconnect();
    this.clipGains = [];
  }

  stop() {
    for (const s of this.musicNodes) {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
      s.disconnect();
    }
    this.musicNodes = [];
    for (const g of this.musicGains) {
      g.disconnect();
    }
    this.musicGains = [];

    if (this.src) {
      try {
        this.src.stop();
      } catch {
        /* not started */
      }
      this.src.disconnect();
      this.src = null;
    }
    if (this.gain) {
      this.gain.disconnect();
      this.gain = null;
    }
    this.stopClips();
    this.running = false;
  }

  now(): number {
    if (!this.running) return this.t0;
    if (this.useCtx && this.ctx) return this.t0 + Math.max(0, this.ctx.currentTime - this.c0);
    return this.t0 + (performance.now() - this.p0) / 1000;
  }

  setVolume(v: number) {
    if (this.gain) this.gain.gain.value = v;
    for (const g of this.musicGains) {
      g.gain.value = v;
    }
  }
}

function clampRate(r: number) {
  return Math.max(0.0625, Math.min(16, r));
}

function sliceBuffer(ctx: BaseAudioContext, buf: AudioBuffer, start: number, dur: number, reverse: boolean): AudioBuffer {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor(start * sr));
  const n = Math.max(1, Math.min(buf.length - (reverse ? 0 : a), Math.floor(dur * sr)));
  const out = ctx.createBuffer(buf.numberOfChannels, n, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    const origin = reverse ? Math.min(buf.length - 1, a + n - 1) : a;
    for (let i = 0; i < n; i++) dst[i] = src[reverse ? origin - i : origin + i] || 0;
  }
  return out;
}

function fadeEdges(buf: AudioBuffer, ms: number) {
  const n = Math.min(buf.length >> 1, Math.floor((buf.sampleRate * ms) / 1000));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const g = i / n;
      d[i] *= g;
      d[d.length - 1 - i] *= g;
    }
  }
}

/** Offline mix of the music track plus every clip's audio, for export. */
export async function mixTimelineAudio(project: Project, total: number): Promise<AudioBuffer | null> {
  const musicList = project.musicClips && project.musicClips.length > 0 ? project.musicClips : project.music ? [project.music] : [];
  const hasMusic = musicList.some((m) => audio.buffers.has(m.mediaId));
  const anyClip = project.clips.some((c) => c.audio !== false && audio.buffers.has(c.mediaId));
  if (!hasMusic && !anyClip) return null;
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * sr)), sr);
  const master = ctx.createGain();
  master.connect(ctx.destination);

  for (const mc of musicList) {
    const buf = audio.buffers.get(mc.mediaId);
    if (!buf) continue;
    const srcIn = Math.max(0, mc.srcIn ?? 0);
    const segDur = mc.duration !== undefined ? mc.duration : Math.max(0, buf.duration - srcIn);
    const segStart = mc.start;
    if (segStart >= total || segDur <= 0.01) continue;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(mc.volume, 0);
    g.gain.setValueAtTime(mc.volume, Math.max(0, total - 0.2));
    g.gain.linearRampToValueAtTime(0, total);
    src.connect(g);
    g.connect(master);

    const when = Math.max(0, segStart);
    const effectiveOffset = segStart < 0 ? srcIn - segStart : srcIn;
    const effectiveDur = Math.min(segDur, Math.max(0, total - when));
    if (effectiveOffset < buf.duration && effectiveDur > 0) {
      src.start(when, effectiveOffset, effectiveDur);
    }
  }
  const bus = ctx.createGain();
  bus.gain.value = 0.9;
  bus.connect(master);
  for (const hit of layoutClips(project.clips)) {
    if (hit.clip.audio === false) continue;
    const buf = audio.buffers.get(hit.clip.mediaId);
    if (!buf) continue;
    audio.placeClip(ctx, bus, hit.clip, hit.start, hit.end, buf, 0, 0);
  }
  return ctx.startRendering();
}

export const audio = new AudioEngine();

/* ------------------------------------------------------------------ */
/* Beat detection                                                       */
/* ------------------------------------------------------------------ */
export interface BeatOpts {
  sensitivity: number; // 0..1
  band: 'bass' | 'full';
  mode: 'onsets' | 'grid';
}

export async function detectBeats(buf: AudioBuffer, opts: BeatOpts): Promise<{ beats: number[]; bpm: number }> {
  const sr = 11025;
  const len = Math.max(1, Math.ceil(buf.duration * sr));
  const off = new OfflineAudioContext(1, len, sr);
  const src = off.createBufferSource();
  src.buffer = buf;
  const f = off.createBiquadFilter();
  if (opts.band === 'bass') {
    f.type = 'lowpass';
    f.frequency.value = 160;
    f.Q.value = 0.8;
  } else {
    f.type = 'highpass';
    f.frequency.value = 40;
  }
  src.connect(f);
  f.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const d = rendered.getChannelData(0);
  const hop = 128;
  const win = 512;
  const frames = Math.max(3, Math.floor((d.length - win) / hop));
  const env = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    const o = i * hop;
    for (let j = 0; j < win; j += 2) {
      const v = d[o + j] || 0;
      s += v * v;
    }
    env[i] = Math.log(1 + 1000 * Math.sqrt(s / (win / 2)));
  }
  const onset = new Float32Array(frames);
  for (let i = 1; i < frames; i++) onset[i] = Math.max(0, env[i] - env[i - 1]);
  const fps = sr / hop;
  const W = Math.round(fps * 0.4);
  const kth = 1.2 + (1 - opts.sensitivity) * 2.2;
  const minGap = Math.round(fps * (0.12 + (1 - opts.sensitivity) * 0.2));
  const pre = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) pre[i + 1] = pre[i] + onset[i];
  const globalMean = pre[frames] / frames;
  let beats: number[] = [];
  let last = -1e9;
  const lat = win / 2 / sr;
  for (let i = 1; i < frames - 1; i++) {
    const a = Math.max(0, i - W);
    const b = Math.min(frames, i + W + 1);
    const mean = (pre[b] - pre[a]) / (b - a);
    const th = mean * kth + globalMean * 0.3;
    if (onset[i] > th && onset[i] >= onset[i - 1] && onset[i] > onset[i + 1] && i - last >= minGap) {
      beats.push((i * hop) / sr + lat);
      last = i;
    }
  }
  // tempo via weighted autocorrelation
  const minLag = Math.round((fps * 60) / 180);
  const maxLag = Math.round((fps * 60) / 70);
  let bestLag = 0;
  let bestVal = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < frames; i++) s += onset[i] * onset[i + lag];
    const bpmL = (60 * fps) / lag;
    s *= Math.exp(-Math.pow(Math.log2(bpmL / 120), 2) * 0.5);
    if (s > bestVal) {
      bestVal = s;
      bestLag = lag;
    }
  }
  let bpm = bestLag ? (60 * fps) / bestLag : 0;
  if (opts.mode === 'grid' && bestLag) {
    const rough = bestLag / fps;
    let best = { score: -1, P: rough, ph: 0 };
    for (let P = rough * 0.985; P <= rough * 1.015; P += rough * 0.0005) {
      const Pf = P * fps;
      for (let ph = 0; ph < Pf; ph += 1) {
        let s = 0;
        for (let x = ph; x < frames; x += Pf) s += onset[Math.round(x)] || 0;
        if (s > best.score) best = { score: s, P, ph };
      }
    }
    bpm = 60 / best.P;
    beats = [];
    for (let t = best.ph / fps + lat; t < buf.duration; t += best.P) beats.push(t);
  }
  return { beats, bpm };
}

/* ------------------------------------------------------------------ */
/* Synthesised demo track: 130 BPM phonk-style beat (cowbell melody)    */
/* ------------------------------------------------------------------ */
export async function synthDemoBeat(): Promise<{ buffer: AudioBuffer; bpm: number; beats: number[] }> {
  const bpm = 130;
  const beat = 60 / bpm;
  const s16 = beat / 4;
  const bars = 8;
  const dur = bars * 4 * beat + 1.2;
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const master = ctx.createGain();
  master.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp);
  comp.connect(ctx.destination);
  const noise = ctx.createBuffer(1, sr, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const sat = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) sat[i] = Math.tanh((i / 511.5 - 1) * 2.4);

  const env = (g: GainNode, t: number, peak: number, decay: number, attack = 0.002) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const noiseHit = (t: number, type: BiquadFilterType, freq: number, q: number, amp: number, decay: number) => {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, amp, decay);
    n.connect(f);
    f.connect(g);
    g.connect(master);
    n.start(t, Math.random() * 0.5);
    n.stop(t + decay + 0.05);
  };
  const kick = (t: number, amp = 1) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.13);
    env(g, t, amp, 0.42);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.5);
  };
  const snare = (t: number, amp = 0.55) => {
    noiseHit(t, 'bandpass', 1900, 0.9, amp, 0.2);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = ctx.createGain();
    env(g, t, amp * 0.6, 0.09);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.15);
  };
  const hat = (t: number, amp = 0.14, open = false) => noiseHit(t, 'highpass', 7200, 0.7, amp, open ? 0.22 : 0.045);
  const cowbell = (t: number, f: number, amp = 0.2) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 1.45;
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    env(g, t, amp, 0.26, 0.001);
    bp.connect(g);
    g.connect(master);
    for (const m of [1, 1.483]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * m;
      o.connect(bp);
      o.start(t);
      o.stop(t + 0.32);
    }
  };
  const bass = (t: number, f: number, len: number, amp = 0.5) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const sh = ctx.createWaveShaper();
    sh.curve = sat;
    const g = ctx.createGain();
    env(g, t, amp, len, 0.004);
    o.connect(sh);
    sh.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + len + 0.05);
  };

  const N = { cs5: 554.37, e5: 659.25, fs5: 739.99, gs5: 830.61, b4: 493.88, gs4: 415.3 };
  const mel = [
    [N.cs5, 0, N.cs5, 0, N.e5, 0, N.cs5, 0, N.gs5, 0, N.fs5, 0, N.e5, 0, N.cs5, 0],
    [N.cs5, 0, N.cs5, 0, N.e5, 0, N.fs5, 0, N.e5, 0, N.cs5, 0, N.b4, 0, N.gs4, 0],
  ];
  const roots = [69.3, 69.3, 55, 61.74];
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * beat;
    const intro = bar < 2;
    const build = bar >= 2 && bar < 4;
    const drop = bar >= 4;
    if (bar === 4) noiseHit(t0, 'highpass', 3500, 0.5, 0.32, 1.5);
    for (let st = 0; st < 16; st++) {
      const t = t0 + st * s16;
      const note = mel[bar % 2][st];
      if (note) cowbell(t, note, intro ? 0.13 : 0.19);
      if (build || drop) {
        if (st % 2 === 0) hat(t, st % 4 === 0 ? 0.13 : 0.09);
        if (st === 4 || st === 12) snare(t, drop ? 0.6 : 0.42);
      }
      if (build && st === 0) kick(t, 0.8);
      if (bar === 3 && st >= 12) snare(t + s16 * 0.5, 0.25 + (st - 12) * 0.08);
      if (drop) {
        if (st % 2 === 1) hat(t, 0.06);
        if (st % 4 === 0) {
          kick(t, 1);
          bass(t, roots[bar % 4], beat * 0.9);
        }
        if (st === 10) kick(t, 0.7);
        if (st === 14 && bar % 2 === 1) hat(t, 0.12, true);
      }
    }
  }
  const buffer = await ctx.startRendering();
  const beats = Array.from({ length: bars * 4 }, (_, i) => i * beat);
  return { buffer, bpm, beats };
}
