/**
 * Regression checks for the editing maths: the on-canvas transform, the
 * one-click moves, the keyframe write path, the effect library, the music
 * wiring and the store.
 *
 * Run with `npm test` — esbuild bundles this file and node runs it, so there
 * is no test framework and no browser in the loop.
 */
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
g.indexedDB = undefined;
g.window = { addEventListener() {}, removeEventListener() {} };
g.document = { createElement: () => ({ getContext: () => null, style: {} }) };


import { layerView, posFromCenter, transformChanges, snapAngle, clampScale, clampRot } from '../src/lib/transform';
import { clipGeom, musicAt, computeFrame } from '../src/lib/compose';
import { presetToClip, MOVE_BY_ID } from '../src/lib/moves';
import { evalTrack, trackFor } from '../src/lib/keyframes';
import { CLIP_PROPS, type Clip, type Project } from '../src/types';
import { evaluateFx, newFxState, FX_DEFS, LIBRARY } from '../src/lib/effects';
import { generateLocalAiPlan } from '../src/lib/ai';
import { useEditor, makeClip, emptyProject } from '../src/store';

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
};
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;

/* ------------------------------------------------------------------ */
/* Clip + gizmo geometry                                                */
/* ------------------------------------------------------------------ */
const base = (over: Partial<Clip> = {}): Clip => ({
  id: 'c1',
  mediaId: 'm1',
  srcIn: 0,
  srcOut: 4,
  speed: 1,
  reverse: false,
  twixtor: false,
  velocity: { preset: 'none', intensity: 1, center: 0.5 },
  fit: 'cover',
  scale: 1,
  posX: 0,
  posY: 0,
  rotation: 0,
  flipX: false,
  mirrorEdges: true,
  color: { preset: 'none', exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, hue: 0, fade: 0, bw: 0, shadowTint: '#000000', highTint: '#ffffff', split: 0 },
  ...over,
});


/* ------------------------------------------------------------------ */
/* Gizmo maths                                                          */
/* ------------------------------------------------------------------ */
/* ---------------------------------------------------------------- gizmo */
const W = 1000;
const H = 562.5; // 16:9
const boxW = 800;
const boxH = 450;
const v0 = layerView(base(), 1920, 1080, boxW, boxH, 0)!;
ok('gizmo: identity fills the frame', near(v0.corners[0][0], 0, 1) && near(v0.corners[1][0], boxW, 1) && near(v0.corners[2][1], boxH, 1), JSON.stringify(v0.corners.map((c) => c.map((n) => +n.toFixed(1)))));
ok('gizmo: centre is the frame centre', near(v0.center[0], boxW / 2, 0.5) && near(v0.center[1], boxH / 2, 0.5));

const vs = layerView(base({ scale: 2 }), 1920, 1080, boxW, boxH, 0)!;
ok('gizmo: 2x scale doubles the frame', near(vs.corners[1][0] - vs.corners[0][0], boxW * 2, 1), `${(vs.corners[1][0] - vs.corners[0][0]).toFixed(1)} vs ${boxW * 2}`);

const vr = layerView(base({ rotation: 90 }), 1920, 1080, boxW, boxH, 0)!;
// a 90° rotation of a 16:9 frame swaps width/height
ok('gizmo: 90° rotation turns the frame a quarter turn', near(Math.abs(vr.corners[1][1] - vr.corners[0][1]), boxW, 1.5) && near(Math.abs(vr.corners[2][0] - vr.corners[1][0]), boxH, 1.5), `${(vr.corners[1][1] - vr.corners[0][1]).toFixed(1)} / ${(vr.corners[2][0] - vr.corners[1][0]).toFixed(1)}`);

const vp = layerView(base({ scale: 2, posX: 0.5 }), 1920, 1080, boxW, boxH, 0)!;
ok('gizmo: pan moves the layer', vp.center[0] > boxW / 2 + 10, `${vp.center[0].toFixed(1)}`);

/* posX round trip: centre -> pos -> centre */
{
  const clip = base({ scale: 1.6 });
  const g = clipGeom(clip, 1920, 1080, W, H, 0);
  const targetCx = 640;
  const { posX } = posFromCenter(g, W, H, targetCx, H / 2, g.scale);
  const g2 = clipGeom(base({ scale: 1.6, posX }), 1920, 1080, W, H, 0);
  ok('gizmo: posX round trips through the centre', near(g2.cx, targetCx, 0.5), `${g2.cx.toFixed(2)} vs ${targetCx}`);
}

ok('snap: 14° snaps to 15°', snapAngle(14, false) === 15);
ok('snap: shift disables the snap', near(snapAngle(14, true), 14));
ok('clamp: scale bounds', near(clampScale(99), 12) && near(clampScale(0), 0.1));
ok('clamp: rotation allows multi-turn', near(clampRot(360), 360) && near(clampRot(-1000), -720));


/* ------------------------------------------------------------------ */
/* Static values vs keyframes                                           */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------- static vs keyframed */
{
  const c = base();
  const p = transformChanges(c, { scale: 1.4 }, 0.5);
  ok('write: static property writes the value', near((p as { scale: number }).scale, 1.4) && !p.keyframes);
  const keyed = base({ keyframes: [{ id: 't', property: 'scale', keyframes: [{ id: 'a', t: 0, val: 1 }, { id: 'b', t: 1, val: 2 }] }] });
  const p2 = transformChanges(keyed, { scale: 1.8 }, 0.5);
  const tr = trackFor(p2.keyframes, 'scale')!;
  ok('write: animated property writes a key, not a value', (p2 as { scale?: number }).scale === undefined && tr.keyframes.length === 3);
  ok('write: the new key lands on the playhead', near(evalTrack(tr, 0.5, 1), 1.8, 1e-9));
}


/* ------------------------------------------------------------------ */
/* One-click moves                                                      */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------- presets */
for (const preset of [...MOVE_BY_ID.values()]) {
  const clip = base();
  const from = { scale: 1, posX: 0, posY: 0, rotation: 0 };
  const patch = presetToClip(clip, preset, from, 4);
  const props = CLIP_PROPS.map((p) => p.id).filter((id) => preset.keys.some((k) => k[id as 'scale'] !== undefined));
  const tracks = props.map((id) => trackFor(patch.keyframes, id)).filter(Boolean);
  const keysOk = tracks.every((t) => t!.keyframes.length >= 2 && t!.keyframes.every((k) => k.t >= 0 && k.t <= 1));
  const first = tracks[0]!.keyframes[0];
  const last = tracks[tracks.length - 1]!.keyframes.slice(-1)[0];
  const monotonic = last.t > first.t;
  ok(`preset ${preset.id}: writes ${props.join('+')} keys`, tracks.length === props.length && keysOk && monotonic, `${tracks.map((t) => t!.keyframes.length).join('/')} keys`);
}
{
  const patch = presetToClip(base(), MOVE_BY_ID.get('spin360')!, { scale: 1, posX: 0, posY: 0, rotation: 0 }, 4);
  const tr = trackFor(patch.keyframes, 'rotation')!;
  ok('preset spin360: covers 0 → 360 in one continuous pass', tr.keyframes.length === 2 && near(tr.keyframes[0].val, 0) && near(tr.keyframes[1].val, 360));
  const ts2 = trackFor(patch.keyframes, 'scale')!;
  ok('preset spin360: carries a push with it', ts2.keyframes.length === 2 && near(ts2.keyframes[0].val, 1) && near(ts2.keyframes[1].val, 1.12));
  const v = (u: number) => (evalTrack(tr, u + 0.005, 0) - evalTrack(tr, u - 0.005, 0)) / 0.01;
  ok('preset spin360: eases in and out', v(0.02) < v(0.5) * 0.2 && v(0.98) < v(0.5) * 0.2, `v0=${v(0.02).toFixed(0)} v50=${v(0.5).toFixed(0)} v98=${v(0.98).toFixed(0)}`);
}
{
  const patch = presetToClip(base(), MOVE_BY_ID.get('whipLand')!, { scale: 1.3, posX: 0, posY: 0, rotation: -8 }, 4);
  const tr = trackFor(patch.keyframes, 'rotation')!;
  const ts = trackFor(patch.keyframes, 'scale')!;
  ok('preset whipLand: starts where the clip already was', near(tr.keyframes[0].val, -8) && near(ts.keyframes[0].val, 1.3));
  ok('preset whipLand: lands square at the end', near(tr.keyframes[1].t, 1) && near(tr.keyframes[1].val, 0) && near(ts.keyframes[1].val, 1));
}


/* ------------------------------------------------------------------ */
/* Effects                                                              */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------- effects */
const has = (t: string) => !!FX_DEFS[t];
for (const t of ['spinZoom', 'dutchZoom', 'orbitZoom', 'ySpin', 'tiltRush', 'snapRotate', 'rollTrans', 'rotateTrans', 'bassPump']) ok(`fx ${t} defined`, has(t));

{
  // a 360 spin reaches a full turn and returns to 0 mod 360
  const s = newFxState(9 / 16);
  const p: Record<string, string | number | boolean> = {};
  for (const d of FX_DEFS.spinZoom.params) p[d.key] = d.def as string | number | boolean;
  const mid = { p: 0.5, lt: 0.4, dur: 0.8, k: 1, P: p, seed: 3, T: 0.4, beats: [], start: 0 } as never;
  FX_DEFS.spinZoom.apply!(s, mid);
  // geo = T R S T; at p=0.5 with expo easing the rotation is ~180°
  const geo = s.geo;
  const a = Math.atan2(geo[1], geo[0]) * (180 / Math.PI);
  ok('fx spinZoom: half way through a 1-turn spin the frame is ~180°', Math.abs(Math.abs(a) - 180) < 60, `${a.toFixed(1)}°`);
}
{
  const s = newFxState(9 / 16);
  const p = FX_DEFS.ySpin.params.reduce((o, d) => ({ ...o, [d.key]: d.def }), {} as Record<string, string | number | boolean>);
  const q = { p: 0.25, lt: 0.15, dur: 0.6, k: 1, P: p, seed: 1, T: 0.15, beats: [], start: 0 } as never;
  FX_DEFS.ySpin.apply!(s, q);
  ok('fx 3D spin: squeezes the frame as it turns', s.geo[0] < 0.95 && s.geo[0] > 0, `sx=${s.geo[0].toFixed(3)}`);
  ok('fx 3D spin: darkens away from face-on', s.shade < 1, `shade=${s.shade.toFixed(2)}`);
  const s2 = newFxState(9 / 16);
  const q2 = { p: 0.4, lt: 0.24, dur: 0.6, k: 1, P: p, seed: 1, T: 0.24, beats: [], start: 0 } as never;
  FX_DEFS.ySpin.apply!(s2, q2);
  ok('fx 3D spin: past 90° the back face is mirrored', s2.geo[0] < 0, `sx=${s2.geo[0].toFixed(3)}`);
  const s3 = newFxState(9 / 16);
  FX_DEFS.ySpin.apply!(s3, Object.assign({}, q, { p: 0 }) as never);
  ok('fx 3D spin: starts and lands face-on', near(s3.geo[0], 1, 0.05) && near(s3.shade, 1, 0.02), `sx=${s3.geo[0].toFixed(3)}`);
}
{
  // every library entry points at a real effect with a real category
  const bad = LIBRARY.filter((e) => !FX_DEFS[e.type]?.apply && !FX_DEFS[e.type]?.remap && e.type !== 'text');
  ok('library: every entry resolves', bad.length === 0, bad.map((b) => b.id).join(','));
  const rot = LIBRARY.filter((e) => e.cat === 'rotate').length;
  const aud = LIBRARY.filter((e) => e.cat === 'audio').length;
  ok('library: rotate + audio entries exist', rot >= 8 && aud >= 1, `${rot} rotate, ${aud} audio`);
}
{
  // every effect must be safe at t=0 and t=1 with default params
  const broken: string[] = [];
  for (const def of Object.values(FX_DEFS)) {
    if (!def.apply) continue;
    const P: Record<string, string | number | boolean> = {};
    for (const d of def.params) P[d.key] = d.def as string | number | boolean;
    for (const p of [0, 0.5, 1]) {
      try {
        const s = newFxState(9 / 16);
        def.apply(s, { p, lt: p * def.dur, dur: def.dur, k: 1, P, seed: 5, T: p * def.dur, beats: [0.2, 0.6], start: 0 } as never);
        if (s.geo.some((n) => !Number.isFinite(n)) || !Number.isFinite(s.shade)) broken.push(`${def.type}@${p}`);
      } catch (e) {
        broken.push(`${def.type}@${p}:${(e as Error).message}`);
      }
    }
  }
  ok('effects: all defs are finite and safe at 0 / 0.5 / 1', broken.length === 0, broken.join(','));
}
{
  const items = LIBRARY.filter((e) => e.type === 'spinZoom').slice(0, 1).map((e) => ({ id: e.id, type: e.type, start: 0, duration: e.dur ?? 0.8, lane: 0, intensity: 1, params: {} }));
  const s = newFxState(9 / 16);
  evaluateFx(items as never, 0.3, [], s);
  ok('evaluate: runs a library effect through the timeline', s.geo.every((n) => Number.isFinite(n)));
}


/* ------------------------------------------------------------------ */
/* Music reactivity wiring                                              */
/* ------------------------------------------------------------------ */
/* ---------------------------------------------------------- music wiring */
{
  const proj = {
    aspect: '9:16', fps: 30, clips: [], fx: [], beats: [], motionBlur: 1,
    music: { id: 'm1', mediaId: 'song', start: 2, volume: 1, srcIn: 10, duration: 5 },
    musicClips: [
      { id: 'a', mediaId: 'song', start: 2, volume: 1, srcIn: 10, duration: 5 },
      { id: 'b', mediaId: 'song2', start: 7, volume: 1, srcIn: 0, duration: 4 },
    ],
  } as unknown as Project;
  ok('music: before the track starts there is no music', musicAt(proj, 1) === null);
  ok('music: maps timeline time to source time', JSON.stringify(musicAt(proj, 4)) === JSON.stringify({ mediaId: 'song', t: 12 }), JSON.stringify(musicAt(proj, 4)));
  ok('music: switches to the next segment', musicAt(proj, 8)?.mediaId === 'song2', JSON.stringify(musicAt(proj, 8)));
  ok('music: past the end is silent again', musicAt(proj, 11) === null);
  const single = { ...proj, musicClips: undefined } as unknown as Project;
  ok('music: falls back to the single track', musicAt(single, 3)?.t === 11);
}
{
  // a reactive effect with no analysed track must be a no-op, never garbage
  const s = newFxState(9 / 16);
  const P: Record<string, string | number | boolean> = {};
  for (const d of FX_DEFS.bassPump.params) P[d.key] = d.def as string | number | boolean;
  const ctx = { p: 0.5, lt: 1, dur: 6, k: 1, P, seed: 2, T: 1, beats: [], start: 0 } as never;
  FX_DEFS.bassPump.apply!(s, ctx);
  ok('fx bassPump: inert without a track', near(s.geo[0], 1) && s.glow === 0 && near(s.geo[4], 0));
}


/* ------------------------------------------------------------------ */
/* AI director plans                                                    */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------- ai plans */
{
  const proj = {
    aspect: '9:16', fps: 30, beats: [1, 2], motionBlur: 1,
    clips: [base(), base({ id: 'c2' })],
    fx: [], music: { id: 'm', mediaId: 'song', start: 0, volume: 1, srcIn: 0, duration: 8 },
  } as unknown as Project;
  const proj2: Project = proj;
  for (const prompt of ['add a spin zoom to every clip', 'make it dutch', 'make the whole edit breathe with the music', 'make simple zooms over the edit']) {
    const plan = generateLocalAiPlan(prompt, proj2);
    const bad = plan.actions.filter((a) => a.type === 'add_fx' && (!a.fxType || !FX_DEFS[a.fxType]));
    ok(`ai "${prompt}" → ${plan.actions.length} actions`, plan.actions.length > 0 && bad.length === 0, plan.summary);
  }
  const noMusic: Project = { ...proj, music: null };
  const plan = generateLocalAiPlan('make it react to the music', noMusic);
  ok('ai asks for a track before going reactive', plan.actions.length === 0, plan.summary);
}


/* ------------------------------------------------------------------ */
/* Store: moves, transform writes, undo                                 */
/* ------------------------------------------------------------------ */
const st = () => useEditor.getState();
st().loadProject({ ...emptyProject(), clips: [makeClip('m1', 0, 3), makeClip('m1', 3, 6)] });
st().addMedia({ id: 'm1', name: 'clip.mp4', kind: 'video', url: 'blob:x', duration: 10, width: 1920, height: 1080, fps: 30, status: 'ready' });
st().select({ kind: 'clip', id: st().project.clips[0].id });

ok('targetClip: follows the selection', st().targetClip()?.clip.id === st().project.clips[0].id);
ok('targetClip: falls back to the playhead', (st().select(null), st().setTime(4), st().targetClip()?.clip.id === st().project.clips[1].id));

st().select({ kind: 'clip', id: st().project.clips[0].id });
st().setTime(0);
st().applyMove('spin360');
{
  const c = st().project.clips[0];
  const tr = trackFor(c.keyframes, 'rotation')!;
  ok('applyMove spin360: writes a rotation track', !!tr && tr.keyframes.length === 2);
  ok('applyMove spin360: spans the clip', near(tr.keyframes[0].t, 0) && near(tr.keyframes[1].t, 1));
  ok('applyMove spin360: 0 → 360', near(tr.keyframes[0].val, 0) && near(tr.keyframes[1].val, 360));
}
ok('applyMove: toast fired', st().toasts.length > 0);

st().undo();
ok('undo: removes the move', !trackFor(st().project.clips[0].keyframes, 'rotation'));
st().redo();
ok('redo: restores the move', !!trackFor(st().project.clips[0].keyframes, 'rotation'));

// static writes and keyboard nudges
st().loadProject({ ...emptyProject(), clips: [makeClip('m1', 0, 3)] });
st().setTime(0);
st().setTransform({ rotation: 30, scale: 1.5 });
{
  const c = st().project.clips[0];
  ok('setTransform: writes static values', near(c.rotation, 30) && near(c.scale, 1.5) && !c.keyframes);
}
st().setTransform({ rotation: 45 });
ok('setTransform: nudges from the current value', near(st().project.clips[0].rotation, 45));

// one drag = one undo step
st().beginTxn();
for (const s of [1.6, 1.7, 1.8, 1.9]) st().setTransform({ scale: s }, { live: true });
st().endTxn();
ok('drag: many live writes collapse into one history entry', near(st().project.clips[0].scale, 1.9));
st().undo();
ok('drag: one undo reverts the whole drag', near(st().project.clips[0].scale, 1.5), String(st().project.clips[0].scale));

// a keyframed property gets a key, not a value
st().applyMove('pushIn');
{
  const p = st().project;
  const mediaMap = new Map(st().media.map((m) => [m.id, m]));
  const d0 = computeFrame(p, mediaMap, 0, 1080, 1920);
  const d1 = computeFrame(p, mediaMap, 2.9, 1080, 1920);
  ok('compose: the sampled frame really zooms in on the key', d1.M1[0] < d0.M1[0] * 0.85, `${d0.M1[0].toExponential(3)} → ${d1.M1[0].toExponential(3)}`);
}
st().setTime(1.5);
st().setTransform({ scale: 2 });
{
  const c = st().project.clips[0];
  const tr = trackFor(c.keyframes, 'scale')!;
  ok('keyframed: dragging stamps a key at the playhead', near(evalTrack(tr, 0.5, 1), 2) && c.scale !== 2, `${c.scale}`);
}
st().resetTransform();
{
  const tr = trackFor(st().project.clips[0].keyframes, 'scale')!;
  ok('reset: writes 100% as a key when animated', near(evalTrack(tr, 0.5, 1), 1));
}

// clamp safety
st().loadProject({ ...emptyProject(), clips: [makeClip('m1', 0, 3)] });
st().setTime(0);
st().setTransform({ scale: 9999, rotation: 9999, posX: 99 });
{
  const c = st().project.clips[0];
  ok('setTransform: clamps absurd values', c.scale === 12 && c.rotation === 720 && Math.abs(c.posX) <= 3, `${c.scale}/${c.rotation}/${c.posX}`);
}


console.log(fails ? `\n${fails} failing check(s)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
