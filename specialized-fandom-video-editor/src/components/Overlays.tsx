import { CheckCircle2, Info, Upload, X, XCircle } from 'lucide-react';
import { useEditor } from '../store';
import { WebLogo } from './TopBar';
import { cn } from '../utils/cn';

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-[300px] left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'ev-in pointer-events-auto flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-medium shadow-xl backdrop-blur-md',
            t.kind === 'success' && 'border-emerald-500/30 bg-emerald-950/80 text-emerald-100',
            t.kind === 'error' && 'border-red-500/30 bg-red-950/80 text-red-100',
            t.kind === 'info' && 'border-white/10 bg-[#16161e]/90 text-zinc-100'
          )}
          onClick={() => useEditor.getState().dismissToast(t.id)}
        >
          {t.kind === 'success' ? <CheckCircle2 size={14} /> : t.kind === 'error' ? <XCircle size={14} /> : <Info size={14} />}
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export function DropOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-[#07070b]/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-[#ff2d55]/70 bg-[#ff2d55]/5 px-16 py-12">
        <Upload size={36} className="text-[#ff2d55]" />
        <div className="text-lg font-bold text-white">Drop clips & music to import</div>
        <div className="text-[12px] text-zinc-400">Videos go to the media bin · songs become the music track</div>
      </div>
    </div>
  );
}

const TIPS: [string, string][] = [
  ['🍿 Microwave edit', 'Songs are marked automatically → Beats tab → “Microwave edit”. Every beat becomes a cut with a forward push, eased snap-back, side slam and zoom pulse.'],
  ['🎯 Good zooms', 'Use “Good Zoom” or “Zoom Transition” centred on a cut. Motion blur is computed automatically from the movement (Project → Motion blur).'],
  ['🫧 Twixtor', 'Speed tab → Twixtor 25%. Neighbouring frames are blended for smooth slow motion — the export renders exact frame blends.'],
  ['📈 Velocity', 'Velocity ramps keep the clip length, so your cuts stay locked to the beat while the speed curve changes inside the clip.'],
  ['⏪ Reverse', 'Toggle Reverse (R) on a clip, or drop the “Rewind” / “Reverse Section” time FX over any part of the timeline.'],
  ['🥁 Beat sync', 'Snap is on by default: effects, trims and the playhead snap to beat markers, cuts and each other.'],
];

export function HelpModal() {
  const open = useEditor((s) => s.helpOpen);
  if (!open) return null;
  const close = () => useEditor.getState().ui({ helpOpen: false });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="ev-in w-full max-w-[560px] max-h-[92vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#101016] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <WebLogo size={24} />
            <span className="text-[14px] font-bold text-white">How to make a fandom edit</span>
          </div>
          <button type="button" onClick={close} className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          {TIPS.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="text-[12.5px] font-bold text-zinc-100">{t}</div>
              <div className="mt-1 text-[11.5px] leading-relaxed text-zinc-400">{d}</div>
            </div>
          ))}
        </div>
        <div className="border-t border-white/[0.06] px-4 py-3 text-[11px] text-zinc-500">
          Shortcuts: <b className="text-zinc-300">Space</b> play · <b className="text-zinc-300">S</b> split · <b className="text-zinc-300">B</b> beat · <b className="text-zinc-300">R</b> reverse · <b className="text-zinc-300">T</b> twixtor · <b className="text-zinc-300">Del</b> delete · <b className="text-zinc-300">Ctrl+Z</b> undo · <b className="text-zinc-300">Ctrl+wheel</b> zoom timeline
        </div>
      </div>
    </div>
  );
}
