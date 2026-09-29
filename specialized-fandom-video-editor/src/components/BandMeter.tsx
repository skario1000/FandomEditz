import { useEffect, useRef } from 'react';
import { useEditor } from '../store';
import { bandEnergy, musicAnalysis, type Band } from '../lib/audio';
import { cn } from '../utils/cn';

const LANES: { id: Exclude<Band, 'hit'>; label: string; color: string }[] = [
  { id: 'bass', label: 'LOW', color: '#34d399' },
  { id: 'mid', label: 'MID', color: '#22d3ee' },
  { id: 'high', label: 'AIR', color: '#c084fc' },
];

/**
 * A three-band meter for the music-reactive effects, read from the same baked
 * envelopes the renderer uses — so what you see is exactly what gets exported.
 */
export function BandMeter({ band, className }: { band: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const musicId = useEditor((s) => s.project.music?.mediaId ?? null);
  const ready = musicId ? !!musicAnalysis(musicId) : false;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 250;
    const H = 44;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const peaks = [0, 0, 0];
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const st = useEditor.getState();
      const t = st.time;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const bw = 26;
      const gap = 6;
      const x0 = 4;
      const top = 12;
      const h = H - top - 12;
      LANES.forEach((lane, i) => {
        const v = bandEnergy(musicId, lane.id, t, 0.4);
        peaks[i] = Math.max(v, peaks[i] - 0.02);
        const x = x0 + i * (bw + gap);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x, top, bw, h);
        const fh = Math.max(1, v * h);
        const g = ctx.createLinearGradient(0, top + h, 0, top);
        g.addColorStop(0, lane.color + '33');
        g.addColorStop(1, lane.color);
        ctx.fillStyle = g;
        ctx.fillRect(x, top + h - fh, bw, fh);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, top + h - Math.max(1, peaks[i] * h) - 1, bw, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '8px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(lane.label, x + bw / 2, H - 2);
      });
      // which band the effect is actually following
      const active = band === 'hit' ? -1 : LANES.findIndex((l) => l.id === band);
      const ax = active >= 0 ? x0 + active * (bw + gap) : x0 + 3 * (bw + gap);
      ctx.strokeStyle = band === 'hit' ? '#fbbf24' : '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(ax - 1.5, top - 3, bw + 3, h + 6);
      if (band === 'hit') {
        const v = bandEnergy(musicId, 'hit', t, 0.4);
        const fh = Math.max(1, v * h);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(ax, top + h - fh, bw, fh);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.textAlign = 'center';
        ctx.fillText('HITS', ax + bw / 2, H - 2);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [musicId, band]);

  return (
    <div className={cn('rounded-lg border border-white/[0.06] bg-black/30 p-1.5', className)}>
      <div className="mb-0.5 flex items-center justify-between px-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">
        <span>Music energy</span>
        <span className={ready ? 'text-[#34d399]' : 'text-zinc-600'}>{musicId ? (ready ? 'analysed' : 'analysing…') : 'no track'}</span>
      </div>
      <canvas ref={ref} style={{ width: '100%', height: 44 }} className="block" />
    </div>
  );
}
