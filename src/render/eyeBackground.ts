import { dirFromAltAz, type Projector, type V3 } from '../core/camera';
import { skyLinearAt, type DomeSkyInput } from './domeSky';
import { directSunLight, SKY_CONSTANTS } from '../core/skyRadiance';
import { createGpuBackground, type GpuBackground, type GpuFrame } from './eyeGpu';
import { moonSkyCorrection } from '../core/atmosphere';

/**
 * خلفية «عين الراصد»: سماء وأرض كلقطة كاميرا.
 *  - تعريض تكيّفي (تكيّف العين/الحسّاس مع سطوع السماء) ثم منحنى سينمائي ثم sRGB؛ لا يُستعمل تعيين القبة اللوغاريتمي.
 *  - أرض إجرائية: تربة/عشب/حصى بتفاوت لوني متعدد المقاييس، تفاصيل دقيقة تتلاشى بالبعد، وظلال دقيقة من اتجاه الشمس والقمر.
 *  - تلال بعيدة وخط أشجار بمنظور جوي، وضباب بلون أفق السماء.
 *  - الإضاءة = ρ · (E_شمس·cosθ + E_قمر·cosθ + E_سماء) / π ثم نفس التعريض، فتنسجم الأرض مع السماء في كل الأوقات.
 * الدوال النقية (fillBackgroundPixels) لا تلمس DOM فتُختبر خارج المتصفح.
 */
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const AZN = 720, ELN = 96;
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lumY = (v: number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];

// ───────────────────────── ضوضاء جدولية (دورية 256) ─────────────────────────
const NZ = new Float32Array(256 * 256);
{ let s = 1337; for (let i = 0; i < NZ.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; NZ[i] = s / 4294967296; } }
export function nz(x: number, y: number): number {
  const xf = Math.floor(x), yf = Math.floor(y), fx = x - xf, fy = y - yf;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const x0 = xf & 255, x1 = (xf + 1) & 255, y0 = (yf & 255) << 8, y1 = ((yf + 1) & 255) << 8;
  const a = NZ[y0 + x0], b = NZ[y0 + x1], c = NZ[y1 + x0], d = NZ[y1 + x1];
  const top = a + (b - a) * sx;
  return top + (c + (d - c) * sx - top) * sy;
}
export function fbm(x: number, y: number, oct: number): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * nz(x * f + i * 17.3, y * f + i * 9.1); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// ───────────────────────── التعريض ومنحنى الاستجابة ─────────────────────────
const aces = (x: number) => Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
const oetf = (v: number) => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
const SAT_SKY = 1.4, SAT_GROUND = 1.0;
let exposure = 1e-4;
/**
 * التعريض من الإضاءة الكلية على سطح أفقي ℓ (لوكس): بطاقة رمادية 18% تُعرَّض إلى 0.36 في الضوء الكامل (ℓ ≥ 6·10⁴)،
 * ثم يهبط مستواها بقانون قوّة 0.25 مع خفوت الضوء: غروب ≈ 0.17، نهاية الشفق المدني ≈ 0.03، ليل القمر ≈ 0.014، ليل بلا قمر ≈ 0.004.
 * (العين/الحسّاس لا يتكيّف كلياً مع الظلمة، فيبقى الليل ليلاً وتبقى الأرض المضاءة بالقمر مرئية خافتة.)
 */
function exposureFor(ell: number): number {
  const e = Math.max(ell, 1e-7);
  const dark = 0.45 + 0.55 * smoothstep(0.003, 0.2, e); // ليل بلا قمر: لا تُرفع زرقة السماء الخافتة
  const x = 0.46 * Math.pow(Math.min(1, e / 6e4), 0.25) * dark;
  return x / ((0.18 * e) / Math.PI);
}
/** إشعاع خطي (cd/m²) → بايتات sRGB بعد التعريض والتشبّع والمنحنى */
export function toCameraRGB(r: number, g: number, b: number, out: Uint8ClampedArray | number[], off: number, sat = SAT_SKY): void {
  r *= exposure; g *= exposure; b *= exposure;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r = Math.max(0, y + (r - y) * sat); g = Math.max(0, y + (g - y) * sat); b = Math.max(0, y + (b - y) * sat);
  // كابح وهج: الأقسام الأسطع بكثير من المتوسط تُضغط (كما تفعل العدسة والعين) فلا تتسع هالة الشمس بلا حد
  const peak = Math.max(r, g, b);
  if (peak > 0.35) { const c = (0.35 + (peak - 0.35) / (1 + (peak - 0.35) * 0.9)) / peak; r *= c; g *= c; b *= c; }
  // رؤية خافتة (بيرْكنجي): عند السطوع المنخفض تميل الألوان إلى الأزرق وتفقد تشبّعها
  const sc = 1 - smoothstep(0.0004, 0.025, y);
  if (sc > 0) { const yy = y * 1.15; r += (yy * 0.86 - r) * sc; g += (yy * 0.96 - g) * sc; b += (yy * 1.16 - b) * sc; }
  r = aces(r); g = aces(g); b = aces(b);
  // أنصاف الألوان الساطعة تميل إلى البياض (كما في الكاميرات): لا يبقى الأفق عند الشروق أصفر ليمونياً
  const wh = smoothstep(0.5, 1.0, Math.max(r, g, b)) * 0.65, yy = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r += (yy - r) * wh; g += (yy - g) * wh; b += (yy - b) * wh;
  out[off] = Math.round(255 * oetf(r));
  out[off + 1] = Math.round(255 * oetf(g));
  out[off + 2] = Math.round(255 * oetf(b));
}

// ───────────────────────── نسيج السماء وإضاءة الأرض ─────────────────────────
let skyTex: Uint8ClampedArray | null = null;
let skyTexKey = '';
let skyTexStamp = 0;
interface Light { sunDir: V3; sunE: number[]; moonDir: V3; moonE: number[]; diffuse: number[] }
let light: Light = { sunDir: [0, 0, 1], sunE: [0, 0, 0], moonDir: [0, 0, 1], moonE: [0, 0, 0], diffuse: [0, 0, 0] };
let shadowKValue = 0.3;
let lastEll = 1;
let skyCapY = 1e9;
/** التعريض الحالي (الأرقام الخطية → شاشة) */
export const getExposure = () => exposure;
let skyVersion = 0;
/** الإضاءة الكلية الحالية على سطح أفقي (لوكس نموذجي) */
export const getIlluminance = () => lastEll;
export const groundShadowK = () => shadowKValue;
export const hasSkyTex = () => skyTex !== null;
const elOf = (j: number) => 90 * Math.pow(j / (ELN - 1), 2);
const acc3 = [0, 0, 0];
const tmp4 = new Uint8ClampedArray(4);

export function buildSkyTexture(inp: DomeSkyInput, version: number, nowMs: number): void {
  const key = `${version}|${Math.round(inp.sunAz / 0.15)}|${Math.round(inp.moonAz / 0.3)}|${Math.round(inp.sunFraction * 100)}`;
  if (key === skyTexKey && skyTex) return;
  if (skyTex && nowMs - skyTexStamp < 90) return; // تشغيل متسارع: نُبقي النسيج السابق لحظة
  if (!skyTex) skyTex = new Uint8ClampedArray(AZN * ELN * 4);
  skyTexKey = key; skyTexStamp = nowMs;

  // إضاءة الأرض: السماء المنتشرة (تكامل نصف الكرة) + الشمس والقمر المباشران
  const diffuseFor = (frac: number): number[] => {
    const E = [0, 0, 0];
    const dTheta = 15 * DEG;
    for (let k = 0; k < 6; k++) {
      const theta = (k + 0.5) * dTheta;
      const w = Math.cos(theta) * Math.sin(theta) * dTheta;
      for (let a = 0; a < 4; a++) {
        skyLinearAt(90 - theta * RAD, inp.sunAz + a * 90, inp.sunAz, inp.moonAz, frac, acc3);
        for (let c = 0; c < 3; c++) E[c] += (2 * Math.PI * w * acc3[c]) / 4;
      }
    }
    return E;
  };
  const E = diffuseFor(inp.sunFraction);
  const sunBase = [0, 0, 0], moonE = [0, 0, 0];
  if (inp.sunAlt > 0) {
    const { rgb } = directSunLight(inp.sunAlt);
    for (let c = 0; c < 3; c++) sunBase[c] = SKY_CONSTANTS.E_SUN * rgb[c];
  }
  const sunE = sunBase.map((v) => v * inp.sunFraction);
  if (inp.moonAlt > 0 && inp.moonPhase > 0.04) {
    const { rgb } = directSunLight(inp.moonAlt);
    const k = inp.moonPhase;
    for (let c = 0; c < 3; c++) moonE[c] = 0.34 * k * k * k * rgb[c];
  }
  light = { sunDir: dirFromAltAz(inp.sunAlt, inp.sunAz), sunE, moonDir: dirFromAltAz(inp.moonAlt, inp.moonAz), moonE, diffuse: E };
  const sinS = Math.max(0, Math.sin(inp.sunAlt * DEG)), sinM = Math.max(0, Math.sin(inp.moonAlt * DEG));
  const horiz = (frac: number, Ed: number[]) => lumY([Ed[0] + (sunBase[0] * frac) * sinS + moonE[0] * sinM, Ed[1] + (sunBase[1] * frac) * sinS + moonE[1] * sinM, Ed[2] + (sunBase[2] * frac) * sinS + moonE[2] * sinM]);
  const ellNow = horiz(inp.sunFraction, E);
  // حالة التكيّف: العين/الحسّاس لا يتكيّف لحظياً مع عتمة الكسوف؛ نمزج 70% من الإضاءة قبل الكسوف و30% من الحالية
  const ellRef = inp.sunFraction >= 0.999 ? ellNow : horiz(1, diffuseFor(1));
  const adapt = (ref: number, now: number) => Math.exp(0.7 * Math.log(Math.max(ref, 1e-9)) + 0.3 * Math.log(Math.max(now, 1e-9)));
  lastEll = adapt(ellRef, ellNow);
  exposure = exposureFor(lastEll);
  // مقياس السماء: عند الغروب تكون السماء أسطع بكثير من الأرض، فيُؤخذ الأدنى من تعريضَي الأرض والسماء (لا تنفجر السماء)
  let lgSky = 0, lgSkyRef = 0;
  const probes: [number, number][] = [[90, 0], [50, 180], [50, 90], [25, 150], [25, 210]];
  for (const [e, da] of probes) {
    skyLinearAt(e, inp.sunAz + da, inp.sunAz, inp.moonAz, inp.sunFraction, acc3);
    lgSky += Math.log(Math.max(1e-6, lumY(acc3)));
    skyLinearAt(e, inp.sunAz + da, inp.sunAz, inp.moonAz, 1, acc3);
    lgSkyRef += Math.log(Math.max(1e-6, lumY(acc3)));
  }
  const laSky = Math.exp((0.7 * lgSkyRef + 0.3 * lgSky) / probes.length);
  exposure = Math.min(exposure, 0.11 / laSky);
  // سقف سطوع الهالة حول الشمس (لا تنفجر إلى بياض يبتلع القرص)
  skyCapY = 5.5 * laSky;
  const tot = [E[0] + sunE[0] * sinS + moonE[0] * sinM, E[1] + sunE[1] * sinS + moonE[1] * sinM, E[2] + sunE[2] * sinS + moonE[2] * sinM];
  shadowKValue = Math.max(0.04, Math.min(1, lumY(E) / Math.max(1e-9, lumY(tot))));
  void tmp4;

  // مرجع السماء المظلمة بلا قمر (اتجاه مقابل للقمر)، لتحديد جزء القمر
  const moonCorr = inp.sunAlt < -12 && inp.moonAlt > -6 && inp.moonPhase > 0.02;
  let darkRef = 2.2e-4;
  if (moonCorr) { skyLinearAt(Math.max(8, 60 - Math.max(0, inp.moonAlt)), inp.moonAz + 180, inp.sunAz, inp.moonAz, inp.sunFraction, acc3); darkRef = Math.min(lumY(acc3), 6e-4); }
  for (let j = 0; j < ELN; j++) {
    const e = elOf(j);
    for (let i = 0; i < AZN; i++) {
      skyLinearAt(e, (i * 360) / AZN, inp.sunAz, inp.moonAz, inp.sunFraction, acc3);
      if (moonCorr) { // ليل صافٍ: جزء القمر وحده يُصحَّح بحسب البعد الزاوي عن القمر (KS91)
        const yy = lumY(acc3);
        const dm = Math.sin(e * DEG) * Math.sin(inp.moonAlt * DEG) + Math.cos(e * DEG) * Math.cos(inp.moonAlt * DEG) * Math.cos(((i * 360) / AZN - inp.moonAz) * DEG);
        const rho = (Math.acos(Math.max(-1, Math.min(1, dm))) * 180) / Math.PI;
        const part = Math.max(0, yy - darkRef);
        if (yy > 0) { const k2 = (darkRef + part * moonSkyCorrection(rho)) / yy; acc3[0] *= k2; acc3[1] *= k2; acc3[2] *= k2; }
      }
      const capK = 1 / (1 + lumY(acc3) / skyCapY);
      toCameraRGB(acc3[0] * capK, acc3[1] * capK, acc3[2] * capK, skyTex, (j * AZN + i) * 4);
      skyTex[(j * AZN + i) * 4 + 3] = 255;
    }
  }
  skyVersion++;
}

function sampleSky(e: number, azDeg: number, out: number[]): void {
  const te = Math.sqrt(Math.max(0, e) / 90) * (ELN - 1);
  const j0 = Math.min(ELN - 2, Math.floor(te)), fj = te - j0;
  let ta = (azDeg / 360) * AZN; ta -= Math.floor(ta / AZN) * AZN;
  const i0 = Math.floor(ta) % AZN, i1 = (i0 + 1) % AZN, fi = ta - Math.floor(ta);
  const t = skyTex!;
  for (let c = 0; c < 3; c++) {
    const a = t[(j0 * AZN + i0) * 4 + c], b = t[(j0 * AZN + i1) * 4 + c];
    const p = t[((j0 + 1) * AZN + i0) * 4 + c], q = t[((j0 + 1) * AZN + i1) * 4 + c];
    out[c] = (a * (1 - fi) + b * fi) * (1 - fj) + (p * (1 - fi) + q * fi) * fj;
  }
}

// ───────────────────────── الأرض والتلال ─────────────────────────
export interface BgPlate { e: number; n: number; r: number }
export interface BgOptions { ground: boolean; eyeHeightM: number }

// ألبيدو (ρ) لكل مادة
const RHO_SOIL = [0.17, 0.135, 0.095], RHO_DRY = [0.15, 0.13, 0.085], RHO_GRASS = [0.085, 0.1, 0.045], RHO_GRAVEL = [0.2, 0.19, 0.17];
const RHO_STONE = [0.3, 0.29, 0.265];
const RHO_FAR = [0.085, 0.1, 0.12], RHO_NEAR = [0.045, 0.07, 0.03];
const lit = [0, 0, 0];
/** إشعاع الأرض لمادة ألبيدو ρ وناظم n */
function irradiate(rho: number[], nx: number, ny: number, nz_: number, k: number, out: number[]): void {
  const s = light.sunDir, m = light.moonDir;
  const cs = Math.max(0, nx * s[0] + ny * s[1] + nz_ * s[2]), cm = Math.max(0, nx * m[0] + ny * m[1] + nz_ * m[2]);
  const sky = 0.55 + 0.45 * nz_;
  for (let c = 0; c < 3; c++) out[c] = (k * rho[c] * (light.sunE[c] * cs + light.moonE[c] * cm + light.diffuse[c] * sky)) / Math.PI;
}
function mix3(a: number[], b: number[], t: number, out: number[]): void { for (let c = 0; c < 3; c++) out[c] = a[c] + (b[c] - a[c]) * t; }

/** ارتفاع التلال زاوياً (درجات) عند سمت معيّن: سلسلة بعيدة عالية، وأخرى قريبة منخفضة بخط أشجار خشن */
function ridges(az: number, out: number[]): void {
  const far = 0.25 + 1.5 * Math.pow(fbm(az * 0.09, 3.1, 4), 1.35);
  const nearBase = 0.05 + 0.5 * fbm(az * 0.21, 41.7, 3);
  const trees = 0.09 * (nz(az * 2.6, 7.7) - 0.5) + 0.04 * (nz(az * 8.5, 2.2) - 0.5) + 0.016 * (nz(az * 27, 5.1) - 0.5);
  out[0] = far; out[1] = Math.max(0.03, nearBase + trees);
}

const acc = [0, 0, 0], haze = [0, 0, 0], rgb = [0, 0, 0], ridge2 = [0, 0], col = [0, 0, 0], col2 = [0, 0, 0], mat = [0, 0, 0];
const bytes = new Uint8ClampedArray(4);

/**
 * يملأ مخزني السماء (معتم) والأرض (ألفا) بالبكسل: sp/gp أطوالهما bw·bh·4. لا DOM.
 */
export function fillBackgroundPixels(P: Projector, opt: BgOptions, plate: BgPlate, bw: number, bh: number, sp: Uint8ClampedArray, gp: Uint8ClampedArray): void {
  const stepX = P.w / bw, stepY = P.h / bh;
  const d: V3 = [0, 0, 0];
  const pxAng = (0.9 * stepX) / Math.max(1e-6, P.scaleAt(P.basis.fwd)); // نصف عرض بكسل الخلفية زاوياً (راد)
  const eyeH = opt.eyeHeightM;
  for (let j = 0; j < bh; j++) {
    const sy = (j + 0.5) * stepY;
    for (let i = 0; i < bw; i++) {
      const sx = (i + 0.5) * stepX;
      P.unprojectInto(sx, sy, d);
      const u = d[2];
      const az = Math.atan2(d[0], d[1]) * RAD;
      const k = (j * bw + i) * 4;
      const e = u > 0 ? Math.asin(u) * RAD : 0;
      sampleSky(e, az, rgb);
      const dim = u < 0 && !opt.ground ? 0.3 : 1;
      sp[k] = rgb[0] * dim; sp[k + 1] = rgb[1] * dim; sp[k + 2] = rgb[2] * dim; sp[k + 3] = 255;
      gp[k + 3] = 0;
      if (!opt.ground) continue;

      // لون الضباب: لون أفق السماء بهذا السمت
      sampleSky(0.4, az, haze);

      if (u >= 0) {
        if (u > 0.04) continue; // أعلى من أعلى تلّة ممكنة (≈2.3°)
        // تلال بعيدة وقريبة فوق الأفق الهندسي
        ridges(az, ridge2);
        const hFar = ridge2[0] * DEG, hNear = ridge2[1] * DEG;
        if (u > hFar + pxAng) continue;
        const nearA = 1 - smoothstep(hNear - pxAng, hNear + pxAng, u);
        const farA = 1 - smoothstep(hFar - pxAng, hFar + pxAng, u);
        if (farA <= 0) continue;
        // البعيدة: زرقة جوية قوية وتدرّج بالارتفاع
        irradiate(RHO_FAR, 0, 0.6, 0.8, 1, acc);
        toCameraRGB(acc[0], acc[1], acc[2], bytes, 0, SAT_GROUND);
        const hv = Math.min(1, u / Math.max(1e-5, hFar));
        const rel = nz(az * 14, u * 800) * 0.5 + nz(az * 41, u * 2300 + 8.8) * 0.5;
        mix3([bytes[0], bytes[1], bytes[2]], haze, 0.62 + 0.14 * hv - 0.12 * rel, col);
        let a = farA;
        if (nearA > 0) {
          // القريبة: غابة/عشب داكن بملمس أوراق وتدرّج، ضباب خفيف
          irradiate(RHO_NEAR, 0, 0.5, 0.85, 1, acc);
          const foliage = 0.78 + 0.5 * nz(az * 75, u * 4200) * nz(az * 31, u * 1500 + 5);
          toCameraRGB(acc[0] * foliage, acc[1] * foliage, acc[2] * foliage, bytes, 0, SAT_GROUND);
          mix3([bytes[0], bytes[1], bytes[2]], haze, 0.3, col2);
          mix3(col, col2, nearA, col);
          a = 1;
        }
        gp[k] = col[0]; gp[k + 1] = col[1]; gp[k + 2] = col[2]; gp[k + 3] = 255 * a;
        continue;
      }

      // الأرض المستوية
      const alpha = 1 - smoothstep(-pxAng, pxAng, u);
      const uu = Math.min(u, -1e-4);
      const t = eyeH / -uu; // المسافة إلى نقطة التقاطع (م)
      const gx = t * d[0], gy = t * d[1];
      const fine = 1 - smoothstep(3, 12, t), mid = 1 - smoothstep(18, 110, t);
      // مادة السطح: بقع كبيرة بين تربة وعشب وحصى
      const nL = fbm(gx * 0.045 + 3.3, gy * 0.045 + 7.9, 3);
      const nM = nz(gx * 0.55, gy * 0.55);
      const nF = fine > 0.01 ? nz(gx * 6.2 + 11, gy * 6.2 + 4) : 0.5;
      const nG = fine > 0.01 ? nz(gx * 23 + 2, gy * 23 + 9) : 0.5;
      const wGrass = smoothstep(0.42, 0.62, nL);
      const wGravel = smoothstep(0.7, 0.8, nz(gx * 0.12 + 40, gy * 0.12 + 20)) * (1 - wGrass * 0.7);
      mix3(RHO_SOIL, RHO_DRY, smoothstep(0.3, 0.7, nM), mat);
      mix3(mat, RHO_GRASS, wGrass, mat);
      mix3(mat, RHO_GRAVEL, wGravel, mat);
      const blade = fine > 0.01 ? nz(gx * 58 + 5, gy * 21 + 13) : 0.5; // شفرات عشب/حبيبات مستطيلة
      const peb = fine > 0.01 ? Math.max(0, nz(gx * 14 + 70, gy * 14 + 31) - 0.62) * 2.6 : 0; // حصى
      const var_ = 1 + 0.5 * (nM - 0.5) * mid + 0.85 * (nF - 0.5) * fine + 0.65 * (nG - 0.5) * fine + 0.55 * (blade - 0.5) * fine * (0.4 + wGrass) + peb * fine * (0.5 + wGravel);
      // ناظم دقيق من ميل الضوضاء: ظلال دقيقة تتجه مع الشمس
      let nx = 0, ny = 0, nzv = 1;
      if (fine > 0.02) {
        const eps = 0.012;
        const dx = nz(gx * 6.2 + 11 + eps * 6.2, gy * 6.2 + 4) - nF, dy = nz(gx * 6.2 + 11, gy * 6.2 + 4 + eps * 6.2) - nF;
        const s = (fine * 0.9) / eps * 0.06;
        nx = -dx * s; ny = -dy * s;
        const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l; nzv = 1 / l;
      }
      let rho = mat;
      let kk = var_;
      // لوح الساعة الشمسية: حجر بحبيبات وعروق ورخام خفيف، وحافة بسماكة
      const lx = gx - plate.e, ly = gy - plate.n;
      const rr = Math.hypot(lx, ly);
      if (rr < plate.r + 0.05) {
        if (rr < plate.r) {
          const grain = 0.95 + 0.09 * nz(lx * 14, ly * 14) + 0.09 * (nz(lx * 55, ly * 55) - 0.5) * fine + 0.05 * (nz(lx * 190, ly * 190) - 0.5) * fine;
          nx = 0; ny = 0; nzv = 1;
          const vein = 1 + 0.12 * (fbm(lx * 1.4 + 5, ly * 1.4, 3) - 0.5);
          const fx = Math.abs(((lx / 0.5) % 1 + 1) % 1 - 0.5), fy = Math.abs(((ly / 0.5) % 1 + 1) % 1 - 0.5);
          const joint = Math.min(0.5 - fx, 0.5 - fy) < 0.012 ? 0.62 : 1;
          const chamfer = rr > plate.r - 0.03 ? 1.12 : 1;
          rho = RHO_STONE; kk = grain * vein * joint * chamfer;
        } else { rho = RHO_STONE; kk = 0.22; } // جدار اللوح الجانبي في ظل نفسه
      }
      irradiate(rho, nx, ny, nzv, kk, acc);
      toCameraRGB(acc[0], acc[1], acc[2], bytes, 0, SAT_GROUND);
      // ضباب جوي: لون الأفق، ويقوى بالبعد (مدى رؤية نحو 10 كم)
      const f = 1 - Math.exp(-t / 3200);
      const hz = 0.94;
      gp[k] = bytes[0] + (haze[0] * hz - bytes[0]) * f;
      gp[k + 1] = bytes[1] + (haze[1] * hz - bytes[1]) * f;
      gp[k + 2] = bytes[2] + (haze[2] * hz - bytes[2]) * f;
      gp[k + 3] = 255 * alpha;
    }
  }
  void lit;
}

// ───────────────────────── الرسم على اللوحة ─────────────────────────
interface Buf { canvas: HTMLCanvasElement; img: ImageData; w: number; h: number }
let skyBuf: Buf | null = null;
let groundBuf: Buf | null = null;
function ensureBuf(b: Buf | null, w: number, h: number): Buf {
  if (b && b.w === w && b.h === h) return b;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  return { canvas, img: new ImageData(w, h), w, h };
}
// المسار على كرت الشاشة (WebGL2) إن توفّر، وإلا المسار الحاسوبي أعلاه
let gpu: GpuBackground | null | undefined;
let gpuEnabled = true;
let gpuUploaded = -1;
let usingGpu = false;
let lastFrame: GpuFrame | null = null;
/** للاختبار: تعطيل المسار على كرت الشاشة */
export function setGpuEnabled(v: boolean): void { gpuEnabled = v; }
export const isUsingGpu = () => usingGpu;
/** يتغيّر عند اكتمال تحميل أنسجة الأرض (لإعادة الرسم) */
export const getGpuStamp = () => (gpu ? gpu.ready() : 0);

export function paintSkyBackground(ctx: CanvasRenderingContext2D, P: Projector, opt: BgOptions, plate: BgPlate, scale: number): void {
  if (gpuEnabled && gpu === undefined) gpu = createGpuBackground();
  if (gpuEnabled && gpu && !gpu.lost() && skyTex) {
    if (gpuUploaded !== skyVersion) { gpu.setSkyTexture(skyTex, AZN, ELN); gpuUploaded = skyVersion; }
    const dpr = Math.max(1, ctx.canvas.width / Math.max(1, P.w));
    lastFrame = { P, dpr, eyeH: opt.eyeHeightM, plate, ground: opt.ground, light: { exposure, sunDir: light.sunDir, sunE: light.sunE, moonDir: light.moonDir, moonE: light.moonE, diffuse: light.diffuse } };
    gpu.drawSky(ctx, lastFrame);
    usingGpu = true;
    return;
  }
  usingGpu = false;
  const bw = Math.max(32, Math.round(P.w * scale)), bh = Math.max(32, Math.round(P.h * scale));
  skyBuf = ensureBuf(skyBuf, bw, bh); groundBuf = ensureBuf(groundBuf, bw, bh);
  fillBackgroundPixels(P, opt, plate, bw, bh, skyBuf.img.data, groundBuf.img.data);
  skyBuf.canvas.getContext('2d')!.putImageData(skyBuf.img, 0, 0);
  groundBuf.canvas.getContext('2d')!.putImageData(groundBuf.img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(skyBuf.canvas, 0, 0, P.w, P.h);
}
/** صورة الأرض (تُرسم بعد الأجرام فتحجب ما تحت الأفق) */
export function paintGroundLayer(ctx: CanvasRenderingContext2D, P: Projector): void {
  if (usingGpu && gpu && lastFrame) { gpu.drawGround(ctx, lastFrame); return; }
  if (!groundBuf) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(groundBuf.canvas, 0, 0, P.w, P.h);
}

/** لون السماء الحالي (sRGB 0..255) باتجاه معيّن، أو null قبل بناء النسيج */
export function skyColorAt(altDeg: number, azDeg: number): [number, number, number] | null {
  if (!skyTex) return null;
  const o = [0, 0, 0]; sampleSky(Math.max(0, altDeg), azDeg, o);
  return [o[0], o[1], o[2]];
}
