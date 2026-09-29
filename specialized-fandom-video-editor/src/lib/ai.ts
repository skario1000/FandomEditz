import type { FxItem, ParamValue, Project } from '../types';
import { layoutClips, totalDuration } from './velocity';
import { FX_DEFS } from './effects';
import { colorFromPreset } from './colorPresets';
import { freeLane, makeFx } from '../store';

export interface AiConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  corsProxy: boolean;
}

const STORAGE_KEY_PREFIX = 'editverse_ai_';

/** All models use the /chat/completions endpoint (OpenAI-compatible wire API). */
export const OPENCODE_MODELS = [
  { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash — fastest, highest limits', provider: 'OpenCode Go' },
  { id: 'glm-5.2', name: 'GLM 5.2 — best all-round quality', provider: 'OpenCode Go' },
  { id: 'glm-5.1', name: 'GLM 5.1', provider: 'OpenCode Go' },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', provider: 'OpenCode Go' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', provider: 'OpenCode Go' },
  { id: 'minimax-m2.7', name: 'MiniMax M2.7', provider: 'OpenCode Go' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'OpenCode Go' },
  { id: 'longcat-2.0', name: 'LongCat 2.0 — huge limits', provider: 'OpenCode Go' },
  { id: 'mimo-v2.5', name: 'MiMo V2.5 — massive limits', provider: 'OpenCode Go' },
  { id: 'hy3', name: 'Hy3', provider: 'OpenCode Go' },
  { id: 'space-bunny-free', name: 'Space Bunny (Free, unlimited)', provider: 'OpenCode Go' },
  { id: 'longcat-2.5-preview-free', name: 'LongCat 2.5 Preview (Free)', provider: 'OpenCode Go' },
  { id: 'custom', name: 'Custom Model ID…', provider: 'Custom' },
];

export const DEFAULT_AI_CONFIG: AiConfig = {
  apiKey: '',
  endpoint: 'https://opencode.ai/zen/go/v1',
  model: 'glm-5.3-flash',
  corsProxy: true,
};

export function loadAiConfig(): AiConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_AI_CONFIG;
  return {
    apiKey: localStorage.getItem(STORAGE_KEY_PREFIX + 'key') || '',
    endpoint: localStorage.getItem(STORAGE_KEY_PREFIX + 'endpoint') || DEFAULT_AI_CONFIG.endpoint,
    model: localStorage.getItem(STORAGE_KEY_PREFIX + 'model') || DEFAULT_AI_CONFIG.model,
    corsProxy: localStorage.getItem(STORAGE_KEY_PREFIX + 'proxy') !== 'false',
  };
}

export function saveAiConfig(cfg: Partial<AiConfig>) {
  if (typeof localStorage === 'undefined') return;
  if (cfg.apiKey !== undefined) localStorage.setItem(STORAGE_KEY_PREFIX + 'key', cfg.apiKey);
  if (cfg.endpoint !== undefined) localStorage.setItem(STORAGE_KEY_PREFIX + 'endpoint', cfg.endpoint);
  if (cfg.model !== undefined) localStorage.setItem(STORAGE_KEY_PREFIX + 'model', cfg.model);
  if (cfg.corsProxy !== undefined) localStorage.setItem(STORAGE_KEY_PREFIX + 'proxy', cfg.corsProxy ? 'true' : 'false');
}

export interface AiPlanAction {
  type:
    | 'add_fx'
    | 'simple_zooms_over_edit'
    | 'apply_velocity'
    | 'set_clip_prop'
    | 'add_text'
    | 'color_grade'
    | 'clear_fx';
  fxType?: string;
  start?: number;
  duration?: number;
  lane?: number;
  params?: Record<string, ParamValue>;
  intensity?: number;
  zoomType?: 'smoothZoom' | 'snapZoom' | 'flowZoom' | 'zoomPunch' | 'zoomIn' | 'zoomOut';
  zoomAmount?: number;
  zoomBlur?: number;
  velocityPreset?: 'classic' | 'impact' | 'rampUp' | 'rampDown' | 'double' | 'microwave' | 'boomerang';
  velocityIntensity?: number;
  clipIndex?: number;
  colorPreset?: string;
  text?: string;
  font?: string;
  style?: string;
  anim?: string;
  size?: number;
  color?: string;
  glowAmt?: number;
  turbAmount?: number;
  description?: string;
}

export interface AiPlan {
  summary: string;
  explanation: string;
  actions: AiPlanAction[];
  isFallback?: boolean;
}

/**
 * Intelligent local semantic fallback when offline or no API key is set.
 * Handles the user's specific prompt "make simple zooms over the edit" and custom effect descriptions.
 */
export function generateLocalAiPlan(prompt: string, project: Project): AiPlan {
  const p = prompt.toLowerCase();
  const clips = project.clips;
  const layout = layoutClips(clips);
  const total = totalDuration(clips);

  // 1. "make simple zooms over the edit" / "zooms over edit"
  if (p.includes('simple zoom') || p.includes('zooms over') || p.includes('zoom over') || (p.includes('zoom') && p.includes('edit'))) {
    const actions: AiPlanAction[] = [];
    const zoomTypes: ('smoothZoom' | 'flowZoom' | 'snapZoom')[] = ['smoothZoom', 'flowZoom', 'snapZoom'];

    layout.forEach((l, i) => {
      const dur = Math.max(0.35, Math.min(l.end - l.start, 0.75));
      const zType = zoomTypes[i % zoomTypes.length];
      const dir = i % 2 === 0 ? 'in' : 'out';
      actions.push({
        type: 'add_fx',
        fxType: zType,
        start: Number(l.start.toFixed(2)),
        duration: Number(dur.toFixed(2)),
        lane: 0,
        intensity: 1,
        params: { dir, amount: 0.35, blur: 1.2 },
        description: `${zType === 'smoothZoom' ? 'Good Zoom' : zType === 'flowZoom' ? 'AE Flow Zoom' : 'Snap Zoom'} (${dir}) on clip #${i + 1}`,
      });
    });

    return {
      summary: `Created ${actions.length} smooth zoom movements over the edit`,
      explanation: `Placed professional eased AE zoom presets alternating in and out at the head of every clip with organic radial motion blur.`,
      actions,
      isFallback: true,
    };
  }

  // 2. Spider-Sense / Glitch / Tingle
  if (p.includes('spider') || p.includes('sense') || p.includes('tingle')) {
    const at = project.beats[0] ?? Math.min(1.5, total / 2);
    return {
      summary: 'Generated Spidey-Sense impact effect',
      explanation: 'Stacked high-speed jitter RGB split, invert flicker, decaying impact shake, and animated comic ink lines.',
      actions: [
        { type: 'add_fx', fxType: 'impact', start: at, duration: 0.7, lane: 0, params: { amount: 0.8 }, description: 'Heavy impact shake' },
        { type: 'add_fx', fxType: 'rgbSplit', start: at, duration: 0.5, lane: 1, params: { amount: 24, env: 'jitter' }, description: 'Jitter RGB aberration' },
        { type: 'add_fx', fxType: 'invert', start: at + 0.05, duration: 0.22, lane: 2, params: { mode: 'flicker', freq: 16 }, description: 'Invert strobe' },
        { type: 'add_fx', fxType: 'flash', start: at, duration: 0.25, lane: 0, params: { color: '#ff2d55', amount: 0.8 }, description: 'Crimson flash' },
        { type: 'add_text', text: 'SPIDER-SENSE', style: 'turbulent', font: 'bebas', anim: 'editImpact', turbAmount: 35, glowAmt: 0.8, color: '#ff3b55', start: at, duration: 1.6, description: 'Turbulent spider title' }
      ],
      isFallback: true,
    };
  }

  // 3. Beat Drop / Drop / Flash Hit
  if (p.includes('drop') || p.includes('beat drop') || p.includes('flash') || p.includes('hit')) {
    const at = project.beats.find((b) => b > 2.0) ?? (total > 3 ? 3.0 : 0);
    return {
      summary: 'Generated beat drop impact combo',
      explanation: 'Synced an explosive crash zoom, whiteout flash, decaying camera shake, and chromatic aberration.',
      actions: [
        { type: 'add_fx', fxType: 'crashZoom', start: at, duration: 0.35, lane: 0, params: { amount: 0.9, blur: 2.8 }, description: 'Crash Zoom into beat' },
        { type: 'add_fx', fxType: 'flash', start: at, duration: 0.25, lane: 1, params: { color: '#ffffff', amount: 1 }, description: 'Whiteout flash' },
        { type: 'add_fx', fxType: 'impact', start: at, duration: 0.75, lane: 0, params: { amount: 0.85 }, description: 'Decaying camera impact' },
        { type: 'add_fx', fxType: 'rgbSplit', start: at, duration: 0.45, lane: 2, params: { amount: 22 }, description: 'RGB split wave' },
      ],
      isFallback: true,
    };
  }

  // 4. Microwave / pulses
  if (p.includes('microwave') || p.includes('pulse')) {
    return {
      summary: 'Applied Microwave edit pulse sequence',
      explanation: 'Configured microwave time remapping on all clips with sync side-slams, reflection edges, and zoom pulses.',
      actions: [
        { type: 'apply_velocity', velocityPreset: 'microwave', velocityIntensity: 0.6, description: 'Microwave time remapping on clips' },
        { type: 'add_fx', fxType: 'microwave', start: 0, duration: Math.max(2, total), lane: 0, params: { mode: 'beats', zoom: 0.18, slide: 0.55 }, description: 'Continuous microwave pulses' },
      ],
      isFallback: true,
    };
  }

  // 5. Text / Title / Deep Glow / Turbulent
  if (p.includes('text') || p.includes('title') || p.includes('glow') || p.includes('turbulent') || p.includes('lyric')) {
    const textWord = prompt.replace(/add|text|title|preset|effect|with|make|create/gi, '').trim() || 'EDITVERSE';
    const hasTurb = p.includes('turbulent') || p.includes('boil') || p.includes('displace');
    return {
      summary: `Generated After Effects ${hasTurb ? 'Turbulent Displace' : 'Deep Glow'} typography`,
      explanation: 'Created high-end typography with staggered per-character motion blur and multi-radius bloom.',
      actions: [
        {
          type: 'add_text',
          text: textWord.toUpperCase(),
          style: hasTurb ? 'turbulent' : 'deepglow',
          font: 'bebas',
          anim: 'editImpact',
          size: 0.16,
          color: '#ffffff',
          glowAmt: 0.95,
          turbAmount: hasTurb ? 36 : 0,
          start: 0.2,
          duration: 2.2,
          description: `AE ${hasTurb ? 'Turbulent' : 'Deep Glow'} title: "${textWord.toUpperCase()}"`,
        },
      ],
      isFallback: true,
    };
  }

  // 6. Generic / Creative Fandom Edit Boost
  return {
    summary: 'Generated custom fandom edit sequence',
    explanation: `Interpreted "${prompt}": applied rhythmic smooth zooms, subtle film grain, letterbox cinema bars, and chromatic punch.`,
    actions: [
      { type: 'add_fx', fxType: 'letterbox', start: 0, duration: Math.max(3, total), lane: 2, params: { size: 0.1 }, description: 'Cinema bars' },
      { type: 'add_fx', fxType: 'smoothZoom', start: 0.1, duration: 0.65, lane: 0, params: { amount: 0.45, dir: 'in', blur: 1.4 }, description: 'Intro Good Zoom' },
      { type: 'add_fx', fxType: 'rgbSplit', start: 0.1, duration: 0.4, lane: 1, params: { amount: 16 }, description: 'Chromatic aberration' },
      { type: 'add_fx', fxType: 'grain', start: 0, duration: Math.max(3, total), lane: 2, params: { amount: 0.2 }, description: 'Film grain texture' },
    ],
    isFallback: true,
  };
}

/**
 * Calls OpenCode Go API with the user's key and natural language description.
 */
export async function callOpenCodeGo(
  prompt: string,
  project: Project,
  cfg: AiConfig,
  onStep?: (msg: string) => void
): Promise<AiPlan> {
  const apiKey = cfg.apiKey.trim();
  if (!apiKey) {
    onStep?.('No API key entered — running with smart built-in AI engine...');
    await new Promise((r) => setTimeout(r, 450));
    return generateLocalAiPlan(prompt, project);
  }

  onStep?.('Connecting to OpenCode Go...');

  const clips = project.clips;
  const layout = layoutClips(clips);
  const total = totalDuration(clips);

  const contextData = {
    totalDuration: Number(total.toFixed(2)),
    fps: project.fps,
    aspect: project.aspect,
    clips: layout.map((l) => ({
      index: l.index + 1,
      start: Number(l.start.toFixed(2)),
      end: Number(l.end.toFixed(2)),
      duration: Number((l.end - l.start).toFixed(2)),
      speed: l.clip.speed,
      reverse: l.clip.reverse,
      velocityPreset: l.clip.velocity.preset,
    })),
    beats: project.beats.slice(0, 24).map((b) => Number(b.toFixed(2))),
    existingFxCount: project.fx.length,
  };

  const systemPrompt = `You are an expert Hollywood and TikTok/Reels video editor AI for EDITVERSE, specialized in Spider-Man, anime, and viral fandom edits.
Your job is to read the user's prompt (e.g. "make simple zooms over the edit", "add turbulent displace text saying HERO", "create an explosive beat drop effect") and return a JSON action plan to modify the timeline.

Available effects in EDITVERSE:
- Zooms: 'smoothZoom' (Good Zoom), 'flowZoom' (AE Flow), 'snapZoom', 'crashZoom', 'landZoom', 'heroZoom', 'pulseZoom', 'whipZoom', 'zoomIn', 'zoomOut', 'zoomPunch', 'microwave', 'zoomTrans'
- Transitions: 'zoomTrans', 'spinTrans', 'whipTrans', 'flashTrans', 'blurTrans', 'glitchTrans'
- Motion: 'shake', 'impact', 'wiggle', 'handheld', 'spin', 'bounce'
- Light: 'flash', 'strobe', 'invert', 'glow', 'exposure', 'bw', 'hueShift'
- Glitch & Stylize: 'rgbSplit', 'glitch', 'vhs', 'pixelate', 'verse', 'halftone', 'letterbox', 'grain', 'echo'
- Text: 'text' (options: anim: 'impact'|'blurReveal'|'slam'|'pop'|'fade'|'scramble'|'typewriter'; style: 'deepglow'|'turbulent'|'chrome'|'stamp'; font: 'bebas'|'anton'|'montserrat'|'oswald'|'archivo'|'cinzel')
- Velocity presets: 'classic', 'impact', 'rampUp', 'rampDown', 'double', 'microwave', 'boomerang'
- Color presets: 'tealOrange', 'spidey', 'symbiote', 'noir', 'verse', 'neon', 'golden', 'faded', 'ice', 'blood', 'matrix'

Timeline info:
${JSON.stringify(contextData, null, 2)}

Return ONLY valid JSON with this schema:
{
  "summary": "One sentence summary of what was created",
  "explanation": "Why this edit style fits the request",
  "actions": [
    {
      "type": "add_fx" | "simple_zooms_over_edit" | "apply_velocity" | "add_text" | "color_grade",
      "fxType": "effectName",
      "start": 0.0,
      "duration": 0.6,
      "lane": 0,
      "params": { ... },
      "intensity": 1.0,
      "description": "Readable description"
    }
  ]
}
Do NOT include any markdown code fences or conversational text outside the JSON.`;

  const baseUrl = cfg.endpoint.replace(/\/+$/, '');
  const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;

  const payload = {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 1200,
  };

  const body = JSON.stringify(payload);
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'x-opencode-session': 'editverse-ai-director',
  };

  onStep?.(`Sending request to ${cfg.model}…`);

  // opencode.ai does not send CORS headers, so a direct browser fetch is blocked.
  // Try the direct call first (works if the endpoint ever enables CORS), then a
  // chain of public CORS relays. Each relay forwards method + body + auth header.
  const attempts: { label: string; url: string; headers: Record<string, string> }[] = [
    { label: 'direct connection', url, headers: baseHeaders },
  ];
  if (cfg.corsProxy) {
    attempts.push(
      { label: 'corsproxy.io', url: `https://corsproxy.io/?url=${encodeURIComponent(url)}`, headers: baseHeaders },
      { label: 'proxy.cors.sh', url: `https://proxy.cors.sh/${url}`, headers: { ...baseHeaders, 'x-cors-api-key': 'temp_' + Date.now() } },
      { label: 'api.allorigins.win', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, headers: baseHeaders },
      { label: 'thingproxy', url: `https://thingproxy.freeboard.io/fetch/${url}`, headers: baseHeaders },
      { label: 'cors-anywhere', url: `https://cors-anywhere.herokuapp.com/${url}`, headers: baseHeaders }
    );
  }

  let responseText = '';
  const failures: string[] = [];
  let succeeded = false;

  for (const attempt of attempts) {
    try {
      onStep?.(`Connecting via ${attempt.label}…`);
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: attempt.headers,
        body,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const short = errBody.slice(0, 200);
        failures.push(`${attempt.label}: HTTP ${res.status} ${short || res.statusText}`);
        // 401/403 = bad key, 404 = wrong model. Retrying other relays won't help.
        if (res.status === 401 || res.status === 403) break;
        continue;
      }

      const raw = await res.text();
      if (!raw) {
        failures.push(`${attempt.label}: empty response`);
        continue;
      }

      let data: { choices?: { message?: { content?: string } }[] } | null = null;
      try {
        data = JSON.parse(raw);
      } catch {
        failures.push(`${attempt.label}: non-JSON response`);
        continue;
      }

      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        failures.push(`${attempt.label}: model returned no content`);
        continue;
      }

      responseText = content;
      succeeded = true;
      break;
    } catch (err) {
      failures.push(`${attempt.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!succeeded) {
    const detail = failures.join(' · ');
    console.warn('OpenCode Go request failed on all routes:', detail);
    const local = generateLocalAiPlan(prompt, project);
    local.explanation += `\n\n⚠️ Live model unreachable: ${detail}`;
    local.summary += ' (offline director)';
    onStep?.('Live model unreachable — used offline director');
    await new Promise((r) => setTimeout(r, 300));
    return local;
  }

  onStep?.('Parsing creative edit plan…');

  try {
    const cleaned = responseText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.actions) && parsed.actions.length) {
      return {
        summary: parsed.summary || 'AI Edit Plan',
        explanation: parsed.explanation || '',
        actions: parsed.actions,
      };
    }
  } catch (parseErr) {
    console.warn('Failed to parse AI response as JSON:', responseText, parseErr);
    // The model answered but not in JSON — keep its text as the explanation.
    const local = generateLocalAiPlan(prompt, project);
    local.explanation = `The model replied but not as JSON, so the offline director built the edit. Model said: "${responseText.slice(0, 240)}"`;
    return local;
  }

  return generateLocalAiPlan(prompt, project);
}

/* ------------------------------------------------------------------ */
/* Connection diagnostics                                              */
/* ------------------------------------------------------------------ */

export interface ConnectionReport {
  ok: boolean;
  report: string;
}

/**
 * Probes the configured endpoint + key + model through every available route
 * and reports exactly which step failed. Purely diagnostic, never throws.
 */
export async function testConnection(cfg: AiConfig): Promise<ConnectionReport> {
  const lines: string[] = [];
  const apiKey = cfg.apiKey.trim();

  if (!apiKey) {
    return { ok: false, report: 'No API key entered. Paste your OpenCode Go key (starts with "sk-").\nGet one at opencode.ai/auth (Go subscription required).' };
  }
  if (!/^sk-/.test(apiKey)) {
    lines.push('⚠️ Key does not start with "sk-" — double-check you copied the whole key.');
  }
  lines.push(`Endpoint: ${cfg.endpoint}`);
  lines.push(`Model: ${cfg.model}`);
  lines.push('');

  const base = cfg.endpoint.replace(/\/+$/, '');
  const chatUrl = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;

  const body = JSON.stringify({
    model: cfg.model,
    messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
    max_tokens: 8,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'x-opencode-session': 'editverse-ai-director',
  };

  const routes: { label: string; url: string; headers: Record<string, string> }[] = [
    { label: 'Direct', url: chatUrl, headers },
  ];
  if (cfg.corsProxy) {
    routes.push(
      { label: 'corsproxy.io', url: `https://corsproxy.io/?url=${encodeURIComponent(chatUrl)}`, headers },
      { label: 'proxy.cors.sh', url: `https://proxy.cors.sh/${chatUrl}`, headers: { ...headers, 'x-cors-api-key': 'temp_' + Date.now() } },
      { label: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(chatUrl)}`, headers },
      { label: 'thingproxy', url: `https://thingproxy.freeboard.io/fetch/${chatUrl}`, headers },
      { label: 'cors-anywhere', url: `https://cors-anywhere.herokuapp.com/${chatUrl}`, headers }
    );
  }

  let anyOk = false;

  for (const route of routes) {
    try {
      const res = await fetch(route.url, { method: 'POST', headers: route.headers, body });
      if (!res.ok) {
        const txt = (await res.text().catch(() => '')).slice(0, 160);
        if (res.status === 401 || res.status === 403) {
          lines.push(`✗ ${route.label}: HTTP ${res.status} — key rejected or no Go subscription.`);
          lines.push(`  ${txt}`);
          return { ok: false, report: lines.join('\n') };
        }
        if (res.status === 404) {
          lines.push(`✗ ${route.label}: HTTP 404 — model id "${cfg.model}" or endpoint not found.`);
          lines.push(`  ${txt}`);
          return { ok: false, report: lines.join('\n') };
        }
        lines.push(`✗ ${route.label}: HTTP ${res.status} ${txt || res.statusText}`);
        continue;
      }
      const raw = await res.text();
      let content = '';
      try {
        content = (JSON.parse(raw) as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? '';
      } catch {
        lines.push(`✗ ${route.label}: returned non-JSON (relay may be down)`);
        continue;
      }
      lines.push(`✓ ${route.label}: reachable — model replied "${content.trim().slice(0, 40)}"`);
      anyOk = true;
      break;
    } catch (err) {
      lines.push(`✗ ${route.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  lines.push('');
  if (anyOk) {
    lines.push('Everything works. Close this panel and generate your edit.');
  } else {
    lines.push('All routes blocked. Causes in order of likelihood:');
    lines.push('1. opencode.ai sends no CORS headers, so a browser cannot call it directly — the public relays above are the workaround, and they are often rate-limited or down.');
    lines.push('2. Your key needs an active Go subscription (a plain Zen key is not enough).');
    lines.push('3. The model id must be an exact /chat/completions model, e.g. glm-5.3-flash, kimi-k2.7-code, deepseek-v4-flash.');
    lines.push('');
    lines.push('Reliable option: run a tiny local proxy that adds CORS headers, e.g.');
    lines.push('  npx cors-anywhere --host 127.0.0.1 --port 8080');
    lines.push('then set the endpoint to http://127.0.0.1:8080/https://opencode.ai/zen/go/v1');
    lines.push('');
    lines.push('Meanwhile the offline director still builds every edit for you.');
  }

  return { ok: anyOk, report: lines.join('\n') };
}

/**
 * Applies the generated AI plan to the project.
 */
export function applyAiPlan(plan: AiPlan, p: Project): Project {
  let project = { ...p };
  const layout = layoutClips(project.clips);

  for (const action of plan.actions) {
    switch (action.type) {
      case 'add_fx': {
        if (!action.fxType || !FX_DEFS[action.fxType]) break;
        const dur = action.duration ?? FX_DEFS[action.fxType].dur;
        const st = Math.max(0, action.start ?? 0);
        const lane = action.lane ?? freeLane(project.fx, st, dur, 0);
        const item = makeFx(action.fxType, st, dur, lane, action.params, action.intensity ?? 1);
        project = { ...project, fx: [...project.fx, item] };
        break;
      }

      case 'simple_zooms_over_edit': {
        const zType = action.zoomType || 'smoothZoom';
        const newFx: FxItem[] = [...project.fx];
        layout.forEach((l, i) => {
          const dur = Math.max(0.35, Math.min(l.end - l.start, 0.65));
          const dir = i % 2 === 0 ? 'in' : 'out';
          const item = makeFx(
            zType,
            l.start,
            dur,
            freeLane(newFx, l.start, dur, 0),
            { dir, amount: action.zoomAmount ?? 0.35, blur: action.zoomBlur ?? 1.3 },
            1
          );
          newFx.push(item);
        });
        project = { ...project, fx: newFx };
        break;
      }

      case 'apply_velocity': {
        if (!action.velocityPreset) break;
        const preset = action.velocityPreset;
        const intensity = action.velocityIntensity ?? 0.75;
        const center = preset === 'microwave' ? 0.7 : 0.5;
        project = {
          ...project,
          clips: project.clips.map((c) => ({
            ...c,
            velocity: { preset, intensity, center },
          })),
        };
        break;
      }

      case 'add_text': {
        const txt = action.text || 'TITLE';
        const dur = action.duration ?? 2.0;
        const st = action.start ?? 0.2;
        const item = makeFx(
          'text',
          st,
          dur,
          freeLane(project.fx, st, dur, 2),
          {
            text: txt,
            style: action.style || 'deepglow',
            font: action.font || 'bebas',
            anim: action.anim || 'impact',
            size: action.size || 0.16,
            color: action.color || '#ffffff',
            glowAmt: action.glowAmt ?? 0.9,
            turbAmount: action.turbAmount ?? 0,
            camera: true,
          },
          1
        );
        project = { ...project, fx: [...project.fx, item] };
        break;
      }

      case 'color_grade': {
        if (!action.colorPreset) break;
        project = {
          ...project,
          clips: project.clips.map((c) => ({
            ...c,
            color: colorFromPreset(action.colorPreset!),
          })),
        };
        break;
      }

      case 'clear_fx': {
        project = { ...project, fx: [] };
        break;
      }
    }
  }

  return project;
}
