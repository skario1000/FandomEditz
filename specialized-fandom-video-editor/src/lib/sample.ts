import type { Clip, Project } from '../types';
import { makeClip, makeFx } from '../store';
import { colorFromPreset } from './colorPresets';
import { DEMO_BEAT_ID } from './audio';

/** A short showcase edit built on the synthesized 130 BPM demo beat. */
export function buildSampleProject(beats: number[], beat: number): Project {
  const b = beat;
  const mk = (mediaId: string, srcIn: number, span: number, patch: Partial<Clip> = {}): Clip => ({
    ...makeClip(mediaId, srcIn, srcIn + span),
    ...patch,
  });
  const SW = 'demo-swing';
  const RT = 'demo-rooftop';
  const clips: Clip[] = [
    // bars 1-2: intro, twixtor slow motion
    mk(SW, 0.4, 8 * b * 0.5, { speed: 0.5, twixtor: true, color: colorFromPreset('tealOrange') }),
    // bar 3: velocity ramp
    mk(RT, 4.6, 4 * b * 1.4, { speed: 1.4, velocity: { preset: 'classic', intensity: 0.85, center: 0.5 }, color: colorFromPreset('golden') }),
    // bar 4: reverse + twixtor
    mk(SW, 5.5, 2 * b, { reverse: true, color: colorFromPreset('spidey') }),
    mk(RT, 5.6, 2 * b * 0.5, { speed: 0.5, twixtor: true, color: colorFromPreset('golden') }),
  ];
  // bars 5-6: the drop, one microwave clip per beat
  for (let i = 0; i < 8; i++) {
    clips.push(
      mk(i % 2 ? RT : SW, i % 2 ? 5.6 + (i % 4) * 0.35 : 1 + i * 0.8, b * 1.2, {
        speed: 1.2,
        velocity: { preset: 'microwave', intensity: 0.5, center: 0.7 },
        color: colorFromPreset(i % 2 ? 'golden' : 'spidey'),
      })
    );
  }
  // bars 7-8: impact velocity then ultra slow twixtor ending
  clips.push(mk(SW, 3, 4 * b * 1.6, { speed: 1.6, velocity: { preset: 'impact', intensity: 0.85, center: 0.55 }, color: colorFromPreset('spidey') }));
  clips.push(mk(SW, 8, 4 * b * 0.3, { speed: 0.3, twixtor: true, color: colorFromPreset('symbiote') }));

  const fx = [
    makeFx('letterbox', 0, 8 * b, 2),
    makeFx('kenBurns', 0, 8 * b, 0, { amount: 0.1 }),
    makeFx('text', 0.25, 8 * b - 0.6, 1, { text: 'EDITVERSE', anim: 'slam', size: 0.13, color: '#ffffff', glow: true }),
    makeFx('flash', 8 * b, 0.3, 0),
    makeFx('zoomPunch', 8 * b, 0.4, 1, { amount: 0.3 }),
    makeFx('zoomTrans', 12 * b - 0.25, 0.5, 0, { amount: 1.2 }),
    makeFx('whipTrans', 14 * b - 0.2, 0.4, 1),
    makeFx('flash', 16 * b, 0.3, 0),
    makeFx('impact', 16 * b, 0.7, 1, { amount: 0.7 }),
    makeFx('rgbSplit', 16 * b, 0.45, 2, { amount: 20 }),
    makeFx('glitchTrans', 24 * b - 0.2, 0.4, 0),
    makeFx('verse', 24 * b, 4 * b, 1),
    makeFx('spinTrans', 28 * b - 0.25, 0.5, 0),
    makeFx('glow', 28 * b, 4 * b, 2, { amount: 1, threshold: 0.45 }),
    makeFx('echo', 28 * b, 4 * b, 1, { amount: 0.45 }),
    makeFx('text', 28 * b + 0.3, 4 * b - 0.4, 0, { text: 'with great power...', anim: 'typewriter', font: 'mono', size: 0.045, y: 0.82, stroke: false }),
  ];
  return {
    aspect: '9:16',
    fps: 30,
    clips,
    fx,
    music: { mediaId: DEMO_BEAT_ID, start: 0, volume: 0.9 },
    beats,
    motionBlur: 1,
  };
}
