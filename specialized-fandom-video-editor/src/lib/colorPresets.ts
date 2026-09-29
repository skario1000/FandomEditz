import type { ColorSettings } from '../types';

export const defaultColor = (): ColorSettings => ({
  preset: 'none',
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  fade: 0,
  bw: 0,
  shadowTint: '#808080',
  highTint: '#808080',
  split: 0,
});

export interface ColorPreset {
  id: string;
  name: string;
  swatch: [string, string, string];
  s: Partial<ColorSettings>;
}

export const COLOR_PRESETS: ColorPreset[] = [
  { id: 'none', name: 'Original', swatch: ['#3a3a44', '#8a8a96', '#d8d8e0'], s: {} },
  {
    id: 'tealOrange',
    name: 'Teal & Orange',
    swatch: ['#0d4f5a', '#3a8f96', '#ff9a3c'],
    s: { contrast: 0.2, saturation: 0.15, temperature: 0.08, shadowTint: '#0d8f9a', highTint: '#ffa24a', split: 0.4, fade: 0.04 },
  },
  {
    id: 'spidey',
    name: 'Spidey Red',
    swatch: ['#0c1450', '#c3122a', '#ff5a5a'],
    s: { contrast: 0.28, saturation: 0.32, temperature: 0.04, shadowTint: '#1a2aa0', highTint: '#ff2a2a', split: 0.32 },
  },
  {
    id: 'symbiote',
    name: 'Symbiote',
    swatch: ['#020308', '#1c2233', '#9fb4ff'],
    s: { exposure: -0.35, contrast: 0.45, saturation: -0.5, temperature: -0.3, shadowTint: '#0a0c20', highTint: '#9fb4ff', split: 0.28 },
  },
  { id: 'noir', name: 'Noir', swatch: ['#050505', '#6a6a6a', '#f2f2f2'], s: { contrast: 0.5, bw: 1, fade: 0.04 } },
  {
    id: 'verse',
    name: 'Verse Pop',
    swatch: ['#3a00a8', '#ff2d95', '#ffe04a'],
    s: { contrast: 0.3, saturation: 0.6, shadowTint: '#6a00ff', highTint: '#ff2d95', split: 0.3 },
  },
  {
    id: 'neon',
    name: 'Neon Night',
    swatch: ['#12005a', '#7a00ff', '#ff00c8'],
    s: { contrast: 0.22, saturation: 0.38, temperature: -0.2, tint: 0.25, shadowTint: '#2a00ff', highTint: '#ff00c8', split: 0.38 },
  },
  {
    id: 'golden',
    name: 'Golden Hour',
    swatch: ['#4a2a0a', '#d9822b', '#ffd27a'],
    s: { exposure: 0.1, contrast: 0.1, saturation: 0.2, temperature: 0.55, highTint: '#ffc36b', split: 0.22 },
  },
  { id: 'faded', name: 'Faded Film', swatch: ['#3b3a40', '#8e8a86', '#e0d6c8'], s: { contrast: -0.15, saturation: -0.28, fade: 0.55, temperature: 0.1 } },
  {
    id: 'ice',
    name: 'Ice Cold',
    swatch: ['#0a1f5a', '#5a8fd8', '#e0f0ff'],
    s: { exposure: 0.1, contrast: 0.15, saturation: -0.2, temperature: -0.6, shadowTint: '#0a3cff', split: 0.22 },
  },
  { id: 'vibrant', name: 'Vibrant', swatch: ['#ff3b3b', '#3bff8f', '#3b7bff'], s: { contrast: 0.22, saturation: 0.6 } },
  {
    id: 'blood',
    name: 'Blood Moon',
    swatch: ['#1a0000', '#8a0a0a', '#ff4a1f'],
    s: { exposure: -0.2, contrast: 0.38, saturation: 0.2, temperature: 0.3, shadowTint: '#5a0000', highTint: '#ff3b1f', split: 0.45 },
  },
  {
    id: 'matrix',
    name: 'Digital Green',
    swatch: ['#001a08', '#0a7a2a', '#9dff9d'],
    s: { tint: -0.5, saturation: -0.2, contrast: 0.3, shadowTint: '#003b10', highTint: '#9dff9d', split: 0.3 },
  },
];

export function colorFromPreset(id: string): ColorSettings {
  const p = COLOR_PRESETS.find((x) => x.id === id);
  return { ...defaultColor(), ...(p?.s ?? {}), preset: id };
}
