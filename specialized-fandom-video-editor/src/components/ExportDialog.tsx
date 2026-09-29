import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Loader2, X, AlertTriangle, Film } from 'lucide-react';
import { useEditor } from '../store';
import { runExport, type ExportProgress } from '../lib/exporter';
import { exportSize, fmtSec } from '../lib/utils';
import { totalDuration } from '../lib/velocity';
import { Btn, Seg } from './ui';

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  const aspect = useEditor((s) => s.project.aspect);
  const pfps = useEditor((s) => s.project.fps);
  const total = useEditor((s) => totalDuration(s.project.clips));
  const [res, setRes] = useState<720 | 1080>(1080);
  const [fps, setFps] = useState(pfps);
  const [quality, setQuality] = useState<'medium' | 'high' | 'very-high'>('high');
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [prog, setProg] = useState<ExportProgress | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [t0, setT0] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) setFps(pfps);
  }, [open, pfps]);

  if (!open) return null;
  const [w, h] = exportSize(aspect, res);

  const start = async () => {
    const st = useEditor.getState();
    st.pause();
    st.ui({ exporting: true });
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    setErr('');
    setProg(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setState('running');
    setT0(performance.now());
    try {
      const blob = await runExport(st.project, st.media, { width: w, height: h, fps, quality, format }, setProg, ac.signal);
      setUrl(URL.createObjectURL(blob));
      setState('done');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setState('idle');
      else {
        setErr(e instanceof Error ? e.message : String(e));
        setState('error');
      }
    } finally {
      useEditor.getState().ui({ exporting: false });
    }
  };

  const close = () => {
    if (state === 'running') {
      if (!confirm('Cancel the export?')) return;
      abortRef.current?.abort();
    }
    useEditor.getState().ui({ exportOpen: false });
    if (state !== 'running') setState('idle');
  };

  const frac = prog ? prog.frame / Math.max(1, prog.total) : 0;
  const elapsed = (performance.now() - t0) / 1000;
  const eta = frac > 0.02 ? elapsed / frac - elapsed : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="ev-in w-full max-w-[460px] max-h-[92vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#101016] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2 text-[14px] font-bold text-white">
            <Film size={16} className="text-[#ff2d55]" /> Export edit
          </div>
          <button type="button" onClick={close} className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 p-4">
          {state === 'done' && url ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-400">
                <CheckCircle2 size={16} /> Your edit is ready!
              </div>
              <video src={url} controls autoPlay loop className="max-h-[46vh] w-full rounded-lg bg-black" />
              <div className="flex gap-2">
                <a href={url} download={`editverse-edit.${format}`} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#ff2d55] to-[#b026ff] px-4 py-2.5 text-[13px] font-bold text-white shadow-lg hover:brightness-110">
                  <Download size={15} /> Download {format.toUpperCase()}
                </a>
                <Btn variant="soft" onClick={() => setState('idle')}>
                  Export again
                </Btn>
              </div>
            </div>
          ) : state === 'running' ? (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-[13px] text-zinc-200">
                <Loader2 size={15} className="animate-spin text-[#ff2d55]" /> {prog?.phase ?? 'Preparing'}…
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-[#ff2d55] to-[#b026ff] transition-[width]" style={{ width: `${Math.round(frac * 100)}%` }} />
              </div>
              <div className="flex justify-between text-[11px] tabular-nums text-zinc-500">
                <span>
                  Frame {prog?.frame ?? 0} / {prog?.total ?? '…'}
                </span>
                <span>
                  {Math.round(frac * 100)}%{eta > 0 ? ` · ~${Math.ceil(eta)}s left` : ''}
                </span>
              </div>
              <Btn variant="danger" className="w-full" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Btn>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <div className="text-zinc-500">Output</div>
                  <div className="text-[13px] font-bold text-white">
                    {w}×{h}
                  </div>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <div className="text-zinc-500">Length</div>
                  <div className="text-[13px] font-bold text-white">{fmtSec(total)}</div>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-zinc-400">Resolution</div>
                <Seg
                  value={res}
                  onChange={setRes}
                  options={[
                    { v: 720, l: '720p' },
                    { v: 1080, l: '1080p' },
                  ]}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-zinc-400">Frame rate</div>
                <Seg value={fps} onChange={setFps} options={[24, 30, 60].map((f) => ({ v: f, l: `${f} fps` }))} />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-zinc-400">Quality</div>
                <Seg
                  value={quality}
                  onChange={setQuality}
                  options={[
                    { v: 'medium', l: 'Medium' },
                    { v: 'high', l: 'High' },
                    { v: 'very-high', l: 'Max' },
                  ]}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-zinc-400">Format</div>
                <Seg
                  value={format}
                  onChange={setFormat}
                  options={[
                    { v: 'mp4', l: 'MP4 (H.264)' },
                    { v: 'webm', l: 'WebM (VP9)' },
                  ]}
                />
              </div>
              {state === 'error' && (
                <div className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-[11.5px] text-red-200">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}
                </div>
              )}
              <Btn variant="primary" className="w-full py-2.5 text-[13px]" onClick={start} disabled={total <= 0}>
                <Download size={15} /> Render & export
              </Btn>
              <div className="text-center text-[10.5px] text-zinc-500">Frame-accurate offline render with full-quality motion blur, twixtor blending and your music track. Everything stays on your device.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
