import { useState } from 'react';
import { ChevronLeft, Download, Redo2, Undo2, Smartphone, Monitor, Sparkles } from 'lucide-react';
import { useEditor } from '../../store';
import { closeProject, renameProject } from '../../lib/projects';
import { useIsPhone } from '../../lib/useIsPhone';

export function MobileTopBar() {
  const name = useEditor((s) => s.projectName);
  const id = useEditor((s) => s.currentProjectId);
  const aspect = useEditor((s) => s.project.aspect);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const st = useEditor.getState();
  const { mode, setMode } = useIsPhone();

  const [renaming, setRenaming] = useState(false);
  const [val, setVal] = useState(name);

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#0c0c12] px-2 text-zinc-100 select-none">
      {/* Back to projects button */}
      <button
        type="button"
        onClick={() => void closeProject()}
        className="flex items-center gap-0.5 rounded-lg py-1 pr-1.5 text-[11px] font-bold text-zinc-300 hover:text-white active:scale-95 transition-transform"
      >
        <ChevronLeft size={16} />
        <span>Projects</span>
      </button>

      {/* Title + Aspect */}
      <div className="flex items-center gap-1.5 min-w-0 max-w-[42%]">
        <button
          type="button"
          onClick={() => {
            setVal(name);
            setRenaming(true);
          }}
          className="truncate text-[12px] font-bold text-white hover:text-[#ff5c7c]"
          title="Tap to rename"
        >
          {name || 'Untitled edit'}
        </button>
        <span className="shrink-0 rounded bg-white/10 px-1 py-0.5 text-[8.5px] font-bold text-zinc-300">
          {aspect}
        </span>
      </div>

      {/* Actions: Device toggle, Undo, Redo, Export */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMode(mode === 'phone' ? 'desktop' : 'phone')}
          title="Toggle phone/desktop layout"
          className="rounded p-1 text-zinc-400 hover:text-white"
        >
          {mode === 'phone' ? <Smartphone size={13} className="text-[#ff2d55]" /> : <Monitor size={13} />}
        </button>

        <button
          type="button"
          disabled={!canUndo}
          onClick={st.undo}
          className="rounded p-1 text-zinc-400 disabled:opacity-30 hover:text-white active:scale-90"
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={st.redo}
          className="rounded p-1 text-zinc-400 disabled:opacity-30 hover:text-white active:scale-90"
        >
          <Redo2 size={14} />
        </button>

        <button
          type="button"
          onClick={() => st.ui({ aiOpen: true })}
          title="Open AI Director Mode"
          className="flex items-center gap-1 rounded-lg border border-[#ff2d55]/40 bg-[#ff2d55]/15 px-2 py-1 text-[10.5px] font-black text-[#ff5c7c] active:scale-95 transition-transform"
        >
          <Sparkles size={11} className="animate-pulse" />
          <span>AI</span>
        </button>

        <button
          type="button"
          onClick={() => st.ui({ exportOpen: true })}
          className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-[#ff2d55] to-[#b026ff] px-2.5 py-1 text-[11px] font-black text-white shadow-md active:scale-95 transition-transform"
        >
          <Download size={12} />
          <span>Export</span>
        </button>
      </div>

      {/* Quick Rename modal */}
      {renaming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-[#12121a] p-4 space-y-3">
            <div className="text-[13px] font-bold text-white">Rename Edit</div>
            <input
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (id) renameProject(id, val);
                  setRenaming(false);
                }
                if (e.key === 'Escape') setRenaming(false);
              }}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-white outline-none focus:border-[#ff2d55]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 py-1.5 text-[11px] font-semibold text-zinc-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (id) renameProject(id, val);
                  setRenaming(false);
                }}
                className="flex-1 rounded-xl bg-[#ff2d55] py-1.5 text-[11px] font-bold text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
