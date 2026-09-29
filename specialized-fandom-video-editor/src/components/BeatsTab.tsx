import { useRef, useState } from 'react';
import { Activity, Loader2, Music2, Scissors, Sparkles, Trash2, Zap } from 'lucide-react';
import { useEditor } from '../store';
import { audio, detectBeats } from '../lib/audio';
import { autoBassPump, autoMicrowave, autoVelocity, cutOnBeats, fxOnBeats, snapCutsToBeats } from '../lib/tools';
import { FX_DEFS } from '../lib/effects';
import { AUDIO_ACCEPT, importFiles } from '../lib/media';
import { Btn, Section, Seg, Select, Slider } from './ui';

const BEAT_FX = ['zoomPunch', 'spinZoom', 'dutchZoom', 'ySpin', 'snapRotate', 'flash', 'shake', 'impact', 'rgbSplit', 'microwave', 'invert', 'glitch', 'strobe', 'exposure', 'smoothZoom', 'bw', 'bassPump'];

export function BeatsTab() {
  const music = useEditor((s) => s.project.music);
  const beats = useEditor((s) => s.project.beats);
  const media = useEditor((s) => s.media);
  const musicName = media.find((m) => m.id === music?.mediaId)?.name;
  const [sens, setSens] = useState(0.6);
  const [band, setBand] = useState<'bass' | 'full'>('bass');
  const [mode, setMode] = useState<'grid' | 'onsets'>('grid');
  const [busy, setBusy] = useState(false);
  const [bpm, setBpm] = useState<number | null>(null);
  const [every, setEvery] = useState(1);
  const [fxType, setFxType] = useState('zoomPunch');
  const [fxEvery, setFxEvery] = useState(1);
  const [fxLen, setFxLen] = useState(0.6);
  const [scope, setScope] = useState<'all' | 'clip'>('all');
  const songInputRef = useRef<HTMLInputElement>(null);
  const st = useEditor.getState();

  const range = (): [number, number] | undefined => {
    if (scope === 'all') return undefined;
    const s = useEditor.getState();
    if (s.selection?.kind !== 'clip') return undefined;
    let t = 0;
    for (const c of s.project.clips) {
      const d = (c.srcOut - c.srcIn) / c.speed;
      if (c.id === s.selection.id) return [t, t + d];
      t += d;
    }
    return undefined;
  };

  const detect = async () => {
    if (!music) return;
    const buf = audio.buffers.get(music.mediaId);
    if (!buf) return;
    setBusy(true);
    try {
      const r = await detectBeats(buf, { sensitivity: sens, band, mode });
      const list = r.beats.map((b) => b + music.start).filter((b) => b >= 0);
      useEditor.getState().setBeats(list);
      setBpm(r.bpm);
      useEditor.getState().toast(`Found ${list.length} beats · ~${Math.round(r.bpm)} BPM`, 'success');
    } catch {
      useEditor.getState().toast('Beat detection failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const needBeats = () => {
    if (!useEditor.getState().project.beats.length) {
      useEditor.getState().toast('Detect or tap some beats first', 'info');
      return true;
    }
    return false;
  };

  return (
    <div className="pb-4">
      <Section title="Beat detection">
        {music ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#121218] px-2.5 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <Activity size={14} className="shrink-0 text-[#ff2d55]" />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-zinc-200">{musicName}</div>
                <div className="text-[10.5px] text-zinc-500">
                  {beats.length} markers{bpm ? ` · ~${Math.round(bpm)} BPM` : ''}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => songInputRef.current?.click()}
              className="shrink-0 flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-[10px] font-bold text-zinc-300 hover:text-white"
            >
              <Music2 size={10} /> Change
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 p-3 text-center text-[11.5px] text-zinc-400 space-y-2">
            <div>Choose an MP3 or audio track for your edit:</div>
            <button
              type="button"
              onClick={() => songInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#b026ff] px-3 py-1.5 text-[11.5px] font-bold text-white shadow-md active:scale-95 transition-transform"
            >
              <Music2 size={13} /> Select Song (.mp3, .wav)
            </button>
          </div>
        )}

        <input
          ref={songInputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          hidden
          onChange={(e) => {
            void importFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { v: 'grid', l: 'BPM grid', title: 'Steady grid locked to the tempo' },
            { v: 'onsets', l: 'Hits / onsets', title: 'Every detected transient' },
          ]}
        />
        <Seg
          value={band}
          onChange={setBand}
          options={[
            { v: 'bass', l: 'Kick / bass' },
            { v: 'full', l: 'Full range' },
          ]}
        />
        <Slider label="Sensitivity" value={sens} min={0} max={1} step={0.01} onChange={setSens} format={(v) => `${Math.round(v * 100)}%`} />
        <div className="flex gap-2">
          <Btn variant="primary" className="flex-1" onClick={detect} disabled={!music || busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Detect beats
          </Btn>
          <Btn variant="danger" title="Clear all beat markers" onClick={() => st.setBeats([])} disabled={!beats.length}>
            <Trash2 size={13} />
          </Btn>
        </div>
        <div className="text-[10.5px] leading-relaxed text-zinc-500">
          Press <kbd className="rounded bg-white/10 px-1 text-zinc-300">B</kbd> while playing to tap markers by hand. Double-click a marker on the ruler to delete it.
        </div>
      </Section>

      <Section title="Auto edit">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              if (needBeats()) return;
              st.commit((p) => autoMicrowave(p));
              st.toast('Microwave edit applied — every beat is a cut', 'success');
            }}
            className="rounded-lg border border-[#ff2d55]/30 bg-gradient-to-br from-[#ff2d55]/20 to-transparent p-2.5 text-left transition-colors hover:border-[#ff2d55]/70"
          >
            <div className="text-lg">🍿</div>
            <div className="text-[12px] font-bold text-zinc-100">Microwave edit</div>
            <div className="text-[10px] leading-snug text-zinc-400">Cut on every beat + microwave time remap</div>
          </button>
          <button
            type="button"
            onClick={() => {
              if (needBeats()) return;
              st.commit((p) => autoVelocity(p));
              st.toast('Velocity edit applied', 'success');
            }}
            className="rounded-lg border border-[#b026ff]/30 bg-gradient-to-br from-[#b026ff]/20 to-transparent p-2.5 text-left transition-colors hover:border-[#b026ff]/70"
          >
            <div className="text-lg">📈</div>
            <div className="text-[12px] font-bold text-zinc-100">Velocity edit</div>
            <div className="text-[10px] leading-snug text-zinc-400">Cut every 2 beats, ramps + zoom punches</div>
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!music) {
              st.toast('Pick a song first — the pump is baked from its audio', 'info');
              return;
            }
            st.commit((p) => autoBassPump(p, { band: 'bass', zoom: 0.2, shake: 0.2, glow: 0.25 }));
            st.toast('Bass Pump added across the whole edit', 'success');
          }}
          className="mt-2 w-full rounded-lg border border-[#34d399]/30 bg-gradient-to-br from-[#34d399]/20 to-transparent p-2.5 text-left transition-colors hover:border-[#34d399]/70"
        >
          <div className="flex items-center gap-2">
            <div className="text-lg">🎚️</div>
            <div className="min-w-0">
              <div className="text-[12px] font-bold text-zinc-100">Make it breathe</div>
              <div className="text-[10px] leading-snug text-zinc-400">Zoom, shake and glow ride the low end of your track — baked from the audio, so the export matches</div>
            </div>
          </div>
        </button>
      </Section>

      <Section title="Cut to the beat">
        <Seg
          value={every}
          onChange={setEvery}
          options={[
            { v: 1, l: 'Every beat' },
            { v: 2, l: 'Every 2' },
            { v: 4, l: 'Every 4' },
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
          <Btn
            variant="soft"
            onClick={() => {
              if (needBeats()) return;
              st.commit((p) => cutOnBeats(p, every));
              st.toast('Clips split on beats', 'success');
            }}
          >
            <Scissors size={13} /> Split on beats
          </Btn>
          <Btn
            variant="soft"
            title="Trim each clip so every cut lands on the nearest beat"
            onClick={() => {
              if (needBeats()) return;
              const map = new Map(useEditor.getState().media.map((m) => [m.id, m]));
              st.commit((p) => snapCutsToBeats(p, map));
              st.toast('Cuts snapped to beats', 'success');
            }}
          >
            <Zap size={13} /> Snap cuts
          </Btn>
        </div>
      </Section>

      <Section title="Effect on every beat">
        <Select label="Effect" value={fxType} onChange={setFxType} options={BEAT_FX.map((t) => ({ v: t, l: `${FX_DEFS[t].icon}  ${FX_DEFS[t].name}` }))} />
        <Seg
          value={fxEvery}
          onChange={setFxEvery}
          options={[
            { v: 1, l: 'Every beat' },
            { v: 2, l: 'Every 2' },
            { v: 4, l: 'Every 4' },
          ]}
        />
        <Slider label="Length (of beat gap)" value={fxLen} min={0.1} max={1} step={0.05} onChange={setFxLen} format={(v) => `${Math.round(v * 100)}%`} />
        <Seg
          value={scope}
          onChange={setScope}
          options={[
            { v: 'all', l: 'Whole edit' },
            { v: 'clip', l: 'Selected clip' },
          ]}
        />
        <Btn
          variant="primary"
          className="w-full"
          onClick={() => {
            if (needBeats()) return;
            const r = range();
            if (scope === 'clip' && !r) {
              st.toast('Select a clip first', 'info');
              return;
            }
            st.commit((p) => fxOnBeats(p, fxType, undefined, fxEvery, fxLen, r));
            st.toast(`${FX_DEFS[fxType].name} added on beats`, 'success');
          }}
        >
          <Sparkles size={13} /> Add to beats
        </Btn>
      </Section>
    </div>
  );
}
