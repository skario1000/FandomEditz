import { useEditor } from '../store';
import { Renderer } from '../gl/renderer';
import { computeFrame } from './compose';
import { clipSourceTime, layoutClips, totalDuration } from './velocity';
import { DemoRenderer } from './demo';
import { audio } from './audio';
import { drawTexts } from './overlay';
import { clamp } from './utils';
import type { MediaItem } from '../types';

/** Real-time program monitor: dual-player pre-seek ping-pong engine + WebGL renderer. */
export class PreviewEngine {
  renderer: Renderer;
  private demoA = new DemoRenderer(640, 360);
  private demoB = new DemoRenderer(640, 360);
  private overlay = document.createElement('canvas');
  private octx = this.overlay.getContext('2d')!;
  private holder: HTMLDivElement;

  // Dual-player ping-pong pool to prevent decoder destruction stalls on mobile cuts
  private playerA: HTMLVideoElement;
  private playerB: HTMLVideoElement;
  private activePlayer: HTMLVideoElement;
  private standbyPlayer: HTMLVideoElement;
  private preloadedClipId = '';
  private lastSeekTarget = new WeakMap<HTMLVideoElement, number>();

  private raf = 0;
  private last = 0;
  private dirtyUntil = 0;
  private lastClipId = '';
  private unsub: () => void;
  private ro: ResizeObserver;
  private cssW = 1;
  private cssH = 1;
  private mediaRef: MediaItem[] | null = null;
  private mediaMap = new Map<string, MediaItem>();

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, false);
    this.holder = document.createElement('div');
    Object.assign(this.holder.style, {
      position: 'fixed',
      left: '-20px',
      top: '-20px',
      width: '2px',
      height: '2px',
      overflow: 'hidden',
      opacity: '0',
      pointerEvents: 'none',
    });
    document.body.appendChild(this.holder);

    this.playerA = this.createVideo();
    this.playerB = this.createVideo();
    this.activePlayer = this.playerA;
    this.standbyPlayer = this.playerB;

    this.unsub = useEditor.subscribe(() => this.markDirty());
    this.ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      this.cssW = Math.max(1, r.width);
      this.cssH = Math.max(1, r.height);
      this.markDirty();
    });
    this.ro.observe(canvas);
    this.raf = requestAnimationFrame(this.loop);
  }

  markDirty() {
    this.dirtyUntil = performance.now() + 600;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unsub();
    this.ro.disconnect();

    this.playerA.pause();
    this.playerA.removeAttribute('src');
    this.playerA.load();

    this.playerB.pause();
    this.playerB.removeAttribute('src');
    this.playerB.load();

    this.holder.remove();
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000 || 0.016);
    this.last = now;
    const st = useEditor.getState();
    if (st.exporting) return;
    let t = st.time;
    if (st.playing) {
      t = audio.now();
      const total = totalDuration(st.project.clips);
      if (t >= total) {
        if (st.loop && total > 0) {
          t = 0;
          st.setTime(0);
        } else {
          st.pause();
          t = total;
          st.tick(total);
        }
      } else st.tick(t);
    } else if (now > this.dirtyUntil) return;
    if (st.viewer !== 'program' && !st.playing) return;
    this.ensureSize(st.quality);
    this.renderAt(t, st.playing, dt);
  };

  private ensureSize(q: 'full' | 'half') {
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    // On phone: 1.0 DPR is extremely sharp on a 5-6" screen and runs 4x faster with zero memory pressure
    const maxDpr = isMobile ? 1.0 : 2.0;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * (q === 'half' ? 0.5 : 1);
    let W = this.cssW * dpr;
    let H = this.cssH * dpr;
    const maxDim = isMobile ? 640 : 1920;
    const m = Math.max(W, H);
    if (m > maxDim) {
      W = (W * maxDim) / m;
      H = (H * maxDim) / m;
    }
    this.renderer.resize(Math.round(W / 2) * 2, Math.round(H / 2) * 2);
  }

  private getMediaMap(media: MediaItem[]) {
    if (media !== this.mediaRef) {
      this.mediaRef = media;
      this.mediaMap = new Map(media.map((m) => [m.id, m]));
    }
    return this.mediaMap;
  }

  private createVideo(): HTMLVideoElement {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.addEventListener('seeked', () => this.markDirty());
    v.addEventListener('loadeddata', () => this.markDirty());
    v.addEventListener('canplay', () => this.markDirty());
    v.addEventListener('timeupdate', () => this.markDirty());
    this.holder.appendChild(v);
    return v;
  }

  private safeSeek(el: HTMLVideoElement, target: number) {
    if (el.seeking) return;
    const last = this.lastSeekTarget.get(el);
    if (last !== undefined && Math.abs(last - target) < 0.05) return;
    this.lastSeekTarget.set(el, target);
    try {
      el.currentTime = target;
    } catch {
      // ignore
    }
  }

  private syncActiveVideo(el: HTMLVideoElement, target: number, rate: number, playing: boolean) {
    if (playing && rate >= 0.0625 && rate <= 16) {
      if (el.paused) {
        if (!el.seeking && Math.abs(el.currentTime - target) > 0.06) {
          this.safeSeek(el, target);
        }
        el.playbackRate = rate;
        el.play().catch(() => undefined);
        return;
      }

      // If already seeking, never interrupt the browser decoder
      if (el.seeking) return;

      const drift = target - el.currentTime;
      // Large drift: single clean seek
      if (Math.abs(drift) > 0.35) {
        this.safeSeek(el, target);
      } else if (Math.abs(drift) > 0.04) {
        // Smooth drift correction: gently adjust playbackRate to align without stutter
        const want = clamp(rate + drift * 1.5, 0.25, 4.0);
        if (Math.abs(want - el.playbackRate) > 0.02) {
          el.playbackRate = want;
        }
      } else {
        if (Math.abs(el.playbackRate - rate) > 0.02) {
          el.playbackRate = rate;
        }
      }
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - target) > 0.03 && !el.seeking) {
        this.safeSeek(el, target);
      }
    }
  }

  private renderAt(T: number, playing: boolean, dt: number) {
    const st = useEditor.getState();
    const mediaMap = this.getMediaMap(st.media);
    const { W, H } = this.renderer;
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

    // Mobile: 2 samples for motion blur is silky smooth; desktop uses 16
    const maxSamples = isMobile ? 2 : 16;

    // Resolve which clip is on screen and pick the player before computing the
    // transform, so the UV matrix is built from the dimensions of the texture
    // that will really be sampled (mismatched dims = stretched image).
    const probe = computeFrame(st.project, mediaMap, T, W, H, maxSamples);
    const clip = probe.clip;
    const media = probe.media;
    const clipChanged = (clip?.id ?? '') !== this.lastClipId;
    let activePlayer: HTMLVideoElement | null = null;
    let playerIsReady = false;

    if (clip && media && media.status === 'ready' && media.kind === 'video') {
      // DUAL PLAYER PING-PONG ENGINE
      if (clipChanged) {
        // Only swap when the standby was genuinely pre-rolled for THIS clip.
        // Matching file URLs alone is not enough — many clips share one file.
        const standbyReady =
          this.preloadedClipId === clip.id &&
          this.standbyPlayer.src === media.url &&
          !this.standbyPlayer.seeking &&
          this.standbyPlayer.readyState >= 2;

        if (standbyReady) {
          const temp = this.activePlayer;
          this.activePlayer = this.standbyPlayer;
          this.standbyPlayer = temp;
          this.standbyPlayer.pause();
          this.preloadedClipId = clip.id;
        } else if (this.activePlayer.src !== media.url) {
          this.activePlayer.src = media.url;
          // Setting src invalidates any pre-roll we thought we had.
          this.preloadedClipId = '';
        }
      }
      activePlayer = this.activePlayer;
      this.syncActiveVideo(activePlayer, probe.srcTime, probe.srcRate, playing);
      playerIsReady = activePlayer.readyState >= 2 && activePlayer.videoWidth > 0;
      if (!playerIsReady) this.markDirty();
    }

    // Dimensions of the texture that will actually be sampled this frame.
    let texW = 0;
    let texH = 0;
    if (clip && media && media.status === 'ready' && media.kind === 'demo') {
      texW = isMobile ? 640 : 1280;
      texH = isMobile ? 360 : 720;
    } else if (playerIsReady && activePlayer) {
      texW = activePlayer.videoWidth;
      texH = activePlayer.videoHeight;
    } else if (this.renderer.canHold) {
      // Falling back to the last good frame — sample it with ITS dimensions,
      // otherwise the old frame is drawn with the new clip's aspect ratio.
      [texW, texH] = this.renderer.holdSize;
    }

    const needsOverride =
      texW > 1 &&
      texH > 1 &&
      (!media || media.kind !== 'demo') &&
      (texW !== (media?.width ?? 0) || texH !== (media?.height ?? 0));

    const d = needsOverride
      ? computeFrame(st.project, mediaMap, T, W, H, maxSamples, texW, texH)
      : probe;

    let hasSource = false;
    let useAccum = false;

    if (clip && media && media.status === 'ready') {
      if (media.kind === 'demo') {
        const fps = media.fps || 24;
        const f = d.srcTime * fps;
        const i0 = Math.floor(f + 1e-6);

        // Size demo renderer to match mobile resolution
        const demoW = isMobile ? 640 : 1280;
        const demoH = isMobile ? 360 : 720;
        this.demoA.resize(demoW, demoH);
        this.renderer.upload('A', this.demoA.render(media.demoId || 'swing', i0 / fps), demoW, demoH);

        if (clip.twixtor && !isMobile) {
          const fr = f - i0;
          this.renderer.accumulate('A', 1, true);
          if (fr > 0.01) {
            this.demoB.resize(demoW, demoH);
            this.renderer.upload('B', this.demoB.render(media.demoId || 'swing', (i0 + 1) / fps), demoW, demoH);
            this.renderer.accumulate('B', fr, false);
          }
          useAccum = true;
        }
        hasSource = true;
      } else if (media.kind === 'video' && activePlayer) {
        // Player selection + seeking already happened above.

        if (playerIsReady) {
          hasSource = this.renderer.upload('A', activePlayer, activePlayer.videoWidth, activePlayer.videoHeight);
          if (hasSource && clip.twixtor) {
            const hold = 1 / (media.fps || 30) / Math.max(0.02, Math.abs(d.srcRate));
            const a = !playing || clipChanged ? 1 : 1 - Math.exp(-dt / (hold * 0.6));
            this.renderer.accumulate('A', a, a >= 1);
            useAccum = true;
          }
        } else {
          // Player not ready: the renderer falls back to the held frame, whose
          // dimensions were used to build this frame's transform.
          this.markDirty();
        }

        // PRE-ROLL NEXT CLIP so the upcoming cut is instant
        const layout = layoutClips(st.project.clips);
        const nextLayout = layout[d.clipIndex + 1];
        if (nextLayout && nextLayout.start - T < 1.2) {
          const nextClip = nextLayout.clip;
          const nextMedia = mediaMap.get(nextClip.mediaId);
          if (nextMedia?.kind === 'video' && nextMedia.status === 'ready') {
            if (this.preloadedClipId !== nextClip.id) {
              this.preloadedClipId = nextClip.id;
              if (this.standbyPlayer.src !== nextMedia.url) {
                this.standbyPlayer.src = nextMedia.url;
              }
              this.safeSeek(this.standbyPlayer, clamp(clipSourceTime(nextClip, 0), 0, Math.max(0, nextMedia.duration - 0.001)));
              this.standbyPlayer.pause();
            }
          }
        } else if (this.preloadedClipId && this.preloadedClipId !== clip.id) {
          // Moved away from the pre-rolled clip — let a later pre-roll re-seek.
          this.preloadedClipId = '';
        }
      }
    }

    this.lastClipId = clip?.id ?? '';

    const hasOverlay = d.fx.texts.length > 0;
    if (hasOverlay) {
      if (this.overlay.width !== W || this.overlay.height !== H) {
        this.overlay.width = W;
        this.overlay.height = H;
      }
      drawTexts(this.octx, W, H, d.fx.texts, d.fx.geo);
      this.renderer.uploadOverlay(this.overlay);
    }
    this.renderer.render(d, { useAccum, hasSource, time: T, overlay: hasOverlay });
  }
}
