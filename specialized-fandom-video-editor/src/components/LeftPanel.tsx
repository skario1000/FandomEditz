import { Activity, Film, Gauge, Palette, Sparkles } from 'lucide-react';
import { useEditor, type LeftTab } from '../store';
import { MediaTab } from './MediaTab';
import { FxTab } from './FxTab';
import { ColorTab, SpeedTab } from './SpeedColorTabs';
import { BeatsTab } from './BeatsTab';
import { cn } from '../utils/cn';

const TABS: { id: LeftTab; label: string; icon: typeof Film }[] = [
  { id: 'media', label: 'Media', icon: Film },
  { id: 'fx', label: 'FX', icon: Sparkles },
  { id: 'speed', label: 'Speed', icon: Gauge },
  { id: 'color', label: 'Color', icon: Palette },
  { id: 'beats', label: 'Beats', icon: Activity },
];

export function LeftPanel() {
  const tab = useEditor((s) => s.leftTab);
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0c0c11]">
      <nav className="flex shrink-0 border-b border-white/[0.06] px-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => useEditor.getState().ui({ leftTab: t.id })}
              className={cn(
                'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors',
                active ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <Icon size={15} className={active ? 'text-[#ff2d55]' : ''} />
              {t.label}
              {active && <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-gradient-to-r from-[#ff2d55] to-[#b026ff]" />}
            </button>
          );
        })}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'media' && <MediaTab />}
        {tab === 'fx' && <FxTab />}
        {tab === 'speed' && <SpeedTab />}
        {tab === 'color' && <ColorTab />}
        {tab === 'beats' && <BeatsTab />}
      </div>
    </aside>
  );
}
