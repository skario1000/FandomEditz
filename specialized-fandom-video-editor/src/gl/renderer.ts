import type { FrameDesc } from '../lib/compose';
import { clamp } from '../lib/utils';

const VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

const FS_BLEND = `${HEAD}
uniform sampler2D uTex;
uniform float uAlpha;
void main() { o = vec4(texture(uTex, vUv).rgb, uAlpha); }`;

const FS_SCENE = `${HEAD}
uniform sampler2D uSrc;
uniform int uHasSrc;
uniform vec2 uOut;
uniform mat3 uM1;
uniform mat3 uM0;
uniform float uShutter;
uniform int uSamples;
uniform float uRadial;
uniform vec2 uRadialC;
uniform vec2 uRgb;
uniform int uMirror;
uniform float uLens;
uniform vec2 uLensC;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uHue;
uniform float uTemp;
uniform float uTint;
uniform float uFade;
uniform float uBW;
uniform float uSplit;
uniform vec3 uShadow;
uniform vec3 uHigh;

vec3 samp(vec2 uv) {
  if (uMirror == 1) {
    uv = 1.0 - abs(1.0 - mod(uv, 2.0));
  } else if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return vec3(0.0);
  }
  return texture(uSrc, uv).rgb;
}
vec3 hueRot(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
vec3 grade(vec3 c) {
  c *= exp2(uExposure);
  c *= vec3(1.0 + 0.22 * uTemp, 1.0 - 0.18 * uTint, 1.0 - 0.22 * uTemp);
  c = (c - 0.5) * (1.0 + uContrast) + 0.5;
  float l = dot(c, LW);
  c = mix(vec3(l), c, 1.0 + uSaturation);
  if (abs(uHue) > 0.0005) c = hueRot(c, uHue);
  c = max(c, vec3(0.0));
  l = clamp(dot(c, LW), 0.0, 1.0);
  if (uSplit > 0.001) {
    vec3 sh = uShadow - vec3(dot(uShadow, LW));
    vec3 hi = uHigh - vec3(dot(uHigh, LW));
    c += (sh * (1.0 - l) * (1.0 - l) + hi * l * l) * uSplit * 1.5;
  }
  if (uFade > 0.001) {
    c = mix(c, c * 0.82 + 0.12, uFade);
  }
  if (uBW > 0.001) {
    c = mix(c, vec3(dot(c, LW)), clamp(uBW, 0.0, 1.0));
  }
  return clamp(c, 0.0, 1.0);
}
vec2 lensWarp(vec2 p) {
  // AE Optics Compensation (Reverse Lens Distortion): pushes pixels outward
  // proportionally to the squared distance from the centre, so the frame bows
  // like a wide-angle lens instead of just scaling.
  if (uLens <= 0.0005) return p;
  vec2 d = p - uLensC;
  float r2 = dot(d, d);
  return uLensC + d * (1.0 + uLens * r2);
}
void main() {
  if (uHasSrc == 0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 p = lensWarp(vec2(vUv.x, 1.0 - vUv.y) * uOut);
  int n = max(uSamples, 1);
  float fn = float(n);
  vec2 du = mat2(uM1) * uRgb;
  bool rgb = abs(uRgb.x) + abs(uRgb.y) > 0.01;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 32; i++) {
    if (i >= n) break;
    float f = n > 1 ? float(i) / (fn - 1.0) : 0.0;
    vec2 q = uRadialC + (p - uRadialC) * (1.0 - uRadial * f);
    vec2 a = (uM1 * vec3(q, 1.0)).xy;
    vec2 b = (uM0 * vec3(q, 1.0)).xy;
    vec2 suv = mix(a, b, f * uShutter);
    if (rgb) acc += vec3(samp(suv + du).r, samp(suv).g, samp(suv - du).b);
    else acc += samp(suv);
  }
  o = vec4(grade(acc / fn), 1.0);
}`;

const FS_BLUR = `${HEAD}
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.2270270270;
  c += texture(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  o = vec4(c, 1.0);
}`;

const FS_FINAL = `${HEAD}
uniform sampler2D uScene;
uniform sampler2D uBlur;
uniform sampler2D uPrev;
uniform vec2 uSize;
uniform float uTime;
uniform float uBlurAmt;
uniform float uGlow;
uniform float uGlowT;
uniform float uVig;
uniform float uGrain;
uniform float uGlitch;
uniform float uPix;
uniform float uHalf;
uniform float uHalfSize;
uniform float uPost;
uniform float uEdges;
uniform float uScan;
uniform float uMirrorFx;
uniform float uEcho;
uniform int uHasPrev;

void main() {
  vec2 uv = vUv;
  if (uMirrorFx > 0.5) uv.x = 0.5 - abs(uv.x - 0.5);
  float gt = floor(uTime * 16.0);
  if (uGlitch > 0.0) {
    float band = floor(uv.y * 20.0 + hash(vec2(gt, 1.7)) * 4.0);
    float r = hash(vec2(band, gt));
    if (r < uGlitch * 0.55) uv.x += (hash(vec2(band, gt + 3.1)) - 0.5) * 0.3 * uGlitch;
    float blk = hash(vec2(floor(uv.y * 6.0), gt + 9.0));
    if (blk < uGlitch * 0.15) uv.y += (hash(vec2(gt, 5.0)) - 0.5) * 0.05;
  }
  if (uPix > 1.0) {
    vec2 cells = uSize / uPix;
    uv = (floor(uv * cells) + 0.5) / cells;
  }
  vec3 col = texture(uScene, uv).rgb;
  if (uGlitch > 0.0) {
    float off = (hash(vec2(gt, 2.3)) - 0.5) * 0.04 * uGlitch;
    col.r = texture(uScene, uv + vec2(off, 0.0)).r;
    col.b = texture(uScene, uv - vec2(off, 0.0)).b;
  }
  vec3 bl = texture(uBlur, uv).rgb;
  if (uBlurAmt > 0.0) col = mix(col, bl, clamp(uBlurAmt, 0.0, 1.0));
  if (uEdges > 0.0) {
    vec2 px = max(1.0, uSize.y / 720.0) / uSize;
    float tl = dot(texture(uScene, uv + px * vec2(-1.0, 1.0)).rgb, LW);
    float tc = dot(texture(uScene, uv + px * vec2(0.0, 1.0)).rgb, LW);
    float tr = dot(texture(uScene, uv + px * vec2(1.0, 1.0)).rgb, LW);
    float ml = dot(texture(uScene, uv + px * vec2(-1.0, 0.0)).rgb, LW);
    float mr = dot(texture(uScene, uv + px * vec2(1.0, 0.0)).rgb, LW);
    float bl2 = dot(texture(uScene, uv + px * vec2(-1.0, -1.0)).rgb, LW);
    float bc = dot(texture(uScene, uv + px * vec2(0.0, -1.0)).rgb, LW);
    float br = dot(texture(uScene, uv + px * vec2(1.0, -1.0)).rgb, LW);
    float gx = -tl - 2.0 * ml - bl2 + tr + 2.0 * mr + br;
    float gy = -tl - 2.0 * tc - tr + bl2 + 2.0 * bc + br;
    float e = smoothstep(0.18, 0.55, length(vec2(gx, gy)));
    col *= 1.0 - e * clamp(uEdges, 0.0, 1.0);
  }
  if (uPost > 1.5) col = floor(col * uPost + 0.5) / uPost;
  if (uHalf > 0.0) {
    float sz = uHalfSize;
    vec2 pp = uv * uSize;
    const float ang = 0.7853981;
    mat2 R = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
    vec2 rp = R * pp;
    vec2 cell = (floor(rp / sz) + 0.5) * sz;
    vec2 cuv = (transpose(R) * cell) / uSize;
    float lum = dot(texture(uScene, cuv).rgb, LW);
    float rad = sz * 0.62 * sqrt(clamp(1.0 - lum, 0.0, 1.0));
    float d = length(rp - cell);
    float m = 1.0 - smoothstep(rad - 1.0, rad + 1.0, d);
    vec3 ht = mix(col * 1.1 + 0.03, col * 0.25, m);
    col = mix(col, ht, clamp(uHalf, 0.0, 1.0));
  }
  if (uGlow > 0.0) {
    vec3 g = max(bl - uGlowT, 0.0) / max(1.0 - uGlowT, 0.05);
    col = 1.0 - (1.0 - col) * (1.0 - clamp(g * uGlow, 0.0, 1.0));
  }
  if (uScan > 0.0) {
    float s = 0.5 + 0.5 * sin(vUv.y * uSize.y * 1.5708);
    col *= 1.0 - clamp(uScan, 0.0, 1.0) * 0.35 * s;
  }
  if (uVig > 0.0) {
    vec2 ar = vec2(uSize.x / uSize.y, 1.0);
    float v = length((vUv - 0.5) * ar) / length(ar * 0.5);
    col *= 1.0 - clamp(uVig, 0.0, 1.0) * smoothstep(0.3, 1.05, v);
  }
  if (uGrain > 0.0) {
    float n = hash(vUv * uSize + fract(uTime * 7.13) * 311.0) - 0.5;
    col += n * uGrain * 0.28;
  }
  if (uEcho > 0.0 && uHasPrev == 1) col = mix(col, texture(uPrev, vUv).rgb, clamp(uEcho, 0.0, 0.97));
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FS_OUT = `${HEAD}
uniform sampler2D uFinal;
uniform sampler2D uOverlay;
uniform int uHasOverlay;
uniform float uInvert;
uniform vec4 uFlash;
uniform float uLetterbox;
void main() {
  vec3 col = texture(uFinal, vUv).rgb;
  col = mix(col, 1.0 - col, clamp(uInvert, 0.0, 1.0));
  col = mix(col, uFlash.rgb, clamp(uFlash.a, 0.0, 1.0));
  if (uHasOverlay == 1) {
    vec4 ov = texture(uOverlay, vec2(vUv.x, 1.0 - vUv.y));
    col = ov.rgb + col * (1.0 - ov.a);
  }
  if (vUv.y < uLetterbox || vUv.y > 1.0 - uLetterbox) col = vec3(0.0);
  o = vec4(col, 1.0);
}`;

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}
export interface RenderOpts {
  useAccum: boolean;
  hasSource: boolean;
  time: number;
  overlay: boolean;
}

export class Renderer {
  gl: WebGL2RenderingContext;
  W = 0;
  H = 0;
  private progs: Record<'blend' | 'scene' | 'blur' | 'final' | 'out', Prog>;
  private vao: WebGLVertexArrayObject;
  private texA: WebGLTexture;
  private texB: WebGLTexture;
  private texOv: WebGLTexture;
  private sizeA: [number, number] = [1, 1];
  private sizeB: [number, number] = [1, 1];
  /** Last successfully uploaded frame, used to avoid black frames while a video buffers. */
  private hold: Target | null = null;
  private hasHold = false;
  private accum: Target | null = null;
  private scene: Target | null = null;
  private blurA: Target | null = null;
  private blurB: Target | null = null;
  private fin: [Target, Target] | null = null;
  private cur = 0;
  private hasPrev = false;

  constructor(public canvas: HTMLCanvasElement, preserve = false) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: preserve,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.progs = {
      blend: this.prog(FS_BLEND),
      scene: this.prog(FS_SCENE),
      blur: this.prog(FS_BLUR),
      final: this.prog(FS_FINAL),
      out: this.prog(FS_OUT),
    };
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.texA = this.tex();
    this.texB = this.tex();
    this.texOv = this.tex();
    this.resize(canvas.width || 2, canvas.height || 2);
  }

  private prog(fs: string): Prog {
    const gl = this.gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader error: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
    const u: Record<string, WebGLUniformLocation | null> = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      if (info) u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  private tex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return t;
  }

  private target(w: number, h: number, old?: Target | null): Target {
    const gl = this.gl;
    if (old && old.w === w && old.h === h) return old;
    if (old) {
      gl.deleteTexture(old.tex);
      gl.deleteFramebuffer(old.fb);
    }
    const tex = this.tex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  resize(W: number, H: number) {
    W = Math.max(2, Math.round(W));
    H = Math.max(2, Math.round(H));
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    if (W === this.W && H === this.H && this.scene) return;
    this.W = W;
    this.H = H;
    this.scene = this.target(W, H, this.scene);
    const bw = Math.max(2, Math.round(W / 4));
    const bh = Math.max(2, Math.round(H / 4));
    this.blurA = this.target(bw, bh, this.blurA);
    this.blurB = this.target(bw, bh, this.blurB);
    this.fin = [this.target(W, H, this.fin?.[0]), this.target(W, H, this.fin?.[1])];
    this.hasPrev = false;
  }

  upload(which: 'A' | 'B', src: TexImageSource, w: number, h: number): boolean {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, which === 'A' ? this.texA : this.texB);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch {
      return false;
    }
    if (which === 'A') {
      this.sizeA = [w || 1, h || 1];
      // Remember the last good frame so a buffering player freezes instead of going black.
      if (src instanceof HTMLVideoElement) {
        const v = src;
        // readyState HAVE_CURRENT_DATA(2) is the minimum for a decodable picture.
        if (v.readyState >= 2 && v.videoWidth > 0 && !v.seeking) this.captureHold();
      } else {
        this.captureHold();
      }
    } else this.sizeB = [w || 1, h || 1];
    return true;
  }

  /** Copies the current A texture into the hold buffer (cheap single GPU blit). */
  private captureHold() {
    const [w, h] = this.sizeA;
    if (!w || !h || w < 2 || h < 2) return;
    const gl = this.gl;
    this.hold = this.target(w, h, this.hold);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hold.fb);
    gl.viewport(0, 0, this.hold.w, this.hold.h);
    const pr = this.progs.blend;
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    this.i1(pr, 'uTex', 0);
    this.f1(pr, 'uAlpha', 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.hasHold = true;
  }

  /** True if a previously captured frame can be shown while the source buffers. */
  get canHold(): boolean {
    return this.hasHold && !!this.hold;
  }

  /** Dimensions of the held frame, so callers can build a matching transform. */
  get holdSize(): [number, number] {
    return this.hasHold && this.hold ? [this.hold.w, this.hold.h] : [0, 0];
  }

  uploadOverlay(src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texOv);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  /** Twixtor-style frame blending into an accumulation buffer (source space). */
  accumulate(which: 'A' | 'B', alpha: number, reset: boolean) {
    const gl = this.gl;
    let [w, h] = which === 'A' ? this.sizeA : this.sizeB;
    const m = Math.max(w, h);
    if (m > 2048) {
      w = Math.round((w * 2048) / m);
      h = Math.round((h * 2048) / m);
    }
    const prev = this.accum;
    this.accum = this.target(Math.max(2, w), Math.max(2, h), this.accum);
    if (this.accum !== prev) reset = true;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accum.fb);
    gl.viewport(0, 0, this.accum.w, this.accum.h);
    const pr = this.progs.blend;
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, which === 'A' ? this.texA : this.texB);
    this.i1(pr, 'uTex', 0);
    this.f1(pr, 'uAlpha', reset ? 1 : clamp(alpha, 0, 1));
    if (!reset) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  resetHistory() {
    this.hasPrev = false;
  }

  render(d: FrameDesc, o: RenderOpts) {
    const gl = this.gl;
    const { W, H } = this;
    const fx = d.fx;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    // 1) scene: transform + motion/zoom blur + RGB split + grade
    let pr = this.progs.scene;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene!.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0);
    // When the live source is not ready (player still buffering after a cut or scrub),
    // show the last good frame rather than filling the canvas with black.
    const holding = !o.hasSource && this.hasHold && this.hold;
    gl.bindTexture(gl.TEXTURE_2D, o.useAccum && this.accum ? this.accum.tex : holding ? this.hold!.tex : this.texA);
    this.i1(pr, 'uSrc', 0);
    this.i1(pr, 'uHasSrc', o.hasSource || holding ? 1 : 0);
    this.f2(pr, 'uOut', W, H);
    this.m3(pr, 'uM1', d.M1);
    this.m3(pr, 'uM0', d.M0);
    this.f1(pr, 'uShutter', d.shutter);
    this.i1(pr, 'uSamples', d.samples);
    this.f1(pr, 'uRadial', clamp(fx.radialBlur, 0, 0.6));
    this.f2(pr, 'uRadialC', d.radialPx[0], d.radialPx[1]);
    const rgb = (fx.rgbSplit * H) / 1080;
    this.f2(pr, 'uRgb', Math.cos(fx.rgbAngle) * rgb, Math.sin(fx.rgbAngle) * rgb);
    this.i1(pr, 'uMirror', d.mirrorEdges ? 1 : 0);
    this.f1(pr, 'uLens', clamp(fx.lens, 0, 0.9));
    this.f2(pr, 'uLensC', fx.lensCx * W, fx.lensCy * H);
    const c = d.color;
    this.f1(pr, 'uExposure', c.exposure);
    this.f1(pr, 'uContrast', c.contrast);
    this.f1(pr, 'uSaturation', c.saturation);
    this.f1(pr, 'uHue', c.hue);
    this.f1(pr, 'uTemp', c.temp);
    this.f1(pr, 'uTint', c.tint);
    this.f1(pr, 'uFade', c.fade);
    this.f1(pr, 'uBW', c.bw);
    this.f1(pr, 'uSplit', c.split);
    this.f3(pr, 'uShadow', c.shadow);
    this.f3(pr, 'uHigh', c.high);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2) blur chain (quarter res) for blur + glow
    const needBlur = fx.blur > 0.001 || fx.glow > 0.001;
    if (needBlur) {
      pr = this.progs.blur;
      gl.useProgram(pr.p);
      this.i1(pr, 'uTex', 0);
      const bA = this.blurA!;
      const bB = this.blurB!;
      const R = Math.max(1, (fx.blurRadius * H) / 4);
      const step = R / 3.2307692308;
      const pass = (src: WebGLTexture, dst: Target, dx: number, dy: number) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src);
        this.f2(pr, 'uDir', dx / dst.w, dy / dst.h);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };
      pass(this.scene!.tex, bA, step, 0);
      pass(bA.tex, bB, 0, step);
      pass(bB.tex, bA, step * 0.6, 0);
      pass(bA.tex, bB, 0, step * 0.6);
    }

    // 3) stylize + echo
    const fin = this.fin!;
    const dst = fin[this.cur];
    const prev = fin[1 - this.cur];
    pr = this.progs.final;
    gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene!.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, needBlur ? this.blurB!.tex : this.scene!.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    this.i1(pr, 'uScene', 0);
    this.i1(pr, 'uBlur', 1);
    this.i1(pr, 'uPrev', 2);
    this.f2(pr, 'uSize', W, H);
    this.f1(pr, 'uTime', o.time);
    this.f1(pr, 'uBlurAmt', needBlur ? fx.blur : 0);
    this.f1(pr, 'uGlow', needBlur ? fx.glow : 0);
    this.f1(pr, 'uGlowT', fx.glowThreshold);
    this.f1(pr, 'uVig', fx.vignette);
    this.f1(pr, 'uGrain', fx.grain);
    this.f1(pr, 'uGlitch', clamp(fx.glitch, 0, 1.5));
    this.f1(pr, 'uPix', (fx.pixelate * H) / 1080);
    this.f1(pr, 'uHalf', fx.halftone);
    this.f1(pr, 'uHalfSize', Math.max(2, (fx.halftoneSize * H) / 1080));
    this.f1(pr, 'uPost', fx.posterize);
    this.f1(pr, 'uEdges', fx.edges);
    this.f1(pr, 'uScan', fx.scanlines);
    this.f1(pr, 'uMirrorFx', fx.mirror);
    this.f1(pr, 'uEcho', fx.echo);
    this.i1(pr, 'uHasPrev', this.hasPrev ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 4) output: invert, flash, text overlay, letterbox
    pr = this.progs.out;
    gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texOv);
    this.i1(pr, 'uFinal', 0);
    this.i1(pr, 'uOverlay', 1);
    this.i1(pr, 'uHasOverlay', o.overlay ? 1 : 0);
    this.f1(pr, 'uInvert', fx.invert);
    this.f4(pr, 'uFlash', fx.flash);
    this.f1(pr, 'uLetterbox', fx.letterbox);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    this.cur = 1 - this.cur;
    this.hasPrev = true;
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private f1(p: Prog, n: string, v: number) {
    const l = p.u[n];
    if (l) this.gl.uniform1f(l, v);
  }
  private i1(p: Prog, n: string, v: number) {
    const l = p.u[n];
    if (l) this.gl.uniform1i(l, v);
  }
  private f2(p: Prog, n: string, a: number, b: number) {
    const l = p.u[n];
    if (l) this.gl.uniform2f(l, a, b);
  }
  private f3(p: Prog, n: string, v: [number, number, number]) {
    const l = p.u[n];
    if (l) this.gl.uniform3f(l, v[0], v[1], v[2]);
  }
  private f4(p: Prog, n: string, v: [number, number, number, number]) {
    const l = p.u[n];
    if (l) this.gl.uniform4f(l, v[0], v[1], v[2], v[3]);
  }
  private m3(p: Prog, n: string, m: Float32Array) {
    const l = p.u[n];
    if (l) this.gl.uniformMatrix3fv(l, false, m);
  }
}
