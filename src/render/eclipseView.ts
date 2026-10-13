/**
 * رسم المنظر المحلي للكسوف والخسوف كما يراه الراصد بعينه — ثلاثة رسوم مستقلة عن خريطة الأرض:
 *   drawSolarView   : الشمس والقمر المعتم بالقياس الحقيقي بينهما (جزئي/حلقي/كلي) مع الأفق إن وقع في الإطار.
 *   drawLunarView   : قرص القمر بتضاريسه في موضعه الحقيقي (تمايل بصري وفيزيائي) وظل الأرض وشبه ظلها.
 *   drawHorizonStrip: بانوراما 360° للأفق تُظهر الشمس والقمر في الجهتين المتقابلتين (الخسوف الأفقي/المقلوب).
 *
 * ما هو محسوب هندسياً (من eclipses.ts): أحجام الأقراص، الإزاحة بينها، اتجاه السمت، ضغط الانكسار،
 * شكل ظل الأرض وشبه ظله (مساحة تقاطع القرصين فعلاً)، اتجاه سطح القمر، محاذاة الإكليل مع خط استواء الشمس.
 * ما هو مرسوم بأسلوب تصويري: شكل الإكليل ونتوءاته (لا مصدر بيانات لحظي له)، ودرجات ألوان السماء،
 * وتضاريس القمر (مواضع المحيطات والفوهات الكبرى حقيقية بإحداثيات سيلينوغرافية، أما تفاصيلها فاصطناعية).
 */
import type { SolarView, LunarView } from '../core/eclipses';
import { getMoonImage, MOON_IMAGE_ROTATION_CCW_DEG } from './bodyImages';

const DEG = Math.PI / 180;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function smooth(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

// ============================= الغلاف الجوي: لون السماء واحمرار الأجرام =============================

/** كتلة هوائية تقريبية (Kasten–Young) عند ارتفاع ظاهري بالدرجات */
function airmass(altDeg: number): number {
  const a = Math.max(altDeg, -0.5);
  return 1 / (Math.sin(a * DEG) + 0.50572 * Math.pow(a + 6.07995, -1.6364));
}

/** معاملا إخماد وإحمرار الضوء المباشر: tint للقناتين (1, g, b) وbright للسطوع الكلي */
function extinction(altDeg: number): { tint: RGB; bright: number } {
  const X = airmass(altDeg);
  const dx = Math.max(0, X - 1);
  const tint: RGB = [1, Math.exp(-0.016 * dx), Math.exp(-0.042 * dx)];
  const bright = lerp(1, 0.5, smooth(0, 14, dx));
  return { tint, bright };
}

/**
 * لون السماء حول القرص: يعتمد ارتفاع الشمس الحقيقي، ونسبة ما بقي من ضوئها (1 = لا كسوف، 0 = كلية).
 * ألوان تصويرية لكنها تتبع تتابع الفجر/الغسق الحقيقي.
 */
function skyPalette(sunTrueAltDeg: number, light: number): { zenith: RGB; horizon: RGB } {
  const day = smooth(-4, 8, sunTrueAltDeg);
  const dusk = 1 - smooth(-9, -1, Math.abs(sunTrueAltDeg + 1.5) > 0 ? sunTrueAltDeg : 0); // 1 قرب الأفق
  const night: RGB = [3, 5, 14];
  const dayZenith: RGB = [58, 118, 205];
  const dayHorizon: RGB = [168, 205, 238];
  const duskHorizon: RGB = [255, 150, 70];
  const duskZenith: RGB = [38, 66, 124];
  let z = mix(night, mix(duskZenith, dayZenith, day), smooth(-12, -2, sunTrueAltDeg));
  let h = mix(night, mix(duskHorizon, dayHorizon, day), smooth(-12, -2, sunTrueAltDeg));
  void dusk;
  // ضوء الكسوف يخفت نحو لون الغسق (360° حول الراصد في الكلية)
  const dim = clamp(light, 0, 1);
  z = mix(mix(night, [10, 16, 48], 0.6), z, dim);
  h = mix([230, 120, 55], h, dim);
  return { zenith: z, horizon: h };
}

/** سطوع السماء المحسوس حول الشمس (0 كلية .. 1 نهار كامل) من نسبة التغطية: منحنى يقترب من الإدراك */
function lightFromObscuration(obsc: number, phase: SolarView['phase']): number {
  if (phase === 'total') return 0.012;
  const o = clamp(obsc, 0, 1);
  return Math.max(0.02, Math.pow(1 - o, 0.45));
}

// ============================= رسم الأرض (الأفق) داخل الإطار =============================

function drawGround(ctx: CanvasRenderingContext2D, w: number, y: number, h: number, glow: RGB, glowA: number) {
  const g = ctx.createLinearGradient(0, y, 0, y + Math.max(10, (h - y) * 0.35));
  g.addColorStop(0, css(mix([6, 7, 10], glow, 0.18), 1));
  g.addColorStop(1, 'rgb(3,4,6)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y, w, h - y);
  // وهج رقيق فوق خط الأفق
  const hg = ctx.createLinearGradient(0, y - 30, 0, y);
  hg.addColorStop(0, css(glow, 0));
  hg.addColorStop(1, css(glow, glowA));
  ctx.fillStyle = hg;
  ctx.fillRect(0, y - 30, w, 30);
}

// ============================= كسوف الشمس =============================

/** نواتئ ثابتة موزعة حول الحافة (بدلاً من عشوائية متغيرة في كل إطار) */
const PROMINENCES: { ang: number; size: number }[] = [
  { ang: 0.4, size: 0.16 }, { ang: 1.9, size: 0.1 }, { ang: 2.8, size: 0.22 },
  { ang: 3.9, size: 0.12 }, { ang: 4.7, size: 0.19 }, { ang: 5.6, size: 0.09 },
];
/** خطوط الإكليل: [زاوية بالراديان من خط الاستواء الشمسي، طول بوحدة نصف قطر الشمس، عرض] */
const STREAMERS: [number, number, number][] = [
  [0.0, 4.4, 0.26], [Math.PI, 4.1, 0.26], [0.22, 3.0, 0.18], [Math.PI - 0.25, 3.3, 0.18], [-0.2, 2.8, 0.17],
  [Math.PI + 0.22, 2.7, 0.17], [0.55, 2.0, 0.16], [Math.PI - 0.6, 2.2, 0.16], [-0.6, 2.0, 0.15], [Math.PI + 0.55, 1.9, 0.15],
  [Math.PI / 2, 1.55, 0.12], [-Math.PI / 2, 1.5, 0.12], [1.15, 1.7, 0.1], [-1.2, 1.65, 0.1], [Math.PI - 1.15, 1.7, 0.1], [Math.PI + 1.2, 1.6, 0.1],
];

export interface SolarViewOptions {
  /** نصف قطر قرص الشمس بالبكسل (الافتراضي: 17% من أقصر بُعد) */
  sunRadiusPx?: number;
}

export function drawSolarView(ctx: CanvasRenderingContext2D, w: number, h: number, v: SolarView, opts: SolarViewOptions = {}) {
  const cx = w / 2, cy = h / 2;
  const R = opts.sunRadiusPx ?? Math.min(w, h) * 0.17;
  const scale = R / v.sun.radiusDeg; // بكسل لكل درجة
  const flat = v.flatten;
  const light = lightFromObscuration(v.obscuration, v.phase);
  const pal = skyPalette(v.sun.trueAltDeg, light);
  const { tint, bright } = extinction(v.sun.altDeg);

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // ----- السماء -----
  const horizonY = cy + v.sun.altDeg * scale; // الأفق على بعد الارتفاع الظاهري تحت مركز الشمس
  const hasHorizon = horizonY < h + 40 && horizonY > -40;
  {
    // قرب الشمس: ابيضاض الوهج الجوي (يخفت مع الكسوف حتى الزرقة الداكنة في الكلية)
    const glowMix = clamp(light * 1.1, 0, 1) * smooth(-3, 6, v.sun.trueAltDeg);
    const near = mix(mix([20, 27, 64], [34, 40, 84], 0.5), mix(pal.zenith, [235, 240, 250], glowMix * 0.85), clamp(light * 3, 0, 1));
    const far = mix([8, 11, 30], pal.zenith, clamp(light * 3, 0, 1));
    const sky = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, Math.hypot(w, h) * 0.75);
    sky.addColorStop(0, css(near));
    sky.addColorStop(0.5, css(mix(near, far, 0.6)));
    sky.addColorStop(1, css(far));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    if (hasHorizon) {
      // تدرّج السماء نحو الأفق (لون الأفق أفتح/أدفأ؛ في الكلية برتقالي خافت 360°)
      const y0 = Math.min(horizonY, h);
      const hg = ctx.createLinearGradient(0, Math.max(0, y0 - h * 0.7), 0, y0);
      hg.addColorStop(0, css(pal.horizon, 0));
      hg.addColorStop(1, css(pal.horizon, 0.85));
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, w, y0);
    }
  }

  // ----- الإكليل (عند الكلية فقط، وفق شرط ظهوره الفعلي: القمر يغطي القرص كله) -----
  const mx = cx + v.dxDeg * scale;
  const my = cy - v.dyDeg * scale * flat;
  const rM = v.moon.radiusDeg * scale;
  const total = v.phase === 'total';
  // يبدأ ظهور الإكليل قبيل التماس الثاني: نتدرج من قدر 0.985 (الهلال الرفيع جداً) إلى الكلية
  const coronaK = total ? 1 : smooth(0.985, 1.0, v.magnitude);
  const pole = v.poleAngleDeg * DEG; // من أعلى الشاشة باتجاه اليمين
  const eqAng = pole + Math.PI / 2;   // اتجاه خط استواء الشمس على الشاشة (قياس رياضي: x يميناً، y لأسفل)
  if (coronaK > 0.001) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy);
    ctx.scale(1, flat);
    ctx.globalAlpha = coronaK;
    // الإكليل الداخلي والخارجي (انخفاض أسّي تقريباً)
    const g1 = ctx.createRadialGradient(0, 0, R * 0.98, 0, 0, R * 1.9);
    g1.addColorStop(0, 'rgba(255,248,235,0.95)');
    g1.addColorStop(0.18, 'rgba(255,240,215,0.55)');
    g1.addColorStop(1, 'rgba(255,235,210,0)');
    ctx.fillStyle = g1;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.9, 0, Math.PI * 2); ctx.fill();
    const g2 = ctx.createRadialGradient(0, 0, R, 0, 0, R * 4.6);
    g2.addColorStop(0, 'rgba(220,230,255,0.30)');
    g2.addColorStop(0.35, 'rgba(190,205,245,0.12)');
    g2.addColorStop(1, 'rgba(160,180,235,0)');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(0, 0, R * 4.6, 0, Math.PI * 2); ctx.fill();
    // الخطوط الإكليلية على طول خط الاستواء الشمسي: بقع إهليلجية ناعمة الحواف
    for (const [a, len, wid] of STREAMERS) {
      const ang = eqAng + a;
      const L = R * len, W = R * wid * 1.6;
      ctx.save();
      ctx.rotate(ang);
      ctx.translate(R * 0.9 + L * 0.5, 0);
      ctx.scale(L * 0.5, W);
      const gr = ctx.createRadialGradient(-0.55, 0, 0, 0, 0, 1);
      gr.addColorStop(0, 'rgba(255,246,230,0.34)');
      gr.addColorStop(0.45, 'rgba(235,235,250,0.12)');
      gr.addColorStop(1, 'rgba(220,225,255,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ----- هالة الشمس تخفت بقدر ما بقي من ضوئها -----
  const glowA = Math.sqrt(clamp(1 - v.obscuration, 0, 1)) * bright;
  if (glowA > 0.005 && v.sun.altDeg > -1) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, flat);
    const glow = ctx.createRadialGradient(0, 0, R * 0.5, 0, 0, R * 3.4);
    glow.addColorStop(0, css([255 * tint[0], 252 * tint[1], 235 * tint[2]], 0.75 * glowA));
    glow.addColorStop(0.25, css([255 * tint[0], 232 * tint[1], 170 * tint[2]], 0.35 * glowA));
    glow.addColorStop(1, css([255 * tint[0], 200 * tint[1], 120 * tint[2]], 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, R * 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ----- قرص الشمس: إظلام الحافة (u≈0.6) وتلوّن الإخماد الجوي، منبعج بالانكسار -----
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, flat);
  {
    const sd = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    const mu = (r: number) => Math.sqrt(Math.max(0, 1 - r * r));
    // مركز أبيض مصفرّ وحافة أغمق وأدفأ (إظلام الحافة u≈0.6 أشد في الأزرق)، ثم الإخماد الجوي
    const limb = (r: number): RGB => {
      const k = 1 - mu(r);
      const I = 1 - 0.1 * k;
      const c: RGB = [255 * I, (253 - 42 * k) * I, (246 - 100 * k) * I];
      const dim = 0.8 + 0.2 * bright;
      return [c[0] * tint[0] * dim, c[1] * tint[1] * dim, c[2] * tint[2] * dim];
    };
    for (const st of [0, 0.5, 0.8, 0.93, 0.98, 1]) sd.addColorStop(st, css(limb(st)));
    ctx.fillStyle = sd;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // ----- النتوءات الوردية: تظهر على حافة الشمس قرب التماسين وفي الكلية، من جهة حافة القمر -----
  if (coronaK > 0.001) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, flat);
    ctx.globalAlpha = coronaK;
    for (const p of PROMINENCES) {
      const a = p.ang + eqAng * 0.3;
      const bx = Math.cos(a) * R, by = Math.sin(a) * R;
      const L = R * p.size;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, L * 1.4);
      g.addColorStop(0, 'rgba(255,90,100,0.95)');
      g.addColorStop(0.5, 'rgba(240,70,90,0.5)');
      g.addColorStop(1, 'rgba(240,70,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, L * 1.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ----- قرص القمر المعتم (الجانب المظلم: وهج الأرض الخافت جداً) -----
  if (v.phase !== 'none' || v.separationDeg < v.sun.radiusDeg + v.moon.radiusDeg + 0.4) {
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(1, flat);
    const mg = ctx.createRadialGradient(0, 0, rM * 0.2, 0, 0, rM);
    mg.addColorStop(0, '#07080c');
    mg.addColorStop(0.9, '#05060a');
    mg.addColorStop(1, '#0b0c12');
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.arc(0, 0, rM, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ----- حلقة الألماس: وهج عند آخر/أول شعاع، قبيل/بعد الكلية -----
  if (v.phase !== 'annular' && v.obscuration > 0.985 && v.diameterRatio > 1) {
    // موضع الشعاع: على حافة الشمس في الجهة المقابلة لاتجاه القمر
    const dx = cx - mx, dy = cy - my;
    const d = Math.hypot(dx, dy) || 1;
    const bx = cx + (dx / d) * R, by = cy + (dy / d) * R * flat;
    const closeness = smooth(0.985, 0.9995, Math.min(v.magnitude, 0.9995)) * (total ? 0 : 1);
    const gl = ctx.createRadialGradient(bx, by, 0, bx, by, R * 0.36);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    gl.addColorStop(0, `rgba(255,255,255,${closeness})`);
    gl.addColorStop(0.12, `rgba(255,252,240,${0.85 * closeness})`);
    gl.addColorStop(0.4, `rgba(255,240,205,${0.25 * closeness})`);
    gl.addColorStop(1, 'rgba(255,230,170,0)');
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(bx, by, R * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ----- الأفق والأرض -----
  if (hasHorizon) {
    const glowC = mix([255, 140, 60], [255, 200, 140], smooth(0, 10, v.sun.altDeg));
    drawGround(ctx, w, horizonY, h, glowC, 0.22 * clamp(light + 0.25, 0, 1));
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, horizonY + 0.5); ctx.lineTo(w, horizonY + 0.5); ctx.stroke();
  }
  ctx.restore();
}

// ============================= تضاريس القمر (نسيج اصطناعي بمواضع حقيقية) =============================

interface Mare { lat: number; lon: number; ns: number; ew: number; alb: number }
interface Crater { lat: number; lon: number; r: number; floor: number; rim: number; rays?: number; rayLen?: number }

/** أبرز بحار القمر بإحداثيات سيلينوغرافية؛ ns/ew أنصاف الأقطار بالدرجات القوسية على السطح */
const MARIA: Mare[] = [
  { lat: 33, lon: -16, ns: 16, ew: 17, alb: 0.3 },     // بحر الأمطار
  { lat: 28, lon: 17.5, ns: 10.5, ew: 11, alb: 0.31 }, // بحر الصفاء
  { lat: 8.5, lon: 31.4, ns: 12, ew: 14, alb: 0.28 },  // بحر الهدوء
  { lat: 17, lon: 59.1, ns: 7, ew: 9, alb: 0.27 },     // بحر الأزمات
  { lat: -7.8, lon: 51.3, ns: 10, ew: 11, alb: 0.33 }, // بحر الخصب
  { lat: -15.2, lon: 35.5, ns: 5, ew: 5.5, alb: 0.34 },// بحر الرحيق
  { lat: -21.3, lon: -16.6, ns: 10, ew: 11, alb: 0.34 },// بحر السحاب
  { lat: -24.4, lon: -38.6, ns: 6, ew: 6.2, alb: 0.32 },// بحر الرطوبة
  { lat: -10.5, lon: -23.2, ns: 5, ew: 6, alb: 0.32 }, // بحر المعرفة
  { lat: 7.5, lon: -30.9, ns: 5, ew: 7, alb: 0.34 },   // بحر الجزر
  { lat: 20, lon: -50, ns: 20, ew: 26, alb: 0.37 },    // محيط العواصف
  { lat: 8, lon: -55, ns: 11, ew: 11, alb: 0.36 },
  { lat: 56, lon: -2, ns: 3.5, ew: 24, alb: 0.38 },    // بحر البرد
  { lat: 13.3, lon: 3.6, ns: 4, ew: 4.4, alb: 0.32 },  // بحر الأبخرة
  { lat: 12, lon: -8.8, ns: 3.5, ew: 4, alb: 0.34 },   // خليج الحرارة
  { lat: 0.4, lon: 1.7, ns: 3, ew: 3.2, alb: 0.34 },   // خليج الوسط
  { lat: 44.1, lon: -31.5, ns: 3.6, ew: 3.6, alb: 0.34 }, // خليج قوس قزح
  { lat: 38, lon: 29, ns: 4, ew: 5, alb: 0.4 },        // بحيرة الأحلام
  { lat: 45, lon: 27, ns: 2.5, ew: 3, alb: 0.38 },     // بحيرة الموت
  { lat: 1.3, lon: 87.5, ns: 3.4, ew: 4, alb: 0.3 },   // بحر سميث
  { lat: 13.3, lon: 86.1, ns: 3, ew: 4, alb: 0.32 },   // بحر الحدود
  { lat: 6.8, lon: 68.4, ns: 2.3, ew: 3, alb: 0.34 },
  { lat: 1.1, lon: 65, ns: 1.8, ew: 2.4, alb: 0.34 },
  { lat: 57, lon: 81, ns: 2.5, ew: 3.5, alb: 0.37 },   // بحر همبولت
  { lat: -38, lon: 93, ns: 5, ew: 6, alb: 0.36 },
  { lat: -19.4, lon: -92.8, ns: 3.5, ew: 3.5, alb: 0.36 }, // بحر الشرق
  { lat: -5.2, lon: -68.3, ns: 3.2, ew: 3.4, alb: 0.3 },  // غريمالدي
  { lat: 51.6, lon: -9.3, ns: 1.7, ew: 1.9, alb: 0.27 },  // أفلاطون
  { lat: 22.6, lon: 67.7, ns: 2, ew: 2.4, alb: 0.34 },
  { lat: 54, lon: -45, ns: 3.5, ew: 4, alb: 0.38 },
];

/** فوهات بارزة: أنصاف أقطار بالدرجات، floor = لمعان القاع، rim = لمعان الحافة، rays = عدد الأشعة */
const CRATERS: Crater[] = [
  { lat: -43.3, lon: -11.2, r: 1.5, floor: 0.78, rim: 0.95, rays: 11, rayLen: 34 },  // تيخو
  { lat: 9.7, lon: -20.1, r: 1.6, floor: 0.7, rim: 0.92, rays: 12, rayLen: 14 },     // كوبرنيكوس
  { lat: 8.1, lon: -38, r: 0.8, floor: 0.8, rim: 0.95, rays: 8, rayLen: 8 },          // كبلر
  { lat: 23.7, lon: -47.4, r: 0.9, floor: 0.95, rim: 1.0, rays: 6, rayLen: 6 },       // أريستارخوس
  { lat: 16.1, lon: 46.9, r: 0.5, floor: 0.9, rim: 1.0, rays: 6, rayLen: 6 },         // بروكلس
  { lat: -8.9, lon: 61, r: 2.0, floor: 0.6, rim: 0.82 },                              // لانغرينوس
  { lat: -25, lon: 60.4, r: 2.8, floor: 0.5, rim: 0.78 },                             // بيتافيوس
  { lat: -17.6, lon: -39.9, r: 1.5, floor: 0.42, rim: 0.7 },                          // غاسندي
  { lat: -9.3, lon: -1.9, r: 2.2, floor: 0.45, rim: 0.74 },                           // بطليموس
  { lat: -13.4, lon: -3.2, r: 1.5, floor: 0.4, rim: 0.76 },                           // الفونسوس
  { lat: 29.7, lon: -4, r: 1.3, floor: 0.32, rim: 0.66 },                             // أرخميدس
  { lat: 50.2, lon: 17.3, r: 1.8, floor: 0.5, rim: 0.74 },                            // أرسطو
  { lat: -11.4, lon: 26.4, r: 1.6, floor: 0.55, rim: 0.8 },                           // ثيوفيلوس
  { lat: 31.8, lon: 29.9, r: 1.5, floor: 0.4, rim: 0.66 },                            // بوسيدونيوس
  { lat: -58.8, lon: -14.4, r: 3.1, floor: 0.6, rim: 0.78 },                          // كلافيوس
  { lat: -41.5, lon: -7, r: 1.5, floor: 0.55, rim: 0.72 },
  { lat: 14.5, lon: -9.4, r: 0.8, floor: 0.7, rim: 0.82 },
  { lat: -38.5, lon: 1.8, r: 1.2, floor: 0.6, rim: 0.74 },
  { lat: -3.3, lon: -74.3, r: 3.2, floor: 0.6, rim: 0.82 },                           // ريتشولي
  { lat: 46.8, lon: -18.4, r: 1.5, floor: 0.52, rim: 0.7 },
  { lat: -20.6, lon: 8.9, r: 1.0, floor: 0.6, rim: 0.76 },
  { lat: 41.7, lon: 3, r: 1.2, floor: 0.55, rim: 0.72 },
  { lat: 21.4, lon: 3.1, r: 1.0, floor: 0.5, rim: 0.68 },
  { lat: 36, lon: -9, r: 1.0, floor: 0.5, rim: 0.68 },
];

const TEX_W = 1024, TEX_H = 512;
let moonAlbedo: Float32Array | null = null;

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x: number, y: number, oct: number): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}

function unitVec(latDeg: number, lonDeg: number): [number, number, number] {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

function buildMoonAlbedo(): Float32Array {
  const tex = new Float32Array(TEX_W * TEX_H);
  const craterVecs = CRATERS.map((c) => unitVec(c.lat, c.lon));
  // اتجاها الشرق والشمال المحليان عند كل فوهة (لحساب سمت الأشعة)
  const craterEN = craterVecs.map((c) => {
    const el = Math.hypot(c[1], c[0]) || 1;
    const e: [number, number, number] = [-c[1] / el, c[0] / el, 0];
    const n: [number, number, number] = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
    return { e, n };
  });
  // أشعة كل فوهة: زوايا ثابتة موزعة بحبكة حتمية
  const rays = CRATERS.map((c, i) => {
    const n = c.rays ?? 0;
    const arr: { a: number; w: number; s: number }[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (hash2(i * 17 + k, 3) - 0.5) * 0.5;
      arr.push({ a, w: 0.05 + hash2(i * 31 + k, 9) * 0.07, s: 0.5 + hash2(i * 13 + k, 5) * 0.5 });
    }
    return arr;
  });

  for (let j = 0; j < TEX_H; j++) {
    const lat = 90 - ((j + 0.5) / TEX_H) * 180;
    for (let i = 0; i < TEX_W; i++) {
      const lon = ((i + 0.5) / TEX_W) * 360 - 180;
      const u = i / TEX_W * 360, vv = j / TEX_H * 180; // إحداثيات الضجيج
      // ارتفاعات: الأراضي المرتفعة أفتح مع تفاوت
      let alb = 0.6 + (fbm(u * 0.18, vv * 0.18, 4) - 0.5) * 0.12;
      // بقع شعاعية ناعمة وفوهات صغيرة بنسيج دقيق
      const fine = fbm(u * 1.6, vv * 1.6, 3) - 0.5;
      alb += fine * 0.07;
      const crt = vnoise(u * 3.1, vv * 3.1);
      if (crt > 0.86) alb += (crt - 0.86) * 0.9;     // فوهات صغيرة ساطعة الحواف
      else if (crt < 0.1) alb -= (0.1 - crt) * 0.5;  // وقيعان داكنة

      // البحار
      let mw = 0, mAlb = alb;
      for (const m of MARIA) {
        let dl = lon - m.lon;
        if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
        const dn = (lat - m.lat) / m.ns;
        const de = (dl * Math.cos(m.lat * DEG)) / m.ew;
        const t = Math.sqrt(dn * dn + de * de);
        if (t > 1.5) continue;
        // حافة غير منتظمة
        const rag = 1 + (fbm(u * 0.9 + m.lat, vv * 0.9 + m.lon, 3) - 0.5) * 0.45;
        const w = 1 - smooth(0.62, 1.0, t * rag);
        if (w > mw) { mw = w; mAlb = 0.6 - (0.6 - m.alb) * 0.6 + (fbm(u * 0.5, vv * 0.5, 3) - 0.5) * 0.06; }
      }
      alb = lerp(alb, mAlb, mw);

      // الفوهات الكبرى وأشعتها
      const sv = unitVec(lat, lon);
      for (let k = 0; k < CRATERS.length; k++) {
        const c = CRATERS[k], cv = craterVecs[k];
        const dot = sv[0] * cv[0] + sv[1] * cv[1] + sv[2] * cv[2];
        const maxLen = Math.max(c.r * 1.6, c.rayLen ?? 0);
        if (dot < Math.cos(maxLen * DEG)) continue;
        const dist = Math.acos(Math.min(1, dot)) / DEG;
        if (dist < c.r * 1.5) {
          const q = dist / c.r;
          if (q < 0.85) alb = lerp(alb, c.floor, 0.85 * (1 - smooth(0.6, 0.85, q)));
          else if (q < 1.25) alb = Math.max(alb, lerp(alb, c.rim, 0.9 * (1 - Math.abs(q - 1) / 0.25)));
        }
        if (c.rays && dist > c.r) {
          // اتجاه المسير من الفوهة إلى النقطة
          const en = craterEN[k];
          const bear = Math.atan2(
            sv[0] * en.e[0] + sv[1] * en.e[1] + sv[2] * en.e[2],
            sv[0] * en.n[0] + sv[1] * en.n[1] + sv[2] * en.n[2]
          );
          let ray = 0;
          for (const r of rays[k]) {
            let da = Math.abs(bear - r.a) % (Math.PI * 2);
            if (da > Math.PI) da = Math.PI * 2 - da;
            ray = Math.max(ray, r.s * Math.exp(-Math.pow(da / (r.w + 0.015 * Math.sqrt(dist)), 2)));
          }
          const fall = Math.exp(-dist / (c.rayLen! * 0.55));
          alb += ray * fall * 0.13 * (1 - mw * 0.5);
        }
      }
      tex[j * TEX_W + i] = clamp(alb, 0.12, 1);
    }
  }
  return tex;
}

function sampleAlbedo(tex: Float32Array, latDeg: number, lonDeg: number): number {
  let fx = ((lonDeg + 180) / 360) * TEX_W - 0.5;
  const fy = clamp(((90 - latDeg) / 180) * TEX_H - 0.5, 0, TEX_H - 1.001);
  fx = ((fx % TEX_W) + TEX_W) % TEX_W;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = (x0 + 1) % TEX_W, y1 = y0 + 1;
  const tx = fx - x0, ty = fy - y0;
  const a = tex[y0 * TEX_W + x0], b = tex[y0 * TEX_W + x1], c = tex[y1 * TEX_W + x0], d = tex[y1 * TEX_W + x1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

// ============================= ظل الأرض: الإضاءة المتبقية لنقطة على القمر =============================

/** مساحة تقاطع قرصين نصفا قطرهما a وb وبُعد مركزيهما c */
function lensArea(a: number, b: number, c: number): number {
  if (c >= a + b) return 0;
  if (c <= Math.abs(a - b)) return Math.PI * Math.min(a, b) ** 2;
  const x = (a * a - b * b + c * c) / (2 * c);
  const y = Math.sqrt(Math.max(0, a * a - x * x));
  return a * a * Math.acos(clamp(x / a, -1, 1)) + b * b * Math.acos(clamp((c - x) / b, -1, 1)) - c * y;
}

/**
 * الضوء المباشر المتبقي (0..1) عند نقطة تبعد d (وحدة نصف قطر القمر) عن محور ظل الأرض.
 * هندسة دقيقة: من النقطة يُرى قرص الشمس (نصف قطره ρs) وقرص الأرض (ρe) على بُعد زاوي s يتناسب خطياً
 * مع d؛ تُستخرج النسب من نصفي قطر الظل U والشبه ظل P: ρe+ρs ∝ P و ρe−ρs ∝ U.
 */
function directLight(d: number, U: number, P: number): number {
  if (d >= P) return 1;
  const re = (P + U) / 2, rs = (P - U) / 2;
  if (rs <= 0) return 1;
  return 1 - lensArea(rs, re, d) / (Math.PI * rs * rs);
}

/**
 * مقياس دانجون (L0..L4) لسطوع/لون القمر داخل الظل. هو مُدخَل لا تنبؤ: يتوقف على نقاء الغلاف الجوي (الغبار البركاني
 * والسحب عند حافة الأرض) وقت الخسوف ولا يمكن حسابه مسبقاً.
 *   L0 داكن جداً شبه غير مرئي · L1 رمادي/بني · L2 أحمر صدئ (الأشيع) · L3 قرميدي بحافة صفراء · L4 نحاسي ساطع بحافة زرقاء
 */
export const DANJON_LABELS_AR = [
  'L0 — داكن جداً (بعد ثوران بركاني)', 'L1 — رمادي بني داكن', 'L2 — أحمر صدئ (النموذجي)',
  'L3 — أحمر قرميدي بحافة صفراء', 'L4 — نحاسي ساطع بحافة زرقاء',
];
const DANJON_CORE = [0.006, 0.025, 0.07, 0.14, 0.26];       // سطوع مركز الظل
const DANJON_RIM = [0.03, 0.12, 0.38, 0.62, 0.9];            // سطوع الحافة
const DANJON_GREEN = [0.75, 0.55, 0.34, 0.42, 0.52];         // دفء اللون: نسبة الأخضر إلى الأحمر
const DANJON_BLUE = [0.6, 0.38, 0.14, 0.17, 0.2];            // نسبة الأزرق إلى الأحمر
const DANJON_TURQ = [0.0, 0.1, 0.55, 0.45, 1.0];             // قوة الحافة الفيروزية/الزرقاء
function danjonLerp(arr: number[], L: number): number {
  const x = clamp(L, 0, 4);
  const i = Math.min(3, Math.floor(x));
  return lerp(arr[i], arr[i + 1], x - i);
}

/** الضوء المنكسر (أحمر نحاسي) داخل الظل وحوله: أشد سطوعاً عند الحافة وأخفت نحو المركز */
function refractedLight(d: number, U: number, L: number): [number, number, number] {
  const q = d / Math.max(U, 1e-6);
  const edge = smooth(1.12, 0.78, q);
  const core = danjonLerp(DANJON_CORE, L) + (danjonLerp(DANJON_RIM, L) - danjonLerp(DANJON_CORE, L)) * Math.pow(smooth(0, 1, q), 1.6);
  const g = edge * core;
  const turq = smooth(0.8, 0.97, q) * (1 - smooth(0.97, 1.1, q)) * danjonLerp(DANJON_TURQ, L);
  return [g, g * (danjonLerp(DANJON_GREEN, L) + 0.55 * turq), g * (danjonLerp(DANJON_BLUE, L) + 0.9 * turq)];
}

// ============================= خسوف القمر =============================

export interface LunarViewOptions {
  /** نصف قطر القمر بالبكسل (الافتراضي 36% من أقصر بُعد) */
  moonRadiusPx?: number;
  /** درجة دانجون (0..4، تقبل الكسور): لون وسطوع القمر داخل الظل. الافتراضي 2 */
  danjonL?: number;
}

// ----- نسيج القمر من الصورة (إن وُجدت) -----
interface MoonTex { lum: Float32Array; w: number; h: number; cx: number; cy: number; r: number; scale: number }
let moonTex: MoonTex | null = null;
let moonTexSrc: CanvasImageSource | null = null;
let moonOverride: CanvasImageSource | null = null;

/** يفرض صورة قمر بعينها (للاختبار أو لتحميل مخصّص)؛ null يعيد الافتراضي */
export function setMoonTexture(img: CanvasImageSource | null) { moonOverride = img; }

function buildMoonTex(img: CanvasImageSource, w: number, h: number): MoonTex | null {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  let minx = w, maxx = 0, miny = h, maxy = 0;
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, a = d[o + 3] / 255;
      const l = ((0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255) * a;
      lum[y * w + x] = l;
      if (a > 0.16) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; hist[Math.min(255, Math.round(l * 255))]++; }
    }
  }
  if (maxx <= minx) return null;
  let total = 0; for (let i = 0; i < 256; i++) total += hist[i];
  let acc = 0, p98 = 1;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.98) { p98 = Math.max(0.2, i / 255); break; } }
  return { lum, w, h, cx: (minx + maxx + 1) / 2, cy: (miny + maxy + 1) / 2, r: (maxx - minx + 1 + (maxy - miny + 1)) / 4, scale: 1 / p98 };
}

function currentMoonTex(): MoonTex | null {
  const src = moonOverride ?? getMoonImage();
  if (!src) return null;
  if (src !== moonTexSrc) {
    moonTexSrc = src;
    const w = (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width;
    const h = (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height;
    moonTex = w && h ? buildMoonTex(src, w, h) : null;
  }
  return moonTex;
}

/** سطوع الصورة (0..~1.1 نسبةً لأفتح 2% من البكسلات) عند نقطة من القرص بإحداثيات سيلينوغرافية (u شرقاً، v شمالاً) */
function sampleMoonTex(t: MoonTex, u: number, v: number, cosA: number, sinA: number): number {
  const pu = cosA * u - sinA * v, pv = sinA * u + cosA * v;
  const k = 0.972 * t.r;
  const fx = t.cx + k * pu - 0.5, fy = t.cy - k * pv - 0.5;
  const x0 = clamp(Math.floor(fx), 0, t.w - 2), y0 = clamp(Math.floor(fy), 0, t.h - 2);
  const tx = clamp(fx - x0, 0, 1), ty = clamp(fy - y0, 0, 1);
  const a = t.lum[y0 * t.w + x0], b = t.lum[y0 * t.w + x0 + 1], c = t.lum[(y0 + 1) * t.w + x0], dd = t.lum[(y0 + 1) * t.w + x0 + 1];
  return lerp(lerp(a, b, tx), lerp(c, dd, tx), ty) * t.scale;
}

let scratch: HTMLCanvasElement | null = null;

export function drawLunarView(ctx: CanvasRenderingContext2D, w: number, h: number, v: LunarView, opts: LunarViewOptions = {}) {
  const tex = currentMoonTex();
  if (!tex && !moonAlbedo) moonAlbedo = buildMoonAlbedo();
  const danjon = opts.danjonL ?? 2;
  const rotA = MOON_IMAGE_ROTATION_CCW_DEG * DEG, cosA = Math.cos(rotA), sinA = Math.sin(rotA);
  const cx = w / 2, cy = h / 2;
  const R = opts.moonRadiusPx ?? Math.min(w, h) * 0.36;
  const scale = R / v.moon.radiusDeg;
  const flat = v.flatten;
  const sunAlt = v.sun.altDeg;
  const sunDay = smooth(-6, 4, sunAlt);
  const pal = skyPalette(sunAlt, 1);
  const { tint, bright } = extinction(v.moon.altDeg);

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // ----- السماء (ليل، أو نهار/غسق إن كانت الشمس فوق الأفق كما في الخسوف الأفقي) -----
  const horizonY = cy + v.moon.altDeg * scale;
  const hasHorizon = horizonY > -40 && horizonY < h + 40;
  const night: RGB = [3, 5, 12];
  const zen = mix(night, pal.zenith, sunDay);
  const hor = mix(night, pal.horizon, sunDay);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, css(zen));
  g.addColorStop(1, css(mix(zen, hor, hasHorizon ? 0.9 : 0.35)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // نجوم خافتة تتلاشى مع النهار (مواضع ثابتة)
  if (sunDay < 0.9) {
    ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - sunDay)})`;
    for (let i = 0; i < 60; i++) {
      const sx = hash2(i, 77) * w, sy = hash2(i, 91) * h;
      const sr = 0.4 + hash2(i, 5) * 0.9;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ----- قرص القمر بصيغة بكسلية: سطح × ظل الأرض -----
  const size = Math.ceil(R * 2 + 4);
  if (!scratch) scratch = document.createElement('canvas');
  scratch.width = size; scratch.height = size;
  const sctx = scratch.getContext('2d')!;
  const img = sctx.createImageData(size, size);
  const data = img.data;
  const M = v.bodyToScreen;
  const sh = v.shadow;
  const half = size / 2;
  const skyVeil = 0.55 * sunDay; // ضوء السماء النهارية يخفّض تباين القمر
  const veilC = mix(zen, hor, 0.6);
  const invGamma = 1 / 2.2;
  let lightSum = 0, lightN = 0;

  for (let py = 0; py < size; py++) {
    const y = -(py + 0.5 - half) / (R * flat); // نحو السمت، بإلغاء ضغط الانكسار
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5 - half) / R;
      const rr = x * x + y * y;
      const o = (py * size + px) * 4;
      if (rr > 1) { data[o + 3] = 0; continue; }
      const z = Math.sqrt(1 - rr);
      // الاتجاه في إطار الجسم: b = Mᵀ s
      const bx = M[0][0] * x + M[1][0] * y + M[2][0] * z;
      const by = M[0][1] * x + M[1][1] * y + M[2][1] * z;
      const bz = M[0][2] * x + M[1][2] * y + M[2][2] * z;
      let base: number;
      if (tex) {
        // الصورة تغطي الوجه القريب: u شرقاً، v شمالاً. خلف الحافة (بسبب التمايل) نثبّت على الحافة
        let u = by, vv = bz;
        if (bx < 0) { const hh = Math.hypot(u, vv) || 1; u /= hh; vv /= hh; }
        base = clamp(sampleMoonTex(tex, u, vv, cosA, sinA), 0, 1.15) * 0.93;
      } else {
        const lat = Math.asin(clamp(bz, -1, 1)) / DEG;
        const lon = Math.atan2(by, bx) / DEG;
        base = clamp(sampleAlbedo(moonAlbedo!, lat, lon) / 0.62, 0, 1.4) * 0.9;
      }
      const L0 = Math.pow(clamp(base, 0, 1.2), 2.2) * (0.86 + 0.14 * Math.sqrt(z));

      // ظل الأرض
      const d = Math.hypot(x - sh.dx, y - sh.dy);
      const f = directLight(d, sh.umbra, sh.penumbra);
      const rl = refractedLight(d, sh.umbra, danjon);
      lightSum += f + 0.35 * rl[0]; lightN++;
      let r = Math.pow(Math.max(0, L0 * (f + rl[0])), invGamma) * 255;
      let gC = Math.pow(Math.max(0, L0 * (f + rl[1])), invGamma) * 255;
      let b = Math.pow(Math.max(0, L0 * (f + rl[2])), invGamma) * 255;
      // لون قمر دافئ قليلاً + إخماد جوي قرب الأفق
      r *= 1.0 * tint[0]; gC *= 0.985 * tint[1]; b *= 0.93 * tint[2];
      const k = clamp(bright * 1.05, 0, 1);
      r *= k; gC *= k; b *= k;
      // حجاب السماء النهارية
      if (skyVeil > 0) {
        r = lerp(r, veilC[0], skyVeil); gC = lerp(gC, veilC[1], skyVeil); b = lerp(b, veilC[2], skyVeil);
      }
      // حافة ناعمة (تنعيم الحافة بنصف بكسل)
      const edge = clamp((1 - Math.sqrt(rr)) * R * 1.0 + 0.5, 0, 1);
      data[o] = clamp(r, 0, 255); data[o + 1] = clamp(gC, 0, 255); data[o + 2] = clamp(b, 0, 255);
      data[o + 3] = edge * 255;
    }
  }
  sctx.putImageData(img, 0, 0);

  // الهالة: تقوى مع الضوء المباشر على القرص (بدر ساطع) وتضعف في الظل والشبه ظل الكثيف، وتخفت في النهار والقرب من الأفق
  {
    const lightFrac = lightN ? clamp(lightSum / lightN, 0, 1) : 1;
    const h = Math.pow(lightFrac, 1.4) * (1 - 0.85 * sunDay) * clamp(bright + 0.1, 0, 1);
    if (h > 0.01) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, flat);
      const hg = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * 3.4);
      hg.addColorStop(0, css(mix([255, 255, 255], [255, 240, 215], 1 - bright), 0.5 * h));
      hg.addColorStop(0.18, css([235, 240, 255], 0.2 * h));
      hg.addColorStop(0.5, css([210, 222, 255], 0.06 * h));
      hg.addColorStop(1, css([200, 215, 255], 0));
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(0, 0, R * 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  ctx.drawImage(scratch, cx - half, cy - half);

  // ----- الأفق والأرض -----
  if (hasHorizon) {
    const glowC = mix([255, 140, 60], [255, 200, 150], smooth(0, 10, sunAlt));
    drawGround(ctx, w, horizonY, h, glowC, 0.18 * sunDay + 0.04);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, horizonY + 0.5); ctx.lineTo(w, horizonY + 0.5); ctx.stroke();
  }
  ctx.restore();
}

// ============================= بانوراما الأفق 360° (الخسوف الأفقي) =============================

export interface HorizonStripInput {
  sun: { altDeg: number; azDeg: number };
  moon: { altDeg: number; azDeg: number };
  /** ظل الأرض نسبةً للقمر (وحدة نصف قطر القمر) لرسم قرص القمر المصغّر */
  shadow: { dx: number; dy: number; umbra: number; penumbra: number };
  umbralMagnitude: number;
}

const COMPASS_AR: [number, string][] = [[0, 'شمال'], [45, 'ش.شرق'], [90, 'شرق'], [135, 'ج.شرق'], [180, 'جنوب'], [225, 'ج.غرب'], [270, 'غرب'], [315, 'ش.غرب'], [360, 'شمال']];

export function drawHorizonStrip(ctx: CanvasRenderingContext2D, w: number, h: number, s: HorizonStripInput) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  const altMin = -14, altMax = 40;
  const X = (az: number) => ((((az % 360) + 360) % 360) / 360) * w;
  const Y = (alt: number) => h - ((alt - altMin) / (altMax - altMin)) * h;
  const yH = Y(0);

  // السماء: تدرج وفق ارتفاع الشمس، مع توهج أقوى قرب سمت الشمس
  const sunDay = smooth(-8, 6, s.sun.altDeg);
  const pal = skyPalette(s.sun.altDeg, 1);
  const night: RGB = [3, 5, 14];
  const z = mix(night, pal.zenith, sunDay), hz = mix(night, pal.horizon, sunDay);
  const sky = ctx.createLinearGradient(0, 0, 0, yH);
  sky.addColorStop(0, css(z)); sky.addColorStop(1, css(hz));
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, yH);
  for (const off of [-w, 0, w]) {
    const gx = X(s.sun.azDeg) + off;
    const gg = ctx.createRadialGradient(gx, Y(s.sun.altDeg), 0, gx, Y(s.sun.altDeg), w * 0.28);
    gg.addColorStop(0, `rgba(255,190,120,${0.5 * sunDay})`);
    gg.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.fillStyle = gg; ctx.fillRect(0, 0, w, yH);
  }
  ctx.fillStyle = 'rgb(7,8,11)'; ctx.fillRect(0, yH, w, h - yH);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, yH + 0.5); ctx.lineTo(w, yH + 0.5); ctx.stroke();

  // أبرز الاتجاهات والارتفاعات
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  for (const [az, name] of COMPASS_AR) {
    const x = az === 360 ? w - 14 : az === 0 ? 14 : X(az);
    ctx.fillText(name, x, yH + 4);
    if (az !== 0 && az !== 360) { ctx.fillRect(X(az) - 0.5, yH - 4, 1, 4); }
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (const alt of [10, 20, 30]) {
    ctx.fillRect(0, Y(alt), w, 0.5);
    ctx.fillText(`${alt}°`, 3, Y(alt) - 6);
  }

  const R = Math.max(9, Math.min(w, h) * 0.04);
  const drawSunIcon = (x: number, y: number, up: boolean) => {
    ctx.save();
    ctx.globalAlpha = up ? 1 : 0.45;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R * 2.8);
    g.addColorStop(0, 'rgba(255,240,190,0.9)'); g.addColorStop(0.35, 'rgba(255,200,100,0.35)'); g.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe9a6'; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  const drawMoonIcon = (x: number, y: number, up: boolean) => {
    ctx.save();
    ctx.globalAlpha = up ? 1 : 0.5;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#d9d6cf'; ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
    // ظل الأرض (y في الإطار للأعلى؛ على الشاشة الأعلى سالب)
    const sx = x + s.shadow.dx * R, sy = y - s.shadow.dy * R;
    const gp = ctx.createRadialGradient(sx, sy, s.shadow.umbra * R * 0.9, sx, sy, s.shadow.penumbra * R);
    gp.addColorStop(0, 'rgba(60,30,20,0.55)'); gp.addColorStop(1, 'rgba(60,30,20,0)');
    ctx.fillStyle = gp; ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
    const gu = ctx.createRadialGradient(sx, sy, 0, sx, sy, s.shadow.umbra * R);
    gu.addColorStop(0, 'rgba(70,16,8,0.95)'); gu.addColorStop(0.85, 'rgba(120,34,16,0.92)'); gu.addColorStop(1, 'rgba(170,80,40,0.8)');
    ctx.fillStyle = gu; ctx.beginPath(); ctx.arc(sx, sy, s.shadow.umbra * R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
  };
  // الرسم مكرَّراً عند حدود الشريط ليظهر الجرم سليماً عند الالتفاف
  for (const off of [-w, 0, w]) {
    drawSunIcon(X(s.sun.azDeg) + off, Y(s.sun.altDeg), s.sun.altDeg > -0.8);
    drawMoonIcon(X(s.moon.azDeg) + off, Y(s.moon.altDeg), s.moon.altDeg > -0.8);
  }
  ctx.restore();
}
