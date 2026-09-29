import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  Copy,
  Film,
  HardDrive,
  HelpCircle,
  Loader2,
  Monitor,
  MoreVertical,
  Music2,
  Pencil,
  Search,
  Smartphone,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEditor } from '../../store';
import type { Aspect } from '../../types';
import { listProjects, storageUsage } from '../../lib/storage';
import { mediaUsageMB } from '../../lib/mediaStorage';
import {
  TEMPLATES,
  createProject,
  createProjectFromFiles,
  deleteProject,
  duplicateProject,
  openProject,
  renameProject,
  type TemplateId,
} from '../../lib/projects';
import { AUDIO_ACCEPT, VIDEO_ACCEPT, ALL_MEDIA_ACCEPT } from '../../lib/media';
import { WebLogo } from '../TopBar';
import { useIsPhone } from '../../lib/useIsPhone';
import { cn } from '../../utils/cn';

const FORMATS: { v: Aspect; label: string; sub: string }[] = [
  { v: '9:16', label: '9:16', sub: 'TikTok / Reels' },
  { v: '16:9', label: '16:9', sub: 'YouTube' },
  { v: '1:1', label: '1:1', sub: 'Square' },
  { v: '4:5', label: '4:5', sub: 'Feed' },
];

function timeAgo(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const fmtDur = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export function MobileStartScreen() {
  useEditor((s) => s.libraryVersion);
  const booted = useEditor((s) => s.booted);
  const opening = useEditor((s) => s.opening);
  const { mode, setMode } = useIsPhone();

  const [aspect, setAspect] = useState<Aspect>('9:16');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState<TemplateId | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [mediaMB, setMediaMB] = useState<number | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);
  const version = useEditor((s) => s.libraryVersion);

  const projects = useMemo(() => {
    const search = q.trim().toLowerCase();
    return listProjects()
      .filter((m) => !search || m.name.toLowerCase().includes(search) || (m.music ?? '').toLowerCase().includes(search))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, version]);

  useEffect(() => {
    void mediaUsageMB().then(setMediaMB);
  }, [version]);

  const startTemplate = async (t: TemplateId) => {
    if (creating || opening) return;
    setCreating(t);
    try {
      await createProject(t, aspect);
    } finally {
      setCreating(null);
    }
  };

  const busy = !booted || opening || !!creating;
  const usage = storageUsage();

  return (
    <div className="relative min-h-screen w-full bg-[#07070b] pb-20 text-zinc-100 select-none">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-64 bg-gradient-to-b from-[#ff2d55]/20 via-[#7b2dff]/10 to-transparent blur-2xl" />

      {/* Mobile Header */}
      <header className="relative flex items-center justify-between border-b border-white/[0.08] bg-[#0c0c12]/90 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <WebLogo size={28} />
          <div>
            <div className="logo-glitch text-[16px] font-black italic tracking-tight text-white leading-tight">
              EDITVERSE
            </div>
            <div className="text-[8.5px] font-bold uppercase tracking-[0.2em] text-[#ff2d55]">
              Mobile Studio
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Device switch helper for testing */}
          <button
            type="button"
            onClick={() => setMode(mode === 'phone' ? 'desktop' : 'phone')}
            title="Toggle device view (Phone / Desktop)"
            className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-zinc-300"
          >
            {mode === 'phone' ? <Smartphone size={11} className="text-[#ff2d55]" /> : <Monitor size={11} />}
            <span>Phone</span>
          </button>

          <button
            type="button"
            onClick={() => useEditor.getState().ui({ helpOpen: true })}
            className="rounded-full p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </header>

      <main className="relative px-4 pt-4 space-y-5">
        {/* Aspect Ratio Pill Bar */}
        <div>
          <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">
            Project Aspect Ratio
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {FORMATS.map((f) => {
              const active = aspect === f.v;
              return (
                <button
                  key={f.v}
                  type="button"
                  onClick={() => setAspect(f.v)}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-xl border py-2 transition-all',
                    active
                      ? 'border-[#ff2d55] bg-gradient-to-b from-[#ff2d55]/20 to-[#b026ff]/10 text-white shadow-md shadow-[#ff2d55]/20'
                      : 'border-white/[0.08] bg-[#121218] text-zinc-400'
                  )}
                >
                  <span className="text-[12px] font-black">{f.label}</span>
                  <span className="text-[9px] text-zinc-500 truncate max-w-full px-1">{f.sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Big Start New Project Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#ff2d55]/20 via-[#7b2dff]/20 to-[#12121c] p-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3">
            <div>
              <div className="text-[17px] font-black tracking-tight text-white">Create New Edit</div>
              <div className="text-[11px] text-zinc-400">Tap a starter or import files from your iPhone</div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => videoFileRef.current?.click()}
                className="flex items-center gap-1 rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-bold text-black shadow hover:bg-zinc-200 active:scale-95 transition-transform"
                title="Select videos from Photos or Files"
              >
                <Film size={12} className="text-[#ff2d55]" /> Videos
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => audioFileRef.current?.click()}
                className="flex items-center gap-1 rounded-xl bg-gradient-to-r from-[#ff2d55] to-[#b026ff] px-2.5 py-1.5 text-[11px] font-bold text-white shadow active:scale-95 transition-transform"
                title="Select songs/MP3 from Files app"
              >
                <Music2 size={12} /> Song (MP3)
              </button>
            </div>
          </div>

          {/* Hidden File Pickers tailored for iOS/iPhone */}
          <input
            ref={videoFileRef}
            type="file"
            multiple
            accept={VIDEO_ACCEPT}
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void createProjectFromFiles(files, aspect);
            }}
          />
          <input
            ref={audioFileRef}
            type="file"
            multiple
            accept={AUDIO_ACCEPT}
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void createProjectFromFiles(files, aspect);
            }}
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ALL_MEDIA_ACCEPT}
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void createProjectFromFiles(files, aspect);
            }}
          />

          {/* Starter Template Grid */}
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={busy}
                onClick={() => void startTemplate(t.id)}
                className="flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#13131d]/90 p-2.5 text-left active:scale-[0.98] transition-transform"
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
                  style={{ background: `${t.accent}20`, color: t.accent }}
                >
                  {creating === t.id ? <Loader2 size={16} className="animate-spin" /> : t.icon}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-bold text-white">{t.name}</div>
                  <div className="truncate text-[10px] text-zinc-500">{t.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Projects List Section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-black text-white">My Projects</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-zinc-400">
                {projects.length}
              </span>
            </div>
            {usage.usedKB > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                <HardDrive size={10} />
                <span>{usage.usedKB} KB{mediaMB ? ` · ${mediaMB} MB` : ''}</span>
              </div>
            )}
          </div>

          {/* Mobile Search */}
          {projects.length > 2 && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#111118] px-3 py-2">
              <Search size={14} className="text-zinc-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search edits or songs..."
                className="w-full bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600"
              />
            </div>
          )}

          {/* Project Cards List */}
          {!booted ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-zinc-500">
              <Loader2 size={16} className="animate-spin text-[#ff2d55]" /> Loading phone studio...
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center space-y-2">
              <Sparkles size={24} className="mx-auto text-[#ff2d55]" />
              <div className="text-[13px] font-bold text-zinc-200">No edits yet</div>
              <div className="text-[11px] text-zinc-500">Tap a starter template above to begin!</div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {projects.map((p) => {
                const hasThumb = p.thumbs.length > 0;
                return (
                  <div
                    key={p.id}
                    className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-white/[0.08] bg-[#101016] p-2.5 active:bg-[#161622] transition-colors"
                  >
                    {/* Thumbnail tap target */}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openProject(p.id)}
                      className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-black text-left"
                    >
                      {hasThumb ? (
                        <div
                          className="h-full w-full bg-cover bg-center"
                          style={{ backgroundImage: `url(${p.thumbs[0]})` }}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-600">
                          <Film size={20} />
                        </div>
                      )}
                      <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[8.5px] font-bold text-zinc-300">
                        {p.aspect}
                      </span>
                    </button>

                    {/* Metadata tap target */}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openProject(p.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-[13px] font-bold text-white leading-tight">
                        {p.name}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400">
                        <span className="flex items-center gap-0.5">
                          <Clock size={10} /> {timeAgo(p.updatedAt)}
                        </span>
                        <span>•</span>
                        <span>{fmtDur(p.duration)}</span>
                        <span>•</span>
                        <span>{p.clips} clips</span>
                      </div>
                      {p.music && (
                        <div className="mt-0.5 flex items-center gap-1 truncate text-[9.5px] text-[#ff5c7c]">
                          <Music2 size={9} className="shrink-0" />
                          <span className="truncate">{p.music}</span>
                        </div>
                      )}
                    </button>

                    {/* Three dots menu button */}
                    <button
                      type="button"
                      onClick={() => setActiveMenuId(activeMenuId === p.id ? null : p.id)}
                      className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
                    >
                      <MoreVertical size={16} />
                    </button>

                    {/* Popup actions menu */}
                    {activeMenuId === p.id && (
                      <div className="absolute right-3 top-10 z-20 flex flex-col rounded-xl border border-white/10 bg-[#191924] p-1.5 shadow-2xl space-y-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuId(null);
                            setRenameId(p.id);
                            setRenameVal(p.name);
                          }}
                          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11.5px] text-zinc-200 hover:bg-white/10"
                        >
                          <Pencil size={12} /> Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuId(null);
                            void duplicateProject(p.id);
                          }}
                          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11.5px] text-zinc-200 hover:bg-white/10"
                        >
                          <Copy size={12} /> Duplicate
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuId(null);
                            if (confirm(`Delete "${p.name}"?`)) void deleteProject(p.id);
                          }}
                          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11.5px] text-red-300 hover:bg-red-500/20"
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Rename Dialog Modal */}
      {renameId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#12121a] p-4 space-y-3">
            <div className="text-[14px] font-bold text-white">Rename Project</div>
            <input
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  renameProject(renameId, renameVal);
                  setRenameId(null);
                }
                if (e.key === 'Escape') setRenameId(null);
              }}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-white outline-none focus:border-[#ff2d55]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRenameId(null)}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2 text-[12px] font-semibold text-zinc-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  renameProject(renameId, renameVal);
                  setRenameId(null);
                }}
                className="flex-1 rounded-xl bg-[#ff2d55] py-2 text-[12px] font-bold text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Opening Overlay */}
      {opening && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 backdrop-blur-sm">
          <Loader2 size={32} className="animate-spin text-[#ff2d55]" />
          <div className="text-[14px] font-bold text-white">Opening edit...</div>
        </div>
      )}
    </div>
  );
}
