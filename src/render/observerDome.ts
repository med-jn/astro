/**
 * قبة الراصد: السماء المحلية فوق موقع الراصد، مرسومة على الخريطة كقرص بنصف قطر الأرض
 * (6371 كم بمقياس الخريطة، أي نصف قطر القرص ÷ π).
 *
 * الإسقاط متعامد كما يُرى القبة من الأعلى: نصف القطر = cos(الارتفاع)، فالسمت (zenith) في المركز
 * والأفق على الحافة. والاتجاهات مطابقة للخريطة نفسها: الشمال نحو القطب (مركز القرص) والشرق
 * عكس عقارب الساعة حول القطب، فيكون الشرق يمين الراصد عندما يكون الشمال أعلى — تماماً كالخريطة.
 *
 * تُرسم عليها كل أجرام التطبيق: الشمس والقمر (بطوره) والكواكب والنجوم (تظهر تدريجياً مع حلول
 * الليل) وخطوط الكوكبات المختارة وحدود الأبراج المختارة والمنازل المختارة وخط البروج.
 * ارتفاع/سمت الشمس والقمر والكواكب يأتي مباشرة من astronomy-engine (مراقب فعلي، بإحداثيات اليوم وبانكسار الجو).
 * وكي لا يختلف المرجع بين الأجرام: النجوم وخطوط الكوكبات وحدود الأبراج (كتالوج J2000) تمرّ عبر core/skyModel
 * (مبادرة + نوتيشن + انكسار)، وخط البروج والمنازل (بإحداثيات اليوم) عبر equatorialToHorizontal مع الانكسار نفسه.
 *
 * ما يظهر تحدده طبقات المستخدم: النجوم بطبقة «النجوم»، والكواكب بطبقة «الكواكب» (الشمس والقمر دائماً كما في الخريطة).
 * والرؤية واقعية: كل نجم/كوكب يخبو بحسب قدره وارتفاعه وشفق السماء وضوء القمر (DOME_REALISTIC_VISIBILITY).
 */
import * as Astronomy from 'astronomy-engine';
import type { CelestialBodyState, ObserverLocation } from '../types/astro';
import { GREENWICH_DOWN_OFFSET_DEG, latLonToScreen, type PolarMapConfig } from '../core/projection';
import { getLoadedStars, getStarColor, getStarRadiusPx, getStarDisplayName, getStarByIdMap } from '../core/starCatalog';
import { getGroupLines } from '../core/starGroups';
import { getLoadedZodiac, type ZodiacKey } from '../core/zodiac';
import { getAllLunarMansions, MANSION_SPAN_DEG } from '../core/mansions';
import { eclipticLongitudeToEquatorial } from '../core/eclipticTransform';
import { PLANET_COLORS, PLANET_LABELS_AR } from '../core/bodies';
import { fillTextUpright, getSceneRotationRad, labelGap } from './uprightText';
import { computeAuroraArcs, auroraBrightness, type AuroraArc } from '../core/aurora';
import { directSunLight } from '../core/skyRadiance';
import { getDomeSkyCanvas, DOME_SKY_SIZE } from './domeSky';
import { limitingMagnitude, makeSkyFrame, placeRaDecJ2000, refractionDeg, StarField, starAlpha } from '../core/skyModel';
import { getMoonImage } from './bodyImages';
import { paintEarthShadowDisc, moonTexFromAxes } from './eclipseOverlay';
import { solarViewAt, lunarShadowOnSky, moonPoleAngleDeg, type SolarView } from '../core/eclipses';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** نصف قطر الأرض ÷ (نصف محيط الأرض): R_map يمثل π·6371 كم، فقبة الأرض = R_map ÷ π */
export const DOME_RADIUS_FRACTION = 1 / Math.PI;

/**
 * إسقاط القبة. «equidistant» (الافتراضي): نصف القطر خطي مع المسافة السمتية ρ=(90−ارتفاع)/90، فيأخذ أدنى 10° فوق الأفق نحو 11% من
 * نصف القطر — وهي المنطقة التي يعيش فيها الفجر والشفق والغروب. «orthographic»: ρ=cos(ارتفاع) يضغط هذه الـ10° في ~1.5% فيستحيل رؤية
 * نطاق الفجر، لكنه يحاكي كرة سماوية منظورة من الجانب.
 */
export type DomeProjection = 'equidistant' | 'orthographic';
export const DOME_PROJECTION: DomeProjection = 'equidistant';

/** نصف القطر النسبي (0 سمت … 1 أفق، >1 تحت الأفق) لارتفاع معيّن */
export function domeRho(altDeg: number): number {
  if (DOME_PROJECTION === 'equidistant') return (90 - altDeg) / 90;
  const alt = altDeg * (Math.PI / 180);
  return alt >= 0 ? Math.cos(alt) : 1 - Math.sin(alt);
}

/** true: كل نجم وكوكب يظهر بحسب قدره وارتفاعه والشفق وضوء القمر (ما يراه الراصد الفعلي).
 *  false: النجوم كلها تظهر معاً تدريجياً مع حلول الليل، والكواكب (المفعَّلة) دائماً. */
export const DOME_REALISTIC_VISIBILITY = true;

const FALLBACK_SUN_ANGULAR_DEG = 0.533;
const FALLBACK_MOON_ANGULAR_DEG = 0.518;
/** أصغر نصف قطر (بكسل ÷ uiScale) لكوكب: أكبر من أقصى نصف قطر نجم (1.35) فلا يلتبس نجم بكوكب */
const PLANET_MIN_RADIUS_UI = 1.6;
/** أكبر نصف قطر لكوكب كنسبة من نصف قطر الشمس: الكواكب نقاط لا أقراص */
const PLANET_MAX_SUN_FRACTION = 0.3;

const ACCENT_LINE = '#b08d57';
const ACCENT_LINE_BRIGHT = '#d4b688';

// ───────────────────────────── الفلك ─────────────────────────────
/** ارتفاع وسمت (من الشمال نحو الشرق) لجرم بمطلعه المستقيم (ساعات) وميله (درجات) */
export function equatorialToHorizontal(
  raHours: number, decDeg: number, lstDeg: number, latDeg: number
): { altDeg: number; azDeg: number } {
  const H = (lstDeg - raHours * 15) * DEG;
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const altDeg = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
  const north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H);
  const east = -Math.cos(dec) * Math.sin(H);
  let azDeg = Math.atan2(east, north) / DEG;
  if (azDeg < 0) azDeg += 360;
  return { altDeg, azDeg };
}

/** الارتفاع الظاهري (بعد انكسار الجو) من ارتفاع هندسي: المعادلة نفسها التي تعتمدها المكتبة لـ'normal' */
export function apparentAltitude(geomAltDeg: number): number {
  return geomAltDeg + refractionDeg(geomAltDeg);
}

// ───────────────────────────── الهندسة على الخريطة ─────────────────────────────
export interface DomeFrame {
  /** مركز القبة (موقع الراصد) بإحداثيات الرسم */
  px: number;
  py: number;
  radius: number;
  /** متجها الشمال والشرق المحليين على الشاشة (وحدة) */
  nx: number; ny: number;
  ex: number; ey: number;
}

export function computeDomeFrame(config: PolarMapConfig, observer: ObserverLocation): DomeFrame {
  const p = latLonToScreen(observer.latitudeDeg, observer.longitudeDeg, config);
  // اتجاه الراصد من المركز: (−sin a, −cos a)؛ الشمال عكسه (نحو القطب)، والشرق مماس الدائرة (باتجاه زيادة الطول)
  const a = (observer.longitudeDeg + GREENWICH_DOWN_OFFSET_DEG) * DEG;
  return {
    px: p.x, py: p.y, radius: config.outerRadiusPx * DOME_RADIUS_FRACTION,
    nx: Math.sin(a), ny: Math.cos(a),
    ex: -Math.cos(a), ey: Math.sin(a),
  };
}

/** نقطة على القبة. ما تحت الأفق يُوضَع خارج القرص (فيُقصّ) بدل أن ينعكس فوق الأفق */
export function domePoint(f: DomeFrame, altDeg: number, azDeg: number): { x: number; y: number } {
  const az = azDeg * DEG;
  const rho = domeRho(altDeg);
  const dx = Math.cos(az) * f.nx + Math.sin(az) * f.ex;
  const dy = Math.cos(az) * f.ny + Math.sin(az) * f.ey;
  return { x: f.px + f.radius * rho * dx, y: f.py + f.radius * rho * dy };
}

// ───────────────────────────── لون السماء ─────────────────────────────
type RGB = [number, number, number];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** جداول (ارتفاع الشمس ↓ مرتَّبة تنازلياً) → قيمة، بالاستيفاء الخطي */
function lookup<T extends RGB | number>(table: [number, T][], alt: number): T {
  if (alt >= table[0][0]) return table[0][1];
  if (alt <= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) {
    if (alt >= table[i][0]) {
      const t = (table[i - 1][0] - alt) / (table[i - 1][0] - table[i][0]);
      const a = table[i - 1][1], b = table[i][1];
      if (typeof a === 'number') return (a + ((b as number) - a) * t) as T;
      return mixRGB(a as RGB, b as RGB, t) as T;
    }
  }
  return table[table.length - 1][1];
}

/** لون سمت الرأس (مركز القبة) */
const ZENITH_RGB: [number, RGB][] = [
  [25, [58, 128, 214]], [10, [80, 146, 220]], [3, [96, 138, 206]], [0, [84, 112, 190]],
  [-3, [58, 78, 158]], [-6, [32, 46, 108]], [-9, [18, 28, 76]], [-12, [10, 16, 48]], [-18, [3, 6, 20]],
];
/** لون السماء عند الأفق (أفتح وأدفأ: حاجز الغلاف الجوي) */
const HORIZON_RGB: [number, RGB][] = [
  [25, [176, 212, 246]], [10, [190, 212, 238]], [4, [176, 192, 222]], [0, [150, 156, 198]],
  [-3, [112, 114, 172]], [-6, [70, 72, 138]], [-9, [38, 46, 106]], [-12, [17, 25, 66]], [-18, [4, 8, 24]],
];
/** كان يُستعمل لتلوين القبة بلون واحد؛ يبقى مُصدَّراً للتوافق (لون الأفق عند هذا الارتفاع) */
export function skyColor(sunAltDeg: number): string {
  const c = mixRGB(lookup(ZENITH_RGB, sunAltDeg), lookup(HORIZON_RGB, sunAltDeg), 0.5);
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, 1)`;
}

const rgbCss = (c: RGB, a = 1) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a.toFixed(3)})`;

/** رؤية النجوم: تظهر عند غروب الشمس (−3°) وتكتمل عند الشفق الملاحي (−12°) */
export function starVisibility(sunAltDeg: number): number {
  return Math.max(0, Math.min(1, (-sunAltDeg - 3) / 9));
}

/**
 * السماء: تدرّج من سمت الرأس إلى الأفق، ثم وهج الفجر/الشفق ينبع من اتجاه الشمس تحت الأفق (فنصف القبة مضاء بنور الفجر
 * والنصف المقابل ليلاً)، وفي الجهة المقابلة ظلّ الأرض الأزرق الداكن. أثناء الكسوف الشمسي يغور اللون نحو الليل
 * ويظهر طوق برتقالي على الأفق كله عند الكلية.
 */
const nowSec = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

/** السماء الفيزيائية: صورة مُحسوبة (domeSky) تُوضَع على القبة بإطار الشمال/الشرق، ثم غسق 360° عند كلية الكسوف */
function paintDomeSky(
  ctx: CanvasRenderingContext2D, f: DomeFrame,
  inp: { sunAlt: number; sunAz: number; moonAlt: number; moonAz: number; moonPhase: number; sunFraction: number },
  totalK: number
) {
  const img = getDomeSkyCanvas(inp, nowSec() * 1000);
  const s = (2 * f.radius) / DOME_SKY_SIZE;
  // محور x للصورة = الشرق، محور y (لأسفل) = −الشمال
  const a = f.ex * s, b = f.ey * s, c = -f.nx * s, d = -f.ny * s;
  const tx = f.px - (DOME_SKY_SIZE / 2) * (a + c), ty = f.py - (DOME_SKY_SIZE / 2) * (b + d);
  ctx.save();
  ctx.transform(a, b, c, d, tx, ty);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0);
  ctx.restore();

  // الكلية: غروب 360° برتقالي خافت على الأفق كله
  if (totalK > 0.01) {
    const g = ctx.createRadialGradient(f.px, f.py, f.radius * 0.6, f.px, f.py, f.radius);
    g.addColorStop(0, 'rgba(255, 140, 60, 0)');
    g.addColorStop(0.85, `rgba(255, 138, 64, ${(0.38 * totalK).toFixed(3)})`);
    g.addColorStop(1, `rgba(255, 168, 96, ${(0.62 * totalK).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(f.px - f.radius, f.py - f.radius, f.radius * 2, f.radius * 2);
  }
}

/**
 * قرص الشمس بحسب ارتفاعها الظاهري: اللون من انطفاء الجو على الكتلة الهوائية (برتقالي محمرّ عند الأفق ثم أصفر فأبيض)،
 * والسطوع لوغاريتمي — عند الشروق/الغروب خافت لكن حدوده حادّة واضحة، وفي الظهيرة ساطع جداً يحترق قلبه إلى الأبيض وتحيط به هالة واسعة.
 */
function paintDomeSun(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, altApp: number) {
  const { rgb, rel } = directSunLight(altApp);
  // اللون: نسب القنوات بأسّ 0.33 (تكيّف العين يخفّف تطرف اللون الفيزيائي) ثم تطبيع
  const hue = rgb.map((v) => Math.pow(Math.max(v, 1e-9), 0.33));
  const hm = Math.max(hue[0], hue[1], hue[2]);
  const col = hue.map((v) => v / hm);
  // السطوع المُدرَك 0..1 من نسبة السطوع الفيزيائية (لوغاريتمي)
  const i = clamp01(0.45 + 0.55 * (Math.log10(Math.max(rel, 1e-4)) + 3) / 3);
  const over = smoothstep(0.78, 1, i); // احتراق القلب إلى الأبيض عند الظهيرة
  const to255 = (v: number) => Math.round(255 * clamp01(v));
  const mixW = (v: number, w: number) => v + (1 - v) * w;
  // قرص مضيء دائماً (الخفوت عند الأفق في غياب الهالة لا في عتمة القرص): برتقالي/أحمر نابض ثم أصفر فأبيض
  const body = [col[0], col[1], col[2]].map((v) => v * (0.9 + 0.1 * i));
  const coreW = 0.5 * i * (1 - over) + over; // قلب أسطع من محيطه فيبرز القرص على أفق برتقالي
  const core = body.map((v) => mixW(v, coreW));
  const edge = body.map((v) => mixW(v * 0.9, 0.95 * over));
  const css = (v: number[], a = 1) => `rgba(${to255(v[0])}, ${to255(v[1])}, ${to255(v[2])}, ${a})`;

  // الهالة: واسعة وساطعة ظهراً، شبه معدومة عند الأفق
  const gr = r * (1.4 + 3.4 * Math.pow(i, 2.2));
  const gA = 0.05 + 0.45 * Math.pow(i, 3);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, gr);
  glow.addColorStop(0, css(body.map((v) => mixW(v, 0.4 * over)), gA));
  glow.addColorStop(0.35, css(body, gA * 0.4));
  glow.addColorStop(1, css(body, 0));
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, gr, 0, TAU); ctx.fill();
  ctx.restore();

  // القرص: حدّه حادّ عند الأفق ويلين ظهراً (يذوب في الهالة)
  const soft = over;
  const disc = ctx.createRadialGradient(x, y, 0, x, y, r);
  disc.addColorStop(0, css(core));
  disc.addColorStop(0.72, css(mixRGBf(core, edge, 0.5)));
  disc.addColorStop(Math.max(0.74, 0.97 - 0.2 * soft), css(edge));
  disc.addColorStop(1, css(edge, 1 - 0.7 * soft));
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  if (soft < 0.5) {
    ctx.strokeStyle = css(body.map((v) => v * 0.78), 0.9);
    ctx.lineWidth = Math.max(0.8, r * 0.05);
    ctx.beginPath(); ctx.arc(x, y, r * 0.985, 0, TAU); ctx.stroke();
  }
}
const mixRGBf = (a: number[], b: number[], t: number) => a.map((v, k) => v * (1 - t) + b[k] * t);

/** الشفق: ستائر رأسية بتدرج لوني بحسب الارتفاع (حافة سفلى وردية، جسم أخضر، قمة حمراء خافتة)، بمزج إضافي */
function paintAurora(ctx: CanvasRenderingContext2D, f: DomeFrame, arcs: AuroraArc[], alpha: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const arc of arcs) {
    const s = arc.samples;
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      if (Math.max(a.bottom.alt, b.bottom.alt, a.top.alt, b.top.alt) < -2) continue;
      const I = ((a.intensity + b.intensity) / 2) * arc.weight * alpha;
      if (I < 0.015) continue;
      // كل شريحة أعرض من خطوتها (تتداخل مع جاراتها) فتذوب الحواف الرأسية بدل أن تظهر كمكعبات
      const pa = s[Math.max(0, i - 1)], pb = s[Math.min(s.length - 1, i + 2)];
      const b1 = domePoint(f, pa.bottom.alt, pa.bottom.az), b2 = domePoint(f, pb.bottom.alt, pb.bottom.az);
      const t1 = domePoint(f, pa.top.alt, pa.top.az), t2 = domePoint(f, pb.top.alt, pb.top.az);
      const x0 = (b1.x + b2.x) / 2, y0 = (b1.y + b2.y) / 2, x1 = (t1.x + t2.x) / 2, y1 = (t1.y + t2.y) / 2;
      if (Math.hypot(x1 - x0, y1 - y0) < 0.5) continue;
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      const A = Math.min(0.4, I * 0.34);
      g.addColorStop(0, 'rgba(220, 90, 190, 0)');
      g.addColorStop(0.03, `rgba(225, 100, 200, ${(A * 0.55).toFixed(3)})`);
      g.addColorStop(0.08, `rgba(70, 255, 150, ${A.toFixed(3)})`);
      g.addColorStop(0.28, `rgba(60, 235, 140, ${(A * 0.6).toFixed(3)})`);
      g.addColorStop(0.55, `rgba(110, 220, 120, ${(A * 0.16).toFixed(3)})`);
      g.addColorStop(0.8, `rgba(235, 70, 80, ${(A * 0.1).toFixed(3)})`);
      g.addColorStop(1, 'rgba(235, 70, 80, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(t2.x, t2.y); ctx.lineTo(t1.x, t1.y);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

// ───────────────────────────── الرسم ─────────────────────────────
interface ScreenPoint { x: number; y: number; visible: boolean }

/** دوال الرسم الموجودة في skyRenderer نفسها (تُمرَّر كي تبقى الشمس/القمر/الكواكب بنفس مظهرها) */
export interface DomeHelpers {
  drawSun: (ctx: CanvasRenderingContext2D, p: ScreenPoint, radiusPx: number) => void;
  drawMoon: (
    ctx: CanvasRenderingContext2D, moon: CelestialBodyState, moonP: ScreenPoint, sunP: ScreenPoint, radiusPx: number,
    tex?: { rotRad: number; mirror: boolean }, haloScale?: number, opaqueDark?: boolean
  ) => void;
  drawPlanetDot: (ctx: CanvasRenderingContext2D, p: ScreenPoint, r: number, color: string, zoomScale: number) => void;
}

export interface DomeInput {
  observer: ObserverLocation;
  /** اللحظة الحالية: لحساب الكسوف والخسوف ومحور القمر */
  date: Date;
  gmstDeg: number;
  obliquityDeg: number;
  sun: CelestialBodyState;
  moon: CelestialBodyState;
  planets: { name: string; state: CelestialBodyState }[];
  selectedZodiacs: ZodiacKey[];
  selectedMansionIndices: number[];
  selectedGroupIds: number[];
  highlightedStarId: number | null;
  /** بكسل لكل درجة عند السمت (القيمة نفسها التي تعاير بها الخريطة الشمس والقمر) */
  pxPerDeg: number;
  /** معامل تضخيم الأقطار الزاوية (ANGULAR_SIZE_VISUAL_BOOST في skyRenderer): الشمس والقمر والكواكب بصيغة واحدة */
  angularBoost: number;
  /** طبقة «النجوم»: لا يُرسم نجم ولا اسمه ولا هدف تحويم له إن كانت مغلقة (تحديدات الكوكبات والأبراج تبقى لأنها اختيار صريح) */
  showStars: boolean;
  /** طبقة الشفق القطبي الشمالي ومؤشر النشاط Kp (0..9) */
  showAurora: boolean;
  auroraKp: number;
  /** طبقة «الكواكب»: لا يُرسم كوكب ولا اسمه ولا هدف تحويم له إن كانت مغلقة */
  showPlanets: boolean;
  showEcliptic: boolean;
  /** إظهار أسماء كل المنازل (layers.mansions + layers.labels) */
  showMansionNames: boolean;
  labels: boolean;
}

/** هدف تحويم على القبة بإحداثيات الرسم (قبل تحويل المشهد) */
export interface DomeTarget {
  x: number;
  y: number;
  name: string;
  detail: string;
}

const MAX_STAR_NAME_MAG = 1.8;

/** البعد الزاوي بين اتجاهين (ساعات/درجات استوائية) */
function eqSepDeg(ra1H: number, dec1: number, ra2H: number, dec2: number): number {
  const a1 = ra1H * 15 * DEG, a2 = ra2H * 15 * DEG, d1 = dec1 * DEG, d2 = dec2 * DEG;
  const c = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

/** إكليل مبسَّط للقبة عند الكلية: هالة داخلية وخارجية وخطوط على طول خط استواء الشمس */
function paintDomeCorona(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, k: number, eqAng: number
) {
  if (k < 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = k;
  const g1 = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.9);
  g1.addColorStop(0, 'rgba(255,248,235,0.95)');
  g1.addColorStop(0.18, 'rgba(255,240,215,0.55)');
  g1.addColorStop(1, 'rgba(255,235,210,0)');
  ctx.fillStyle = g1;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.9, 0, TAU); ctx.fill();
  const g2 = ctx.createRadialGradient(cx, cy, R, cx, cy, R * 4.4);
  g2.addColorStop(0, 'rgba(220,230,255,0.30)');
  g2.addColorStop(0.35, 'rgba(190,205,245,0.12)');
  g2.addColorStop(1, 'rgba(160,180,235,0)');
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.arc(cx, cy, R * 4.4, 0, TAU); ctx.fill();
  const streamers: [number, number, number][] = [
    [0, 3.3, 0.2], [Math.PI, 3.1, 0.2], [0.28, 2.1, 0.14], [-0.3, 2.2, 0.14], [Math.PI + 0.3, 2.0, 0.14], [Math.PI - 0.3, 2.2, 0.14],
    [Math.PI / 2, 1.5, 0.12], [-Math.PI / 2, 1.45, 0.12],
  ];
  for (const [a, len, wid] of streamers) {
    const L = R * len, W = R * wid * 1.6;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(eqAng + a);
    ctx.translate(R * 0.9 + L * 0.5, 0);
    ctx.scale(L * 0.5, W);
    const gr = ctx.createRadialGradient(-0.55, 0, 0, 0, 0, 1);
    gr.addColorStop(0, 'rgba(255,246,230,0.34)');
    gr.addColorStop(0.45, 'rgba(235,235,250,0.12)');
    gr.addColorStop(1, 'rgba(220,225,255,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ───────────────────────────── أدوات الرسم المساعدة ─────────────────────────────
/** حقل النجوم (متجهات J2000 جاهزة): يُعاد بناؤه فقط عند تغيّر حجم الكتالوج (تحميله غير المتزامن) */
let starField: StarField | null = null;
let starFieldCount = -1;

/**
 * قلم يرسم خطوطاً على القبة ويقطعها عند الأفق بدل أن يمدّها خارج القرص.
 * ما تحت الأفق يُوضَع خارج القرص (ρ>1) فيصل الوتر بين نقطتين تحت الأفق على جانبين متقابلين إلى داخل القرص
 * ويرسم خطاً مستقيماً زائفاً عبره (يحدث لخط البروج وحدود الأبراج عند راصد استوائي قرب النادر). هنا يُقطع الخط عند ارتفاع 0
 * بالاستيفاء بين النقطتين، فلا يُرسم شيء من الجزء الغاطس.
 */
function makePen(ctx: CanvasRenderingContext2D, f: DomeFrame) {
  let prev: { alt: number; az: number } | null = null;
  const cross = (a: { alt: number; az: number }, b: { alt: number; az: number }) => {
    const t = a.alt / (a.alt - b.alt);
    let d = b.az - a.az;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    return domePoint(f, 0, a.az + d * t);
  };
  return {
    /** بداية خط جديد (لا يُوصَل بما قبله) */
    lift() { prev = null; },
    to(alt: number, az: number) {
      const cur = { alt, az };
      if (!prev) {
        if (alt >= 0) { const p = domePoint(f, alt, az); ctx.moveTo(p.x, p.y); }
      } else if (prev.alt >= 0 && alt >= 0) {
        const p = domePoint(f, alt, az); ctx.lineTo(p.x, p.y);
      } else if (prev.alt >= 0) {
        const c = cross(prev, cur); ctx.lineTo(c.x, c.y);
      } else if (alt >= 0) {
        const c = cross(prev, cur); ctx.moveTo(c.x, c.y);
        const p = domePoint(f, alt, az); ctx.lineTo(p.x, p.y);
      }
      prev = cur;
    },
  };
}

/** اسم على القبة: يُجمَع ثم يُرسم دفعة واحدة بعد حل التراكب */
interface DomeLabel {
  text: string;
  /** نقطة الارتكاز بإحداثيات الرسم، والإزاحة (ox, oy) في إطار الشاشة كما في fillTextUpright */
  x: number; y: number; ox: number; oy: number;
  font: string; color: string; align: CanvasTextAlign;
  /** الأعلى أولاً: الأجرام الأساسية (≥80) لا تُحذف أبداً، وغيرها يُحذف إن تراكب مع أعلى منه أو لم يتسع في القبة */
  prio: number;
  alpha: number;
  /** يُقلب إلى الجهة المقابلة من نقطته إن كان سيخرج من حلقة الأفق */
  flip: boolean;
}

/**
 * يرسم الأسماء بعد رفع قصّ القبة (فلا يُبتر اسم عند الحلقة) مع منع التراكب: كل اسم يُقاس ويُختبر مستطيله
 * في إطار الشاشة (الدوران لا يغيّر الأبعاد، فتُحسب الإزاحات نسبةً لمركز القبة بعد تدوير المتجه بزاوية المشهد).
 */
function flushLabels(ctx: CanvasRenderingContext2D, f: DomeFrame, labels: DomeLabel[]) {
  if (!labels.length) return;
  const th = getSceneRotationRad();
  const c = Math.cos(th), s = Math.sin(th);
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const sorted = [...labels].sort((a, b) => b.prio - a.prio);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  for (const L of sorted) {
    ctx.font = L.font;
    const w = ctx.measureText(L.text).width;
    const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(L.font)?.[1] ?? '10');
    const dx = L.x - f.px, dy = L.y - f.py;
    const ux = dx * c - dy * s, uy = dx * s + dy * c;
    const boxFor = (ox: number, oy: number, align: CanvasTextAlign) => {
      const x0 = align === 'left' || align === 'start' ? ux + ox : align === 'right' || align === 'end' ? ux + ox - w : ux + ox - w / 2;
      return { x0, x1: x0 + w, y0: uy + oy - size * 0.85, y1: uy + oy + size * 0.25 };
    };
    const outside = (b: { x0: number; y0: number; x1: number; y1: number }) =>
      Math.max(Math.hypot(b.x0, b.y0), Math.hypot(b.x1, b.y0), Math.hypot(b.x0, b.y1), Math.hypot(b.x1, b.y1)) > f.radius * 1.03;
    const clash = (b: { x0: number; y0: number; x1: number; y1: number }) =>
      placed.some((p) => b.x0 < p.x1 + 2 && b.x1 > p.x0 - 2 && b.y0 < p.y1 + 1 && b.y1 > p.y0 - 1);
    // المواضع المجرَّبة بالترتيب: الأصلي، ثم الجهة المقابلة من النقطة (قرب الحافة)، ثم أسفلها، ثم أعلاها
    const opp: CanvasTextAlign = L.align === 'left' ? 'right' : L.align === 'right' ? 'left' : L.align;
    const step = size * 1.3;
    const tries: { ox: number; oy: number; align: CanvasTextAlign }[] = [{ ox: L.ox, oy: L.oy, align: L.align }];
    if (L.flip) tries.push({ ox: -L.ox, oy: L.oy, align: opp });
    tries.push({ ox: L.ox, oy: L.oy + step, align: L.align });
    if (L.flip) tries.push({ ox: -L.ox, oy: L.oy + step, align: opp });
    tries.push({ ox: L.ox, oy: L.oy - step, align: L.align });
    const essential = L.prio >= 80;
    let chosen = tries.find((t) => { const b = boxFor(t.ox, t.oy, t.align); return !outside(b) && !clash(b); });
    // الأجرام الأساسية لا تُحذف أبداً: عند تعذّر موضع حر تُرسم داخل القبة ولو تراكبت، وإلا في موضعها الأصلي
    if (!chosen && essential) chosen = tries.find((t) => !outside(boxFor(t.ox, t.oy, t.align))) ?? tries[0];
    if (!chosen) continue;
    const ox = chosen.ox, align = chosen.align;
    const box = boxFor(chosen.ox, chosen.oy, chosen.align);
    placed.push(box);
    ctx.globalAlpha = L.alpha;
    ctx.fillStyle = L.color;
    ctx.textAlign = align;
    fillTextUpright(ctx, L.text, L.x, L.y, ox, chosen.oy);
  }
  ctx.restore();
}

export function drawObserverDome(
  ctx: CanvasRenderingContext2D, config: PolarMapConfig, input: DomeInput,
  uiScale: number, helpers: DomeHelpers
): DomeTarget[] {
  const targets: DomeTarget[] = [];
  const labels: DomeLabel[] = [];
  const f = computeDomeFrame(config, input.observer);
  const lat = input.observer.latitudeDeg;
  const lst = input.gmstDeg + input.observer.longitudeDeg;
  const sunAlt = input.sun.horizontal.altitudeDeg;
  const sunAz = input.sun.horizontal.azimuthDeg;
  const moonAlt = input.moon.horizontal.altitudeDeg;
  const moonAz = input.moon.horizontal.azimuthDeg;
  const lw = Math.min(uiScale, 2.5);
  // بكسل لكل درجة عند السمت بسلّم إسقاط القبة نفسه (فتتسق أحجام الشمس والقمر مع إحداثياتهما عليها)
  const domePxPerDeg = DOME_PROJECTION === 'equidistant' ? f.radius / 90 : f.radius * DEG;
  // معايرة الأحجام: نصف قطر الجرم = (قطره الزاوي ÷ 2) × بكسل/درجة × التضخيم، كما في الخريطة تماماً
  const radiusOf = (angDeg: number | undefined, fallback: number) =>
    Math.max(4, ((angDeg ?? fallback) / 2) * domePxPerDeg * input.angularBoost);
  const sunRadiusPx = radiusOf(input.sun.angularSizeDeg, FALLBACK_SUN_ANGULAR_DEG);
  const moonRadiusPx = radiusOf(input.moon.angularSizeDeg, FALLBACK_MOON_ANGULAR_DEG);

  // إطار السماء الموحَّد (مصفوفة واحدة J2000 → شرق/شمال/علو بالمبادرة والنوتيشن) لكل ما كتالوجه J2000
  const skyFrame = makeSkyFrame(Astronomy.MakeTime(input.date), input.observer);
  /** موضع على القبة من إحداثيات J2000 (نجوم، كوكبات، حدود أبراج): ارتفاع ظاهري بعد الانكسار */
  const fromJ2000 = (raHours: number, decDeg: number) => {
    const h = placeRaDecJ2000(skyFrame, raHours, decDeg);
    return { ...domePoint(f, h.altDeg, h.azDeg), altDeg: h.altDeg, azDeg: h.azDeg };
  };
  /** موضع على القبة من إحداثيات اليوم (خط البروج، المنازل، محاور القمر): بالانكسار نفسه */
  const toDome = (raHours: number, decDeg: number) => {
    const h = equatorialToHorizontal(raHours, decDeg, lst, lat);
    const alt = apparentAltitude(h.altDeg);
    return { ...domePoint(f, alt, h.azDeg), altDeg: alt, azDeg: h.azDeg };
  };
  const detailOf = (alt: number, az: number) => `على القبة · ارتفاع ${alt.toFixed(1)}° · سمت ${az.toFixed(1)}°`;

  // ── الكسوف والخسوف: لا حساب إلا والجرمان متقاربان (أو متقابلان) ──
  const sepEq = eqSepDeg(
    input.sun.equatorial.rightAscensionHours, input.sun.equatorial.declinationDeg,
    input.moon.equatorial.rightAscensionHours, input.moon.equatorial.declinationDeg
  );
  let solar: SolarView | null = null;
  if (sepEq < 4 && sunAlt > -3) {
    try { solar = solarViewAt(input.date, input.observer); } catch { solar = null; }
    if (solar && solar.separationDeg > 3.2) solar = null;
  }
  const obsc = solar ? solar.obscuration : 0;
  // الإظلام المُدرَك لا يتناسب خطياً مع التغطية: يبدأ محسوساً بعد ~80% ويشتد جداً قرب الكلية
  const darkness = solar && solar.phase !== 'none' ? 1 - Math.pow(Math.max(0, 1 - obsc), 0.35) : 0;
  const totalK = solar && solar.diameterRatio > 1 ? (solar.phase === 'total' ? 1 : smoothstep(0.985, 1, solar.magnitude)) : 0;
  const altEff = sunAlt + (Math.min(sunAlt, -7) - sunAlt) * darkness; // ارتفاع «مكافئ» للون السماء والنجوم
  const moonLight = smoothstep(-8, -14, sunAlt) * clamp01((input.moon.phaseFraction ?? 0)) * clamp01(moonAlt / 30);

  // أخفت قدر يراه الراصد الآن: يتبع شفق السماء (وكلية الكسوف) وضوء القمر
  const limitMag = limitingMagnitude(altEff, { altDeg: moonAlt, phaseFraction: input.moon.phaseFraction ?? 0 });
  const flatStarVisibility = starVisibility(altEff) * (1 - 0.7 * smoothstep(0.4, 1, moonLight));
  /** شفافية جرم بقدره وارتفاعه الظاهري */
  const bodyAlpha = (mag: number, altApparent: number) =>
    DOME_REALISTIC_VISIBILITY ? starAlpha(mag, altApparent, limitMag) : altApparent < -0.6 ? 0 : 1;

  // محورا الشمال والشرق السماويين على القبة عند القمر (للصورة والظل)
  const mra = input.moon.equatorial.rightAscensionHours, mdec = input.moon.equatorial.declinationDeg;
  const unit = (dx: number, dy: number) => { const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
  let moonAxes: { e: { x: number; y: number }; n: { x: number; y: number } } | null = null;
  if (moonAlt > -2) {
    const p0 = toDome(mra, mdec);
    const cosd = Math.max(0.05, Math.cos(mdec * DEG));
    const pe = toDome(mra + (0.05 / cosd) / 15, mdec);
    const dn = mdec > 85 ? -0.05 : 0.05;
    const pn = toDome(mra, mdec + dn);
    const n = unit(pn.x - p0.x, pn.y - p0.y);
    moonAxes = { e: unit(pe.x - p0.x, pe.y - p0.y), n: dn < 0 ? { x: -n.x, y: -n.y } : n };
  }

  ctx.save();

  // السماء + قصّ كل ما بعدها داخل الأفق
  ctx.beginPath();
  ctx.arc(f.px, f.py, f.radius, 0, TAU);
  ctx.clip();
  paintDomeSky(ctx, f, {
    sunAlt, sunAz, moonAlt, moonAz, moonPhase: input.moon.phaseFraction ?? 0, sunFraction: solar ? 1 - obsc : 1,
  }, totalK);

  // شبكة القبة: دائرتا 30° و60° متقطعتان، خط الشرق–الغرب، وخط الشمال الأحمر (وجنوبه خافت)
  const dayK = smoothstep(-4, 10, altEff);
  const gridRGB = mixRGB([226, 232, 240], [30, 42, 80], dayK * 0.8);
  ctx.strokeStyle = rgbCss(gridRGB, 0.2 + 0.06 * dayK);
  ctx.lineWidth = 0.8 * lw;
  ctx.setLineDash([3 * lw, 4 * lw]);
  ctx.beginPath();
  for (const alt of [30, 60]) {
    const r = f.radius * domeRho(alt);
    ctx.moveTo(f.px + r, f.py);
    ctx.arc(f.px, f.py, r, 0, TAU);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(f.px - f.ex * f.radius, f.py - f.ey * f.radius);
  ctx.lineTo(f.px + f.ex * f.radius, f.py + f.ey * f.radius);
  ctx.moveTo(f.px, f.py);
  ctx.lineTo(f.px - f.nx * f.radius, f.py - f.ny * f.radius);
  ctx.strokeStyle = rgbCss(gridRGB, 0.34);
  ctx.lineWidth = 1 * lw;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(f.px, f.py);
  ctx.lineTo(f.px + f.nx * f.radius, f.py + f.ny * f.radius);
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.92)';
  ctx.lineWidth = 1.5 * lw;
  ctx.stroke();
  if (input.labels) {
    ctx.font = `${9 * uiScale}px system-ui, sans-serif`;
    ctx.fillStyle = rgbCss(gridRGB, 0.7);
    ctx.textAlign = 'left';
    for (const alt of [30, 60]) {
      const r = f.radius * domeRho(alt);
      fillTextUpright(ctx, `${alt}°`, f.px + f.nx * r + f.ex * 3 * uiScale, f.py + f.ny * r + f.ey * 3 * uiScale, 0, 0);
    }
  }

  // الشفق القطبي الشمالي: ليلاً فقط، ويخبو مع الشفق المدني وضوء القمر
  if (input.showAurora) {
    const dark = smoothstep(-6, -13, sunAlt) * (1 - 0.7 * smoothstep(0.35, 1, moonLight));
    if (dark > 0.02) {
      const arcs = computeAuroraArcs({
        kp: input.auroraKp, latDeg: lat, lonDeg: input.observer.longitudeDeg,
        sunRaHours: input.sun.equatorial.rightAscensionHours, sunDecDeg: input.sun.equatorial.declinationDeg,
        gmstDeg: input.gmstDeg, timeSec: nowSec(),
      });
      paintAurora(ctx, f, arcs, dark * auroraBrightness(input.auroraKp));
    }
  }

  // خط البروج (بإحداثيات اليوم) — يُقطع عند الأفق
  if (input.showEcliptic) {
    ctx.strokeStyle = 'rgba(176, 141, 87, 0.6)';
    ctx.lineWidth = 1.3 * lw;
    ctx.beginPath();
    const pen = makePen(ctx, f);
    for (let lon = 0; lon <= 360; lon += 3) {
      const { raHours, decDeg } = eclipticLongitudeToEquatorial(lon, input.obliquityDeg);
      const p = toDome(raHours, decDeg);
      pen.to(p.altDeg, p.azDeg);
    }
    ctx.stroke();
  }

  // النجوم: طبقة «النجوم» فقط، وكل نجم يخبو بقدره وارتفاعه والشفق وضوء القمر
  const hasSelection = input.selectedZodiacs.length > 0 || input.selectedGroupIds.length > 0;
  if (input.showStars && (DOME_REALISTIC_VISIBILITY ? limitMag > -3.5 : flatStarVisibility > 0)) {
    const stars = getLoadedStars();
    if (!starField || starFieldCount !== stars.length) {
      starField = new StarField(stars);
      starFieldCount = stars.length;
    }
    starField.update(skyFrame);
    const LEVELS = 6;
    const buckets = new Map<string, Path2D>();
    const named: { x: number; y: number; name: string; alt: number; az: number; r: number; mag: number; a: number }[] = [];
    const dim = hasSelection ? 0.35 : 1;
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      // بوابة رخيصة: نجم أخفت من القدر المحدِّد بـ0.6 لا يُرى مهما كان ارتفاعه
      if (DOME_REALISTIC_VISIBILITY && star.mag >= limitMag + 0.6) continue;
      const alt = starField.altDeg[i];
      const a = DOME_REALISTIC_VISIBILITY ? starAlpha(star.mag, alt, limitMag) : alt < -0.6 ? 0 : flatStarVisibility;
      if (a < 0.03) continue;
      const az = starField.azDeg[i];
      const p = domePoint(f, alt, az);
      const r = Math.max(0.55, getStarRadiusPx(star.mag) * uiScale * 0.9);
      const key = `${getStarColor(star.spect)}|${Math.max(1, Math.ceil(a * LEVELS))}`;
      let path = buckets.get(key);
      if (!path) { path = new Path2D(); buckets.set(key, path); }
      path.moveTo(p.x + r, p.y);
      path.arc(p.x, p.y, r, 0, TAU);
      if (star.mag < MAX_STAR_NAME_MAG && a > 0.4) {
        const name = getStarDisplayName(star);
        if (name) named.push({ x: p.x, y: p.y, name, alt, az, r, mag: star.mag, a });
      }
    }
    for (const [key, path] of buckets) {
      const sep = key.lastIndexOf('|');
      ctx.globalAlpha = (Number(key.slice(sep + 1)) / LEVELS) * dim;
      ctx.fillStyle = key.slice(0, sep);
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;

    for (const n of named) {
      if (input.labels && uiScale > 1.6) {
        labels.push({
          text: n.name, x: n.x, y: n.y, ox: labelGap(n.r * 1.8, uiScale), oy: -(3 + uiScale),
          font: `${10 * uiScale}px system-ui, sans-serif`, color: 'rgba(226, 232, 240, 0.85)', align: 'left',
          prio: 30 - n.mag * 3, alpha: n.a, flip: true,
        });
      }
      if (n.alt > 0) targets.push({ x: n.x, y: n.y, name: n.name, detail: detailOf(n.alt, n.az) });
    }
  }

  // خطوط الكوكبات المختارة (اختيار صريح: تظهر ولو أُغلقت طبقة النجوم)
  if (input.selectedGroupIds.length) {
    const starById = getStarByIdMap();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = Math.min(1.3, 0.8 + 0.2 * uiScale);
    ctx.beginPath();
    const pen = makePen(ctx, f);
    for (const groupId of input.selectedGroupIds) {
      for (const { hipFrom, hipTo } of getGroupLines(groupId)) {
        const a = starById.get(hipFrom);
        const b = starById.get(hipTo);
        if (!a || !b) continue;
        const pa = fromJ2000(a.ra, a.dec);
        const pb = fromJ2000(b.ra, b.dec);
        pen.lift();
        pen.to(pa.altDeg, pa.azDeg);
        pen.to(pb.altDeg, pb.azDeg);
      }
    }
    ctx.stroke();
  }

  // حدود الأبراج المختارة (كتالوج J2000)
  if (input.selectedZodiacs.length) {
    ctx.strokeStyle = ACCENT_LINE;
    ctx.lineWidth = 1.8 * lw;
    ctx.beginPath();
    const pen = makePen(ctx, f);
    for (const key of input.selectedZodiacs) {
      const data = getLoadedZodiac()[key];
      if (!data) continue;
      for (const seg of data.segments) {
        pen.lift();
        for (const pt of seg) {
          if (!pt) { pen.lift(); continue; }
          const p = fromJ2000(pt[0], pt[1]);
          pen.to(p.altDeg, p.azDeg);
        }
      }
    }
    ctx.stroke();
  }

  // المنازل القمرية: المختارة بإبراز، وأسماء الكل إن طُلبت
  const mansions = getAllLunarMansions();
  if (input.selectedMansionIndices.length) {
    ctx.strokeStyle = ACCENT_LINE;
    ctx.lineWidth = 2.4 * lw;
    ctx.beginPath();
    const pen = makePen(ctx, f);
    for (const idx of input.selectedMansionIndices) {
      const m = mansions[idx];
      if (!m) continue;
      pen.lift();
      for (let lon = m.startLongitudeDeg; lon <= m.endLongitudeDeg; lon += 1) {
        const { raHours, decDeg } = eclipticLongitudeToEquatorial(lon, input.obliquityDeg);
        const p = toDome(raHours, decDeg);
        pen.to(p.altDeg, p.azDeg);
      }
    }
    ctx.stroke();
  }
  const nameMansion = (m: (typeof mansions)[number], bright: boolean) => {
    const midLon = m.startLongitudeDeg + MANSION_SPAN_DEG / 2;
    const { raHours, decDeg } = eclipticLongitudeToEquatorial(midLon, input.obliquityDeg);
    const p = toDome(raHours, decDeg);
    if (p.altDeg < 0) return;
    labels.push({
      text: m.nameAr, x: p.x, y: p.y, ox: 0, oy: bright ? -10 * uiScale : 0,
      font: `bold ${(bright ? 11 : 9) * uiScale}px system-ui, sans-serif`,
      color: bright ? ACCENT_LINE_BRIGHT : 'rgba(201, 172, 120, 0.9)', align: 'center',
      prio: bright ? 60 : 15, alpha: 1, flip: false,
    });
  };
  if (input.showMansionNames) mansions.forEach((m) => nameMansion(m, false));
  if (input.labels) input.selectedMansionIndices.forEach((idx) => { if (mansions[idx]) nameMansion(mansions[idx], true); });

  // علامة تصويب النجمة المحدَّدة (اختيار صريح)
  if (input.highlightedStarId != null) {
    const star = getStarByIdMap().get(input.highlightedStarId);
    if (star) {
      const p = fromJ2000(star.ra, star.dec);
      if (p.altDeg > 0) {
        const t = (Math.sin(Date.now() / 640) + 1) / 2;
        const gap = 6 + 1.2 * uiScale + 2 * t;
        const len = 5 + 0.8 * uiScale;
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.65 + 0.35 * (1 - t);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x - gap - len, p.y); ctx.lineTo(p.x - gap, p.y);
        ctx.moveTo(p.x + gap, p.y); ctx.lineTo(p.x + gap + len, p.y);
        ctx.moveTo(p.x, p.y - gap - len); ctx.lineTo(p.x, p.y - gap);
        ctx.moveTo(p.x, p.y + gap); ctx.lineTo(p.x, p.y + gap + len);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // الكواكب: طبقة «الكواكب» فقط، وكل كوكب يخبو بقدره وارتفاعه (يظهر في الكلية لأن السماء تُظلم)
  if (input.showPlanets) {
    for (const { name, state } of input.planets) {
      const { altitudeDeg, azimuthDeg } = state.horizontal;
      if (altitudeDeg < -1) continue;
      const mag = state.magnitude ?? 2;
      const a = bodyAlpha(mag, altitudeDeg);
      if (a < 0.04) continue;
      const p = domePoint(f, altitudeDeg, azimuthDeg);
      const color = PLANET_COLORS[name as keyof typeof PLANET_COLORS] ?? '#e2e8f0';
      // نقطة تتدرج بالقدر: سقفها نسبة من الشمس، وأرضيتها فوق أكبر نجم (الأرضية هي الغالبة)
      const r = Math.max(PLANET_MIN_RADIUS_UI * uiScale, Math.min(sunRadiusPx * PLANET_MAX_SUN_FRACTION, (2.3 - mag * 0.14) * uiScale));
      ctx.save();
      ctx.globalAlpha = a;
      helpers.drawPlanetDot(ctx, { x: p.x, y: p.y, visible: true }, r, color, uiScale);
      ctx.restore();
      const nameAr = PLANET_LABELS_AR[name as keyof typeof PLANET_LABELS_AR] ?? name;
      if (input.labels) {
        labels.push({
          text: nameAr, x: p.x, y: p.y, ox: labelGap(r, uiScale), oy: -(3 + uiScale),
          font: `${10 * uiScale}px system-ui, sans-serif`, color, align: 'left', prio: 90, alpha: a, flip: true,
        });
      }
      if (altitudeDeg > 0 && a > 0.15) targets.push({ x: p.x, y: p.y, name: nameAr, detail: detailOf(altitudeDeg, azimuthDeg) });
    }
  }

  // ── الشمس والقمر ──
  // الأحجام على القبة مضخَّمة للوضوح بمعامل واحد (angularBoost) فتبقى نسبة القمر إلى الشمس حقيقية. عند اقتراب الجرمين نبدّل تدريجياً إلى وضع «الكسوف»:
  // الأحجام النسبية الحقيقية وإزاحة المركزين الحقيقية (من منظر الراصد) بنفس معامل التضخيم، فيتطابق الشكل مع السماء.
  const sunP0 = domePoint(f, sunAlt, sunAz);
  const moonP0 = domePoint(f, moonAlt, moonAz);
  const bodyRadius = sunRadiusPx;
  let sunP = sunP0, moonP = moonP0, moonR = moonRadiusPx;
  const w = solar ? smoothstep(3.0, 0.9, solar.separationDeg) : 0;
  let eqAng = 0;
  if (solar && w > 0) {
    const k = bodyRadius / solar.sun.radiusDeg;
    const a = sunAz * DEG;
    const rx = Math.cos(a) * f.nx + Math.sin(a) * f.ex, ry = Math.cos(a) * f.ny + Math.sin(a) * f.ey;     // نحو الأفق (للخارج)
    const tx = -Math.sin(a) * f.nx + Math.cos(a) * f.ex, ty = -Math.sin(a) * f.ny + Math.cos(a) * f.ey;   // يمين الراصد
    // نحو السمت = −الخارج
    const mx = sunP0.x + k * (solar.dxDeg * tx - solar.dyDeg * rx);
    const my = sunP0.y + k * (solar.dxDeg * ty - solar.dyDeg * ry);
    moonP = { x: moonP0.x + (mx - moonP0.x) * w, y: moonP0.y + (my - moonP0.y) * w };
    moonR = moonRadiusPx + (bodyRadius * (solar.moon.radiusDeg / solar.sun.radiusDeg) - moonRadiusPx) * w;
    // اتجاه خط استواء الشمس على القبة (الخطوط الإكليلية)
    const pa = solar.poleAngleDeg * DEG;
    const ex2 = -Math.sin(pa) * (-rx) + Math.cos(pa) * tx, ey2 = -Math.sin(pa) * (-ry) + Math.cos(pa) * ty;
    eqAng = Math.atan2(ey2, ex2);
  }
  const sunV = { x: sunP.x, y: sunP.y, visible: true };
  const moonV = { x: moonP.x, y: moonP.y, visible: true };

  // صورة القمر باتجاهها الحقيقي على القبة، وهالة الاكتمال
  const moonTex = moonAxes && moonRadiusPx >= 5 && getMoonImage()
    ? moonTexFromAxes(moonAxes, moonPoleAngleDeg(input.date))
    : undefined;
  const eclipseSepL = 180 - sepEq;
  const haloScale = eclipseSepL < 1.3 ? Math.max(0.1, (eclipseSepL - 0.35) / 0.95) : 1;
  const realOverlap = (solar ? solar.separationDeg : sepEq) < 0.62;

  const paintMoon = () => {
    helpers.drawMoon(ctx, input.moon, moonV, sunV, moonR, moonTex, haloScale, realOverlap);
    // خسوف القمر: ظل الأرض وشبه ظلها على القرص بنصف القطر والإزاحة الحقيقيين
    if (moonAxes && eclipseSepL < 2.4) {
      const s = lunarShadowOnSky(input.date);
      if (s.penumbralMagnitude > 0) {
        const cx = moonP.x + moonR * (s.eastMoonRadii * moonAxes.e.x + s.northMoonRadii * moonAxes.n.x);
        const cy = moonP.y + moonR * (s.eastMoonRadii * moonAxes.e.y + s.northMoonRadii * moonAxes.n.y);
        paintEarthShadowDisc(ctx, moonP.x, moonP.y, moonR, cx, cy, s.umbra * moonR, s.penumbra * moonR);
      }
    }
  };
  const paintSun = () => {
    ctx.save();
    ctx.globalAlpha = 0.1 + 0.9 * Math.sqrt(clamp01(1 - obsc));
    paintDomeSun(ctx, sunV.x, sunV.y, bodyRadius, sunAlt);
    ctx.restore();
  };

  if (realOverlap || (solar && w > 0.5)) {
    paintSun();
    paintMoon();
    // الإكليل خلف القمر وفوق الشمس: يُرسم بعد القمر بالمزج الإضافي ليحيط بقرصه المعتم
    if (solar && totalK > 0.01) paintDomeCorona(ctx, sunP.x, sunP.y, bodyRadius, totalK, eqAng);
    // حلقة الألماس عند آخر/أول شعاع قبيل/بعد الكلية
    if (solar && solar.phase !== 'annular' && solar.obscuration > 0.985 && solar.diameterRatio > 1 && solar.phase !== 'total') {
      const dx = sunP.x - moonP.x, dy = sunP.y - moonP.y;
      const d = Math.hypot(dx, dy) || 1;
      const bx = sunP.x + (dx / d) * bodyRadius, by = sunP.y + (dy / d) * bodyRadius;
      const cl = smoothstep(0.985, 0.9995, Math.min(solar.magnitude, 0.9995));
      const gl = ctx.createRadialGradient(bx, by, 0, bx, by, bodyRadius * 1.1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      gl.addColorStop(0, `rgba(255,255,255,${cl})`);
      gl.addColorStop(0.15, `rgba(255,252,240,${0.8 * cl})`);
      gl.addColorStop(0.5, `rgba(255,240,205,${0.22 * cl})`);
      gl.addColorStop(1, 'rgba(255,230,170,0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(bx, by, bodyRadius * 1.1, 0, TAU); ctx.fill();
      ctx.restore();
    }
  } else {
    // الشمس في الطبقة العليا ما لم يتقاطع القرصان فعلاً
    paintMoon();
    paintSun();
  }

  if (input.labels) {
    const gap = bodyRadius * (1 + (solar ? 0.4 * w : 0)) + 4 * uiScale;
    const font = `${10 * uiScale}px system-ui, sans-serif`;
    // الشمس والقمر فوق الجميع. اسم القمر في الجهة المعاكسة للشمس إن تقاربا حتى لا يتراكب الاسمان
    if (sunAlt > -1) {
      labels.push({ text: 'الشمس', x: sunP.x, y: sunP.y, ox: 0, oy: -gap - 2 * uiScale, font, color: '#fde68a', align: 'center', prio: 100, alpha: 1, flip: false });
    }
    if (moonAlt > -1) {
      const below = Math.hypot(moonP.x - sunP.x, moonP.y - sunP.y) < bodyRadius * 5 && moonP.y <= sunP.y;
      labels.push({ text: 'القمر', x: moonP.x, y: moonP.y, ox: 0, oy: below ? moonR + 12 * uiScale : -moonR - 6 * uiScale, font, color: '#e2e8f0', align: 'center', prio: 100, alpha: 1, flip: false });
    }
  }
  if (sunAlt > -1) {
    targets.push({ x: sunP.x, y: sunP.y, name: 'الشمس', detail: detailOf(sunAlt, sunAz) });
  }
  if (moonAlt > -1) {
    targets.push({ x: moonP.x, y: moonP.y, name: 'القمر', detail: detailOf(moonAlt, moonAz) });
  }

  ctx.restore();

  // الأسماء بعد رفع القصّ: لا تُبتر عند الحلقة، ولا يتراكب اسمان (الأعلى أولوية يبقى)
  flushLabels(ctx, f, labels);

  // ── إطار الأفق: حلقة، تدريجات السمت، نقطة السمت، سهم الشمال، وحروف E/S/W ──
  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
  ctx.lineWidth = 1.6 * lw;
  ctx.beginPath();
  ctx.arc(f.px, f.py, f.radius, 0, TAU);
  ctx.stroke();

  // تدريجات كل 5° (صغيرة) و10° (أطول) و45° (الأطول)
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
  ctx.lineWidth = 1 * lw;
  ctx.beginPath();
  for (let az = 0; az < 360; az += 5) {
    const len = az % 45 === 0 ? 0.045 : az % 10 === 0 ? 0.028 : 0.015;
    const a = az * DEG;
    const dx = Math.cos(a) * f.nx + Math.sin(a) * f.ex;
    const dy = Math.cos(a) * f.ny + Math.sin(a) * f.ey;
    ctx.moveTo(f.px + dx * f.radius * (1 - len), f.py + dy * f.radius * (1 - len));
    ctx.lineTo(f.px + dx * f.radius, f.py + dy * f.radius);
  }
  ctx.stroke();

  // نقطة السمت
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.9)';
  ctx.lineWidth = 1.3 * lw;
  ctx.beginPath();
  ctx.arc(f.px, f.py, 4.5 * lw, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
  ctx.beginPath();
  ctx.arc(f.px, f.py, 1.6 * lw, 0, TAU);
  ctx.fill();

  // سهم الشمال الأحمر خارج الحافة
  {
    const base = f.radius * 1.025, apex = f.radius * 1.17, half = f.radius * 0.035;
    const bx = f.px + f.nx * base, by = f.py + f.ny * base;
    ctx.fillStyle = '#ef4444';
    ctx.shadowColor = 'rgba(239, 68, 68, 0.55)';
    ctx.shadowBlur = 8 * lw;
    ctx.beginPath();
    ctx.moveTo(f.px + f.nx * apex, f.py + f.ny * apex);
    ctx.lineTo(bx + f.ex * half, by + f.ey * half);
    ctx.lineTo(bx - f.ex * half, by - f.ey * half);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // E / S / W (أفقية دائماً)؛ الشمال يكفيه السهم
  if (input.labels) {
    ctx.font = `600 ${12 * uiScale}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e2e8f0';
    const letters: { t: string; dx: number; dy: number }[] = [
      { t: 'E', dx: f.ex, dy: f.ey }, { t: 'S', dx: -f.nx, dy: -f.ny }, { t: 'W', dx: -f.ex, dy: -f.ey },
    ];
    for (const c of letters) {
      fillTextUpright(ctx, c.t, f.px + c.dx * f.radius * 1.1, f.py + c.dy * f.radius * 1.1, 0, 4.5 * uiScale);
    }
  }
  ctx.restore();

  return targets;
}
