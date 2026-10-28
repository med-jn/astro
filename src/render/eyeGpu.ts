import type { Projector } from '../core/camera';

/**
 * خلفية «عين الراصد» على كرت الشاشة (WebGL2): تمرّر السماء ثم الأرض والتلال بدقة الشاشة الكاملة وبسرعة الإطار.
 * الأرض والتلال حسابية في المظلّل نفسه (لا نسيج صور): مروج بنباتها وبقعها اليابسة وأزهارها وتربتها وحصاها،
 * مع تفاصيل تتلاشى بحسب حجم البكسل على الأرض فلا يظهر وميض ولا تضبيب.
 * تعتمد القيم (التعريض، الإضاءة، نسيج السماء) على eyeBackground ليبقى المسار الحاسوبي (CPU) بديلاً متطابق الإضاءة.
 */
export interface GpuLight {
  exposure: number;
  sunDir: number[]; sunE: number[]; moonDir: number[]; moonE: number[]; diffuse: number[];
}
export interface GpuFrame {
  P: Projector;
  dpr: number;
  eyeH: number;
  plate: { e: number; n: number; r: number };
  ground: boolean;
  light: GpuLight;
}
export interface GpuBackground {
  /** يرسم السماء على ctx (إحداثيات CSS) */
  drawSky(ctx: CanvasRenderingContext2D, f: GpuFrame): void;
  /** يرسم الأرض والتلال (ألفا) فوق ما سبق */
  drawGround(ctx: CanvasRenderingContext2D, f: GpuFrame): void;
  setSkyTexture(data: Uint8ClampedArray, w: number, h: number): void;
  lost(): boolean;
  /** يزيد عند اكتمال تحميل الأنسجة (ليعيد المشغّل الرسم) */
  ready(): number;
}

const VERT = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec2 uSize;   // frame size in CSS px
uniform vec2 uRes;    // canvas size in device px
uniform vec3 uRight, uUp, uFwd;
uniform float uF;
uniform int uKind;    // 0 stereographic, 1 perspective, 2 equidistant
uniform sampler2D uSky;
out vec4 outColor;
const float AZN = 720.0, ELN = 96.0, RAD = 57.29577951308232, DEG = 0.017453292519943295;

vec3 unprojectDir(vec2 frag) {
  float X = frag.x - uSize.x * 0.5, Y = uSize.y * 0.5 - frag.y;
  float x, y, z;
  float r = length(vec2(X, Y));
  vec2 dxy = r > 1e-9 ? vec2(X, Y) / r : vec2(0.0);
  if (uKind == 0) { float t = r / (2.0 * uF); float den = 1.0 + t * t; float s = 2.0 * t / den; z = (1.0 - t * t) / den; x = dxy.x * s; y = dxy.y * s; }
  else if (uKind == 1) { vec3 v = normalize(vec3(X / uF, Y / uF, 1.0)); x = v.x; y = v.y; z = v.z; }
  else { float th = r / uF; float s = sin(th); z = cos(th); x = dxy.x * s; y = dxy.y * s; }
  return uRight * x + uUp * y + uFwd * z;
}
vec2 fragCss() { return vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * (uSize / uRes); }
vec3 skyAt(float e, float azDeg) {
  float te = sqrt(max(e, 0.0) / 90.0) * (ELN - 1.0);
  return texture(uSky, vec2((azDeg / 360.0 * AZN + 0.5) / AZN, (te + 0.5) / ELN)).rgb;
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

const SKY_FRAG = COMMON + `
uniform float uDimBelow;
void main() {
  vec3 d = unprojectDir(fragCss());
  float u = d.z;
  float az = atan(d.x, d.y) * RAD;
  float e = u > 0.0 ? asin(min(u, 1.0)) * RAD : 0.0;
  vec3 c = skyAt(e, az) * (u < 0.0 ? uDimBelow : 1.0);
  c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0; // dither: removes gradient banding
  outColor = vec4(c, 1.0);
}`;

const GROUND_FRAG = COMMON + `
uniform sampler2D uNz;
uniform sampler2D uGrassA, uGrassN; // meadow albedo (sRGB->linear in hardware) and tangent-space normal
uniform float uTexReady;
uniform float uExposure, uEyeH, uPxRad;
uniform vec3 uPlate;   // e, n, r
uniform vec3 uSunDir, uSunE, uMoonDir, uMoonE, uDiffuse;

float nzv(vec2 p) {
  vec2 ip = floor(p); vec2 f = p - ip; vec2 s = f * f * (3.0 - 2.0 * f);
  ivec2 i0 = ivec2(ip) & 255; ivec2 i1 = (i0 + 1) & 255;
  float a = texelFetch(uNz, i0, 0).r, b = texelFetch(uNz, ivec2(i1.x, i0.y), 0).r;
  float c = texelFetch(uNz, ivec2(i0.x, i1.y), 0).r, d = texelFetch(uNz, i1, 0).r;
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}
float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5, f = 1.0, n = 0.0;
  for (int i = 0; i < 4; i++) { if (i >= oct) break; s += a * nzv(p * f + vec2(float(i) * 17.3, float(i) * 9.1)); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
vec3 aces(vec3 x) { return max((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0); }
vec3 oetf(vec3 v) { v = clamp(v, 0.0, 1.0); return mix(12.92 * v, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v)); }
vec3 camera(vec3 L, float sat) {
  vec3 c = L * uExposure;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(vec3(0.0), y + (c - y) * sat);
  float pk = max(c.r, max(c.g, c.b));
  if (pk > 0.35) c *= (0.35 + (pk - 0.35) / (1.0 + (pk - 0.35) * 0.9)) / pk;
  float sc = 1.0 - smoothstep(0.0004, 0.025, y);
  if (sc > 0.0) { float yy = y * 1.15; c += (vec3(yy * 0.86, yy * 0.96, yy * 1.16) - c) * sc; }
  c = aces(c);
  float wh = smoothstep(0.5, 1.0, max(c.r, max(c.g, c.b))) * 0.65;
  c += (vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))) - c) * wh; // highlights roll to white (no lemon-yellow horizon)
  return oetf(c);
}
vec3 irradiate(vec3 rho, vec3 n, float k) {
  float cs = max(0.0, dot(n, uSunDir)), cm = max(0.0, dot(n, uMoonDir));
  float sky = 0.55 + 0.45 * n.z;
  return k * rho * (uSunE * cs + uMoonE * cm + uDiffuse * sky) / 3.141592653589793;
}
vec2 groundPt(vec2 frag) { vec3 dd = unprojectDir(frag); float uu = min(dd.z, -3e-3); return (uEyeH / -uu) * dd.xy; }
float detailFade(float freq, float fp) { return 1.0 - smoothstep(0.3, 1.15, freq * fp); }

// angular ridge heights (deg): far range, and a nearer one with a treeline and crowns
void ridges(float az, out float farH, out float nearH) {
  farH = 0.25 + 1.5 * pow(fbm(vec2(az * 0.09, 3.1), 4), 1.35);
  float nearBase = 0.05 + 0.5 * fbm(vec2(az * 0.21, 41.7), 3);
  float clump = smoothstep(0.42, 0.68, nzv(vec2(az * 0.33, 12.0)));
  float crowns = pow(abs(sin(az * 4.6 + nzv(vec2(az * 0.7, 3.0)) * 7.0)), 0.55) * 0.14
               + pow(abs(sin(az * 15.0 + nzv(vec2(az * 2.1, 8.0)) * 9.0)), 0.7) * 0.05;
  float trees = clump * crowns + 0.09 * (nzv(vec2(az * 2.6, 7.7)) - 0.5) * 0.5 + 0.016 * (nzv(vec2(az * 27.0, 5.1)) - 0.5);
  nearH = max(0.03, nearBase + trees);
}

void main() {
  vec2 frag = fragCss();
  vec3 d = unprojectDir(frag);
  float u = d.z;
  float az = atan(d.x, d.y) * RAD;
  vec3 haze = skyAt(0.4, az);
  float pxAng = 0.9 * uPxRad;
  vec3 rgbOut = vec3(0.0); float alpha = 0.0;

  if (u >= 0.0) {
    if (u > 0.04) { outColor = vec4(0.0); return; }
    float hFarDeg, hNearDeg; ridges(az, hFarDeg, hNearDeg);
    float hFar = hFarDeg * DEG, hNear = hNearDeg * DEG;
    float nearA = 1.0 - smoothstep(hNear - pxAng, hNear + pxAng, u);
    float farA = 1.0 - smoothstep(hFar - pxAng, hFar + pxAng, u);
    if (farA <= 0.0) { outColor = vec4(0.0); return; }
    vec3 cFar = camera(irradiate(vec3(0.085, 0.10, 0.12), vec3(0.0, 0.6, 0.8), 1.0), 1.0);
    float hv = min(1.0, u / max(1e-5, hFar));
    float rel = nzv(vec2(az * 14.0, u * 800.0)) * 0.5 + nzv(vec2(az * 41.0, u * 2300.0 + 8.8)) * 0.5;
    vec3 col = mix(cFar, haze, 0.62 + 0.14 * hv - 0.12 * rel);
    float a = farA;
    if (nearA > 0.0) {
      float foliage = 0.78 + 0.5 * nzv(vec2(az * 55.0, u * 3200.0)) * nzv(vec2(az * 23.0, u * 1200.0 + 5.0));
      vec3 cNear = camera(irradiate(vec3(0.040, 0.066, 0.028), vec3(0.0, 0.5, 0.85), foliage), 1.0);
      col = mix(col, mix(cNear, haze, 0.3), nearA);
      a = 1.0;
    }
    rgbOut = col; alpha = a;
  } else {
    alpha = 1.0 - smoothstep(-pxAng, pxAng, u);
    float uu = min(u, -1e-4);
    float t = uEyeH / -uu;
    vec2 g = t * d.xy;
    float fp = t * uPxRad * 1.4 / max(abs(uu), 0.03); // pixel footprint on the ground (m)
    float fpl = t * uPxRad * 1.4;
    float fpx = max(fp, fpl);
    // materials: meadow (green/dry), bare soil, gravel
    float nL = fbm(g * 0.045 + vec2(3.3, 7.9), 3);
    float nM = nzv(g * 0.55);
    float dry = smoothstep(0.38, 0.72, fbm(g * 0.085 + vec2(21.0, 5.0), 2));
    float soilW = smoothstep(0.66, 0.8, nzv(g * 0.11 + vec2(40.0, 20.0)));
    float gravW = smoothstep(0.8, 0.88, nzv(g * 0.2 + vec2(7.0, 3.0))) * (1.0 - soilW);
    vec3 greenA = vec3(0.052, 0.088, 0.024), greenB = vec3(0.105, 0.135, 0.040), dryA = vec3(0.19, 0.15, 0.075);
    vec3 rho = mix(greenA, greenB, smoothstep(0.3, 0.75, nL));
    rho = mix(rho, dryA, dry * 0.85);
    rho = mix(rho, vec3(0.16, 0.125, 0.09), soilW);
    rho = mix(rho, vec3(0.2, 0.19, 0.17), gravW);
    float cover = (1.0 - soilW) * (1.0 - gravW); // vegetation cover
    // multi-scale detail, faded by pixel footprint
    float d7 = detailFade(7.5, fpx), d28 = detailFade(28.0, fpx), d55 = detailFade(55.0, fpx), d140 = detailFade(140.0, fpx);
    float b3 = nzv(g * 7.5 + vec2(11.0, 4.0));
    float b1 = nzv(g * vec2(55.0, 40.0) + vec2(5.0, 13.0));
    float b2 = nzv(g * vec2(140.0, 95.0) + vec2(2.0, 9.0));
    float b0 = nzv(g * vec2(2.3, 1.7) + vec2(30.0, 60.0)), b4 = nzv(g * vec2(4.6, 3.9) + vec2(8.0, 2.0));
    float d2 = detailFade(2.3, fpx), d4 = detailFade(4.6, fpx);
    float k = 1.0 + 0.5 * (nM - 0.5) * (1.0 - smoothstep(18.0, 110.0, t)) + 0.55 * (b0 - 0.5) * d2 * (0.3 + cover) + 0.7 * (b4 - 0.5) * d4 * (0.3 + cover)
              + 0.9 * (b3 - 0.5) * d7 + 1.0 * (b1 - 0.5) * d55 * (0.4 + cover) + 0.9 * (b2 - 0.5) * d140 * cover;
    k *= 1.0 - 0.38 * smoothstep(0.6, 0.18, b1) * d55 * cover - 0.2 * smoothstep(0.55, 0.2, b4) * d4 * cover;
    k = max(k, 0.42); // gaps between tufts and blades
    // small white and yellow wildflowers
    float fl = step(0.955, nzv(g * 26.0 + vec2(91.0, 17.0))) * d28 * cover * (1.0 - dry * 0.7);
    float flY = step(0.5, nzv(g * 0.7 + vec2(3.0, 90.0)));
    rho = mix(rho, mix(vec3(0.55, 0.53, 0.5), vec3(0.5, 0.4, 0.07), flY), fl);
    // fine normal from the noise slope (sun-directed relief)
    vec3 n = vec3(0.0, 0.0, 1.0);
    float nf = d7 * 0.9;
    if (nf > 0.02) {
      float e = 0.02;
      float dx = nzv((g + vec2(e, 0.0)) * 7.5 + vec2(11.0, 4.0)) - b3, dy = nzv((g + vec2(0.0, e)) * 7.5 + vec2(11.0, 4.0)) - b3;
      n = normalize(vec3(-dx * nf * 1.8, -dy * nf * 1.8, 1.0));
    }
    if (uTexReady > 0.5) {
      // real texture path: planar mapping on the ground plane, mipmapped + anisotropic via analytic gradients
      vec2 dgx = groundPt(frag + vec2(1.0, 0.0)) - g, dgy = groundPt(frag + vec2(0.0, 1.0)) - g;
      vec3 a1 = textureGrad(uGrassA, g, dgx, dgy).rgb;
      vec3 a2 = textureGrad(uGrassA, g * 0.137 + vec2(0.31, 0.57), dgx * 0.137, dgy * 0.137).rgb;
      float m2 = pow(clamp(dot(a2, vec3(0.2126, 0.7152, 0.0722)) / 0.06, 0.45, 2.2), 0.6);   // second scale breaks repetition
      vec3 grass = a1 * m2;
      { float lg = dot(grass, vec3(0.2126, 0.7152, 0.0722)); grass = mix(vec3(lg), grass, 0.7) * vec3(1.06, 0.97, 0.9) * 0.66 + vec3(0.0, 0.0, 0.004); } // real chlorophyll albedo: darker, less saturated, some blue
      grass = mix(grass, grass * vec3(2.7, 2.1, 1.1) + vec3(0.018, 0.012, 0.004), dry * 0.8); // dry patches
      float lumA = min(dot(a1, vec3(0.2126, 0.7152, 0.0722)), 0.11);
      vec3 soilC = vec3(0.17, 0.13, 0.092) * (0.45 + 6.0 * lumA);
      vec3 gravC = vec3(0.15, 0.14, 0.125) * (0.5 + 5.0 * lumA);
      rho = mix(mix(grass, soilC, soilW), gravC, gravW);
      k = 1.0;
      vec3 nt = textureGrad(uGrassN, g, dgx, dgy).xyz * 2.0 - 1.0;
      n = normalize(vec3(nt.xy, max(nt.z, 0.25)));
    }
    // sundial plate
    vec2 pl = g - uPlate.xy; float rr = length(pl);
    if (rr < uPlate.z + 0.05) {
      if (rr < uPlate.z) {
        float grain = 0.95 + 0.09 * nzv(pl * 14.0) + 0.09 * (nzv(pl * 55.0) - 0.5) * d55 + 0.05 * (nzv(pl * 190.0) - 0.5) * d140;
        float vein = 1.0 + 0.12 * (fbm(pl * 1.4 + vec2(5.0, 0.0), 3) - 0.5);
        vec2 q = abs(fract(pl / 0.5) - 0.5);
        float joint = min(0.5 - q.x, 0.5 - q.y) < 0.012 ? 0.62 : 1.0;
        float chamfer = rr > uPlate.z - 0.03 ? 1.12 : 1.0;
        rho = vec3(0.3, 0.29, 0.265); k = grain * vein * joint * chamfer; n = vec3(0.0, 0.0, 1.0);
      } else { rho = vec3(0.3, 0.29, 0.265); k = 0.22; }
    }
    vec3 lit = camera(irradiate(rho, n, k), 1.0);
    float f = 1.0 - exp(-t / 3200.0);
    rgbOut = lit + (haze * 0.94 - lit) * f;
  }
  rgbOut += (hash12(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;
  outColor = vec4(rgbOut * alpha, alpha);
}`;

export function createGpuBackground(): GpuBackground | null {
  if (typeof document === 'undefined') return null;
  let canvas: HTMLCanvasElement;
  let gl: WebGL2RenderingContext | null = null;
  try {
    canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  } catch { return null; }
  if (!gl) return null;
  const G = gl;
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; });

  const compile = (type: number, src: string): WebGLShader | null => {
    const s = G.createShader(type)!;
    G.shaderSource(s, src); G.compileShader(s);
    if (!G.getShaderParameter(s, G.COMPILE_STATUS)) { console.warn('[eyeGpu] shader:', G.getShaderInfoLog(s)); return null; }
    return s;
  };
  const link = (frag: string): WebGLProgram | null => {
    const v = compile(G.VERTEX_SHADER, VERT), f = compile(G.FRAGMENT_SHADER, frag);
    if (!v || !f) return null;
    const p = G.createProgram()!;
    G.attachShader(p, v); G.attachShader(p, f); G.linkProgram(p);
    if (!G.getProgramParameter(p, G.LINK_STATUS)) { console.warn('[eyeGpu] link:', G.getProgramInfoLog(p)); return null; }
    return p;
  };
  const skyProg = link(SKY_FRAG), groundProg = link(GROUND_FRAG);
  if (!skyProg || !groundProg) return null;
  const vao = G.createVertexArray(); G.bindVertexArray(vao);

  // نسيج الضوضاء (256²، قناة واحدة) مطابق لجدول المسار الحاسوبي
  const NZ = new Uint8Array(256 * 256);
  { let s = 1337; for (let i = 0; i < NZ.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; NZ[i] = Math.round((s / 4294967296) * 255); } }
  const nzTex = G.createTexture();
  G.activeTexture(G.TEXTURE1); G.bindTexture(G.TEXTURE_2D, nzTex);
  G.pixelStorei(G.UNPACK_ALIGNMENT, 1);
  G.texImage2D(G.TEXTURE_2D, 0, G.R8, 256, 256, 0, G.RED, G.UNSIGNED_BYTE, NZ);
  G.texParameteri(G.TEXTURE_2D, G.TEXTURE_MIN_FILTER, G.NEAREST); G.texParameteri(G.TEXTURE_2D, G.TEXTURE_MAG_FILTER, G.NEAREST);

  const skyTex = G.createTexture();
  G.activeTexture(G.TEXTURE0); G.bindTexture(G.TEXTURE_2D, skyTex);
  G.texParameteri(G.TEXTURE_2D, G.TEXTURE_MIN_FILTER, G.LINEAR); G.texParameteri(G.TEXTURE_2D, G.TEXTURE_MAG_FILTER, G.LINEAR);
  G.texParameteri(G.TEXTURE_2D, G.TEXTURE_WRAP_S, G.REPEAT); G.texParameteri(G.TEXTURE_2D, G.TEXTURE_WRAP_T, G.CLAMP_TO_EDGE);
  let haveSky = false;
  // meadow textures (loaded asynchronously; until then the procedural path is used)
  const BASE: string = (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';
  const grassA = G.createTexture(), grassN = G.createTexture();
  let texReady = 0;
  const aniso = G.getExtension('EXT_texture_filter_anisotropic');
  const loadTex = (url: string, tex: WebGLTexture | null, internal: number, done: () => void) => {
    const img = new Image();
    img.onload = () => {
      if (contextLost) return;
      G.bindTexture(G.TEXTURE_2D, tex);
      G.pixelStorei(G.UNPACK_FLIP_Y_WEBGL, false);
      G.texImage2D(G.TEXTURE_2D, 0, internal, G.RGBA, G.UNSIGNED_BYTE, img);
      G.generateMipmap(G.TEXTURE_2D);
      G.texParameteri(G.TEXTURE_2D, G.TEXTURE_MIN_FILTER, G.LINEAR_MIPMAP_LINEAR); G.texParameteri(G.TEXTURE_2D, G.TEXTURE_MAG_FILTER, G.LINEAR);
      G.texParameteri(G.TEXTURE_2D, G.TEXTURE_WRAP_S, G.REPEAT); G.texParameteri(G.TEXTURE_2D, G.TEXTURE_WRAP_T, G.REPEAT);
      if (aniso) G.texParameterf(G.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, G.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number));
      done();
    };
    img.src = url;
  };
  let loaded = 0;
  loadTex(`${BASE}textures/ground_albedo.jpg`, grassA, G.SRGB8_ALPHA8, () => { if (++loaded === 2) texReady = 1; });
  loadTex(`${BASE}textures/ground_normal.png`, grassN, G.RGBA8, () => { if (++loaded === 2) texReady = 1; });

  const loc = (p: WebGLProgram, n: string) => G.getUniformLocation(p, n);
  const KIND = { stereographic: 0, perspective: 1, equidistant: 2 } as const;

  const setCommon = (p: WebGLProgram, f: GpuFrame) => {
    const { P } = f;
    G.useProgram(p);
    G.uniform2f(loc(p, 'uSize'), P.w, P.h);
    G.uniform2f(loc(p, 'uRes'), canvas.width, canvas.height);
    G.uniform3f(loc(p, 'uRight'), P.basis.right[0], P.basis.right[1], P.basis.right[2]);
    G.uniform3f(loc(p, 'uUp'), P.basis.up[0], P.basis.up[1], P.basis.up[2]);
    G.uniform3f(loc(p, 'uFwd'), P.basis.fwd[0], P.basis.fwd[1], P.basis.fwd[2]);
    G.uniform1f(loc(p, 'uF'), P.f);
    G.uniform1i(loc(p, 'uKind'), KIND[P.camera.projection]);
    G.uniform1i(loc(p, 'uSky'), 0);
  };
  const prepare = (f: GpuFrame) => {
    const w = Math.max(2, Math.round(f.P.w * f.dpr)), h = Math.max(2, Math.round(f.P.h * f.dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    G.viewport(0, 0, w, h);
    G.disable(G.BLEND); G.disable(G.DEPTH_TEST);
    G.activeTexture(G.TEXTURE0); G.bindTexture(G.TEXTURE_2D, skyTex);
    G.activeTexture(G.TEXTURE1); G.bindTexture(G.TEXTURE_2D, nzTex);
    if (texReady) { G.activeTexture(G.TEXTURE2); G.bindTexture(G.TEXTURE_2D, grassA); G.activeTexture(G.TEXTURE3); G.bindTexture(G.TEXTURE_2D, grassN); }
    G.bindVertexArray(vao);
  };

  return {
    lost: () => contextLost || G.isContextLost(),
    ready: () => texReady,
    setSkyTexture(data, w, h) {
      G.activeTexture(G.TEXTURE0); G.bindTexture(G.TEXTURE_2D, skyTex);
      G.pixelStorei(G.UNPACK_ALIGNMENT, 4);
      G.texImage2D(G.TEXTURE_2D, 0, G.RGBA8, w, h, 0, G.RGBA, G.UNSIGNED_BYTE, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      haveSky = true;
    },
    drawSky(ctx, f) {
      if (!haveSky) return;
      prepare(f); setCommon(skyProg, f);
      G.uniform1f(loc(skyProg, 'uDimBelow'), f.ground ? 1 : 0.3);
      G.drawArrays(G.TRIANGLES, 0, 3);
      ctx.drawImage(canvas, 0, 0, f.P.w, f.P.h);
    },
    drawGround(ctx, f) {
      if (!haveSky || !f.ground) return;
      prepare(f); setCommon(groundProg, f);
      G.uniform1i(loc(groundProg, 'uNz'), 1);
      G.uniform1i(loc(groundProg, 'uGrassA'), 2); G.uniform1i(loc(groundProg, 'uGrassN'), 3);
      G.uniform1f(loc(groundProg, 'uTexReady'), texReady);
      const L = f.light;
      G.uniform1f(loc(groundProg, 'uExposure'), L.exposure);
      G.uniform1f(loc(groundProg, 'uEyeH'), f.eyeH);
      G.uniform1f(loc(groundProg, 'uPxRad'), 1 / (Math.max(1e-6, f.P.scaleAt(f.P.basis.fwd)) * f.dpr));
      G.uniform3f(loc(groundProg, 'uPlate'), f.plate.e, f.plate.n, f.plate.r);
      G.uniform3fv(loc(groundProg, 'uSunDir'), L.sunDir); G.uniform3fv(loc(groundProg, 'uSunE'), L.sunE);
      G.uniform3fv(loc(groundProg, 'uMoonDir'), L.moonDir); G.uniform3fv(loc(groundProg, 'uMoonE'), L.moonE);
      G.uniform3fv(loc(groundProg, 'uDiffuse'), L.diffuse);
      G.clearColor(0, 0, 0, 0); G.clear(G.COLOR_BUFFER_BIT);
      G.drawArrays(G.TRIANGLES, 0, 3);
      ctx.drawImage(canvas, 0, 0, f.P.w, f.P.h);
    },
  };
}
