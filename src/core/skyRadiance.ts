/**
 * إشعاع السماء (سطوع ولون) لقبة الراصد — نموذج تشتّت أحادي فيزيائي بثلاث قنوات لونية.
 *
 * لماذا نموذج لا جداول ألوان: ما يميّز الفجر والشفق ليس لوناً بل «هندسة ظل الأرض»: الغلاف الجوي مضاء فقط حيث تصله
 * أشعة الشمس فوق سطح الأرض، فيظهر قوس الغسق ويرتفع حدّه كلما اقتربت الشمس، ويظهر ظل الأرض في الجهة المقابلة بحزام الزهرة
 * الوردي فوقه. هذه كلها تنتج تلقائياً من تكامل التشتّت على خط النظر مع معرفة موضع كل نقطة من الأرض نسبةً للشمس.
 *
 * المعادلة (لكل قناة لونية c): L_c = E_c · ∫ [β_R,c(z)·P_R(θ) + ω·β_M,c(z)·P_M(θ)] · T_شمس,c · T_نظر,c · ds
 *   • β_R: تشتّت رايلي (∝ λ⁻⁴، ارتفاع مقياس 8 كم) · β_M: هباء (أنغستروم α=1.3، 1.2 كم، طور هنيي–غرينشتاين g=0.76).
 *   • T_شمس: نفاذية ضوء الشمس إلى نقطة التشتّت (رايلي + هباء + أوزون شابويس، فتحمرّ الأشعة الماسّة وتُزرَّق ذروة الغسق).
 *     تُحسب مرة واحدة في جدول (ارتفاع النقطة × ارتفاع الشمس عندها)، وتساوي صفراً إن حجبتها الأرض.
 *   • θ: زاوية التشتّت بين خط النظر والشمس.
 *
 * المعايرة (مراجع قياسية): سطوع السمت ≈0.45 cd/m² عند نهاية الغسق المدني (−6°)، ≈0.0019 عند نهاية الملاحي (−12°)،
 * وسماء الليل الطبيعية ≈0.00022. التشتّت الأحادي يقلّل السطوع عند الغسق العميق (التشتّت المتعدد يهيمن) فيُضاف حدّ تعويضي معايَر.
 *
 * ملف رياضي صرف (بلا DOM) لسهولة الاختبار.
 */
const DEG = Math.PI / 180;
const R_E = 6371; // كم
const TOP = 100; // كم: قمة الغلاف المؤثر
const H_R = 8;
const H_M = 1.2;
const OZONE_Z = 25;
const OZONE_S = 7;

/** أطوال الموجة (µm) للقنوات أحمر/أخضر/أزرق */
const LAMBDA = [0.64, 0.55, 0.46];
const TAU_R0 = LAMBDA.map((l) => 0.008569 * Math.pow(l, -4) * (1 + 0.0113 * Math.pow(l, -2) + 0.00013 * Math.pow(l, -4)));
/** عمق بصري رأسي للهباء عند 550nm: جو صافٍ (≈0.06). الهباء الأكبر يُبيّض الأزرق ويُغني الأفق */
export const AEROSOL_TAU_550 = 0.06;
const TAU_M0 = LAMBDA.map((l) => AEROSOL_TAU_550 * Math.pow(0.55 / l, 1.3));
const OMEGA_M = 0.92;
const G_M = 0.76;
/** أوزون 300 DU: امتصاص شابويس (أحمر/أخضر) شبه معدوم في الأزرق */
const TAU_O0 = [0.033, 0.032, 0.0045];

/** إضاءة الشمس خارج الغلاف (lux) وتوزيعها اللوني الأبيض-الدافئ */
const E_SUN = 1.27e5;
const SUN_RGB = [1.02, 1.0, 0.94];

const ozoneDensity = (z: number) => Math.exp(-0.5 * ((z - OZONE_Z) / OZONE_S) ** 2) / (OZONE_S * Math.sqrt(2 * Math.PI));

// ───────────────────────── جدول النفاذية ─────────────────────────
const Z_GRID = [0, 0.5, 1, 2, 3, 4.5, 6, 8, 10, 13, 16, 20, 25, 32, 45, 70, 100];
const H_GRID = [-14, -12, -10, -8, -7, -6, -5, -4, -3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 13, 17, 22, 30, 40, 55, 70, 90];
const BLOCKED_TAU = 60;
let lut: Float32Array | null = null;

/** تكامل العمق البصري على شعاع من ارتفاع zKm بزاوية hDeg حتى قمة الغلاف (بلا منطق ظل) */
function integrateTau(zKm: number, hDeg: number, out: number[]) {
  const r0 = R_E + zKm;
  const h = hDeg * DEG;
  const sinH = Math.sin(h), cosH = Math.cos(h);
  const b = r0 * sinH;
  const rTop = R_E + TOP;
  const disc = b * b - (r0 * r0 - rTop * rTop);
  const lExit = -b + Math.sqrt(Math.max(0, disc));
  if (lExit <= 0) { out[0] = out[1] = out[2] = 0; return; }
  void cosH;
  const N = 220, dl = lExit / N;
  let iR = 0, iM = 0, iO = 0;
  for (let k = 0; k < N; k++) {
    const l = (k + 0.5) * dl;
    const r = Math.sqrt(Math.max(R_E * R_E, r0 * r0 + 2 * l * b + l * l)); // لا نغوص تحت السطح عند المماس
    const z = r - R_E;
    iR += Math.exp(-z / H_R) * dl;
    iM += Math.exp(-z / H_M) * dl;
    iO += ozoneDensity(z) * dl;
  }
  for (let c = 0; c < 3; c++) out[c] = (TAU_R0[c] * iR) / H_R + (TAU_M0[c] * iM) / H_M + TAU_O0[c] * iO;
}

/**
 * عمق بصري لشعاع الشمس إلى نقطة. حدّ ظل الأرض ناعم لا حاد: الانكسار الجوي وعرض قرص الشمس (~0.5°) ينفذان ضوءاً إلى ما تحت المماس
 * الهندسي بنحو 10 كم عند 1000 كم، فنعامل الشعاع الغاطس حتى 8 كم كأنه ماسّ مع عقوبة متدرجة (نفاذية 1 عند المماس → 10⁻³ عند −8 كم).
 */
function slantTau(zKm: number, hDeg: number, out: number[]) {
  let penalty = 0;
  let hUse = hDeg;
  if (hDeg < 0) {
    const r0 = R_E + zKm;
    const tangent = r0 * Math.cos(hDeg * DEG) - R_E;
    if (tangent < -8) { out[0] = out[1] = out[2] = BLOCKED_TAU; return; }
    if (tangent < 0) {
      penalty = -Math.log(Math.max(1e-3, 1 + tangent / 8));
      hUse = -Math.acos(Math.min(1, R_E / r0)) / DEG;
    }
  }
  integrateTau(zKm, hUse, out);
  if (penalty > 0) { out[0] += penalty; out[1] += penalty; out[2] += penalty; }
}

function ensureLut(): Float32Array {
  if (lut) return lut;
  const nz = Z_GRID.length, nh = H_GRID.length;
  const t = new Float32Array(nz * nh * 3);
  const tmp = [0, 0, 0];
  for (let i = 0; i < nz; i++) {
    for (let j = 0; j < nh; j++) {
      slantTau(Z_GRID[i], H_GRID[j], tmp);
      const o = (i * nh + j) * 3;
      t[o] = tmp[0]; t[o + 1] = tmp[1]; t[o + 2] = tmp[2];
    }
  }
  lut = t;
  return t;
}

function bracket(arr: number[], x: number): [number, number] {
  const n = arr.length;
  if (x <= arr[0]) return [0, 0];
  if (x >= arr[n - 1]) return [n - 2, 1];
  let i = 0;
  while (i < n - 2 && x > arr[i + 1]) i++;
  return [i, (x - arr[i]) / (arr[i + 1] - arr[i])];
}

/** عمق بصري على مسار الشمس إلى نقطة (ارتفاعها z كم، وارتفاع الشمس عندها hDeg) — لثلاث قنوات */
function sunTau(t: Float32Array, z: number, hDeg: number, out: number[]) {
  const nh = H_GRID.length;
  const [iz, fz] = bracket(Z_GRID, z);
  const [ih, fh] = bracket(H_GRID, hDeg);
  const a = (iz * nh + ih) * 3, b = (iz * nh + ih + 1) * 3, c = ((iz + 1) * nh + ih) * 3, d = ((iz + 1) * nh + ih + 1) * 3;
  for (let k = 0; k < 3; k++) {
    const top = t[a + k] * (1 - fh) + t[b + k] * fh;
    const bot = t[c + k] * (1 - fh) + t[d + k] * fh;
    out[k] = top * (1 - fz) + bot * fz;
  }
}

// ───────────────────────── مصدر الضوء والتكامل ─────────────────────────
export interface SkyLight {
  /** ارتفاع الضوء الهندسي (بلا انكسار) واتجاهه بالدرجات */
  altDeg: number;
  azDeg: number;
  /** إضاءة المصدر خارج الغلاف (lux). الشمس ≈ 1.27e5 */
  illuminance: number;
  /** حصة الإضاءة اللونية (أبيض-دافئ للشمس) */
  rgb: number[];
}

export function makeSunLight(altDeg: number, azDeg: number, fraction = 1): SkyLight {
  return { altDeg, azDeg, illuminance: E_SUN * fraction, rgb: SUN_RGB };
}

/** القمر: إضاءته خارج الغلاف ≈ 0.34 lux عند البدر وتهبط بسرعة مع الطور (أثر المعارضة) */
export function makeMoonLight(altDeg: number, azDeg: number, phaseFraction: number): SkyLight {
  const k = Math.max(0, Math.min(1, phaseFraction));
  return { altDeg, azDeg, illuminance: 0.34 * k * k * k, rgb: [1.04, 0.99, 0.9] };
}

const SAMPLES = 32;
const POW = 2.5;
const scratch = [0, 0, 0];

/** يضيف إلى out (3 قنوات) إشعاع التشتّت الأحادي لمصدر ضوء من اتجاه (eDeg ارتفاع، azDeg سمت) */
export function addSkyRadiance(out: number[], light: SkyLight, eDeg: number, azDeg: number): void {
  const t = ensureLut();
  const e = Math.max(0, eDeg) * DEG;
  const sinE = Math.sin(e), cosE = Math.cos(e);
  const hs = light.altDeg * DEG;
  const sinHs = Math.sin(hs), cosHs = Math.cos(hs);
  const cosD = Math.cos((azDeg - light.azDeg) * DEG);
  const cosTh = sinE * sinHs + cosE * cosHs * cosD;
  const pR = (3 / (16 * Math.PI)) * (1 + cosTh * cosTh);
  const g2 = G_M * G_M;
  const pM = (1 - g2) / (4 * Math.PI * Math.pow(1 + g2 - 2 * G_M * cosTh, 1.5));
  const sMax = -R_E * sinE + Math.sqrt(R_E * R_E * sinE * sinE + 2 * R_E * TOP + TOP * TOP);

  let vR = 0, vG = 0, vB = 0; // عمق نظر تراكمي لكل قناة
  let sumR = 0, sumG = 0, sumB = 0;
  let sPrev = 0;
  for (let k = 0; k < SAMPLES; k++) {
    const sNext = sMax * Math.pow((k + 1) / SAMPLES, POW);
    const ds = sNext - sPrev;
    const s = 0.5 * (sNext + sPrev);
    sPrev = sNext;
    const x = s * cosE, y = R_E + s * sinE;
    const r = Math.sqrt(x * x + y * y);
    const z = r - R_E;
    const cosPhi = y / r, sinPhi = x / r;
    const sinHp = sinHs * cosPhi + cosHs * cosD * sinPhi;
    const hp = Math.asin(Math.max(-1, Math.min(1, sinHp))) / DEG;

    const dR = Math.exp(-z / H_R), dM = Math.exp(-z / H_M), dO = ozoneDensity(z);
    // امتصاص/تشتّت على امتداد النظر حتى منتصف هذه الخطوة
    const eR = TAU_R0[0] / H_R * dR + TAU_M0[0] / H_M * dM + TAU_O0[0] * dO;
    const eG = TAU_R0[1] / H_R * dR + TAU_M0[1] / H_M * dM + TAU_O0[1] * dO;
    const eB = TAU_R0[2] / H_R * dR + TAU_M0[2] / H_M * dM + TAU_O0[2] * dO;
    const tvR = vR + 0.5 * eR * ds, tvG = vG + 0.5 * eG * ds, tvB = vB + 0.5 * eB * ds;
    vR += eR * ds; vG += eG * ds; vB += eB * ds;

    sunTau(t, Math.max(0, z), hp, scratch);
    if (scratch[0] >= BLOCKED_TAU - 1) continue; // نقطة في ظل الأرض
    const sR = (TAU_R0[0] / H_R * dR * pR + OMEGA_M * TAU_M0[0] / H_M * dM * pM) * Math.exp(-scratch[0] - tvR) * ds;
    const sG = (TAU_R0[1] / H_R * dR * pR + OMEGA_M * TAU_M0[1] / H_M * dM * pM) * Math.exp(-scratch[1] - tvG) * ds;
    const sB = (TAU_R0[2] / H_R * dR * pR + OMEGA_M * TAU_M0[2] / H_M * dM * pM) * Math.exp(-scratch[2] - tvB) * ds;
    sumR += sR; sumG += sG; sumB += sB;
  }
  out[0] += light.illuminance * light.rgb[0] * sumR;
  out[1] += light.illuminance * light.rgb[1] * sumG;
  out[2] += light.illuminance * light.rgb[2] * sumB;
}

/** عمق بصري على المسار الأفقي إلى الشمس لارتفاع ظاهري معيّن (لونها وسطوعها عند الأفق): نفاذية قرص الشمس المباشر */
export function sunDiscTransmittance(altDeg: number): number[] {
  const t = ensureLut();
  sunTau(t, 0, Math.max(altDeg, -0.8), scratch);
  return [Math.exp(-scratch[0]), Math.exp(-scratch[1]), Math.exp(-scratch[2])];
}


/**
 * لون وسطوع قرص الشمس المباشر عند ارتفاع ظاهري معيّن: انطفاء رايلي + هباء + أوزون على كتلة هوائية Kasten–Young (1989).
 * rgb: نفاذية القنوات مضروبة بطيف الشمس. rel: سطوع القرص نسبةً إلى الشمس في السمت (≈1 ظهراً، ≈5×10⁻⁴ عند الأفق).
 */
export function directSunLight(altAppDeg: number): { rgb: number[]; rel: number } {
  const h = Math.max(altAppDeg, -1);
  const m = 1 / (Math.sin(h * DEG) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
  const rgb: number[] = [], ref: number[] = [];
  for (let c = 0; c < 3; c++) {
    const tau = TAU_R0[c] + TAU_M0[c] + TAU_O0[c];
    rgb.push(Math.exp(-tau * m) * SUN_RGB[c]);
    ref.push(Math.exp(-tau) * SUN_RGB[c]);
  }
  const y = (v: number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  return { rgb, rel: y(rgb) / y(ref) };
}

export const SKY_CONSTANTS = { E_SUN, SUN_RGB };
