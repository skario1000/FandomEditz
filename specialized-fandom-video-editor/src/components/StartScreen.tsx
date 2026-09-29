import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Clock, Copy, Film, FolderOpen, HardDrive, HelpCircle, Loader2, Music2, Pencil, Plus, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import { useEditor } from '../store';
import type { Aspect } from '../types';
import { listProjects, storageUsage, type ProjectMeta } from '../lib/storage';
import { mediaUsageMB } from '../lib/mediaStorage';
import { TEMPLATES, createProject, createProjectFromFiles, deleteProject, duplicateProject, openProject, renameProject, type TemplateId } from '../lib/projects';
import { ALL_MEDIA_ACCEPT } from '../lib/media';
import { WebLogo } from './TopBar';
import { cn } from '../utils/cn';

const FORMATS: { v: Aspect; label: string; hint: string; w: number; h: number }[] = [
  { v: '9:16', label: '9:16', hint: 'TikTok · Reels · Shorts', w: 18, h: 32 },
  { v: '16:9', label: '16:9', hint: 'YouTube', w: 34, h: 19 },
  { v: '1:1', label: '1:1', hint: 'Square post', w: 26, h: 26 },
  { v: '4:5', label: '4:5', hint: 'Instagram feed', w: 24, h: 30 },
];

function ago(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}
const dur = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function ProjectCard({ m, busy }: { m: ProjectMeta; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setName(m.name), [m.name]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== m.name) renameProject(m.id, name);
    else setName(m.name);
  };
  const [a, b] = m.aspect.split(':').map(Number);
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-[#101017] transition-all hover:-translate-y-0.5 hover:border-white/20 hover:shadow-2xl hover:shadow-black/60">
      <button type="button" disabled={busy} onClick={() => void openProject(m.id)} className="relative block aspect-[16/10] w-full overflow-hidden bg-[#0a0a0f] text-left">
        {m.thumbs.length ? (
          <div className="absolute inset-0 flex">
            {m.thumbs.map((t, i) => (
              <div key={i} className="h-full flex-1 bg-cover bg-center transition-transform duration-500 group-hover:scale-105" style={{ backgroundImage: `url(${t})` }} />
            ))}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(120%_90%_at_50%_30%,#231830_0%,#0b0b10_70%)]">
            <div className="rounded-[3px] border border-white/25" style={{ width: (a / Math.max(a, b)) * 34, height: (b / Math.max(a, b)) * 34 }} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
        <div className="absolute left-2 top-2 flex gap-1">
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-zinc-200 backdrop-blur">{m.aspect}</span>
          {m.duration > 0 && <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-zinc-300 backdrop-blur">{dur(m.duration)}</span>}
        </div>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[11px] font-bold text-black shadow-xl">
            <FolderOpen size={13} /> Open
          </span>
        </div>
        <div className="absolute bottom-1.5 left-2 right-2 flex items-center gap-2 text-[10px] text-zinc-300">
          <span className="flex items-center gap-1">
            <Film size={10} /> {m.clips} clips
          </span>
          {m.music && (
            <span className="flex min-w-0 items-center gap-1 truncate">
              <Music2 size={10} className="shrink-0" /> <span className="truncate">{m.music}</span>
            </span>
          )}
        </div>
      </button>
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button type="button" title="Rename" onClick={() => setEditing(true)} className="rounded-md bg-black/75 p-1.5 text-zinc-200 backdrop-blur hover:bg-white hover:text-black">
          <Pencil size={11} />
        </button>
        <button type="button" title="Duplicate" onClick={() => void duplicateProject(m.id)} className="rounded-md bg-black/75 p-1.5 text-zinc-200 backdrop-blur hover:bg-white hover:text-black">
          <Copy size={11} />
        </button>
        <button
          type="button"
          title="Delete"
          onClick={() => {
            if (confirm(`Delete “${m.name}”? Its timeline and any clips only it uses are removed.`)) void deleteProject(m.id);
          }}
          className="rounded-md bg-black/75 p-1.5 text-zinc-200 backdrop-blur hover:bg-red-500 hover:text-white"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <div className="px-3 pb-2.5 pt-2">
        {editing ? (
          <input
            ref={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setName(m.name);
                setEditing(false);
              }
            }}
            className="w-full rounded border border-[#ff2d55]/60 bg-black/40 px-1.5 py-0.5 text-[13px] font-semibold text-white outline-none"
          />
        ) : (
          <div className="truncate text-[13px] font-semibold text-zinc-100" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
            {m.name}
          </div>
        )}
        <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-zinc-500">
          <Clock size={10} /> Edited {ago(m.updatedAt)}
        </div>
      </div>
    </div>
  );
}

export function StartScreen() {
  useEditor((s) => s.libraryVersion);
  const booted = useEditor((s) => s.booted);
  const opening = useEditor((s) => s.opening);
  const [aspect, setAspect] = useState<Aspect>('9:16');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'name' | 'created'>('recent');
  const [creating, setCreating] = useState<TemplateId | null>(null);
  const [mediaMB, setMediaMB] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const version = useEditor((s) => s.libraryVersion);

  const projects = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = listProjects().filter((m) => !s || m.name.toLowerCase().includes(s) || (m.music ?? '').toLowerCase().includes(s));
    return list.sort((x, y) => (sort === 'name' ? x.name.localeCompare(y.name) : sort === 'created' ? y.createdAt - x.createdAt : y.updatedAt - x.updatedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, version]);

  useEffect(() => {
    void mediaUsageMB().then(setMediaMB);
  }, [version]);

  const start = async (t: TemplateId) => {
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
    <div className="bg-grid relative h-screen w-screen overflow-y-auto bg-[#07070b] text-zinc-200">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_100%_at_30%_0%,rgba(255,45,85,0.18),transparent_70%),radial-gradient(50%_90%_at_80%_0%,rgba(123,45,255,0.16),transparent_70%)]" />

      <header className="relative mx-auto flex max-w-[1240px] items-center gap-3 px-6 pt-6">
        <WebLogo size={36} />
        <div className="leading-none">
          <div className="logo-glitch text-[22px] font-black italic tracking-tight text-white">EDITVERSE</div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">fandom edit studio</div>
        </div>
        <div className="flex-1" />
        <div className="hidden items-center gap-3 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-[10.5px] text-zinc-400 sm:flex">
          <HardDrive size={12} />
          <span>
            {projects.length} project{projects.length === 1 ? '' : 's'} · {usage.usedKB} KB timelines{mediaMB !== null ? ` · ${mediaMB} MB clips` : ''}
          </span>
        </div>
        <button type="button" onClick={() => useEditor.getState().ui({ helpOpen: true })} className="rounded-full p-2 text-zinc-400 hover:bg-white/10 hover:text-white" title="How it works">
          <HelpCircle size={17} />
        </button>
      </header>

      <main className="relative mx-auto max-w-[1240px] px-6 pb-16 pt-8">
        {/* ---------------- new project ---------------- */}
        <section className="rounded-2xl border border-white/[0.07] bg-[#0d0d13]/90 p-5 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-black tracking-tight text-white">Start a new edit</h1>
              <p className="mt-0.5 text-[12.5px] text-zinc-400">Pick a format, then a starting point. Everything saves automatically in this browser.</p>
            </div>
            <div className="flex gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.v}
                  type="button"
                  onClick={() => setAspect(f.v)}
                  title={f.hint}
                  className={cn(
                    'flex w-[76px] flex-col items-center gap-1.5 rounded-xl border px-2 pb-2 pt-2.5 transition-all',
                    aspect === f.v ? 'border-[#ff2d55]/70 bg-[#ff2d55]/10 text-white shadow-lg shadow-[#ff2d55]/10' : 'border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                  )}
                >
                  <div className="flex h-[34px] items-center justify-center">
                    <div className={cn('rounded-[3px] border-2', aspect === f.v ? 'border-[#ff2d55]' : 'border-current')} style={{ width: f.w, height: f.h }} />
                  </div>
                  <span className="text-[11px] font-bold">{f.label}</span>
                  <span className="text-center text-[8.5px] leading-tight text-zinc-500">{f.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={busy}
                onClick={() => void start(t.id)}
                className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#13131b] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-white/25 disabled:cursor-wait disabled:opacity-60"
              >
                <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: t.accent }} />
                <div
                  className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg text-[20px]"
                  style={{ background: `${t.accent}1f`, boxShadow: `inset 0 0 0 1px ${t.accent}55`, color: t.accent }}
                >
                  {creating === t.id ? <Loader2 size={18} className="animate-spin" /> : t.icon}
                </div>
                <div className="text-[13.5px] font-bold text-white">{t.name}</div>
                <div className="mt-1 text-[11px] leading-snug text-zinc-500">{t.desc}</div>
                <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ background: `radial-gradient(160px 90px at 20% 0%, ${t.accent}22, transparent)` }} />
              </button>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/10 p-4 text-center transition-colors hover:border-[#ff2d55]/60 hover:bg-[#ff2d55]/5 disabled:opacity-60"
            >
              <Upload size={20} className="text-[#ff2d55]" />
              <div className="text-[12.5px] font-bold text-zinc-100">From your files</div>
              <div className="text-[10.5px] leading-snug text-zinc-500">Pick clips & a song — or drop them anywhere on this page</div>
            </button>
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
          </div>
        </section>

        {/* ---------------- projects ---------------- */}
        <section className="mt-9">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-[16px] font-black tracking-tight text-white">Your projects</h2>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-semibold text-zinc-400">{projects.length}</span>
            <div className="flex-1" />
            <div className="flex w-[240px] items-center gap-2 rounded-lg border border-white/[0.08] bg-[#111118] px-2.5 py-1.5 focus-within:border-[#ff2d55]/50">
              <Search size={13} className="text-zinc-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects or songs" className="w-full bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600" />
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#111118] px-2 py-1 text-[11px] text-zinc-400">
              <ArrowUpDown size={12} />
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="bg-transparent py-0.5 text-zinc-200 outline-none">
                <option value="recent">Last edited</option>
                <option value="created">Newest</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>

          {!booted ? (
            <div className="flex items-center justify-center gap-2 py-20 text-[12.5px] text-zinc-500">
              <Loader2 size={16} className="animate-spin text-[#ff2d55]" /> Warming up the studio…
            </div>
          ) : projects.length ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {projects.map((m) => (
                <ProjectCard key={m.id} m={m} busy={busy} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 py-16 text-center">
              <Sparkles size={24} className="text-[#ff2d55]" />
              <div className="text-[14px] font-bold text-zinc-100">{q ? `Nothing matches “${q}”` : 'No projects yet'}</div>
              <div className="text-[12px] text-zinc-500">{q ? 'Try another name.' : 'Create one above to get started.'}</div>
              {!q && (
                <button type="button" onClick={() => void start('blank')} className="mt-1 flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff2d55] to-[#b026ff] px-4 py-2 text-[12px] font-bold text-white">
                  <Plus size={14} /> New blank edit
                </button>
              )}
            </div>
          )}
        </section>

        <p className="mt-10 text-center text-[10.5px] text-zinc-600">
          Projects and imported clips are stored locally in this browser (localStorage + IndexedDB). Clearing site data removes them.
        </p>
      </main>

      {opening && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#07070b]/85 backdrop-blur-sm">
          <Loader2 size={26} className="animate-spin text-[#ff2d55]" />
          <div className="text-[13px] font-semibold text-zinc-200">Opening project…</div>
        </div>
      )}
    </div>
  );
}
