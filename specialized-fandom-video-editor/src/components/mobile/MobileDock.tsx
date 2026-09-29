import {
  Activity,
  Bot,
  ChevronDown,
  Diamond,
  Film,
  Gauge,
  Music2,
  Palette,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useState } from 'react';
import { useEditor } from '../../store';
import { MediaTab } from '../MediaTab';
import { FxTab } from '../FxTab';
import { SpeedTab, ColorTab } from '../SpeedColorTabs';
import { BeatsTab } from '../BeatsTab';
import { KeyframeEditor } from '../KeyframeEditor';
import { ClipInspector, FxInspector } from '../Inspector';
import { FX_DEFS } from '../../lib/effects';
import { getMusicClips } from '../../lib/music';
import { CLIP_PROPS, FX_PROPS, type Clip, type FxItem } from '../../types';
import { clipDuration, layoutClips } from '../../lib/velocity';
import { clamp } from '../../lib/utils';
import { cn } from '../../utils/cn';

type MobileTab = 'none' | 'clips' | 'speed' | 'fx' | 'text' | 'color' | 'beats' | 'keyframes' | 'fxSettings' | 'clipSettings';

export function MobileDock() {
  const activeTab = useEditor((s) => s.mobileDrawer);
  const sel = useEditor((s) => s.selection);
  const clips = useEditor((s) => s.project.clips);
  const fxList = useEditor((s) => s.project.fx);
  const media = useEditor((s) => s.media);
  const project = useEditor((s) => s.project);
  const st = useEditor.getState();

  const mediaMap = new Map(media.map((m) => [m.id, m]));
  const musicClips = getMusicClips(project, mediaMap);
  const selectedClip = sel?.kind === 'clip' ? clips.find((c) => c.id === sel.id) : null;
  const selectedFx = sel?.kind === 'fx' ? fxList.find((f) => f.id === sel.id) : null;
  const selectedMusic = sel?.kind === 'music' ? musicClips.find((mc) => mc.id === sel.id || sel.id === 'music') || musicClips[0] : null;

  const openTab = (tab: MobileTab) => {
    st.ui({ mobileDrawer: activeTab === tab ? 'none' : tab });
  };

  return (
    <div className="relative shrink-0 border-t border-white/[0.08] bg-[#0c0c14] select-none">
      {/* Slide-Up Drawer for Selected Tab */}
      {activeTab !== 'none' && (
        <div className="flex h-[42vh] max-h-[380px] min-h-[220px] flex-col border-b border-white/[0.08] bg-[#101018] shadow-2xl">
          {/* Drawer Header */}
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0d0d14] px-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-white uppercase tracking-wider">
              {activeTab === 'clips' && <Film size={13} className="text-[#ff2d55]" />}
              {activeTab === 'speed' && <Gauge size={13} className="text-[#4ade80]" />}
              {activeTab === 'keyframes' && <Diamond size={13} className="text-[#ff2d55]" />}
              {activeTab === 'fx' && <Sparkles size={13} className="text-[#22d3ee]" />}
              {activeTab === 'fxSettings' && <SlidersHorizontal size={13} className="text-[#ff2d55]" />}
              {activeTab === 'clipSettings' && <SlidersHorizontal size={13} className="text-[#ff2d55]" />}
              {activeTab === 'text' && <Type size={13} className="text-white" />}
              {activeTab === 'color' && <Palette size={13} className="text-[#a78bfa]" />}
              {activeTab === 'beats' && <Activity size={13} className="text-[#ff2d55]" />}
              <span>
                {activeTab === 'clips'
                  ? 'Clips & Media'
                  : activeTab === 'speed'
                  ? 'Speed & Velocity'
                  : activeTab === 'keyframes'
                  ? 'Keyframe Graph Editor'
                  : activeTab === 'fx'
                  ? 'Effects & Zooms'
                  : activeTab === 'fxSettings'
                  ? (selectedFx ? `${FX_DEFS[selectedFx.type]?.name || 'Effect'} Settings` : 'Effect Settings')
                  : activeTab === 'clipSettings'
                  ? (selectedClip ? `Clip #${clips.findIndex((c) => c.id === selectedClip.id) + 1} Settings` : 'Clip Settings')
                  : activeTab === 'text'
                  ? 'Text Presets'
                  : activeTab === 'color'
                  ? 'Color Grades'
                  : 'Beats & Sync'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => st.ui({ mobileDrawer: 'none' })}
              className="flex items-center gap-0.5 rounded-lg bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-zinc-300 hover:text-white active:scale-95"
            >
              <span>Done</span>
              <ChevronDown size={14} />
            </button>
          </div>

          {/* Drawer Scrollable Content */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {activeTab === 'clips' && <MediaTab />}
            {activeTab === 'speed' && <SpeedTab />}
            {activeTab === 'fx' && <FxTab />}
            {activeTab === 'fxSettings' && (
              <div className="space-y-2">
                {selectedFx ? (
                  <FxInspector fx={selectedFx} />
                ) : (
                  <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-[12px] text-zinc-400">
                    Double-tap an effect on the timeline to open its settings!
                  </div>
                )}
              </div>
            )}
            {activeTab === 'clipSettings' && (
              <div className="space-y-2">
                {selectedClip ? (
                  <ClipInspector clip={selectedClip} />
                ) : (
                  <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-[12px] text-zinc-400">
                    Double-tap a clip on the timeline to open its settings!
                  </div>
                )}
              </div>
            )}
            {activeTab === 'text' && <FxTab />}
            {activeTab === 'color' && <ColorTab />}
            {activeTab === 'beats' && <BeatsTab />}

            {activeTab === 'keyframes' && (
              <MobileKeyframeDrawer selectedClip={selectedClip} selectedFx={selectedFx} />
            )}
          </div>
        </div>
      )}

      {/* Selected Item Quick Action Ribbon (when a clip is selected) */}
      {selectedClip && activeTab === 'none' && (
        <div className="flex h-9 items-center justify-between border-b border-white/[0.06] bg-[#12121c] px-2 text-[11px]">
          <div className="flex items-center gap-1 min-w-0">
            {(() => {
              const clipIndex = clips.findIndex((c) => c.id === selectedClip.id);
              return (
                <>
                  <span className="font-bold text-[#ff5c7c] shrink-0 text-[10px]">#{clipIndex + 1}</span>
                  <button
                    type="button"
                    disabled={clipIndex <= 0}
                    onClick={() => {
                      st.moveClip(clipIndex, clipIndex - 1);
                      st.toast('Moved clip earlier', 'info');
                    }}
                    className="flex items-center rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-zinc-300 disabled:opacity-25 active:scale-95"
                    title="Move clip earlier"
                  >
                    ◀ Move
                  </button>
                  <button
                    type="button"
                    disabled={clipIndex < 0 || clipIndex >= clips.length - 1}
                    onClick={() => {
                      st.moveClip(clipIndex, clipIndex + 2);
                      st.toast('Moved clip later', 'info');
                    }}
                    className="flex items-center rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-zinc-300 disabled:opacity-25 active:scale-95"
                    title="Move clip later"
                  >
                    Move ▶
                  </button>
                </>
              );
            })()}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => st.ui({ mobileDrawer: 'clipSettings' })}
              className="flex items-center gap-1 rounded bg-[#ff2d55] px-2 py-0.5 text-[9.5px] font-black text-white shadow active:scale-95 transition-transform"
              title="Open clip settings"
            >
              <SlidersHorizontal size={10} />
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={() => st.updateClip(selectedClip.id, { reverse: !selectedClip.reverse })}
              className={cn(
                'rounded px-1.5 py-0.5 text-[9.5px] font-bold active:scale-95',
                selectedClip.reverse ? 'bg-yellow-500 text-black' : 'bg-white/10 text-zinc-300'
              )}
            >
              REV
            </button>
            <button
              type="button"
              onClick={() => st.updateClip(selectedClip.id, { twixtor: !selectedClip.twixtor })}
              className={cn(
                'rounded px-1.5 py-0.5 text-[9.5px] font-bold active:scale-95',
                selectedClip.twixtor ? 'bg-[#22d3ee] text-black' : 'bg-white/10 text-zinc-300'
              )}
            >
              TWX
            </button>
            <button
              type="button"
              onClick={() => st.updateClip(selectedClip.id, { audio: selectedClip.audio === false })}
              className="rounded bg-white/10 p-1 text-zinc-300"
              title="Toggle clip audio"
            >
              {selectedClip.audio === false ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
            <button
              type="button"
              onClick={() => st.removeSelected()}
              className="rounded bg-red-500/20 p-1 text-red-300"
              title="Delete clip"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Selected Effect Quick Ribbon */}
      {selectedFx && activeTab === 'none' && !selectedClip && (
        <div className="flex h-9 items-center justify-between border-b border-white/[0.06] bg-[#12121c] px-3 text-[11px]">
          <div className="flex items-center gap-1.5 truncate min-w-0">
            <span className="text-sm shrink-0">{FX_DEFS[selectedFx.type]?.icon || '✨'}</span>
            <span className="font-bold text-white truncate text-[11px]">
              {FX_DEFS[selectedFx.type]?.name || selectedFx.type}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => st.ui({ mobileDrawer: 'fxSettings' })}
              className="flex items-center gap-1 rounded bg-[#ff2d55] px-2 py-0.5 text-[10px] font-black text-white shadow active:scale-95 transition-transform"
            >
              <SlidersHorizontal size={11} />
              <span>Settings</span>
            </button>
            <div className="flex items-center rounded bg-white/10 p-0.5">
              <button
                type="button"
                onClick={() => {
                  const newDur = Math.max(0.05, Number((selectedFx.duration - 0.1).toFixed(2)));
                  st.updateFx(selectedFx.id, { duration: newDur });
                }}
                className="rounded px-1.5 py-0.5 text-[9.5px] font-bold text-zinc-300 active:scale-90"
                title="Shorten effect duration"
              >
                -0.1s
              </button>
              <span className="px-1 text-[9px] tabular-nums text-zinc-400 font-mono">
                {selectedFx.duration.toFixed(2)}s
              </span>
              <button
                type="button"
                onClick={() => {
                  const newDur = Number((selectedFx.duration + 0.1).toFixed(2));
                  st.updateFx(selectedFx.id, { duration: newDur });
                }}
                className="rounded px-1.5 py-0.5 text-[9.5px] font-bold text-zinc-300 active:scale-90"
                title="Lengthen effect duration"
              >
                +0.1s
              </button>
            </div>
            <button
              type="button"
              onClick={() => st.duplicateSelected()}
              className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-bold text-zinc-300 active:scale-95"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => st.removeSelected()}
              className="rounded bg-red-500/20 p-1 text-red-300 active:scale-95"
              title="Delete effect"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Selected Music Quick Ribbon */}
      {selectedMusic && activeTab === 'none' && !selectedClip && !selectedFx && (
        <div className="flex h-9 items-center justify-between border-b border-white/[0.06] bg-[#12121c] px-2.5 text-[11px]">
          <div className="flex items-center gap-1.5 truncate min-w-0">
            <Music2 size={12} className="text-[#b026ff] shrink-0" />
            <span className="font-bold text-white truncate text-[10.5px]">
              {mediaMap.get(selectedMusic.mediaId)?.name || 'Music'}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => st.splitAtPlayhead()}
              className="flex items-center gap-1 rounded bg-[#ff2d55] px-2 py-0.5 text-[10px] font-black text-white shadow active:scale-95 transition-transform"
              title="Split music at playhead"
            >
              <Scissors size={11} />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => st.trimMusicToPlayhead('start')}
              className="rounded bg-white/10 px-1.5 py-0.5 text-[9.5px] font-bold text-zinc-300 active:scale-95"
              title="Cut left part of music"
            >
              Cut Left
            </button>
            <button
              type="button"
              onClick={() => st.trimMusicToPlayhead('end')}
              className="rounded bg-white/10 px-1.5 py-0.5 text-[9.5px] font-bold text-zinc-300 active:scale-95"
              title="Cut right part of music"
            >
              Cut Right
            </button>
            <button
              type="button"
              onClick={() => st.removeSelected()}
              className="rounded bg-red-500/20 p-1 text-red-300 active:scale-95"
              title="Delete music track"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Primary Mobile Navigation Dock */}
      <nav className="flex h-12 items-center justify-around px-1 text-zinc-400">
        <button
          type="button"
          onClick={() => openTab('clips')}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[9.5px] font-semibold active:scale-95 transition-all',
            activeTab === 'clips' ? 'text-[#ff2d55]' : 'hover:text-white'
          )}
        >
          <Film size={16} />
          <span>Clips</span>
        </button>

        <button
          type="button"
          onClick={() => openTab('speed')}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[9.5px] font-semibold active:scale-95 transition-all',
            activeTab === 'speed' ? 'text-[#4ade80]' : 'hover:text-white'
          )}
        >
          <Gauge size={16} />
          <span>Speed</span>
        </button>

        <button
          type="button"
          onClick={() => openTab('keyframes')}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[9.5px] font-semibold active:scale-95 transition-all',
            activeTab === 'keyframes' ? 'text-[#ff2d55]' : 'hover:text-white'
          )}
        >
          <Diamond size={16} />
          <span>Graph</span>
        </button>

        <button
          type="button"
          onClick={() => openTab('fx')}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[9.5px] font-semibold active:scale-95 transition-all',
            activeTab === 'fx' ? 'text-[#22d3ee]' : 'hover:text-white'
          )}
        >
          <Sparkles size={16} />
          <span>FX</span>
        </button>

        <button
          type="button"
          onClick={() => openTab('text')}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[9.5px] font-semibold active:scale-95 transition-all',
            activeTab === 'text' ? 'text-white' : 'hover:text-white'
          )}
        >
          <Type size={16} />
          <span>Text</span>
        </button>

        <button
          type="button"
          onClick={() => openTab('color')}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[9.5px] font-semibold active:scale-95 transition-all',
            activeTab === 'color' ? 'text-[#a78bfa]' : 'hover:text-white'
          )}
        >
          <Palette size={16} />
          <span>Color</span>
        </button>

        <button
          type="button"
          onClick={() => openTab('beats')}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[9.5px] font-semibold active:scale-95 transition-all',
            activeTab === 'beats' ? 'text-[#ff2d55]' : 'hover:text-white'
          )}
        >
          <Activity size={16} />
          <span>Beats</span>
        </button>

        <button
          type="button"
          onClick={() => st.ui({ aiOpen: true })}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[9.5px] font-bold text-[#ff5c7c] active:scale-95 transition-all"
        >
          <Bot size={16} className="text-[#ff2d55] animate-pulse" />
          <span>AI</span>
        </button>
      </nav>
    </div>
  );
}

function MobileKeyframeDrawer({
  selectedClip,
  selectedFx,
}: {
  selectedClip: Clip | null | undefined;
  selectedFx: FxItem | null | undefined;
}) {
  const [keyframeProp, setKeyframeProp] = useState('scale');
  const time = useEditor((s) => s.time);
  const clips = useEditor((s) => s.project.clips);
  const st = useEditor.getState();

  const layout = layoutClips(clips);
  const hitClip = selectedClip ? layout.find((l) => l.clip.id === selectedClip.id) : null;
  const clipDur = selectedClip ? clipDuration(selectedClip) : 1;
  const clipNormT = hitClip ? clamp((time - hitClip.start) / clipDur, 0, 1) : 0;
  const fxNormT = selectedFx ? clamp((time - selectedFx.start) / Math.max(0.01, selectedFx.duration), 0, 1) : 0;

  if (selectedClip) {
    return (
      <div className="space-y-3">
        <KeyframeEditor
          props={CLIP_PROPS}
          propId={keyframeProp}
          onPropChange={setKeyframeProp}
          tracks={selectedClip.keyframes}
          onTracksChange={(t) => st.updateClip(selectedClip.id, { keyframes: t })}
          staticVals={{
            scale: selectedClip.scale,
            posX: selectedClip.posX,
            posY: selectedClip.posY,
            rotation: selectedClip.rotation,
          }}
          normU={clipNormT}
          durationSec={clipDur}
          onScrub={(u) => hitClip && st.setTime(hitClip.start + u * clipDur)}
        />
      </div>
    );
  }

  if (selectedFx) {
    return (
      <div className="space-y-3">
        <KeyframeEditor
          props={FX_PROPS}
          propId="intensity"
          onPropChange={() => undefined}
          tracks={selectedFx.keyframes}
          onTracksChange={(t) => st.updateFx(selectedFx.id, { keyframes: t })}
          staticVals={{ intensity: selectedFx.intensity }}
          normU={fxNormT}
          durationSec={selectedFx.duration}
          onScrub={(u) => st.setTime(selectedFx.start + u * selectedFx.duration)}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-[12px] text-zinc-400">
      Tap a clip or effect on the timeline above to edit its keyframe curves!
    </div>
  );
}
