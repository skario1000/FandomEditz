import { useEditor } from '../store';
import type { Clip, VelocitySettings } from '../types';
import { clipAtTime, layoutClips } from '../lib/velocity';
import { COLOR_PRESETS, colorFromPreset } from '../lib/colorPresets';
import { VelocityCurve } from './Curve';
import { Toggle } from './ui';
import { cn } from '../utils/cn';

interface SpeedPreset {
  id: string;
  name: string;
  icon: string;
  desc: string;
  patch: (c: Clip) => Partial<Clip>;
  curve?: VelocitySettings;
}

const vel = (preset: VelocitySettings['preset'], intensity = 0.85, center = 0.5): VelocitySettings => ({ preset, intensity, center });

const SPEED_PRESETS: SpeedPreset[] = [
  { id: 'reverse', name: 'Reverse', icon: '⏪', desc: 'Toggle playing the clip backwards', patch: (c) => ({ reverse: !c.reverse }) },
  { id: 'twix50', name: 'Twixtor 50%', icon: '🫧', desc: 'Smooth slow-mo with frame blending', patch: () => ({ speed: 0.5, twixtor: true }) },
  { id: 'twix25', name: 'Twixtor 25%', icon: '🌊', desc: 'Super smooth slow-mo', patch: () => ({ speed: 0.25, twixtor: true }) },
  { id: 'twix10', name: 'Twixtor 10%', icon: '🧊', desc: 'Ultra slow bullet-time', patch: () => ({ speed: 0.1, twixtor: true }) },
  { id: 'vel', name: 'Velocity', icon: '📈', desc: 'Fast → slow → fast (the classic velocity edit)', patch: () => ({ velocity: vel('classic'), speed: 1.3 }), curve: vel('classic') },
  { id: 'impact', name: 'Impact Ramp', icon: '💥', desc: 'Blazing fast with a sudden slow-mo hit', patch: () => ({ velocity: vel('impact', 0.9, 0.55), speed: 1.4 }), curve: vel('impact', 0.9, 0.55) },
  { id: 'rampUp', name: 'Slow → Fast', icon: '🚀', desc: 'Speed ramp up', patch: () => ({ velocity: vel('rampUp') }), curve: vel('rampUp') },
  { id: 'rampDown', name: 'Fast → Slow', icon: '🪂', desc: 'Speed ramp down into slow-mo', patch: () => ({ velocity: vel('rampDown') }), curve: vel('rampDown') },
  { id: 'double', name: 'Double Ramp', icon: '〰️', desc: 'Two slow-mo moments per clip', patch: () => ({ velocity: vel('double'), speed: 1.3 }), curve: vel('double') },
  { id: 'microwave', name: 'Microwave', icon: '🍿', desc: 'Forward push then eased snap-back + side slam & zoom pulse', patch: () => ({ velocity: vel('microwave', 0.5, 0.7) }), curve: vel('microwave', 0.5, 0.7) },
  { id: 'boomerang', name: 'Boomerang', icon: '🪃', desc: 'Forward then reverse to the start', patch: () => ({ velocity: vel('boomerang', 1, 0.5) }), curve: vel('boomerang', 1, 0.5) },
  { id: 'fast2', name: 'Speed 2×', icon: '⏩', desc: 'Double speed', patch: () => ({ speed: 2 }) },
  { id: 'reset', name: 'Reset Time', icon: '♻️', desc: 'Normal speed, forward, no ramps', patch: () => ({ speed: 1, reverse: false, twixtor: false, velocity: vel('none') }) },
];

function useTargetLabel() {
  return useEditor((s) => {
    if (s.applyAll) return `All ${s.project.clips.length} clips`;
    const id = s.selection?.kind === 'clip' ? s.selection.id : clipAtTime(layoutClips(s.project.clips), s.time)?.clip.id;
    if (!id) return 'No clip selected';
    const i = s.project.clips.findIndex((c) => c.id === id);
    return i >= 0 ? `Clip ${i + 1}${s.selection?.kind === 'clip' ? '' : ' (under playhead)'}` : 'No clip selected';
  });
}

function TargetBar() {
  const applyAll = useEditor((s) => s.applyAll);
  const label = useTargetLabel();
  return (
    <div className="rounded-lg border border-white/[0.06] bg-[#121218] px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Target</div>
      <div className="text-[12px] font-semibold text-zinc-200">{label}</div>
      <Toggle label="Apply to all clips" checked={applyAll} onChange={(v) => useEditor.getState().ui({ applyAll: v })} />
    </div>
  );
}

export function SpeedTab() {
  const current = useEditor((s) => (s.selection?.kind === 'clip' ? s.project.clips.find((c) => c.id === s.selection!.id) : undefined));
  return (
    <div className="space-y-3 p-3">
      <TargetBar />
      <div className="grid grid-cols-2 gap-1.5">
        {SPEED_PRESETS.map((p) => {
          const active =
            current &&
            ((p.id === 'reverse' && current.reverse) ||
              (p.curve && current.velocity.preset === p.curve.preset) ||
              (p.id.startsWith('twix') && current.twixtor && Math.abs(current.speed - (p.id === 'twix50' ? 0.5 : p.id === 'twix25' ? 0.25 : 0.1)) < 0.01));
          return (
            <div
              key={p.id}
              role="button"
              title={p.desc}
              onClick={() => useEditor.getState().patchTargetClips(p.patch)}
              className={cn(
                'group relative cursor-pointer overflow-hidden rounded-lg border bg-[#13131a] p-2 transition-all hover:border-white/20 hover:bg-[#191922]',
                active ? 'border-[#4ade80]/60 ring-1 ring-[#4ade80]/30' : 'border-white/[0.06]'
              )}
            >
              <div className="flex items-start justify-between">
                <span className="text-lg leading-none">{p.icon}</span>
                {p.curve && <VelocityCurve v={p.curve} w={52} h={22} stroke={active ? '#4ade80' : '#ff2d55'} />}
              </div>
              <div className="mt-1 text-[11.5px] font-semibold text-zinc-100">{p.name}</div>
              <div className="line-clamp-2 text-[10px] leading-snug text-zinc-500">{p.desc}</div>
            </div>
          );
        })}
      </div>
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-zinc-400">
        <b className="text-zinc-200">Tip:</b> Twixtor blends neighbouring frames for smooth slow motion. Velocity ramps keep the clip length, so cuts stay on the beat. Fine-tune curves in the Inspector →
      </div>
    </div>
  );
}

export function ColorTab() {
  const current = useEditor((s) => (s.selection?.kind === 'clip' ? s.project.clips.find((c) => c.id === s.selection!.id)?.color.preset : undefined));
  return (
    <div className="space-y-3 p-3">
      <TargetBar />
      <div className="grid grid-cols-2 gap-2">
        {COLOR_PRESETS.map((p) => (
          <div
            key={p.id}
            role="button"
            onClick={() => useEditor.getState().patchTargetClips(() => ({ color: colorFromPreset(p.id) }))}
            className={cn(
              'cursor-pointer overflow-hidden rounded-lg border bg-[#13131a] transition-all hover:-translate-y-px hover:border-white/25',
              current === p.id ? 'border-[#ff2d55]/70 ring-1 ring-[#ff2d55]/40' : 'border-white/[0.06]'
            )}
          >
            <div className="h-12" style={{ background: `linear-gradient(135deg, ${p.swatch[0]} 0%, ${p.swatch[1]} 55%, ${p.swatch[2]} 100%)` }} />
            <div className="px-2 py-1 text-[11px] font-semibold text-zinc-200">{p.name}</div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-zinc-500">Fine-tune exposure, contrast, temperature and split-toning in the Inspector.</div>
    </div>
  );
}
