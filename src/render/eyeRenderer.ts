import { clampCamera, dirFromAltAz, makeProjector, type Camera, type Projector, type V3 } from '../core/camera';
import { ensureSkyTables, type DomeSkyInput } from './domeSky';
import { buildSkyTexture, getExposure, groundShadowK, paintGroundLayer, paintSkyBackground, skyColorAt } from './eyeBackground';
import { horizonAtmosphere } from '../core/atmosphere';
import { paintEyeMoon, paintEyeSun, refractionFlatten } from './eyeBodies';
import { paintFilteredSun, solarPhysical } from './eyeSun';
import { getLoadedStars, getStarByIdMap, getStarColor, getStarDisplayName, getStarRadiusPx } from '../core/starCatalog';
import { limitingMagnitude, makeSkyFrame, placeRaDecJ2000, StarField, starAlpha, getRefractionScale, refractionDegStd } from '../core/skyModel';
import { computeGroupCenter, getGroupById, getGroupLines } from '../core/starGroups';
import { paintPlanetResolved, PLANET_RADII_KM, AU_KM, SATURN_RING_OUTER, type PlanetPhys } from './eyePlanets';
import { getLoadedZodiac } from '../core/zodiac';
import { getAllLunarMansions, MANSION_SPAN_DEG } from '../core/mansions';
import { eclipticLongitudeToEquatorial } from '../core/eclipticTransform';
import { apparentAltitude, equatorialToHorizontal, paintDomeCorona } from './observerDome';
import { auroraBrightness, computeAuroraArcs } from '../core/aurora';
import { apparentSolarHour, gnomonShadow, hourAngleDeg, shadowTipCurve, SOLSTICE_DEC_DEG } from '../core/sundial';
import { moonTexFromAxes, paintDarkRegion } from './eclipseOverlay';
import { resolveLook } from '../core/danjon';
import { getMoonImage } from './bodyImages';
import { lunarShadowOnSky, moonPoleAngleDeg, solarViewAt, type SolarView } from '../core/eclipses';
import { PLANET_COLORS } from '../core/bodies';
import type { CelestialBodyState, ObserverLocation } from '../types/astro';
import * as Astronomy from 'astronomy-engine';

/**
 * عين الراصد: منظور أول شخص كستيلاريوم — السماء في الأعلى والأرض في الأسفل، والكاميرا بارتفاع عين فوق أرض مستوية
 * عليها ساعة شمسية (عمود رأسي) عند قدمي الراصد يُقرأ من ظلّها الاتجاه والطول والزمن الشمسي.
 *
 * ترتيب الرسم: صورة السماء ← (شبكة، خطوط، شفق، نجوم، كواكب، شمس، قمر) ← صورة الأرض (تحجب ما تحت الأفق) ← الأفق والاتجاهات ← الساعة الشمسية.
 * الخلفية تُحسب بكسلاً بكسلاً بدقة مخفَّضة (bgScale) وبنسيج سماء (سمت×ارتفاع) يُعاد بناؤه عند تغيّر الشمس فقط،
 * فيكلّف السحب إسقاطاً وبحثاً في النسيج لا غير.
 */
const DEG = Math.PI / 180;
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** ارتفاع عمود الساعة الشمسية بالمتر (وحدة قياس الظل: طول الظل بالمتر = النسبة × هذا) */
export const GNOMON_HEIGHT_M = 1;
/** مركز الساعة الشمسية (م) نسبةً للراصد: 4.2م جنوباً فتُرى أمامك عند النظر جنوباً ونحو الأسفل */
const DIAL_E = 0;
const DIAL_N = -4.2;
const PLATE_RADIUS_M = 3.2;
const ROD_RADIUS_M = 0.025;
const SUN_ANGULAR_DIAMETER_RAD = 0.00931;
/** تعريض يُظهر أسطع نقطة في القمر عند ~0.9 (سطوع القمر الكامل ≈ 3400 cd/m²): يُؤخذ الأدنى منه ومن تعريض المشهد */
const MOON_EXPOSURE = 0.9 / 3400;

export interface EyeStates {
  sun: CelestialBodyState;
  moon: CelestialBodyState;
  planets: { name: string; state: CelestialBodyState }[];
  gmstDeg: number;
  obliquityDeg: number;
  /** معطيات فيزيائية للكواكب (المسافة والطور والقطب وأقمار المشتري) من astronomy-engine */
  physical?: Record<string, PlanetPhys>;
}
export interface EyeOptions {
  stars: boolean; planets: boolean; labels: boolean; ecliptic: boolean;
  ground: boolean; sundial: boolean; altAzGrid: boolean;
  aurora: boolean; auroraKp: number;
  /** فلتر شمسي: كل شيء معتم عدا قرص الشمس */
  solarFilter?: boolean;
  /** ارتفاع العين فوق الأرض (م) */
  eyeHeightM: number;
}
export interface EyeSelection { zodiacs: string[]; mansionIndices: number[]; groupIds: number[]; highlightedStarId: number | null }
export interface EyeNames {
  sun: string; moon: string; planet: (id: string) => string;
  /** ش، ش‑ق، ق، ج‑ق، ج، ج‑غ، غ، ش‑غ (من الشمال بزيادة 45°) */
  cardinals: string[];
  mansion: (index: number, nameAr: string) => string;
  group: (g: { nameAr: string; nameEn?: string | null }) => string;
  zodiac: (key: string) => string;
  /** نص «تحت الأفق» لمؤشر النجم المختار */
  belowHorizon: string;
  /** اسم قمر غاليلي من مفتاحه: io | europa | ganymede | callisto */
  jovian: (key: string) => string;
}
export interface EyeHelpers {
  drawMoon: (ctx: CanvasRenderingContext2D, moon: CelestialBodyState, moonP: { x: number; y: number; visible: boolean }, sunP: { x: number; y: number; visible: boolean }, radiusPx: number, tex?: { rotRad: number; mirror: boolean }, haloScale?: number, opaqueDark?: boolean) => void;
  drawPlanetDot: (ctx: CanvasRenderingContext2D, p: { x: number; y: number; visible: boolean }, r: number, color: string, zoomScale: number) => void;
}
export interface EyeInput {
  date: Date; observer: ObserverLocation; camera: Camera; states: EyeStates;
  options: EyeOptions; selection: EyeSelection; names: EyeNames;
  /** دقة الخلفية نسبةً لحجم الشاشة (0.2 أثناء التفاعل … 0.6 عند السكون) */
  bgScale: number;
}
export interface EyeTarget { x: number; y: number; name: string; detail: string; kind: 'sun' | 'moon' | 'planet' | 'star' | 'tip' }
export interface SundialReadout {
  source: 'sun' | 'moon' | 'none';
  altDeg: number; azDeg: number;
  /** طول الظل بنسبة ارتفاع العمود (null إن لم يوجد ظل) */
  lengthRatio: number | null;
  lengthM: number | null;
  shadowAzDeg: number | null;
  /** الزمن الشمسي الظاهري (0..24) */
  solarHour: number;
  sunDecDeg: number;
}
export interface EyeOutput { targets: EyeTarget[]; sundial: SundialReadout; scalePxPerDeg: number }

// ───────────────────────── أدوات الرسم ─────────────────────────
const pt = { x: 0, y: 0 };
const toDir = (alt: number, az: number) => dirFromAltAz(alt, az);

/** رسم خط من نقاط (ارتفاع، سمت) يُقطع حيث لا يُسقط الاتجاه */
function strokeSky(ctx: CanvasRenderingContext2D, P: Projector, pts: { alt: number; az: number }[]): void {
  let pen = false;
  let prevX = 0, prevY = 0;
  for (const p of pts) {
    if (!P.project(toDir(p.alt, p.az), pt)) { pen = false; continue; }
    // قفزة هائلة بين نقطتين متجاورتين = التفاف الإسقاط (تقاطع الجبهة الخلفية): نكسر الخط
    if (pen && Math.hypot(pt.x - prevX, pt.y - prevY) > Math.max(P.w, P.h)) pen = false;
    if (!pen) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
    pen = true; prevX = pt.x; prevY = pt.y;
  }
}

interface Label { text: string; x: number; y: number; ox: number; oy: number; font: string; color: string; align: CanvasTextAlign; prio: number }
function flushLabels(ctx: CanvasRenderingContext2D, labels: Label[], W: number, H: number): void {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  for (const L of [...labels].sort((a, b) => b.prio - a.prio)) {
    if (L.x < -50 || L.x > W + 50 || L.y < -20 || L.y > H + 20) continue;
    ctx.font = L.font;
    const w = ctx.measureText(L.text).width;
    const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(L.font)?.[1] ?? '11');
    const x0 = L.align === 'left' ? L.x + L.ox : L.align === 'right' ? L.x + L.ox - w : L.x + L.ox - w / 2;
    const box = { x0, x1: x0 + w, y0: L.y + L.oy - size * 0.85, y1: L.y + L.oy + size * 0.25 };
    if (placed.some((p) => box.x0 < p.x1 + 2 && box.x1 > p.x0 - 2 && box.y0 < p.y1 + 1 && box.y1 > p.y0 - 1)) continue;
    placed.push(box);
    ctx.textAlign = L.align;
    ctx.lineJoin = 'round'; ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.strokeText(L.text, L.x + L.ox, L.y + L.oy);
    ctx.fillStyle = L.color;
    ctx.fillText(L.text, L.x + L.ox, L.y + L.oy);
  }
  ctx.restore();
}

// ───────────────────────── الساعة الشمسية (على الأرض) ─────────────────────────
/** نقطة على الأرض بإحداثيات محلية للساعة (م شرق/شمال من قاعدة العمود) → شاشة. z = ارتفاع فوق الأرض (م) */
function dialPoint(P: Projector, e: number, n: number, eyeH: number, out: { x: number; y: number }, z = 0): boolean {
  const X = DIAL_E + e, Y = DIAL_N + n, Z = z - eyeH;
  const len = Math.hypot(X, Y, Z);
  return P.project([X / len, Y / len, Z / len], out);
}
/** خط على الأرض بإحداثيات الساعة المحلية؛ ينقطع حيث لا يُسقط */
function dialLine(ctx: CanvasRenderingContext2D, P: Projector, pts: [number, number][], eyeH: number, close = false): void {
  let pen = false;
  const q = { x: 0, y: 0 };
  for (const [e, n] of pts) {
    if (!dialPoint(P, e, n, eyeH, q)) { pen = false; continue; }
    if (!pen) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    pen = true;
  }
  if (close) ctx.closePath();
}
const circlePts = (r: number, step = 3): [number, number][] => { const o: [number, number][] = []; for (let a = 0; a <= 360; a += step) o.push([r * Math.sin(a * DEG), r * Math.cos(a * DEG)]); return o; };
const polar = (r: number, azDeg: number): [number, number] => [r * Math.sin(azDeg * DEG), r * Math.cos(azDeg * DEG)];

function drawSundial(
  ctx: CanvasRenderingContext2D, P: Projector, input: EyeInput, shadow: { vec: ReturnType<typeof gnomonShadow>; k: number; source: SundialReadout['source'] },
  sunDec: number, targets: EyeTarget[], labels: Label[]
): void {
  const eyeH = input.options.eyeHeightM;
  const h = GNOMON_HEIGHT_M;
  const q = { x: 0, y: 0 }, q2 = { x: 0, y: 0 };
  const lat = input.observer.latitudeDeg;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // الحلقات: كل حلقة = مضاعف لارتفاع العمود، فيُقرأ طول الظل مباشرة
  ctx.strokeStyle = 'rgba(40, 30, 20, 0.45)'; ctx.lineWidth = 1;
  for (let m = 1; m * h < PLATE_RADIUS_M; m++) { ctx.beginPath(); dialLine(ctx, P, circlePts(m * h), eyeH); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(30, 22, 14, 0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); dialLine(ctx, P, circlePts(PLATE_RADIUS_M), eyeH); ctx.stroke();

  // خطوط السمت كل 30° وتدريجات كل 5° على الحافة
  ctx.strokeStyle = 'rgba(40, 30, 20, 0.28)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let a = 0; a < 360; a += 30) dialLine(ctx, P, [[0, 0], polar(PLATE_RADIUS_M, a)], eyeH);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(30, 22, 14, 0.75)';
  ctx.beginPath();
  for (let a = 0; a < 360; a += 5) dialLine(ctx, P, [polar(PLATE_RADIUS_M - (a % 10 === 0 ? 0.2 : 0.1), a), polar(PLATE_RADIUS_M, a)], eyeH);
  ctx.stroke();
  // خط الشمال (أحمر كما في القبة)
  ctx.strokeStyle = 'rgba(220, 60, 60, 0.9)'; ctx.lineWidth = 2;
  ctx.beginPath(); dialLine(ctx, P, [[0, 0], [0, PLATE_RADIUS_M]], eyeH); ctx.stroke();

  // أسماء الاتجاهات خارج الحافة وأرقام الحلقات
  for (let k = 0; k < 8; k++) {
    const [e, n] = polar(PLATE_RADIUS_M + 0.4, k * 45);
    if (dialPoint(P, e, n, eyeH, q)) labels.push({ text: input.names.cardinals[k], x: q.x, y: q.y, ox: 0, oy: 4, font: `${k % 2 === 0 ? 'bold 13' : '11'}px system-ui, sans-serif`, color: k === 0 ? '#ff7b7b' : 'rgba(255,255,255,0.92)', align: 'center', prio: 60 - k });
  }
  for (let m = 1; m * h < PLATE_RADIUS_M; m++) {
    if (dialPoint(P, 0.08, m * h, eyeH, q)) labels.push({ text: `×${m}`, x: q.x, y: q.y, ox: 4, oy: -2, font: '10px system-ui, sans-serif', color: 'rgba(20,14,8,0.85)', align: 'left', prio: 20 });
  }

  // منحنيات طرف الظل: انقلاب صيفي/شتوي (خافتان) واليوم الحالي (ذهبي) مع ساعات شمسية ظاهرية
  const curves = [
    { dec: SOLSTICE_DEC_DEG, color: 'rgba(255, 120, 90, 0.6)', width: 1, dash: [4, 4], hours: false },
    { dec: -SOLSTICE_DEC_DEG, color: 'rgba(110, 160, 255, 0.65)', width: 1, dash: [4, 4], hours: false },
    { dec: sunDec, color: 'rgba(214, 160, 40, 0.98)', width: 2.2, dash: [] as number[], hours: true },
  ];
  for (const c of curves) {
    const tc = shadowTipCurve(lat, c.dec, PLATE_RADIUS_M / h, 1);
    ctx.strokeStyle = c.color; ctx.lineWidth = c.width; ctx.setLineDash(c.dash);
    ctx.beginPath();
    for (const seg of tc.segments) dialLine(ctx, P, seg.map((p) => [p.e * h, p.n * h] as [number, number]), eyeH);
    ctx.stroke();
    ctx.setLineDash([]);
    if (c.hours) {
      for (const p of tc.hours) {
        if (!dialPoint(P, p.e * h, p.n * h, eyeH, q)) continue;
        ctx.fillStyle = 'rgba(214, 160, 40, 1)'; ctx.strokeStyle = 'rgba(40,28,10,0.9)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        labels.push({ text: String(Math.round(p.solarHour)), x: q.x, y: q.y, ox: 0, oy: -7, font: 'bold 11px system-ui, sans-serif', color: 'rgba(60,40,10,0.95)', align: 'center', prio: 30 });
      }
    }
  }

  // الظل: شبه الظل يتّسع بالمسافة (قرص الشمس 0.0093 راد) ويُعتَّم بنسبة (1 − إضاءة الظل/الكلية)
  const sv = shadow.vec;
  if (sv && shadow.k > 0.02) {
    const L = sv.length * h; // م
    const w0 = ROD_RADIUS_M, w1 = ROD_RADIUS_M + 0.5 * SUN_ANGULAR_DIAMETER_RAD * L;
    const ux = Math.sin(sv.shadowAzDeg * DEG), uy = Math.cos(sv.shadowAzDeg * DEG); // اتجاه الظل
    const nx = uy, ny = -ux; // عمودي
    const darkness = (1 - groundShadowK()) * shadow.k;
    const poly = (scale: number): [number, number][] => {
      const pts: [number, number][] = [];
      const N = 14;
      for (let i = 0; i <= N; i++) { const s = i / N; const w = (w0 + (w1 - w0) * s) * scale; pts.push([ux * L * s + nx * w, uy * L * s + ny * w]); }
      for (let i = N; i >= 0; i--) { const s = i / N; const w = (w0 + (w1 - w0) * s) * scale; pts.push([ux * L * s - nx * w, uy * L * s - ny * w]); }
      return pts;
    };
    for (const [scale, a] of [[2.4, 0.3], [1.5, 0.36], [1, 0.5]] as [number, number][]) {
      ctx.fillStyle = `rgba(6, 4, 10, ${(a * darkness).toFixed(3)})`;
      ctx.beginPath(); dialLine(ctx, P, poly(scale), eyeH, true); ctx.fill();
    }
    // اتجاه الجرم المضيء فوق الأرض (خط منقّط من القاعدة نحوه)
    ctx.strokeStyle = shadow.source === 'sun' ? 'rgba(255, 220, 120, 0.6)' : 'rgba(200, 220, 255, 0.55)';
    ctx.lineWidth = 1.2; ctx.setLineDash([2, 5]);
    ctx.beginPath(); dialLine(ctx, P, [[0, 0], [-ux * PLATE_RADIUS_M, -uy * PLATE_RADIUS_M]], eyeH); ctx.stroke();
    ctx.setLineDash([]);
    // طرف الظل: علامة تصويب
    if (dialPoint(P, ux * L, uy * L, eyeH, q)) {
      ctx.strokeStyle = 'rgba(255, 245, 210, 0.95)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(q.x - 10, q.y); ctx.lineTo(q.x + 10, q.y); ctx.moveTo(q.x, q.y - 10); ctx.lineTo(q.x, q.y + 10); ctx.stroke();
      targets.push({ x: q.x, y: q.y, name: '', detail: '', kind: 'tip' });
    }
  }

  // العمود الرأسي: من القاعدة (على الأرض) إلى الطرف (على ارتفاع h)
  {
    // العصا (gnomon): أسطوانة نحاسية بقطرها الفيزيائي (5 سم) تكبر مع الزوم وتتناقص بالمنظور؛ تُظلَّل بحسب جهة الضوء
    const bv: V3 = [DIAL_E, DIAL_N, -eyeH], tv: V3 = [DIAL_E, DIAL_N, h - eyeH];
    const bl = Math.hypot(bv[0], bv[1], bv[2]), tl2 = Math.hypot(tv[0], tv[1], tv[2]);
    const bd: V3 = [bv[0] / bl, bv[1] / bl, bv[2] / bl], td: V3 = [tv[0] / tl2, tv[1] / tl2, tv[2] / tl2];
    if (P.project(bd, q) && P.project(td, q2)) {
      const D = 2 * ROD_RADIUS_M;
      const wb = Math.max(1.4, (D / bl) * P.scaleAt(bd)), wt = Math.max(1.4, (D / tl2) * P.scaleAt(td));
      const ax = q2.x - q.x, ay = q2.y - q.y, al = Math.hypot(ax, ay) || 1, nx = -ay / al, ny = ax / al;
      let side = 0; // جهة الضوء: عكس اتجاه الظل على اللوح
      if (shadow.vec && shadow.k > 0.02) {
        const ux = Math.sin(shadow.vec.shadowAzDeg * DEG), uy = Math.cos(shadow.vec.shadowAzDeg * DEG);
        const l3: V3 = [DIAL_E - ux * 0.15, DIAL_N - uy * 0.15, 0.5 - eyeH], ll = Math.hypot(l3[0], l3[1], l3[2]);
        const lp = { x: 0, y: 0 };
        if (P.project([l3[0] / ll, l3[1] / ll, l3[2] / ll], lp)) side = Math.sign((lp.x - (q.x + q2.x) / 2) * nx + (lp.y - (q.y + q2.y) / 2) * ny);
      }
      const lit = shadow.k > 0.02 ? 1 : 0.32;
      const hl = side > 0 ? 0.72 : side < 0 ? 0.28 : 0.5;
      const rgb = (r: number, g: number, bch: number) => `rgb(${Math.round(r * lit + 14)},${Math.round(g * lit + 11)},${Math.round(bch * lit + 8)})`;
      const grad = ctx.createLinearGradient(q.x - nx * wb / 2, q.y - ny * wb / 2, q.x + nx * wb / 2, q.y + ny * wb / 2);
      grad.addColorStop(0, rgb(104, 80, 40)); grad.addColorStop(Math.max(0.05, hl - 0.38), rgb(178, 146, 84));
      grad.addColorStop(hl, rgb(250, 228, 168)); grad.addColorStop(Math.min(0.95, hl + 0.38), rgb(170, 138, 78)); grad.addColorStop(1, rgb(92, 70, 34));
      ctx.beginPath();
      ctx.moveTo(q.x - nx * wb / 2, q.y - ny * wb / 2); ctx.lineTo(q2.x - nx * wt / 2, q2.y - ny * wt / 2);
      ctx.lineTo(q2.x + nx * wt / 2, q2.y + ny * wt / 2); ctx.lineTo(q.x + nx * wb / 2, q.y + ny * wb / 2); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
      ctx.strokeStyle = 'rgba(24, 16, 8, 0.55)'; ctx.lineWidth = 0.8; ctx.stroke();
      // رأس كروي أكبر قليلاً من قطر العصا
      const rt = Math.max(wt * 0.78, 1.8);
      const bg = ctx.createRadialGradient(q2.x + nx * side * rt * 0.3, q2.y + ny * side * rt * 0.3, rt * 0.1, q2.x, q2.y, rt);
      bg.addColorStop(0, rgb(255, 244, 205)); bg.addColorStop(1, rgb(150, 118, 62));
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(q2.x, q2.y, rt, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

// ───────────────────────── الإطار الكامل ─────────────────────────
export function renderEye(ctx: CanvasRenderingContext2D, w: number, h: number, input: EyeInput, helpers: EyeHelpers, nowMs: number): EyeOutput {
  const cam = clampCamera(input.camera);
  const P = makeProjector(cam, w, h);
  const { states, options: opt } = input;
  const targets: EyeTarget[] = [];
  const labels: Label[] = [];
  const lat = input.observer.latitudeDeg;
  const lst = states.gmstDeg + input.observer.longitudeDeg;
  // انكسار المستخدم (حرارة/ضغط/رطوبة): حالات المكتبة بانكسار قياسي، فيُضاف الفرق (k−1)·R(ارتفاع حقيقي)
  const rs = getRefractionScale();
  const rAdj = (a: number) => (rs === 1 ? a : a + (rs - 1) * refractionDegStd(a - refractionDegStd(a)));
  const sunAlt = rAdj(states.sun.horizontal.altitudeDeg), sunAz = states.sun.horizontal.azimuthDeg;
  const moonAlt = rAdj(states.moon.horizontal.altitudeDeg), moonAz = states.moon.horizontal.azimuthDeg;
  const moonPhase = states.moon.phaseFraction ?? 0;
  const px: { x: number; y: number } = { x: 0, y: 0 };
  const scaleCenter = P.scaleAt(P.basis.fwd);

  // الكسوف: بالمعايير نفسها في القبة (solarViewAt لا يُستدعى إلا قرب الاقتران)
  const sunDir = toDir(sunAlt, sunAz), moonDir = toDir(moonAlt, moonAz);
  const sepEq = Math.acos(Math.max(-1, Math.min(1, sunDir[0] * moonDir[0] + sunDir[1] * moonDir[1] + sunDir[2] * moonDir[2]))) / DEG;
  let solar: SolarView | null = null;
  if (sepEq < 4 && sunAlt > -3) {
    try { solar = solarViewAt(input.date, input.observer); } catch { solar = null; }
    if (solar && solar.separationDeg > 3.2) solar = null;
  }
  const obsc = solar ? solar.obscuration : 0;
  const darkness = solar && solar.phase !== 'none' ? 1 - Math.pow(Math.max(0, 1 - obsc), 0.35) : 0;
  const totalK = solar && solar.diameterRatio > 1 ? (solar.phase === 'total' ? 1 : smoothstep(0.985, 1, solar.magnitude)) : 0;
  const altEff = sunAlt + (Math.min(sunAlt, -7) - sunAlt) * darkness; // الارتفاع الفعّال: يُظلم الرصد في ذروة الكسوف
  const skyIn: DomeSkyInput = { sunAlt, sunAz, moonAlt, moonAz, moonPhase, sunFraction: solar ? 1 - obsc : 1 };
  const version = ensureSkyTables(skyIn, nowMs);
  buildSkyTexture(skyIn, version, nowMs);
  ctx.save();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  paintSkyBackground(ctx, P, { ground: opt.ground, eyeHeightM: opt.eyeHeightM }, { e: DIAL_E, n: DIAL_N, r: PLATE_RADIUS_M }, input.bgScale);

  // أبعاد زاوية → بكسل عند اتجاه
  const pxAt = (angDeg: number, d: V3) => angDeg * DEG * P.scaleAt(d);
  const limitMag = limitingMagnitude(altEff, { altDeg: moonAlt, phaseFraction: moonPhase });
  const fov = cam.fovDeg;
  const detail = Math.max(0, Math.log2(Math.max(1, 90 / fov))); // كلما ضاق المجال زاد التفصيل

  // شبكة سمت/ارتفاع
  if (opt.altAzGrid) {
    ctx.strokeStyle = 'rgba(140, 170, 220, 0.16)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let az = 0; az < 360; az += 30) strokeSky(ctx, P, Array.from({ length: 31 }, (_, i) => ({ alt: i * 3, az })));
    for (let alt = 15; alt < 90; alt += 15) strokeSky(ctx, P, Array.from({ length: 181 }, (_, i) => ({ alt, az: i * 2 })));
    ctx.stroke();
  }

  // خط البروج وخطوط الكوكبات/الأبراج/المنازل المختارة
  const skyFrame = makeSkyFrame(Astronomy.MakeTime(input.date), input.observer);
  const fromJ2000 = (ra: number, dec: number) => { const hh = placeRaDecJ2000(skyFrame, ra, dec); return { alt: hh.altDeg, az: hh.azDeg }; };
  const ofDate = (ra: number, dec: number) => { const hh = equatorialToHorizontal(ra, dec, lst, lat); return { alt: apparentAltitude(hh.altDeg), az: hh.azDeg }; };
  const projEqj = (v: V3, out: { x: number; y: number }): boolean => {
    const r = Math.hypot(v[0], v[1], v[2]) || 1;
    const raH = (((Math.atan2(v[1], v[0]) / DEG) + 360) % 360) / 15, decD = Math.asin(Math.max(-1, Math.min(1, v[2] / r))) / DEG;
    const h2 = fromJ2000(raH, decD);
    return P.project(toDir(h2.alt, h2.az), out);
  };
  /** اتجاه (وحدة) على الشاشة من نقطة `from` نحو `to` (دائرة عظمى) */
  const screenDirToward = (from: V3, to: V3): { x: number; y: number } | null => {
    const dp = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
    const t: V3 = [to[0] - from[0] * dp, to[1] - from[1] * dp, to[2] - from[2] * dp];
    const tl = Math.hypot(t[0], t[1], t[2]); if (!tl) return null;
    const c = Math.cos(0.8 * DEG), s2 = Math.sin(0.8 * DEG);
    const off: V3 = [from[0] * c + (t[0] / tl) * s2, from[1] * c + (t[1] / tl) * s2, from[2] * c + (t[2] / tl) * s2];
    const a0 = { x: 0, y: 0 }, b0 = { x: 0, y: 0 };
    if (!P.project(from, a0) || !P.project(off, b0)) return null;
    const dx = b0.x - a0.x, dy = b0.y - a0.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l };
  };
  if (opt.ecliptic) {
    ctx.strokeStyle = 'rgba(176, 141, 87, 0.65)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    strokeSky(ctx, P, Array.from({ length: 181 }, (_, i) => { const { raHours, decDeg } = eclipticLongitudeToEquatorial(i * 2, states.obliquityDeg); return ofDate(raHours, decDeg); }));
    ctx.stroke();
  }
  // الاختيارات من القوائم والبحث: خطوط بإطار داكن (تُرى على سماء النهار) وأسماء مثل الخريطة
  const strokeOutlined = (color: string, width: number, draw: () => void) => {
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(8, 12, 22, 0.42)'; ctx.lineWidth = width + 2.4; draw();
    ctx.strokeStyle = color; ctx.lineWidth = width; draw();
    ctx.restore();
  };
  if (input.selection.groupIds.length) {
    // مطابقة للخريطة: الخط يتوقف قبل كل نجم بفراغ GAP حتى لا يغطيه، بلا تكرار للقطعة نفسها
    const byId = getStarByIdMap();
    const zs = Math.max(1, Math.min(4, 1 + 0.6 * detail));
    const GAP = 4 + 1.5 * zs, lw = Math.min(1.3, 0.8 + 0.2 * zs);
    const under = 0.35 * smoothstep(-6, 4, sunAlt); // إطار داكن يُرى به الخط على سماء النهار
    const seen = new Set<string>();
    for (const gid of input.selection.groupIds) {
      const segs: number[][] = [];
      for (const { hipFrom, hipTo } of getGroupLines(gid)) {
        if (hipFrom === hipTo) continue;
        const key = hipFrom < hipTo ? `${hipFrom}-${hipTo}` : `${hipTo}-${hipFrom}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a1 = byId.get(hipFrom), b1 = byId.get(hipTo);
        if (!a1 || !b1) continue;
        const h1 = fromJ2000(a1.ra, a1.dec), h2 = fromJ2000(b1.ra, b1.dec);
        const p1 = { x: 0, y: 0 }, p2 = { x: 0, y: 0 };
        if (!P.project(toDir(h1.alt, h1.az), p1) || !P.project(toDir(h2.alt, h2.az), p2)) continue;
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
        if (len <= GAP * 2 + 1) continue;
        const ux = dx / len, uy = dy / len;
        segs.push([p1.x + ux * GAP, p1.y + uy * GAP, p2.x - ux * GAP, p2.y - uy * GAP]);
      }
      ctx.save(); ctx.lineCap = 'butt';
      const strokeSegs = () => { ctx.beginPath(); for (const q4 of segs) { ctx.moveTo(q4[0], q4[1]); ctx.lineTo(q4[2], q4[3]); } ctx.stroke(); };
      if (under > 0.01) { ctx.strokeStyle = `rgba(8, 12, 22, ${under.toFixed(3)})`; ctx.lineWidth = lw + 2; strokeSegs(); }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.lineWidth = lw; strokeSegs();
      ctx.restore();
      const grp = getGroupById(gid), ctr = computeGroupCenter(gid);
      if (grp && ctr) {
        const hh = fromJ2000(ctr.raHours, ctr.decDeg);
        if (P.project(toDir(hh.alt, hh.az), px)) labels.push({ text: input.names.group(grp), x: px.x, y: px.y, ox: 0, oy: 0, font: 'bold 14px system-ui, sans-serif', color: '#ffffff', align: 'center', prio: 85 });
      }
    }
  }
  if (input.selection.zodiacs.length) {
    for (const key of input.selection.zodiacs) {
      const data = getLoadedZodiac()[key];
      if (!data) continue;
      let mx = 0, my = 0, mz = 0;
      strokeOutlined('#e0b96e', 2, () => {
        ctx.beginPath();
        for (const seg of data.segments) {
          let run: { alt: number; az: number }[] = [];
          const flush = () => { if (run.length) strokeSky(ctx, P, run); run = []; };
          for (const q3 of seg) { if (!q3) { flush(); continue; } const pt = fromJ2000(q3[0], q3[1]); run.push(pt); const d3 = toDir(pt.alt, pt.az); mx += d3[0]; my += d3[1]; mz += d3[2]; }
          flush();
        }
        ctx.stroke();
      });
      const ml = Math.hypot(mx, my, mz);
      if (ml > 0 && P.project([mx / ml, my / ml, mz / ml], px)) labels.push({ text: input.names.zodiac(key), x: px.x, y: px.y, ox: 0, oy: 0, font: 'bold 14px system-ui, sans-serif', color: '#f0d8a0', align: 'center', prio: 84 });
    }
  }
  if (input.selection.mansionIndices.length) {
    const mansions = getAllLunarMansions();
    for (const idx of input.selection.mansionIndices) {
      const m = mansions[idx]; if (!m) continue;
      strokeOutlined('#e0b96e', 2.4, () => {
        ctx.beginPath();
        const run: { alt: number; az: number }[] = [];
        for (let lon = m.startLongitudeDeg; lon <= m.endLongitudeDeg + 1e-9; lon += 1) { const { raHours, decDeg } = eclipticLongitudeToEquatorial(lon, states.obliquityDeg); run.push(ofDate(raHours, decDeg)); }
        strokeSky(ctx, P, run);
        ctx.stroke();
      });
      const mid = eclipticLongitudeToEquatorial(m.startLongitudeDeg + MANSION_SPAN_DEG / 2, states.obliquityDeg);
      const mp2 = ofDate(mid.raHours, mid.decDeg);
      if (P.project(toDir(mp2.alt, mp2.az), px)) labels.push({ text: input.names.mansion(idx, m.nameAr), x: px.x, y: px.y, ox: 0, oy: -9, font: 'bold 13px system-ui, sans-serif', color: '#f0d8a0', align: 'center', prio: 83 });
    }
  }

  // الشفق القطبي
  // مؤشر على حافة الشاشة نحو النجم المختار إن كان خارج الإطار أو تحت الأفق (لا يضيع نتيجة البحث)
  if (input.selection.highlightedStarId !== null) {
    const hs = getStarByIdMap().get(input.selection.highlightedStarId);
    if (hs) {
      const hh = fromJ2000(hs.ra, hs.dec);
      const seen = P.project(toDir(hh.alt, hh.az), px) && px.x > 14 && px.x < w - 14 && px.y > 14 && px.y < h - 14;
      if (!seen) {
        const dAz = ((hh.az - cam.azDeg + 540) % 360) - 180, dAlt = hh.alt - cam.altDeg;
        const ang = Math.atan2(-dAlt, dAz * Math.max(0.15, Math.cos(cam.altDeg * DEG)));
        const cx0 = Math.cos(ang), sy0 = Math.sin(ang), mx = w / 2 - 40, my = h / 2 - 40;
        const k = Math.min(Math.abs(cx0) > 1e-6 ? mx / Math.abs(cx0) : 1e9, Math.abs(sy0) > 1e-6 ? my / Math.abs(sy0) : 1e9);
        const ex = w / 2 + cx0 * k, ey = h / 2 + sy0 * k;
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang);
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = 'rgba(8,12,22,0.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.stroke(); ctx.fill();
        ctx.restore();
        const nm = (getStarDisplayName(hs) ?? '') + (hh.alt < 0 ? ` · ${input.names.belowHorizon}` : '');
        labels.push({ text: nm, x: ex - cx0 * 26, y: ey - sy0 * 26, ox: 0, oy: 0, font: 'bold 13px system-ui, sans-serif', color: '#ffffff', align: 'center', prio: 120 });
      }
    }
  }

  if (opt.aurora) {
    const dark = smoothstep(-6, -13, sunAlt);
    if (dark > 0.02) {
      const arcs = computeAuroraArcs({ kp: opt.auroraKp, latDeg: lat, lonDeg: input.observer.longitudeDeg, sunRaHours: states.sun.equatorial.rightAscensionHours, sunDecDeg: states.sun.equatorial.declinationDeg, gmstDeg: states.gmstDeg, timeSec: nowMs / 1000 });
      paintEyeAurora(ctx, P, arcs, dark * auroraBrightness(opt.auroraKp));
    }
  }

  // النجوم: كل ما يتعلق بالزمن لا بالكاميرا (مواضع، شفافية، ألوان، أسماء) يُخزَّن ويُعاد فقط عند تغيّر الزمن/الموقع/القدر المحدِّد
  if (opt.stars) {
    const stars = getLoadedStars();
    if (stars.length) {
      const key = `${input.date.getTime()}|${lat}|${input.observer.longitudeDeg}|${stars.length}|${Math.round(limitMag * 20)}`;
      if (!starCache || starCache.key !== key) starCache = buildStarCache(stars, skyFrame, limitMag, key);
      const sc = starCache;
      const LEVELS = 6;
      const buckets = new Map<string, Path2D>();
      const nameLimit = Math.min(6.5, 1.7 + 1.6 * detail);
      const sizeBoost = 1 + 0.55 * detail;
      const dir: V3 = [0, 0, 0];
      for (let k = 0; k < sc.n; k++) {
        dir[0] = sc.dir[3 * k]; dir[1] = sc.dir[3 * k + 1]; dir[2] = sc.dir[3 * k + 2];
        if (!P.project(dir, px)) continue;
        if (px.x < -8 || px.x > w + 8 || px.y < -8 || px.y > h + 8) continue;
        const r = Math.min(7, Math.max(0.7, sc.baseR[k] * sizeBoost * 1.15));
        const key2 = `${sc.color[k]}|${sc.level[k]}`;
        let path = buckets.get(key2); if (!path) { path = new Path2D(); buckets.set(key2, path); }
        path.moveTo(px.x + r, px.y); path.arc(px.x, px.y, r, 0, Math.PI * 2);
        const name = sc.name[k];
        if (name && sc.mag[k] < nameLimit) {
          labels.push({ text: name, x: px.x, y: px.y, ox: r + 5, oy: -3, font: '11px system-ui, sans-serif', color: 'rgba(226,232,240,0.88)', align: 'left', prio: 30 - sc.mag[k] * 3 });
          if (sc.alt[k] > 0) targets.push({ x: px.x, y: px.y, name, detail: `${sc.alt[k].toFixed(1)}° · ${sc.az[k].toFixed(1)}°`, kind: 'star' });
        }
      }
      for (const [key2, path] of buckets) {
        const sep = key2.lastIndexOf('|');
        ctx.globalAlpha = Number(key2.slice(sep + 1)) / LEVELS; ctx.fillStyle = key2.slice(0, sep); ctx.fill(path);
      }
      ctx.globalAlpha = 1;
    }
    if (input.selection.highlightedStarId != null) {
      const s = getStarByIdMap().get(input.selection.highlightedStarId);
      if (s) {
        const hh = fromJ2000(s.ra, s.dec);
        if (P.project(toDir(hh.alt, hh.az), px)) {
          const t = (Math.sin(nowMs / 640) + 1) / 2; const gap = 8 + 2 * t, len = 7;
          ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.65 + 0.35 * (1 - t); ctx.lineWidth = 1.2; ctx.beginPath();
          ctx.moveTo(px.x - gap - len, px.y); ctx.lineTo(px.x - gap, px.y); ctx.moveTo(px.x + gap, px.y); ctx.lineTo(px.x + gap + len, px.y);
          ctx.moveTo(px.x, px.y - gap - len); ctx.lineTo(px.x, px.y - gap); ctx.moveTo(px.x, px.y + gap); ctx.lineTo(px.x, px.y + gap + len);
          ctx.stroke(); ctx.globalAlpha = 1;
          // النجم المختار يُرى دائماً (حتى نهاراً) باسمه
          ctx.save(); ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(8,12,22,0.7)'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(px.x, px.y, 2.6, 0, Math.PI * 2); ctx.stroke(); ctx.fill(); ctx.restore();
          labels.push({ text: getStarDisplayName(s) ?? '', x: px.x, y: px.y, ox: gap + len + 6, oy: -4, font: 'bold 13px system-ui, sans-serif', color: '#ffffff', align: 'left', prio: 110 });
        }
      }
    }
  }

  // الكواكب (نقاط تتدرج بالقدر، أكبر من أي نجم)
  if (opt.planets) {
    for (const { name, state } of states.planets) {
      const alt = rAdj(state.horizontal.altitudeDeg), az = state.horizontal.azimuthDeg;
      if (alt < -1) continue;
      const mag = state.magnitude ?? 2;
      let a = starAlpha(mag, alt, limitMag);
      const pdir = toDir(alt, az);
      if (!P.project(pdir, px)) continue;
      const pp = { x: px.x, y: px.y };
      // قرص حقيقي إن كان قابلاً للتمييز: نصف القطر الفيزيائي ÷ المسافة × مقياس العدسة (يتّسع مع الزوم)
      const phys = states.physical?.[name];
      let drawnDisc = false, discExtent = 0;
      if (phys && PLANET_RADII_KM[name]) {
        const scale = P.scaleAt(pdir);
        const eqPx = (PLANET_RADII_KM[name].eq / (phys.distAu * AU_KM)) * scale;
        a = Math.max(a, smoothstep(2.5, 9, eqPx * (name === 'Saturn' ? SATURN_RING_OUTER : 1)));
        if (a >= 0.04) {
          const res = paintPlanetResolved(ctx, name, phys, pp.x, pp.y, { proj: projEqj, pxPerRad: scale, sunDirScreen: screenDirToward(pdir, sunDir), alpha: a, moonLabel: input.names.jovian });
          drawnDisc = res.drawn; discExtent = res.extentPx;
        }
      }
      if (a < 0.04) continue;
      // الكوكب عند الرصد بالعين المجردة نقطة ضوئية (قطره الزاوي أقل من ~1 بكسل): يُرسم بقلب صغير + هالة تتبع القدر
      // (لا بحجم قرص)، فيبقى أصغر بكثير من قرصي الشمس والقمر (0.53°) مهما كان الإطار.
      const bright = Math.max(0, 1.5 - mag);                       // 0 لكوكب خافت … ~6 للزهرة
      const r = Math.max(0.7, Math.min(2.0, 0.8 + 0.2 * bright));  // نصف قطر القلب بالبكسل
      if (!drawnDisc) {
        const pc = PLANET_COLORS[name as keyof typeof PLANET_COLORS] ?? '#e2e8f0';
        const gr = Math.min(10, 2.4 + 1.1 * bright);               // نصف قطر الهالة
        ctx.save(); ctx.globalAlpha = a;
        const gl = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, gr);
        gl.addColorStop(0, 'rgba(255,255,255,0.30)'); gl.addColorStop(0.25, 'rgba(255,255,255,0.09)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(pp.x, pp.y, gr, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = pc; ctx.beginPath(); ctx.arc(pp.x, pp.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      const label = input.names.planet(name);
      const off = (drawnDisc ? discExtent : r) + 6;
      labels.push({ text: label, x: pp.x, y: pp.y, ox: off, oy: -3, font: '12px system-ui, sans-serif', color: PLANET_COLORS[name as keyof typeof PLANET_COLORS] ?? '#e2e8f0', align: 'left', prio: 90 });
      if (alt > 0) targets.push({ x: pp.x, y: pp.y, name: label, detail: `${alt.toFixed(1)}° · ${az.toFixed(1)}°`, kind: 'planet' });
    }
  }

  // الشمس
  const sunVisible = sunAlt > -1 && P.project(sunDir, px);
  const sunPx = { x: px.x, y: px.y };
  const sunRadiusDeg = solar ? solar.sun.radiusDeg : (states.sun.angularSizeDeg ?? 0.533) / 2;
  const sunR = Math.max(2, pxAt(sunRadiusDeg, sunDir));
  // اتجاها السمت وازدياد السمت على الشاشة عند الشمس (لتفلطح القرص بالانكسار ولاتجاه الإكليل)
  let zenAng = -Math.PI / 2, eastAng = 0;
  if (sunVisible) {
    const q = { x: 0, y: 0 };
    if (P.project(toDir(Math.min(89.9, sunAlt + 0.3), sunAz), q)) zenAng = Math.atan2(q.y - sunPx.y, q.x - sunPx.x);
    if (P.project(toDir(sunAlt, sunAz + 0.3 / Math.max(0.05, Math.cos(sunAlt * DEG))), q)) eastAng = Math.atan2(q.y - sunPx.y, q.x - sunPx.x);
  }

  const moonVisible = moonAlt > -1 && P.project(moonDir, px);
  const mp = { x: px.x, y: px.y, visible: true };
  let moonR = Math.max(2, pxAt((states.moon.angularSizeDeg ?? 0.52) / 2, moonDir));
  const wEcl = solar ? smoothstep(3.0, 0.9, solar.separationDeg) : 0;
  if (moonVisible && solar && wEcl > 0) {
    // موضع القمر الدقيق قرب الشمس (إزاحة مقيسة من solarViewAt) بمزج متدرّج مع الموضع العادي
    const q = { x: 0, y: 0 };
    if (P.project(toDir(sunAlt + solar.dyDeg, sunAz + solar.dxDeg / Math.max(0.05, Math.cos(sunAlt * DEG))), q)) {
      mp.x += (q.x - mp.x) * wEcl; mp.y += (q.y - mp.y) * wEcl;
    }
    moonR += (Math.max(2, pxAt(solar.moon.radiusDeg, sunDir)) - moonR) * wEcl;
  }
  // اتجاه الإضاءة على الشاشة: نقطة تبعد 1.5° عن القمر نحو الشمس
  let sunP = { x: mp.x + 100, y: mp.y, visible: true };
  let moonAxes: { e: { x: number; y: number }; n: { x: number; y: number } } | null = null;
  let tex: { rotRad: number; mirror: boolean } | undefined;
  if (moonVisible) {
    const toSun = sunDir.map((v, i) => v - moonDir[i] * (sunDir[0] * moonDir[0] + sunDir[1] * moonDir[1] + sunDir[2] * moonDir[2])) as V3;
    const tl = Math.hypot(toSun[0], toSun[1], toSun[2]) || 1;
    const off: V3 = [moonDir[0] * Math.cos(1.5 * DEG) + (toSun[0] / tl) * Math.sin(1.5 * DEG), moonDir[1] * Math.cos(1.5 * DEG) + (toSun[1] / tl) * Math.sin(1.5 * DEG), moonDir[2] * Math.cos(1.5 * DEG) + (toSun[2] / tl) * Math.sin(1.5 * DEG)];
    const o = { x: 0, y: 0 };
    if (P.project(off, o)) { const dx = o.x - px.x, dy = o.y - px.y, l = Math.hypot(dx, dy) || 1; sunP = { x: mp.x + (dx / l) * 100, y: mp.y + (dy / l) * 100, visible: true }; }
    // محورا القمر على الشاشة (شرق/شمال سماويان) من المصدر المشترك لدوران الصورة
    const mra = states.moon.equatorial.rightAscensionHours, mdec = states.moon.equatorial.declinationDeg;
    const proj = (ra: number, dec: number) => { const q = ofDate(ra, dec); const e = { x: 0, y: 0 }; return P.project(toDir(q.alt, q.az), e) ? e : null; };
    const p0 = proj(mra, mdec), pe = proj(mra + (0.05 / Math.max(0.05, Math.cos(mdec * DEG))) / 15, mdec), pn = proj(mra, mdec + (mdec > 85 ? -0.05 : 0.05));
    if (p0 && pe && pn) {
      const unit = (dx: number, dy: number) => { const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
      const n0 = unit(pn.x - p0.x, pn.y - p0.y);
      moonAxes = { e: unit(pe.x - p0.x, pe.y - p0.y), n: mdec > 85 ? { x: -n0.x, y: -n0.y } : n0 };
      if (moonR >= 2 && getMoonImage()) tex = moonTexFromAxes(moonAxes, moonPoleAngleDeg(input.date));
    }
  }
  const realOverlap = (solar ? solar.separationDeg : sepEq) < 0.62;
  const eclipseSepL = 180 - sepEq;
  const flattenSun = solar ? solar.flatten : refractionFlatten(sunAlt, sunRadiusDeg);

  const paintSunNow = () => {
    ctx.save(); ctx.globalAlpha = 0.1 + 0.9 * Math.sqrt(Math.max(0, 1 - obsc));
    paintEyeSun(ctx, sunPx.x, sunPx.y, sunR, sunAlt, flattenSun, zenAng, skyColorAt(sunAlt, sunAz), horizonAtmosphere(sunAlt).haze);
    ctx.restore();
  };
  const paintMoonNow = () => {
    if (realOverlap) { ctx.save(); ctx.fillStyle = '#0a0a10'; ctx.beginPath(); ctx.arc(mp.x, mp.y, moonR, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    const atM = horizonAtmosphere(moonAlt);
    const brightness = Math.pow(Math.min(1, getExposure() / MOON_EXPOSURE), 1 / 2.2) * atM.perceptual;
    const done = tex ? paintEyeMoon(ctx, mp.x, mp.y, moonR, { sunDirAngle: Math.atan2(sunP.y - mp.y, sunP.x - mp.x), tex, phaseFraction: moonPhase, brightness, tint: atM.rel, haze: atM.haze }) : false;
    if (!done) helpers.drawMoon(ctx, states.moon, mp, sunP, moonR, tex, 1, realOverlap);
    // خسوف: منطقة معتمة بحسب الموضع الحقيقي لمركز الظل (الدالة والمظهر المشتركان في المشروع)
    if (moonAxes && eclipseSepL < 2.4) {
      const sh = lunarShadowOnSky(input.date);
      if (sh.penumbralMagnitude > 0) {
        const cx = mp.x + moonR * (sh.eastMoonRadii * moonAxes.e.x + sh.northMoonRadii * moonAxes.n.x);
        const cy = mp.y + moonR * (sh.eastMoonRadii * moonAxes.e.y + sh.northMoonRadii * moonAxes.n.y);
        paintDarkRegion(ctx, mp.x, mp.y, moonR, cx, cy, sh.umbra * moonR, sh.penumbra * moonR, resolveLook(input.date));
      }
    }
  };
  if (sunVisible && moonVisible && (realOverlap || (solar && wEcl > 0.5))) {
    paintSunNow(); paintMoonNow();
    if (solar && totalK > 0.01) {
      const pa = solar.poleAngleDeg * DEG, ux = Math.cos(zenAng), uy = Math.sin(zenAng), sx = Math.cos(eastAng), sy = Math.sin(eastAng);
      paintDomeCorona(ctx, sunPx.x, sunPx.y, sunR, totalK, Math.atan2(-Math.sin(pa) * uy + Math.cos(pa) * sy, -Math.sin(pa) * ux + Math.cos(pa) * sx));
    }
    // حلقة الألماس عند بداية/نهاية الكلية
    if (solar && solar.phase !== 'annular' && solar.obscuration > 0.985 && solar.diameterRatio > 1 && solar.phase !== 'total') {
      const dx = sunPx.x - mp.x, dy = sunPx.y - mp.y, d = Math.hypot(dx, dy) || 1;
      const bx = sunPx.x + (dx / d) * sunR, by = sunPx.y + (dy / d) * sunR;
      const cl = smoothstep(0.985, 0.9995, Math.min(solar.magnitude, 0.9995));
      const gl = ctx.createRadialGradient(bx, by, 0, bx, by, sunR * 1.1);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      gl.addColorStop(0, `rgba(255,255,255,${cl})`); gl.addColorStop(0.15, `rgba(255,252,240,${0.8 * cl})`);
      gl.addColorStop(0.5, `rgba(255,240,205,${0.22 * cl})`); gl.addColorStop(1, 'rgba(255,230,170,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(bx, by, sunR * 1.1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  } else {
    if (moonVisible) paintMoonNow();
    if (sunVisible) paintSunNow();
  }
  if (sunVisible) {
    labels.push({ text: input.names.sun, x: sunPx.x, y: sunPx.y, ox: 0, oy: -sunR - 8, font: '12px system-ui, sans-serif', color: '#fde68a', align: 'center', prio: 100 });
    if (sunAlt > 0) targets.push({ x: sunPx.x, y: sunPx.y, name: input.names.sun, detail: `${sunAlt.toFixed(1)}° · ${sunAz.toFixed(1)}°`, kind: 'sun' });
  }
  if (moonVisible) {
    labels.push({ text: input.names.moon, x: mp.x, y: mp.y, ox: 0, oy: moonR + 15, font: '12px system-ui, sans-serif', color: '#e2e8f0', align: 'center', prio: 100 });
    if (moonAlt > 0) targets.push({ x: mp.x, y: mp.y, name: input.names.moon, detail: `${moonAlt.toFixed(1)}° · ${moonAz.toFixed(1)}°`, kind: 'moon' });
  }

  // الأرض تحجب ما تحت الأفق
  if (opt.ground) paintGroundLayer(ctx, P);

  // الأفق والاتجاهات
  const pxPerDeg = scaleCenter * DEG;
  if (opt.altAzGrid) { // خط الأفق وتدريجاته مع شبكة السمت والارتفاع فقط (المنظر الطبيعي بلا خطوط)
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); strokeSky(ctx, P, Array.from({ length: 721 }, (_, i) => ({ alt: 0, az: i * 0.5 }))); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let az = 0; az < 360; az += 5) {
    const big = az % 15 === 0;
    if (!big && pxPerDeg < 3) continue;
    if (!P.project(toDir(0, az), px)) continue;
    const q = { x: 0, y: 0 };
    if (!P.project(toDir(big ? -1.6 : -0.8, az), q)) continue;
    ctx.moveTo(px.x, px.y); ctx.lineTo(q.x, q.y);
    if (az % 30 === 0 && az % 90 !== 0 && pxPerDeg > 1.2) labels.push({ text: `${az}°`, x: q.x, y: q.y, ox: 0, oy: 13, font: '10px system-ui, sans-serif', color: 'rgba(255,255,255,0.65)', align: 'center', prio: 25 });
  }
  ctx.stroke();
  }
  for (let k = 0; k < 8; k++) {
    if (!P.project(toDir(-3.2, k * 45), px)) continue;
    labels.push({ text: input.names.cardinals[k], x: px.x, y: px.y, ox: 0, oy: 6, font: `${k % 2 === 0 ? 'bold 19' : '13'}px system-ui, sans-serif`, color: k === 0 ? '#ff7b7b' : '#f1f5f9', align: 'center', prio: 95 - k });
  }

  // الساعة الشمسية
  const H = hourAngleDeg(lst, states.sun.equatorial.rightAscensionHours);
  const solarHour = apparentSolarHour(H);
  let source: SundialReadout['source'] = 'none';
  let lit: { alt: number; az: number; k: number } | null = null;
  if (sunAlt > 0.5) { source = 'sun'; lit = { alt: sunAlt, az: sunAz, k: 1 }; }
  else if (sunAlt < -4 && moonAlt > 4 && moonPhase > 0.15) { source = 'moon'; lit = { alt: moonAlt, az: moonAz, k: Math.min(1, moonPhase * 1.2) }; }
  const vec = lit ? gnomonShadow(lit.alt, lit.az) : null;
  const sundial: SundialReadout = {
    source: vec ? source : 'none', altDeg: lit?.alt ?? sunAlt, azDeg: lit?.az ?? sunAz,
    lengthRatio: vec ? vec.length : null, lengthM: vec ? vec.length * GNOMON_HEIGHT_M : null, shadowAzDeg: vec ? vec.shadowAzDeg : null,
    solarHour, sunDecDeg: states.sun.equatorial.declinationDeg,
  };
  if (opt.ground && opt.sundial) drawSundial(ctx, P, input, { vec, k: lit?.k ?? 0, source }, states.sun.equatorial.declinationDeg, targets, labels);

  flushLabels(ctx, labels, w, h);
  // فلتر شمسي: لا يُرى إلا قرص الشمس (وقرص القمر أمامه عند الكسوف)
  if (opt.solarFilter && sunVisible) {
    ctx.save();
    ctx.fillStyle = '#000'; ctx.globalAlpha = 0.995; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    const sra = states.sun.equatorial.rightAscensionHours, sdec = states.sun.equatorial.declinationDeg;
    const proj = (ra: number, dec: number) => { const q = ofDate(ra, dec); const e = { x: 0, y: 0 }; return P.project(toDir(q.alt, q.az), e) ? e : null; };
    const s0 = proj(sra, sdec), sn = proj(sra, sdec + (sdec > 85 ? -0.05 : 0.05)), se = proj(sra + 0.05 / Math.max(0.05, Math.cos(sdec * DEG)) / 15, sdec);
    if (s0 && sn && se) {
      const unit = (dx: number, dy: number) => { const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
      const n = unit(sn.x - s0.x, sn.y - s0.y), e = unit(se.x - s0.x, se.y - s0.y), sg = sdec > 85 ? -1 : 1;
      const jd = input.date.getTime() / 86400000 + 2440587.5;
      paintFilteredSun(ctx, sunPx.x, sunPx.y, sunR, { nx: n.x * sg, ny: n.y * sg, ex: e.x, ey: e.y }, solarPhysical(jd, sra, sdec), jd);
    }
    if (moonVisible && realOverlap) { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(mp.x, mp.y, moonR, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  ctx.restore();
  return { targets, sundial, scalePxPerDeg: pxPerDeg };
}

let eyeStarField: StarField | null = null;
let eyeStarCount = -1;
interface StarCache {
  key: string; n: number;
  dir: Float32Array; alpha: Float32Array; level: Uint8Array; baseR: Float32Array; mag: Float32Array; alt: Float32Array; az: Float32Array;
  color: string[]; name: (string | null)[];
}
let starCache: StarCache | null = null;

function buildStarCache(stars: ReturnType<typeof getLoadedStars>, frame: ReturnType<typeof makeSkyFrame>, limitMag: number, key: string): StarCache {
  if (!eyeStarField || eyeStarCount !== stars.length) { eyeStarField = new StarField(stars); eyeStarCount = stars.length; }
  eyeStarField.update(frame);
  const N = stars.length;
  const c: StarCache = {
    key, n: 0, dir: new Float32Array(N * 3), alpha: new Float32Array(N), level: new Uint8Array(N), baseR: new Float32Array(N), mag: new Float32Array(N),
    alt: new Float32Array(N), az: new Float32Array(N), color: new Array(N), name: new Array(N),
  };
  let n = 0;
  for (let i = 0; i < N; i++) {
    const st = stars[i];
    if (st.mag >= limitMag + 0.6) continue;
    const alt = eyeStarField.altDeg[i];
    const a = starAlpha(st.mag, alt, limitMag);
    if (a < 0.03) continue;
    const az = eyeStarField.azDeg[i];
    const ca = Math.cos(alt * DEG);
    c.dir[3 * n] = ca * Math.sin(az * DEG); c.dir[3 * n + 1] = ca * Math.cos(az * DEG); c.dir[3 * n + 2] = Math.sin(alt * DEG);
    c.alpha[n] = a; c.level[n] = Math.max(1, Math.ceil(a * 6));
    c.baseR[n] = getStarRadiusPx(st.mag); c.mag[n] = st.mag; c.alt[n] = alt; c.az[n] = az;
    c.color[n] = getStarColor(st.spect);
    c.name[n] = st.mag < 4.6 && a > 0.4 ? getStarDisplayName(st) : null;
    n++;
  }
  c.n = n;
  return c;
}

/** ستائر الشفق بالإسقاط الحالي: شرائح متداخلة بتدرج لوني رأسي (حافة وردية، جسم أخضر، قمة حمراء) ومزج إضافي */
function paintEyeAurora(ctx: CanvasRenderingContext2D, P: Projector, arcs: ReturnType<typeof computeAuroraArcs>, alpha: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pb1 = { x: 0, y: 0 }, pb2 = { x: 0, y: 0 }, pt1 = { x: 0, y: 0 }, pt2 = { x: 0, y: 0 };
  for (const arc of arcs) {
    const s = arc.samples;
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      if (Math.max(a.bottom.alt, b.bottom.alt, a.top.alt, b.top.alt) < -1) continue;
      const I = ((a.intensity + b.intensity) / 2) * arc.weight * alpha;
      if (I < 0.015) continue;
      const pa = s[Math.max(0, i - 1)], pb = s[Math.min(s.length - 1, i + 2)];
      if (!P.project(toDir(pa.bottom.alt, pa.bottom.az), pb1) || !P.project(toDir(pb.bottom.alt, pb.bottom.az), pb2)) continue;
      if (!P.project(toDir(pa.top.alt, pa.top.az), pt1) || !P.project(toDir(pb.top.alt, pb.top.az), pt2)) continue;
      const x0 = (pb1.x + pb2.x) / 2, y0 = (pb1.y + pb2.y) / 2, x1 = (pt1.x + pt2.x) / 2, y1 = (pt1.y + pt2.y) / 2;
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
      ctx.beginPath(); ctx.moveTo(pb1.x, pb1.y); ctx.lineTo(pb2.x, pb2.y); ctx.lineTo(pt2.x, pt2.y); ctx.lineTo(pt1.x, pt1.y); ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}
