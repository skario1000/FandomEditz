import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, HelpCircle, LayoutGrid, Loader2, Redo2, Smartphone, Sparkles, Undo2 } from 'lucide-react';
import { useEditor } from '../store';
import { closeProject, duplicateProject, renameProject } from '../lib/projects';
import { useIsPhone } from '../lib/useIsPhone';
import { Btn, Seg } from './ui';
import { cn } from '../utils/cn';
import type { Aspect } from '../types';

const octagon = (cx: number, cy: number, r: number) =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

export function WebLogo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <defs>
        <linearGradient id="evlg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff2d55" />
          <stop offset="1" stopColor="#7b2dff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#evlg)" />
      <g stroke="white" strokeWidth="1.1" fill="none" opacity="0.95">
        {[0, 45, 90, 135].map((a) => (
          <line key={a} x1="16" y1="3.5" x2="16" y2="28.5" transform={`rotate(${a} 16 16)`} />
        ))}
        {[4, 8, 12].map((r) => (
          <polygon key={r} points={octagon(16, 16, r)} />
        ))}
      </g>
    </svg>
  );
}

function ProjectName() {
  const name = useEditor((s) => s.projectName);
  const id = useEditor((s) => s.currentProjectId);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = () => {
    if (id && draft.trim() && draft.trim() !== name) renameProject(id, draft);
    else setDraft(name);
  };
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(name);
          setTimeout(() => (document.activeElement as HTMLElement | null)?.blur(), 0);
        }
      }}
      title="Rename project"
      className="w-[190px] truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] font-semibold text-zinc-100 outline-none hover:border-white/10 focus:border-[#ff2d55]/60 focus:bg-black/30"
    />
  );
}

function SaveBadge() {
  const s = useEditor((x) => x.saveState);
  return (
    <div
      className={cn(
        'hidden items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium sm:flex',
        s === 'error' ? 'border-red-500/30 bg-red-950/40 text-red-300' : s === 'saving' ? 'border-amber-500/20 bg-amber-950/30 text-amber-300' : 'border-emerald-500/20 bg-emerald-950/40 text-emerald-400'
      )}
      title="Projects save automatically in this browser"
    >
      {s === 'saving' ? <Loader2 size={10} className="animate-spin" /> : s === 'error' ? <AlertTriangle size={10} /> : <Check size={10} />}
      {s === 'saving' ? 'Saving…' : s === 'error' ? 'Storage full' : 'Saved'}
    </div>
  );
}

export function TopBar() {
  const aspect = useEditor((s) => s.project.aspect);
  const fps = useEditor((s) => s.project.fps);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const st = useEditor.getState();
  const { setMode } = useIsPhone();
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0f] px-3">
      <button type="button" onClick={() => void closeProject()} title="Back to projects" className="flex select-none items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-white/[0.05]">
        <WebLogo />
        <div className="hidden leading-none xl:block">
          <div className="logo-glitch text-[17px] font-black italic tracking-tight text-white">EDITVERSE</div>
        </div>
      </button>
      <Btn variant="soft" onClick={() => void closeProject()} title="All projects">
        <LayoutGrid size={14} /> <span className="hidden lg:inline">Projects</span>
      </Btn>
      <ProjectName />
      <div className="mx-1 h-6 w-px bg-white/10" />
      <Seg<Aspect>
        value={aspect}
        onChange={(a) => st.setProjectProps({ aspect: a })}
        options={[
          { v: '9:16', l: '9:16', title: 'TikTok / Reels / Shorts' },
          { v: '16:9', l: '16:9', title: 'YouTube' },
          { v: '1:1', l: '1:1', title: 'Square' },
          { v: '4:5', l: '4:5', title: 'Instagram feed' },
        ]}
      />
      <Seg<number> value={fps} onChange={(f) => st.setProjectProps({ fps: f })} options={[24, 30, 60].map((f) => ({ v: f, l: `${f} fps` }))} className="hidden md:flex" />
      <div className="flex-1" />
      <SaveBadge />

      <Btn title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={st.undo}>
        <Undo2 size={15} />
      </Btn>
      <Btn title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={st.redo}>
        <Redo2 size={15} />
      </Btn>
      <Btn variant="soft" title="Duplicate this project (keeps working on the current one)" onClick={() => st.currentProjectId && void duplicateProject(st.currentProjectId)}>
        <Copy size={14} /> <span className="hidden lg:inline">Duplicate</span>
      </Btn>

      {/* AI Director Mode button */}
      <button
        type="button"
        onClick={() => st.ui({ aiOpen: true })}
        title="Open AI Director (OpenCode Go)"
        className="flex items-center gap-1.5 rounded-lg border border-[#ff2d55]/50 bg-gradient-to-r from-[#ff2d55]/20 via-[#b026ff]/20 to-[#7b2dff]/20 px-3 py-1.5 text-[12px] font-bold text-white shadow-md shadow-[#ff2d55]/20 hover:brightness-125 active:scale-95 transition-all"
      >
        <Sparkles size={14} className="text-[#ff5c7c] animate-pulse" />
        <span>AI Mode</span>
        <span className="rounded bg-[#ff2d55] px-1 py-0.2 text-[8px] font-black uppercase tracking-wider text-white">
          GO
        </span>
      </button>
      <Btn
        title="Switch to Phone version"
        onClick={() => setMode('phone')}
        className="text-zinc-400 hover:text-white"
      >
        <Smartphone size={16} className="text-[#ff2d55]" />
        <span className="hidden xl:inline text-[11px]">Phone view</span>
      </Btn>
      <Btn title="Shortcuts & tips" onClick={() => st.ui({ helpOpen: true })}>
        <HelpCircle size={16} />
      </Btn>
      <Btn variant="primary" onClick={() => st.ui({ exportOpen: true })} className="px-4">
        <Download size={14} /> Export
      </Btn>
    </header>
  );
}
