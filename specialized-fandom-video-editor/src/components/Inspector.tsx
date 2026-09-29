import { Fragment, useState } from 'react';
import { Copy, Crosshair, Keyboard, Music2, RotateCcw, Scissors, Trash2 } from 'lucide-react';
import { useEditor } from '../store';
import type { Clip, ColorSettings, FxItem, ParamValue } from '../types';
import { CLIP_PROPS, FX_PROPS } from '../types';
import { FX_CATS, FX_DEFS, catColor, type ParamDef } from '../lib/effects';
import { VELOCITY_PRESETS, clipDuration, totalDuration, layoutClips } from '../lib/velocity';
import { COLOR_PRESETS, colorFromPreset, defaultColor } from '../lib/colorPresets';
import { animatedValue, hasTrack, removeTrack, setKeyframe, trackFor, upsertTrack } from '../lib/keyframes';
import { MOVE_PRESETS } from '../lib/moves';
import { thumbs } from '../lib/media';
import { getMusicClips, syncMusicProject } from '../lib/music';
import { fmtSec, clamp } from '../lib/utils';
import { VelocityCurve } from './Curve';
import { Btn, Chip, NumField, Section, Seg, Select, Slider, Toggle } from './ui';
import { KeyframeEditor } from './KeyframeEditor';
import { BandMeter } from './BandMeter';
import { cn } from '../utils/cn';

const txn = {
  start: () => useEditor.getState().beginTxn(),
  end: () => useEditor.getState().endTxn(),
};

function Header({ icon, title, sub, color, children }: { icon: React.ReactNode; title: string; sub?: string; color?: string; children?: React.ReactNode }) {
  return (
    <div className="border-b border-white/[0.06] p-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-xl" style={{ background: color ? `${color}22` : '#ffffff0d', boxShadow: color ? `inset 0 0 0 1px ${color}55` : undefined }}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-zinc-100">{title}</div>
          {sub && <div className="truncate text-[11px] text-zinc-500">{sub}</div>}
        </div>
      </div>
      {children && <div className="mt-2.5 flex gap-1.5">{children}</div>}
    </div>
  );
}

export function ClipInspector({ clip }: { clip: Clip }) {
  const st = useEditor.getState();
  const media = useEditor((s) => s.media.find((m) => m.id === clip.mediaId));
  const index = useEditor((s) => s.project.clips.findIndex((c) => c.id === clip.id));
  useEditor((s) => s.thumbVersion);
  const up = (patch: Partial<Clip>, live = false) => st.updateClip(clip.id, patch, live);
  const upColor = (patch: Partial<ColorSettings>, live = false) => up({ color: { ...clip.color, ...patch, preset: 'custom' } }, live);
  const thumb = thumbs.get(media, clip.srcIn);
  const maxD = media?.duration ?? clip.srcOut;
  const v = clip.velocity;
  const col = clip.color;
  const [editorProp, setEditorProp] = useState<string>('scale');

  // clip-local playhead position for the keyframe editor
  const now = useEditor((s) => s.time);
  const placements = layoutClips(useEditor((s) => s.project.clips));
  const mine = placements.find((l) => l.clip.id === clip.id);
  const clipStart = mine?.start ?? 0;
  const dur = clipDuration(clip);
  const clipTime = clamp(now - clipStart, 0, dur);
  const normT = dur > 0 ? clamp(clipTime / dur, 0, 1) : 0;
  const staticVal = (c: Clip, id: string) =>
    id === 'scale' ? c.scale : id === 'posX' ? c.posX : id === 'posY' ? c.posY : c.rotation;
  const nowRot = animatedValue(clip.keyframes, CLIP_PROPS[3], normT, clip.rotation);
  const nowScale = animatedValue(clip.keyframes, CLIP_PROPS[0], normT, clip.scale);

  const cs = (key: keyof ColorSettings, label: string, min: number, max: number, step: number) => (
    <Slider
      label={label}
      value={col[key] as number}
      min={min}
      max={max}
      step={step}
      onStart={txn.start}
      onEnd={txn.end}
      onChange={(x) => upColor({ [key]: x } as Partial<ColorSettings>, true)}
      onReset={() => upColor({ [key]: defaultColor()[key] } as Partial<ColorSettings>)}
    />
  );
  return (
    <>
      <Header icon={thumb ? <img src={thumb} className="h-full w-full object-cover" /> : '🎞️'} title={`Clip ${index + 1}`} sub={`${media?.name ?? 'Missing media'} · ${fmtSec(clipDuration(clip))}`}>
        <Btn variant="soft" onClick={st.splitAtPlayhead} title="Split at playhead (S)" className="flex-1">
          <Scissors size={13} /> Split
        </Btn>
        <Btn variant="soft" onClick={st.duplicateSelected} title="Duplicate (Ctrl+D)">
          <Copy size={13} />
        </Btn>
        <Btn variant="danger" onClick={st.removeSelected} title="Delete (Del)">
          <Trash2 size={13} />
        </Btn>
      </Header>

      <Section title="Speed & time">
        <Slider label="Speed" value={clip.speed} min={0.05} max={4} step={0.01} format={(x) => `${x.toFixed(2)}×`} onStart={txn.start} onEnd={txn.end} onChange={(x) => up({ speed: x }, true)} onReset={() => up({ speed: 1 })} />
        <div className="flex flex-wrap gap-1">
          {[0.1, 0.25, 0.5, 1, 1.5, 2, 3].map((s) => (
            <Chip key={s} active={Math.abs(clip.speed - s) < 0.001} onClick={() => up({ speed: s })}>
              {s}×
            </Chip>
          ))}
        </div>
        <Toggle label="⏪ Reverse" checked={clip.reverse} onChange={(x) => up({ reverse: x })} hint="Shortcut: R" />
        <Toggle label="🫧 Twixtor (frame blending)" checked={clip.twixtor} onChange={(x) => up({ twixtor: x })} hint="Smooth slow motion — shortcut: T" />
        <Toggle
          label="🔊 Clip audio"
          checked={clip.audio !== false}
          onChange={(x) => {
            up({ audio: x });
            const s = useEditor.getState();
            if (s.playing) void import('../lib/audio').then(({ audio }) => audio.scheduleClips(s.project.clips, s.time));
          }}
          hint="Play this clip's own sound under the music"
        />
        {clip.audio !== false && (
          <Slider
            label="Clip audio level"
            value={clip.audioVolume ?? 1}
            min={0}
            max={2}
            step={0.01}
            format={(x) => `${Math.round(x * 100)}%`}
            onStart={txn.start}
            onEnd={() => {
              txn.end();
              const s = useEditor.getState();
              if (s.playing) void import('../lib/audio').then(({ audio }) => audio.scheduleClips(s.project.clips, s.time));
            }}
            onChange={(x) => up({ audioVolume: x }, true)}
            onReset={() => up({ audioVolume: 1 })}
          />
        )}
        <div>
          <div className="mb-1 text-[11px] text-zinc-400">Velocity / time remap</div>
          <div className="flex flex-wrap gap-1">
            {VELOCITY_PRESETS.map((p) => (
              <Chip key={p.id} active={v.preset === p.id} onClick={() => up({ velocity: { ...v, preset: p.id, center: p.id === 'microwave' ? 0.7 : p.id === 'impact' ? 0.55 : 0.5, intensity: p.id === 'microwave' ? 0.5 : v.intensity } })}>
                {p.name}
              </Chip>
            ))}
          </div>
        </div>
        {v.preset !== 'none' && (
          <>
            <div className="rounded-lg border border-white/[0.06] bg-black/30 p-2">
              <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-zinc-500">
                <span>time remap graph</span>
                <span>source ↑ · clip →</span>
              </div>
              <VelocityCurve v={v} w={250} h={64} />
            </div>
            <Slider label={v.preset === 'microwave' ? 'Snap-back amount' : 'Intensity'} value={v.intensity} min={0} max={1} step={0.01} onStart={txn.start} onEnd={txn.end} onChange={(x) => up({ velocity: { ...v, intensity: x } }, true)} />
            {v.preset !== 'rampUp' && v.preset !== 'rampDown' && (
              <Slider
                label={v.preset === 'microwave' || v.preset === 'boomerang' ? 'Turn point' : 'Slow-mo point'}
                value={v.center}
                min={0.05}
                max={0.95}
                step={0.01}
                onStart={txn.start}
                onEnd={txn.end}
                onChange={(x) => up({ velocity: { ...v, center: x } }, true)}
              />
            )}
          </>
        )}
      </Section>

      <Section title="Source range" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="In" value={clip.srcIn} step={0.04} min={0} max={clip.srcOut - 0.05} suffix="s" onChange={(x) => up({ srcIn: Math.max(0, Math.min(x, clip.srcOut - 0.05)) })} />
          <NumField label="Out" value={clip.srcOut} step={0.04} min={clip.srcIn + 0.05} max={maxD} suffix="s" onChange={(x) => up({ srcOut: Math.min(maxD, Math.max(x, clip.srcIn + 0.05)) })} />
        </div>
        <div className="text-[10.5px] text-zinc-500">
          Uses {fmtSec(clip.srcOut - clip.srcIn)} of a {fmtSec(maxD)} source · Timeline length {fmtSec(clipDuration(clip))}
        </div>
      </Section>

      <Section title="Rotate & zoom" defaultOpen={true}>
        <div className="text-[10.5px] leading-relaxed text-zinc-500">
          Drag the frame in the preview to move it, pull a corner to zoom, twist the ring to rotate — or use these.
        </div>
        <div>
          <div className="mb-1 text-[11px] text-zinc-400">Rotate</div>
          <div className="grid grid-cols-6 gap-1">
            {[
              { l: '↺ 90', v: -90 },
              { l: '−15°', v: -15 },
              { l: '−5°', v: -5 },
              { l: '+5°', v: 5 },
              { l: '+15°', v: 15 },
              { l: '↻ 90', v: 90 },
            ].map((b) => (
              <button
                key={b.l}
                type="button"
                onClick={() => st.setTransform({ rotation: nowRot + b.v }, { clipId: clip.id })}
                className="rounded-md border border-white/[0.08] bg-white/[0.03] py-1 text-[10px] font-semibold text-zinc-300 transition-colors hover:border-[#c084fc]/50 hover:text-white"
              >
                {b.l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-zinc-400">Zoom</div>
          <div className="grid grid-cols-6 gap-1">
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => st.setTransform({ scale: v }, { clipId: clip.id })}
                className={cn(
                  'rounded-md border py-1 text-[10px] font-semibold transition-colors',
                  Math.abs(nowScale - v) < 0.005
                    ? 'border-[#22d3ee]/60 bg-[#22d3ee]/15 text-[#22d3ee]'
                    : 'border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:border-[#22d3ee]/50 hover:text-white'
                )}
              >
                {v * 100}%
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1.5">
          <Btn
            variant="soft"
            className="flex-1"
            onClick={() => up({ flipX: !clip.flipX })}
            title="Mirror the clip horizontally"
          >
            ⇋ Flip
          </Btn>
          <Btn
            variant="soft"
            className="flex-1"
            onClick={() => st.setTransform({ posX: 0, posY: 0 }, { clipId: clip.id })}
            title="Recentre the frame"
          >
            ⌖ Centre
          </Btn>
          <Btn variant="danger" onClick={st.resetTransform} title="Reset scale, rotation and position (0)">
            <RotateCcw size={13} />
          </Btn>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
            <span>One-click moves</span>
            <span className="text-[9.5px] text-zinc-600">writes keyframes</span>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {MOVE_PRESETS.map((m) => (
              <button
                key={m.id}
                type="button"
                title={`${m.hint}\n${m.mode === 'clip' ? 'Across the whole clip' : `${m.dur}s move at the playhead`}`}
                onClick={() => st.applyMove(m.id)}
                className="flex flex-col items-center gap-0.5 rounded-md border border-white/[0.07] bg-[#12121a] px-0.5 py-1 transition-colors hover:border-[#c084fc]/50 hover:bg-[#191926]"
              >
                <span className="text-[12px] leading-none">{m.icon}</span>
                <span className="text-[8px] font-semibold leading-none text-zinc-400">{m.name}</span>
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Transform & keyframes" defaultOpen={true}>
        <Seg
          value={clip.fit}
          onChange={(x) => up({ fit: x })}
          options={[
            { v: 'cover', l: 'Fill (crop)' },
            { v: 'contain', l: 'Fit (bars)' },
          ]}
        />
        <div className="flex items-center justify-between rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-[3px] text-[10px] text-zinc-400">
          <span>Playhead</span>
          <span className="font-mono text-zinc-200">
            {clipTime.toFixed(2)}s / {dur.toFixed(2)}s
          </span>
          <span className="font-mono text-[#22d3ee]">{(normT * 100).toFixed(0)}%</span>
        </div>
        {CLIP_PROPS.map((p) => {
          const animated = hasTrack(clip.keyframes, p.id);
          const shown = animated ? animatedValue(clip.keyframes, p, normT, staticVal(clip, p.id)) : staticVal(clip, p.id);
          return (
            <div key={p.id} className="relative">
              <Slider
                label={p.label}
                value={shown}
                min={p.min}
                max={p.max}
                step={p.step}
                format={p.fmt}
                onStart={txn.start}
                onEnd={txn.end}
                onChange={(x) => {
                  if (!animated) {
                    up({ [p.id]: x } as Partial<Clip>, true);
                    return;
                  }
                  const tr = trackFor(clip.keyframes, p.id)!;
                  up({ keyframes: upsertTrack(clip.keyframes, setKeyframe(tr, normT, x)) }, true);
                }}
                onReset={() => {
                  if (animated) up({ keyframes: removeTrack(clip.keyframes, p.id) });
                  up({ [p.id]: p.id === 'scale' ? 1 : 0 } as Partial<Clip>);
                }}
              />
              {animated && (
                <span className="absolute right-0 top-0 flex items-center gap-1 text-[9px] font-bold text-[#4ade80]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" /> keyed @ {trackFor(clip.keyframes, p.id)!.keyframes.length}
                </span>
              )}
            </div>
          );
        })}
        <Toggle label="Flip horizontally" checked={clip.flipX} onChange={(x) => up({ flipX: x })} />
        <Toggle label="Reflect edges (for shakes & slides)" checked={clip.mirrorEdges} onChange={(x) => up({ mirrorEdges: x })} />

        <div className="pt-1">
          <KeyframeEditor
            props={CLIP_PROPS}
            propId={editorProp}
            onPropChange={setEditorProp}
            tracks={clip.keyframes}
            onTracksChange={(t) => up({ keyframes: t })}
            staticVals={{ scale: clip.scale, posX: clip.posX, posY: clip.posY, rotation: clip.rotation }}
            normU={normT}
            durationSec={dur}
            onScrub={(u) => st.setTime(clipStart + u * dur)}
          />
        </div>
      </Section>

      <Section
        title="Color grade"
        right={
          <button type="button" className="text-[10px] text-zinc-500 hover:text-white" onClick={() => up({ color: defaultColor() })} title="Reset grade">
            <RotateCcw size={12} />
          </button>
        }
      >
        <Select label="Look" value={COLOR_PRESETS.some((p) => p.id === col.preset) ? col.preset : 'custom'} onChange={(id) => id !== 'custom' && up({ color: colorFromPreset(id) })} options={[...COLOR_PRESETS.map((p) => ({ v: p.id, l: p.name })), { v: 'custom', l: 'Custom' }]} />
        {cs('exposure', 'Exposure', -2, 2, 0.01)}
        {cs('contrast', 'Contrast', -1, 1, 0.01)}
        {cs('saturation', 'Saturation', -1, 1, 0.01)}
        {cs('temperature', 'Temperature', -1, 1, 0.01)}
        {cs('tint', 'Tint', -1, 1, 0.01)}
        {cs('hue', 'Hue', -180, 180, 1)}
        {cs('fade', 'Fade', 0, 1, 0.01)}
        {cs('bw', 'Black & white', 0, 1, 0.01)}
        {cs('split', 'Split tone', 0, 1, 0.01)}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input type="color" value={col.shadowTint} onChange={(e) => upColor({ shadowTint: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" /> Shadows
          </label>
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input type="color" value={col.highTint} onChange={(e) => upColor({ highTint: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" /> Highlights
          </label>
        </div>
        <Btn
          variant="soft"
          className="w-full"
          onClick={() => {
            st.commit((p) => ({ ...p, clips: p.clips.map((c) => ({ ...c, color: { ...clip.color } })) }));
            st.toast('Grade copied to all clips', 'success');
          }}
        >
          Apply this grade to all clips
        </Btn>
      </Section>
    </>
  );
}

export function ParamControl({ fx, p }: { fx: FxItem; p: ParamDef }) {
  const st = useEditor.getState();
  const val = fx.params[p.key] ?? p.def;
  const set = (x: ParamValue, live = false) => st.updateFx(fx.id, { params: { ...fx.params, [p.key]: x } }, live);
  switch (p.type) {
    case 'range':
      return <Slider label={p.label} value={Number(val)} min={p.min} max={p.max} step={p.step} onStart={txn.start} onEnd={txn.end} onChange={(x) => set(x, true)} onReset={() => set(p.def)} />;
    case 'select':
      return <Select label={p.label} value={String(val)} options={p.options} onChange={(x) => set(x)} />;
    case 'bool':
      return <Toggle label={p.label} checked={Boolean(val)} onChange={(x) => set(x)} />;
    case 'color':
      return (
        <label className="flex items-center justify-between text-[11px] text-zinc-400">
          {p.label}
          <input type="color" value={String(val)} onChange={(e) => set(e.target.value)} className="h-6 w-10 cursor-pointer rounded border-0 bg-transparent" />
        </label>
      );
    case 'text':
      return (
        <label className="block">
          <div className="mb-0.5 text-[11px] text-zinc-400">{p.label}</div>
          <textarea
            value={String(val)}
            rows={2}
            onFocus={txn.start}
            onBlur={txn.end}
            onChange={(e) => set(e.target.value, true)}
            className="w-full resize-none rounded-md border border-white/[0.08] bg-[#15151d] px-2 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-[#ff2d55]/60"
          />
        </label>
      );
  }
}

export function FxInspector({ fx }: { fx: FxItem }) {
  const st = useEditor.getState();
  const def = FX_DEFS[fx.type];
  if (!def) return null;
  const color = catColor(def.cat);
  const catName = FX_CATS.find((c) => c.id === def.cat)?.name;
  return (
    <>
      <Header icon={def.icon} title={def.name} sub={catName} color={color}>
        <Btn variant="soft" className="flex-1" onClick={() => st.setTime(fx.start)} title="Move playhead to the effect">
          <Crosshair size={13} /> Jump
        </Btn>
        <Btn variant="soft" onClick={st.duplicateSelected} title="Duplicate (Ctrl+D)">
          <Copy size={13} />
        </Btn>
        <Btn variant="danger" onClick={st.removeSelected} title="Delete (Del)">
          <Trash2 size={13} />
        </Btn>
      </Header>
      <div className="border-b border-white/[0.05] px-3 py-2 text-[11px] leading-relaxed text-zinc-400">{def.desc}</div>
      <Section title="Timing">
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Start" value={fx.start} step={0.02} min={0} suffix="s" onChange={(x) => st.updateFx(fx.id, { start: Math.max(0, x) })} />
          <NumField label="Duration" value={fx.duration} step={0.02} min={0.05} suffix="s" onChange={(x) => st.updateFx(fx.id, { duration: Math.max(0.05, x) })} />
        </div>
        <Seg
          value={fx.lane}
          onChange={(l) => st.updateFx(fx.id, { lane: l })}
          options={[0, 1, 2].map((l) => ({ v: l, l: `Lane ${l + 1}` }))}
        />
        <Slider label="Intensity" value={fx.intensity} min={0} max={2} step={0.01} format={(x) => `${Math.round(x * 100)}%`} onStart={txn.start} onEnd={txn.end} onChange={(x) => st.updateFx(fx.id, { intensity: x }, true)} onReset={() => st.updateFx(fx.id, { intensity: 1 })} />
        {def.transition && <div className="text-[10.5px] text-zinc-500">Transition: centre it on a cut (the midpoint line) for a seamless switch.</div>}
        {def.remap && <div className="text-[10.5px] text-zinc-500">Time effect: changes which frames are shown underneath it.</div>}
      </Section>
      {def.params.length > 0 && (
        <Section title="Settings">
          {def.params.some((p) => p.key === 'band') && (
            <BandMeter band={String(fx.params.band ?? 'bass')} />
          )}
          {def.params.map((p, i) => (
            <Fragment key={p.key}>
              {p.group && p.group !== def.params[i - 1]?.group && (
                <div className="-mx-3 mt-1 border-t border-white/[0.05] px-3 pt-2 text-[9.5px] font-bold uppercase tracking-[0.16em] text-[#ff5c7c]">{p.group}</div>
              )}
              <ParamControl fx={fx} p={p} />
            </Fragment>
          ))}
        </Section>
      )}

      {/* Keyframe curves: fade the effect in and out over its duration */}
      <Section title="Animation (fade in / out)" defaultOpen={false}>
        <div className="text-[10.5px] leading-relaxed text-zinc-500">
          Keyframe the strength so the effect ramps up and back down — or press “Animate” and bend the curve by hand.
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { l: 'Ramp in/out', keys: [[0, 0], [0.5, fx.intensity], [1, 0]] as [number, number][] },
            { l: 'Slam then decay', keys: [[0, 0], [0.12, fx.intensity], [1, 0]] as [number, number][] },
            { l: 'Hold full', keys: [[0, fx.intensity], [1, fx.intensity]] as [number, number][] },
            { l: 'Fade out', keys: [[0, fx.intensity], [1, 0]] as [number, number][] },
          ].map((o) => (
            <Btn
              key={o.l}
              variant="soft"
              className="h-6 px-1 text-[9.5px]"
              onClick={() =>
                st.updateFx(fx.id, {
                  keyframes: upsertTrack(
                    fx.keyframes,
                    {
                      id: fx.id + '-intensity',
                      property: 'intensity',
                      keyframes: o.keys.map(([t, val], i) => ({
                        id: `${fx.id}-k${i}-${t}`,
                        t,
                        val,
                        interp: 'bezier' as const,
                        out: [0.12, 0.85] as [number, number],
                        inn: [0.2, 1] as [number, number],
                      })),
                    }
                  ),
                })
              }
            >
              {o.l}
            </Btn>
          ))}
        </div>
        {hasTrack(fx.keyframes, 'intensity') && (
          <div className="flex items-center gap-2 text-[10px] text-[#4ade80]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" /> animated · {trackFor(fx.keyframes, 'intensity')!.keyframes.length} keys
            <button type="button" className="ml-auto text-zinc-500 hover:text-white" onClick={() => st.updateFx(fx.id, { keyframes: removeTrack(fx.keyframes, 'intensity') })}>
              clear
            </button>
          </div>
        )}
        <KeyframeEditor
          props={FX_PROPS}
          propId="intensity"
          onPropChange={() => undefined}
          tracks={fx.keyframes}
          onTracksChange={(t) => st.updateFx(fx.id, { keyframes: t })}
          staticVals={{ intensity: fx.intensity }}
          normU={clamp((useEditor.getState().time - fx.start) / fx.duration, 0, 1)}
          durationSec={fx.duration}
          onScrub={(u) => st.setTime(fx.start + u * fx.duration)}
        />
      </Section>
    </>
  );
}

function MusicInspector() {
  const st = useEditor.getState();
  const music = useEditor((s) => s.project.music);
  const mediaList = useEditor((s) => s.media);
  const project = useEditor((s) => s.project);
  const selId = useEditor((s) => s.selection?.id);
  if (!music) return null;

  const mediaMap = new Map(mediaList.map((x) => [x.id, x]));
  const segments = getMusicClips(project, mediaMap);
  const active = segments.find((mc) => mc.id && mc.id === selId) ?? segments[0];
  if (!active) return null;
  const m = mediaMap.get(active.mediaId);
  const maxSrc = m?.duration ?? 300;
  const segDur = active.duration ?? Math.max(0.1, maxSrc - (active.srcIn ?? 0));

  return (
    <>
      <Header
        icon={<Music2 size={18} className="text-[#ff2d55]" />}
        title={m?.name ?? 'Music'}
        sub={segments.length > 1 ? `Segment ${segments.indexOf(active) + 1} of ${segments.length} · ${fmtSec(segDur)}` : `Music track · ${fmtSec(segDur)}`}
        color="#ff2d55"
      />
      <Section title="Audio">
        <Slider
          label="Volume"
          value={active.volume}
          min={0}
          max={1.5}
          step={0.01}
          format={(x) => `${Math.round(x * 100)}%`}
          onStart={txn.start}
          onEnd={txn.end}
          onChange={(x) => {
            const updated = { ...active, volume: x };
            st.commit((p) => syncMusicProject(p, segments.map((s2) => (s2.id === active.id ? updated : s2))));
          }}
          onReset={() => {
            const updated = { ...active, volume: 1 };
            st.commit((p) => syncMusicProject(p, segments.map((s2) => (s2.id === active.id ? updated : s2))));
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="Timeline start"
            value={active.start}
            step={0.05}
            min={0}
            suffix="s"
            onChange={(x) => {
              const ns = Math.max(0, x);
              const updated = { ...active, start: ns };
              const delta = ns - active.start;
              st.commit((p) => ({
                ...syncMusicProject(p, segments.map((s2) => (s2.id === active.id ? updated : s2))),
                beats: p.beats.map((b) => b + delta),
              }));
            }}
          />
          <NumField
            label="Segment length"
            value={segDur}
            step={0.05}
            min={0.1}
            max={Math.max(0.1, maxSrc - (active.srcIn ?? 0))}
            suffix="s"
            onChange={(x) => {
              const updated = { ...active, duration: Math.max(0.1, x) };
              st.commit((p) => syncMusicProject(p, segments.map((s2) => (s2.id === active.id ? updated : s2))));
            }}
          />
        </div>
        <NumField
          label="Song in-point (skips the intro)"
          value={active.srcIn ?? 0}
          step={0.05}
          min={0}
          max={Math.max(0, maxSrc - 0.1)}
          suffix="s"
          onChange={(x) => {
            const updated = { ...active, srcIn: Math.max(0, Math.min(x, maxSrc - 0.1)) };
            st.commit((p) => syncMusicProject(p, segments.map((s2) => (s2.id === active.id ? updated : s2))));
          }}
        />
        <div className="text-[10.5px] leading-relaxed text-zinc-500">
          Drag the waveform to move it · drag its edges to trim · press <kbd className="rounded bg-white/10 px-1 text-zinc-300">S</kbd> to split at the playhead.
        </div>
        <div className="flex gap-2">
          <Btn variant="soft" className="flex-1" onClick={() => st.ui({ leftTab: 'beats' })}>
            Beat tools
          </Btn>
          {segments.length > 1 && (
            <Btn variant="danger" onClick={() => st.removeSelected()} title="Delete this segment only">
              <Trash2 size={13} /> Segment
            </Btn>
          )}
          <Btn variant="danger" onClick={() => st.setMusic(null)} title="Remove all music">
            <Trash2 size={13} /> All
          </Btn>
        </div>
      </Section>
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['S', 'Split at playhead'],
  ['B', 'Tap beat marker'],
  ['R / T', 'Reverse / Twixtor clip'],
  ['[ / ]', 'Rotate 1° (Shift = 15°)'],
  [', / .', 'Zoom 5% (Shift = 1%)'],
  ['0', 'Reset transform'],
  ['Del', 'Delete selection'],
  ['Ctrl+D', 'Duplicate'],
  ['Ctrl+Z', 'Undo (Shift = redo)'],
  ['← →', 'Frame step (Shift = 1s)'],
  ['Wheel', 'Zoom the frame (Shift = rotate)'],
  ['Ctrl+Wheel', 'Zoom timeline'],
  ['I / O', 'Mark in / out (source)'],
];

function ProjectInspector() {
  const st = useEditor.getState();
  const p = useEditor((s) => s.project);
  return (
    <>
      <Header icon="🕸️" title="Project" sub={`${fmtSec(totalDuration(p.clips))} · ${p.clips.length} clips · ${p.fx.length} effects`} color="#b026ff" />
      <Section title="Output">
        <Seg
          value={p.aspect}
          onChange={(a) => st.setProjectProps({ aspect: a })}
          options={(['9:16', '16:9', '1:1', '4:5'] as const).map((a) => ({ v: a, l: a }))}
        />
        <Seg value={p.fps} onChange={(f) => st.setProjectProps({ fps: f })} options={[24, 30, 60].map((f) => ({ v: f, l: `${f} fps` }))} />
        <Slider label="Motion blur (shutter)" value={p.motionBlur} min={0} max={2} step={0.05} format={(x) => `${Math.round(x * 180)}°`} onStart={txn.start} onEnd={txn.end} onChange={(x) => st.live((q) => ({ ...q, motionBlur: x }))} onReset={() => st.setProjectProps({ motionBlur: 1 })} />
        <div className="text-[10.5px] leading-relaxed text-zinc-500">Motion blur is computed from every zoom, shake, spin and slide — the secret sauce behind smooth “good zooms”.</div>
      </Section>
      <Section title="Shortcuts">
        <div className="space-y-1">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between text-[11px]">
              <span className="text-zinc-400">{d}</span>
              <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">{k}</kbd>
            </div>
          ))}
        </div>
      </Section>
      <div className="p-3 text-[11px] leading-relaxed text-zinc-500">
        <Keyboard size={12} className="mb-1 inline text-zinc-400" /> Select a clip, effect or the music track on the timeline to edit its properties here.
      </div>
    </>
  );
}

export function Inspector() {
  const sel = useEditor((s) => s.selection);
  const clip = useEditor((s) => (s.selection?.kind === 'clip' ? s.project.clips.find((c) => c.id === s.selection!.id) : undefined));
  const fx = useEditor((s) => (s.selection?.kind === 'fx' ? s.project.fx.find((f) => f.id === s.selection!.id) : undefined));
  const hasMusic = useEditor((s) => !!s.project.music);
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-white/[0.06] bg-[#0c0c11]">
      <div className="flex h-9 shrink-0 items-center border-b border-white/[0.06] px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Inspector</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {clip ? <ClipInspector clip={clip} /> : fx ? <FxInspector fx={fx} /> : sel?.kind === 'music' && hasMusic ? <MusicInspector /> : <ProjectInspector />}
      </div>
    </aside>
  );
}
