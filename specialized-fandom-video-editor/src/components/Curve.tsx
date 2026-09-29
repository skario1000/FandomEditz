import type { VelocitySettings } from '../types';
import { velocityProgress } from '../lib/velocity';

export function VelocityCurve({ v, w = 64, h = 28, stroke = '#ff2d55' }: { v: VelocitySettings; w?: number; h?: number; stroke?: string }) {
  const pts: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const u = i / 48;
    const p = velocityProgress(v, u);
    pts.push(`${(u * w).toFixed(1)},${(h - 2 - p * (h - 4)).toFixed(1)}`);
  }
  return (
    <svg width={w} height={h} className="overflow-visible">
      <line x1={0} y1={h - 2} x2={w} y2={2} stroke="rgba(255,255,255,0.14)" strokeDasharray="2 3" />
      <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
