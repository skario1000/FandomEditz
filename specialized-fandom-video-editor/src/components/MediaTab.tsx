import { useRef } from 'react';
import { AudioLines, Film, Loader2, Music2, Plus, Trash2, Wand2 } from 'lucide-react';
import { useEditor } from '../store';
import { extractAudioAsMusic, importFiles, thumbs, AUDIO_ACCEPT, VIDEO_ACCEPT, ALL_MEDIA_ACCEPT } from '../lib/media';
import { audio } from '../lib/audio';
import { fmtSec } from '../lib/utils';
import { useIsPhone } from '../lib/useIsPhone';
import type { MediaItem } from '../types';
import { cn } from '../utils/cn';

function MiniWave({ id }: { id: string }) {
  const peaks = audio.peaks.get(id);
  if (!peaks) return null;
  const n = 36;
  const step = Math.max(1, Math.floor(peaks.length / n));
  const bars = Array.from({ length: n }, (_, i) => {
    let m = 0;
    for (let j = i * step; j < Math.min(peaks.length, (i + 1) * step); j++) m = Math.max(m, peaks[j]);
    return m;
  });
  return (
    <div className="flex h-full items-center gap-[2px] px-2">
      {bars.map((b, i) => (
        <div key={i} className="flex-1 rounded-full bg-gradient-to-t from-[#b026ff] to-[#ff2d55]" style={{ height: `${Math.max(6, b * 90)}%` }} />
      ))}
    </div>
  );
}

function MediaCard({ m }: { m: MediaItem }) {
  const st = useEditor.getState();
  const isMusic = useEditor((s) => s.project.music?.mediaId === m.id);
  const isSource = useEditor((s) => s.viewer === 'source' && s.sourceId === m.id);
  const thumb = m.kind !== 'audio' ? thumbs.get(m, Math.min(1.5, m.duration * 0.3)) : undefined;
  const ready = m.status === 'ready';
  const { isPhone } = useIsPhone();

  const handleAddClip = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!ready) return;
    if (m.kind === 'audio') {
      st.setMusic(m.id);
      st.toast(`Set "${m.name}" as music track`, 'success');
    } else {
      const curTime = st.time;
      const insertIdx = st.insertIndexAtTime(curTime);
      const durToAdd = m.duration > 0 ? Math.min(m.duration, 3.5) : 3;
      st.addClip(m.id, 0, durToAdd, insertIdx);
      st.toast(`Added "${m.name}" to timeline`, 'success');
    }
  };

  return (
    <div
      draggable={ready}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-ev', JSON.stringify({ kind: 'media', id: m.id }));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => {
        if (!ready) return;
        if (isPhone) {
          // On mobile: tapping on the clip immediately adds the clip!
          handleAddClip();
        } else {
          if (m.kind === 'audio') {
            st.setMusic(m.id);
            st.toast(`Set "${m.name}" as music track`, 'success');
          } else {
            st.openSource(m.id);
          }
        }
      }}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-lg border bg-[#13131a] transition-all hover:border-white/20 active:scale-[0.98]',
        isSource || isMusic ? 'border-[#ff2d55]/70 ring-1 ring-[#ff2d55]/40' : 'border-white/[0.06]'
      )}
      title={m.kind === 'audio' ? 'Tap to use as music' : isPhone ? 'Tap to add clip to timeline' : 'Click to open in source viewer, drag onto timeline'}
    >
      <div className="relative aspect-video bg-black/60">
        {m.kind === 'audio' ? (
          <MiniWave id={m.id} />
        ) : thumb ? (
          <img src={thumb} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-600">
            <Film size={18} />
          </div>
        )}
        {m.status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Loader2 className="animate-spin text-zinc-300" size={18} />
          </div>
        )}
        {m.status === 'error' && <div className="absolute inset-0 flex items-center justify-center bg-red-950/70 p-1 text-center text-[10px] text-red-200">{m.error ?? 'Error'}</div>}
        {ready && <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[9px] tabular-nums font-bold text-zinc-200">{fmtSec(m.duration)}</span>}
        {m.kind === 'demo' && <span className="absolute left-1 top-1 rounded bg-[#b026ff]/80 px-1 text-[8px] font-bold uppercase tracking-wider text-white">demo</span>}
        {isMusic && <span className="absolute left-1 top-1 rounded bg-[#ff2d55] px-1 text-[8px] font-bold uppercase tracking-wider text-white">music</span>}

        {/* Action button row: always visible "+ Add" on video clips! */}
        <div className="absolute right-1 top-1 flex items-center gap-1 z-10">
          {ready && m.kind !== 'audio' && (
            <button
              type="button"
              title="Add to timeline"
              onClick={handleAddClip}
              className="flex items-center gap-0.5 rounded bg-[#ff2d55] px-1.5 py-0.5 text-[9.5px] font-black text-white shadow hover:brightness-110 active:scale-90 transition-transform"
            >
              <Plus size={11} />
              <span>Add</span>
            </button>
          )}
          {ready && m.kind === 'audio' && !isMusic && (
            <button
              type="button"
              title="Use as music"
              onClick={(e) => {
                e.stopPropagation();
                st.setMusic(m.id);
                st.toast(`Set "${m.name}" as music track`, 'success');
              }}
              className="flex items-center gap-0.5 rounded bg-[#b026ff] px-1.5 py-0.5 text-[9.5px] font-black text-white shadow hover:brightness-110 active:scale-90 transition-transform"
            >
              <Plus size={11} />
              <span>Music</span>
            </button>
          )}
          {ready && m.kind === 'video' && m.hasAudio !== false && (
            <button
              type="button"
              title="Use this video's audio as the music track"
              onClick={(e) => {
                e.stopPropagation();
                void extractAudioAsMusic(m);
              }}
              className="rounded bg-black/75 p-1 text-white hover:bg-[#b026ff] active:scale-90"
            >
              <Music2 size={11} />
            </button>
          )}
          {m.kind !== 'demo' && m.id !== 'demo-beat' && (
            <button
              type="button"
              title="Remove from project"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Remove “${m.name}” and its clips?`)) st.removeMedia(m.id);
              }}
              className="rounded bg-black/75 p-1 text-white hover:bg-red-600 active:scale-90"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-1 px-1.5 py-1">
        <div className="flex items-center gap-1 min-w-0">
          {m.kind === 'audio' ? <AudioLines size={11} className="shrink-0 text-[#ff2d55]" /> : <Film size={11} className="shrink-0 text-zinc-500" />}
          <span className="truncate text-[10.5px] font-semibold text-zinc-300">{m.name}</span>
        </div>
        {isPhone && ready && m.kind !== 'audio' && (
          <span className="shrink-0 text-[8.5px] font-bold text-[#ff5c7c] uppercase">Tap to add</span>
        )}
      </div>
    </div>
  );
}

export function MediaTab() {
  const media = useEditor((s) => s.media);
  useEditor((s) => s.thumbVersion);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videos = media.filter((m) => m.kind !== 'audio');
  const audios = media.filter((m) => m.kind === 'audio');

  return (
    <div className="space-y-3 p-3 select-none">
      {/* Two dedicated touch buttons: one for videos (Photos/Camera Roll), one for MP3 songs (Files) */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-[#14141e] py-3 text-center transition-all hover:border-[#ff2d55]/50 active:scale-95"
        >
          <Film size={18} className="text-[#ff2d55]" />
          <span className="text-[11.5px] font-bold text-white">Add Videos</span>
          <span className="text-[9px] text-zinc-500">MP4 · MOV (Photos/Files)</span>
        </button>

        <button
          type="button"
          onClick={() => audioInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-[#14141e] py-3 text-center transition-all hover:border-[#b026ff]/50 active:scale-95"
        >
          <Music2 size={18} className="text-[#b026ff]" />
          <span className="text-[11.5px] font-bold text-white">Add Music / MP3</span>
          <span className="text-[9px] text-zinc-500">MP3 · WAV · M4A (Files)</span>
        </button>
      </div>

      {/* Hidden File Inputs with iPhone/iOS friendly accepts */}
      <input
        ref={videoInputRef}
        type="file"
        multiple
        accept={VIDEO_ACCEPT}
        hidden
        onChange={(e) => {
          void importFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        multiple
        accept={AUDIO_ACCEPT}
        hidden
        onChange={(e) => {
          void importFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ALL_MEDIA_ACCEPT}
        hidden
        onChange={(e) => {
          void importFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />

      {/* Clips section */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Film size={11} className="text-[#ff2d55]" /> Clips ({videos.length})
          </span>
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            className="flex items-center gap-0.5 rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-zinc-300 hover:text-white"
          >
            <Plus size={10} /> Add
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {videos.map((m) => (
            <MediaCard key={m.id} m={m} />
          ))}
        </div>
      </div>

      {/* Audio section */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
          <span className="flex items-center gap-1.5">
            <AudioLines size={11} className="text-[#b026ff]" /> Songs & Audio ({audios.length})
          </span>
          <button
            type="button"
            onClick={() => audioInputRef.current?.click()}
            className="flex items-center gap-0.5 rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-zinc-300 hover:text-white"
          >
            <Plus size={10} /> Add MP3
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {audios.map((m) => (
            <MediaCard key={m.id} m={m} />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-gradient-to-br from-[#ff2d55]/10 to-[#7b2dff]/10 p-2.5 text-[11px] leading-relaxed text-zinc-400">
        <div className="mb-1 flex items-center gap-1 font-semibold text-zinc-200">
          <Wand2 size={12} className="text-[#ff2d55]" /> Tips for iPhone
        </div>
        • Tap <b>Add Music / MP3</b> to pick downloaded songs directly from your iPhone <b>Files</b> app.
        <br />
        • Tap <b>Add Videos</b> to browse your Photos / Camera Roll.
        <br />
        • Tap any clip to immediately insert it into the timeline!
      </div>
    </div>
  );
}
