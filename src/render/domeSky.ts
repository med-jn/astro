import { addSkyRadiance, makeMoonLight, makeSunLight } from '../core/skyRadiance';
import { refractionDeg } from '../core/skyModel';

/**
 * سماء قبة الراصد: صورة تُحسب من إشعاع فيزيائي (core/skyRadiance) ثم تُرسم داخل القبة بدل التدرج الشعاعي القديم.
 *
 * الإشعاع يعتمد على (الارتفاع، السمت النسبي للشمس) فقط، فيُحسب جدول واحد (أرخص بكثير من حساب كل بكسل) ويُعاد استعماله
 * مع أي سمت للشمس. الجدول يُعاد بناؤه فقط عند تغيّر ارتفاع الشمس/القمر محسوساً (وبحدّ زمني) فلا يثقل التشغيل المتسارع.
 *
 * ما يضيفه هذا الملف فوق التشتّت الأحادي (الذي ينهار بعد −10° لأن الظل يبلغ قمة الغلاف):
 *   • حدّ انتشار ضوئي أزرق عند السمت معايَر بقياسات سطوع السمت أثناء الغسق (−12° ≈ 1.7e-3، −14° ≈ 9e-4، −16° ≈ 2e-4 cd/m²).
 *   • نطاق «الضوء الأول» الأفقي: توهّج فوق أفق الشمس يبدأ نحو −18°، ارتفاع حدّه ~3° عندئذٍ ثم يتسع ويشتد تدريجياً مع اقتراب
 *     الشمس، وله حدّ علوي واضح (لا يذوب في ليل السماء) وامتداد سمتي واسع مع تفضيل جهة الشمس.
 *   • سماء الليل الطبيعية (توهّج الغلاف الليلي) وضوء القمر.
 */
const NE = 48; // عقد الارتفاع (غير منتظمة: كثيفة قرب الأفق)
const ND = 61; // عقد السمت النسبي 0..180° كل 3° (السماء متناظرة حول مستوى الشمس)
const SZ = 256; // دقة صورة السماء (بكسل)
const DEG = Math.PI / 180;

const NIGHT_Y = 2.2e-4;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lumY = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const unitY = (c: number[]) => { const y = lumY(c); return [c[0] / y, c[1] / y, c[2] / y]; };

const COOL = unitY([0.78, 0.88, 1.0]);
const WARM = unitY([1.0, 0.78, 0.55]);
const DIFFUSE = unitY([0.10, 0.28, 1.0]); // أزرق الغسق العميق: امتصاص الأوزون يأكل الأحمر والأخضر
const NIGHT_RGB = unitY([0.22, 0.5, 1.0]); // ليل أزرق داكن لا رمادي

/** سطوع السمت لجزء الانتشار الغسقي (cd/m²) مقابل عمق الشمس بالدرجات */
const Y_ZEN_REF: [number, number][] = [[6, 0.45], [9, 0.03], [12, 0.0017], [14, 9e-4], [16, 2.2e-4], [18, 3e-5], [20, 0]];
function zenithReference(dep: number): number {
  if (dep <= Y_ZEN_REF[0][0]) return Y_ZEN_REF[0][1];
  for (let i = 0; i < Y_ZEN_REF.length - 1; i++) {
    const [d0, y0] = Y_ZEN_REF[i], [d1, y1] = Y_ZEN_REF[i + 1];
    if (dep <= d1) {
      if (y1 <= 0) return y0 * (1 - (dep - d0) / (d1 - d0));
      const f = (dep - d0) / (d1 - d0);
      return Math.exp(Math.log(y0) * (1 - f) + Math.log(y1) * f);
    }
  }
  return 0;
}

const elAt = (j: number) => 90 * Math.pow(j / (NE - 1), 2);

function buildSunTable(sunGeomAlt: number): Float32Array {
  const tab = new Float32Array(NE * ND * 3);
  const dep = -sunGeomAlt;
  const light = makeSunLight(sunGeomAlt, 0);
  const o = [0, 0, 0];
  addSkyRadiance(o, light, 90, 0);
  const singleZenith = lumY(o);
  const diffY = Math.max(0, zenithReference(dep) - singleZenith) * smooth(5.5, 9, dep);
  const bandA = (dep <= 20 ? 9e-2 * Math.pow(10, -0.25 * (dep - 12)) : 9e-4 * Math.pow(10, -0.4 * (dep - 20))) * smooth(7, 11, dep);
  const hb = 3.2 * Math.exp(0.1 * (18 - dep));
  for (let j = 0; j < NE; j++) {
    const e = elAt(j);
    for (let i = 0; i < ND; i++) {
      const d = i * 3;
      let r = 0, g = 0, b = 0;
      if (dep < 17 && sunGeomAlt > -17) {
        o[0] = o[1] = o[2] = 0;
        addSkyRadiance(o, light, e, d);
        r = o[0]; g = o[1]; b = o[2];
      }
      const cd = Math.cos(d * DEG);
      if (diffY > 0) {
        const D = 1 + 1.5 * Math.exp(-e / 18) * (1 + cd) / 2;
        r += diffY * D * DIFFUSE[0]; g += diffY * D * DIFFUSE[1]; b += diffY * D * DIFFUSE[2];
      }
      if (bandA > 1e-9) {
        const B = 0.07 + 0.93 * Math.exp(-((d / 52) ** 2));
        const V = 1 / (1 + Math.pow(e / hb, 2.8));
        const warm = Math.exp(-e / (0.45 * hb)) * (0.4 + 0.6 * Math.exp(-((d / 35) ** 2)));
        const a = bandA * B * V;
        r += a * (COOL[0] * (1 - warm) + WARM[0] * warm);
        g += a * (COOL[1] * (1 - warm) + WARM[1] * warm);
        b += a * (COOL[2] * (1 - warm) + WARM[2] * warm);
      }
      const k = (j * ND + i) * 3;
      tab[k] = r; tab[k + 1] = g; tab[k + 2] = b;
    }
  }
  return tab;
}

function buildMoonTable(moonGeomAlt: number, phase: number): Float32Array {
  const tab = new Float32Array(NE * ND * 3);
  const light = makeMoonLight(moonGeomAlt, 0, phase);
  const o = [0, 0, 0];
  for (let j = 0; j < NE; j++) {
    const e = elAt(j);
    for (let i = 0; i < ND; i++) {
      o[0] = o[1] = o[2] = 0;
      addSkyRadiance(o, light, e, i * 3);
      const k = (j * ND + i) * 3;
      tab[k] = o[0]; tab[k + 1] = o[1]; tab[k + 2] = o[2];
    }
  }
  return tab;
}

// ───────────────────────── تعيين السطوع إلى لون الشاشة ─────────────────────────
/**
 * منحنى تعيين السطوع الفيزيائي (cd/m²) إلى مستوى الشاشة الخطي: خطي مقطعي على لوغاريتم السطوع (العين تقيس نسبياً — قانون فيبر).
 * مرتكزاته (تقريب لإدراك العين المتكيّفة): ليل السماء الطبيعي شبه أسود، نهاية الغسق الملاحي أزرق داكن، نهاية المدني متوسط الظلمة،
 * وسماء الظهيرة (≈3×10³) مستوى عالٍ دون احتراق. تبقى الفروق الدقيقة قرب الليل مرئية، فيظهر الفجر الأول «خافتاً واضحاً» على الأفق.
 */
const TONE: [number, number][] = [
  [-4, 0.0006], [-3.7, 0.0010], [-3, 0.010], [-2.4, 0.03], [-1.5, 0.06], [-0.4, 0.095],
  [0.7, 0.15], [1.7, 0.25], [2.7, 0.43], [3.5, 0.62], [4.3, 0.88], [5, 1.0],
];
function displayLevel(y: number): number {
  const ly = Math.log10(Math.max(y, 1e-9));
  if (ly <= TONE[0][0]) return TONE[0][1];
  for (let i = 0; i < TONE.length - 1; i++) {
    const [x0, v0] = TONE[i], [x1, v1] = TONE[i + 1];
    if (ly <= x1) return v0 + ((ly - x0) / (x1 - x0)) * (v1 - v0);
  }
  return 1;
}
const GAMMA_LUT = (() => { const t = new Uint8ClampedArray(2048); for (let i = 0; i < 2048; i++) t[i] = Math.round(255 * Math.pow(i / 2047, 1 / 2.2)); return t; })();
const enc = (v: number) => GAMMA_LUT[Math.max(0, Math.min(2047, Math.round(v * 2047)))];

// ───────────────────────── الصورة والتخزين المؤقت ─────────────────────────
export interface DomeSkyInput {
  /** ارتفاعات ظاهرية (بعد الانكسار) وسمت الشمس والقمر */
  sunAlt: number; sunAz: number;
  moonAlt: number; moonAz: number; moonPhase: number;
  /** حصة قرص الشمس غير المحجوبة (1 بلا كسوف) */
  sunFraction: number;
}

let canvas: HTMLCanvasElement | null = null;
let image: ImageData | null = null;
let geomE: Float32Array | null = null;
let geomAz: Float32Array | null = null;
let sunTab: Float32Array | null = null;
let sunTabAlt = NaN;
let moonTab: Float32Array | null = null;
let moonTabKey = '';
let tabStamp = 0;
let tabVersion = 0;
let imageKey = '';

function ensureGeometry() {
  if (geomE) return;
  geomE = new Float32Array(SZ * SZ);
  geomAz = new Float32Array(SZ * SZ);
  for (let y = 0; y < SZ; y++) {
    for (let x = 0; x < SZ; x++) {
      const u = ((x + 0.5) / SZ) * 2 - 1, v = ((y + 0.5) / SZ) * 2 - 1;
      const rho = Math.hypot(u, v);
      const k = y * SZ + x;
      geomE[k] = rho >= 1 ? -1 : 90 * (1 - rho); // إسقاط متساوي المسافة: ρ=(90−ارتفاع)/90
      let az = Math.atan2(u, -v) / DEG; // الشمال أعلى، الشرق يميناً
      if (az < 0) az += 360;
      geomAz![k] = az;
    }
  }
}

function sampleTab(tab: Float32Array, e: number, d: number, scale: number, out: number[]) {
  const te = Math.sqrt(e / 90) * (NE - 1);
  const j0 = Math.min(NE - 2, Math.floor(te)), fj = te - j0;
  const td = Math.min(ND - 1.0001, d / 3);
  const i0 = Math.floor(td), fi = td - i0;
  for (let c = 0; c < 3; c++) {
    const a = tab[(j0 * ND + i0) * 3 + c], b = tab[(j0 * ND + i0 + 1) * 3 + c];
    const p = tab[((j0 + 1) * ND + i0) * 3 + c], q = tab[((j0 + 1) * ND + i0 + 1) * 3 + c];
    out[c] += scale * ((a * (1 - fi) + b * fi) * (1 - fj) + (p * (1 - fi) + q * fi) * fj);
  }
}

/**
 * يجهّز جداول الإشعاع للشمس والقمر (يُعاد بناؤها عند تغيّر محسوس وبحدّ زمني) ويعيد رقم نسخة تتغير عند إعادة البناء.
 * مشتركة بين القبة وعين الراصد: كلتاهما تقرأ الجداول عبر skyLinearAt.
 */
export function ensureSkyTables(inp: DomeSkyInput, nowMs: number): number {
  const sunGeom = inp.sunAlt - refractionDeg(Math.max(inp.sunAlt, -1));
  const moonGeom = inp.moonAlt - refractionDeg(Math.max(inp.moonAlt, -1));
  const needSun = sunGeom > -22;
  const needMoon = sunGeom < -5 && moonGeom > -3 && inp.moonPhase > 0.04;
  const moonKey = needMoon ? `${Math.round(moonGeom / 0.5)}|${Math.round(inp.moonPhase * 25)}` : '';

  // إعادة بناء الجداول: عند تغيّر محسوس، وبحدّ ≥ 90ms بين عمليتين (التشغيل المتسارع لا يُثقَل)
  const sunChanged = needSun && (sunTab === null || Math.abs(sunGeom - sunTabAlt) > 0.12);
  const moonChanged = needMoon ? moonKey !== moonTabKey : moonTab !== null && moonTabKey !== '';
  if ((sunChanged || moonChanged || (!needSun && sunTab)) && (nowMs - tabStamp > 90 || tabVersion === 0 || (needSun && sunTab === null))) {
    if (needSun) { sunTab = buildSunTable(sunGeom); sunTabAlt = sunGeom; } else { sunTab = null; sunTabAlt = NaN; }
    if (needMoon) { moonTab = buildMoonTable(moonGeom, inp.moonPhase); moonTabKey = moonKey; } else { moonTab = null; moonTabKey = ''; }
    tabStamp = nowMs; tabVersion++;
  }
  return tabVersion;
}

/** إشعاع خطي (cd/m²، ثلاث قنوات) لاتجاه (ارتفاع e، سمت az) — بعد ensureSkyTables */
export function skyLinearAt(e: number, az: number, sunAz: number, moonAz: number, sunFraction: number, out: number[]): void {
  const nf = NIGHT_Y * (1 + 0.8 * Math.exp(-e / 12));
  out[0] = nf * NIGHT_RGB[0]; out[1] = nf * NIGHT_RGB[1]; out[2] = nf * NIGHT_RGB[2];
  if (sunTab) {
    let d = Math.abs(az - sunAz); d %= 360; if (d > 180) d = 360 - d;
    sampleTab(sunTab, e, d, Math.max(0, Math.min(1, sunFraction)), out);
  }
  if (moonTab) {
    let d = Math.abs(az - moonAz); d %= 360; if (d > 180) d = 360 - d;
    sampleTab(moonTab, e, d, 1, out);
  }
}

/** إشعاع خطي → بايتات sRGB (RGBA) عند الإزاحة off: تعيين لوغاريتمي للسطوع مع حفظ اللون */
export function toDisplayRGB(acc: number[], px: Uint8ClampedArray | Uint8Array, off: number): void {
  const y = Math.max(1e-9, lumY(acc));
  const L = displayLevel(y);
  let cr = Math.pow(acc[0] / y, 0.85), cg = Math.pow(acc[1] / y, 0.85), cb = Math.pow(acc[2] / y, 0.85);
  const cy = lumY([cr, cg, cb]); cr /= cy; cg /= cy; cb /= cy;
  const boost = 1 + 0.45 * smooth(150, 1500, y) - 0.5 * smooth(8000, 60000, y);
  let r = 1 + (cr - 1) * boost, g = 1 + (cg - 1) * boost, b = 1 + (cb - 1) * boost;
  r = Math.max(0, r) * L; g = Math.max(0, g) * L; b = Math.max(0, b) * L;
  const m = Math.max(r, g, b);
  if (m > 1) { const s = 1 / m; r *= s; g *= s; b *= s; }
  px[off] = enc(r); px[off + 1] = enc(g); px[off + 2] = enc(b); px[off + 3] = 255;
}

/** صورة السماء الجاهزة (شمال أعلى، شرق يميناً، قرص الأفق يملأ المربع) — تُرسم بمصفوفة تحويل القبة */
export function getDomeSkyCanvas(inp: DomeSkyInput, nowMs: number): HTMLCanvasElement {
  if (!canvas) { canvas = document.createElement('canvas'); canvas.width = canvas.height = SZ; image = new ImageData(SZ, SZ); }
  ensureGeometry();
  ensureSkyTables(inp, nowMs);

  const key = `${tabVersion}|${Math.round(inp.sunAz / 0.15)}|${Math.round(inp.moonAz / 0.3)}|${Math.round(inp.sunFraction * 100)}`;
  if (key === imageKey) return canvas;
  imageKey = key;

  const px = image!.data;
  const acc = [0, 0, 0];
  for (let k = 0; k < SZ * SZ; k++) {
    const e = geomE![k];
    if (e < 0) { px[k * 4 + 3] = 0; continue; }
    skyLinearAt(e, geomAz![k], inp.sunAz, inp.moonAz, inp.sunFraction, acc);
    toDisplayRGB(acc, px, k * 4);
  }
  canvas.getContext('2d')!.putImageData(image!, 0, 0);
  return canvas;
}

export const DOME_SKY_SIZE = SZ;
