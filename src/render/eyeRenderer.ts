import { clampCamera, dirFromAltAz, makeProjector, type Camera, type Projector, type V3 } from '../core/camera';
import { ensureSkyTables, type DomeSkyInput } from './domeSky';
import { buildSkyTexture, getExposure, groundShadowK, paintGroundLayer, paintSkyBackground } from './eyeBackground';
import { paintEyeMoon, paintEyeSun, refractionFlatten } from './eyeBodies';
import { paintFilteredSun, solarPhysical } from './eyeSun';
import { getLoadedStars, getStarByIdMap, getStarColor, getStarDisplayName, getStarRadiusPx } from '../core/starCatalog';
import { limitingMagnitude, makeSkyFrame, placeRaDecJ2000, StarField, starAlpha } from '../core/skyModel';
import { getGroupLines } from '../core/starGroups';
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
  if (dialPoint(P, 0, 0, eyeH, q, 0) && dialPoint(P, 0, 0, eyeH, q2, h)) {
    ctx.strokeStyle = 'rgba(20, 14, 8, 0.9)'; ctx.lineWidth = 5.5;
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(236, 218, 170, 1)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 244, 205, 1)';
    ctx.beginPath(); ctx.arc(q2.x, q2.y, 3.4, 0, Math.PI * 2); ctx.fill();
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
  const sunAlt = states.sun.horizontal.altitudeDeg, sunAz = states.sun.horizontal.azimuthDeg;
  const moonAlt = states.moon.horizontal.altitudeDeg, moonAz = states.moon.horizontal.azimuthDeg;
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
  if (opt.ecliptic) {
    ctx.strokeStyle = 'rgba(176, 141, 87, 0.65)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    strokeSky(ctx, P, Array.from({ length: 181 }, (_, i) => { const { raHours, decDeg } = eclipticLongitudeToEquatorial(i * 2, states.obliquityDeg); return ofDate(raHours, decDeg); }));
    ctx.stroke();
  }
  if (input.selection.groupIds.length) {
    const byId = getStarByIdMap();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (const gid of input.selection.groupIds) for (const { hipFrom, hipTo } of getGroupLines(gid)) {
      const a = byId.get(hipFrom), b = byId.get(hipTo);
      if (a && b) strokeSky(ctx, P, [fromJ2000(a.ra, a.dec), fromJ2000(b.ra, b.dec)]);
    }
    ctx.stroke();
  }
  if (input.selection.zodiacs.length) {
    ctx.strokeStyle = '#b08d57'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (const key of input.selection.zodiacs) {
      const data = getLoadedZodiac()[key];
      if (!data) continue;
      for (const seg of data.segments) {
        let run: { alt: number; az: number }[] = [];
        const flush = () => { if (run.length) strokeSky(ctx, P, run); run = []; };
        for (const q of seg) { if (!q) { flush(); continue; } run.push(fromJ2000(q[0], q[1])); }
        flush();
      }
    }
    ctx.stroke();
  }
  if (input.selection.mansionIndices.length) {
    const mansions = getAllLunarMansions();
    ctx.strokeStyle = '#b08d57'; ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (const idx of input.selection.mansionIndices) {
      const m = mansions[idx]; if (!m) continue;
      const run: { alt: number; az: number }[] = [];
      for (let lon = m.startLongitudeDeg; lon <= m.endLongitudeDeg + 1e-9; lon += 1) { const { raHours, decDeg } = eclipticLongitudeToEquatorial(lon, states.obliquityDeg); run.push(ofDate(raHours, decDeg)); }
      strokeSky(ctx, P, run);
      const mid = eclipticLongitudeToEquatorial(m.startLongitudeDeg + MANSION_SPAN_DEG / 2, states.obliquityDeg);
      const mp = ofDate(mid.raHours, mid.decDeg);
      if (P.project(toDir(mp.alt, mp.az), px)) labels.push({ text: input.names.mansion(idx, m.nameAr), x: px.x, y: px.y, ox: 0, oy: -9, font: 'bold 12px system-ui, sans-serif', color: '#d4b688', align: 'center', prio: 70 });
    }
    ctx.stroke();
  }

  // الشفق القطبي
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
        }
      }
    }
  }

  // الكواكب (نقاط تتدرج بالقدر، أكبر من أي نجم)
  if (opt.planets) {
    for (const { name, state } of states.planets) {
      const { altitudeDeg: alt, azimuthDeg: az } = state.horizontal;
      if (alt < -1) continue;
      const mag = state.magnitude ?? 2;
      const a = starAlpha(mag, alt, limitMag);
      if (a < 0.04) continue;
      if (!P.project(toDir(alt, az), px)) continue;
      const r = Math.max(2.4, Math.min(6.5, 3.4 - mag * 0.22)) * (1 + 0.2 * detail);
      ctx.save(); ctx.globalAlpha = a;
      helpers.drawPlanetDot(ctx, { x: px.x, y: px.y, visible: true }, r, PLANET_COLORS[name as keyof typeof PLANET_COLORS] ?? '#e2e8f0', 1);
      ctx.restore();
      const label = input.names.planet(name);
      labels.push({ text: label, x: px.x, y: px.y, ox: r + 6, oy: -3, font: '12px system-ui, sans-serif', color: PLANET_COLORS[name as keyof typeof PLANET_COLORS] ?? '#e2e8f0', align: 'left', prio: 90 });
      if (alt > 0) targets.push({ x: px.x, y: px.y, name: label, detail: `${alt.toFixed(1)}° · ${az.toFixed(1)}°`, kind: 'planet' });
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
    paintEyeSun(ctx, sunPx.x, sunPx.y, sunR, sunAlt, flattenSun, zenAng);
    ctx.restore();
  };
  const paintMoonNow = () => {
    if (realOverlap) { ctx.save(); ctx.fillStyle = '#0a0a10'; ctx.beginPath(); ctx.arc(mp.x, mp.y, moonR, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    const brightness = Math.pow(Math.min(1, getExposure() / MOON_EXPOSURE), 1 / 2.2);
    const done = tex ? paintEyeMoon(ctx, mp.x, mp.y, moonR, { sunDirAngle: Math.atan2(sunP.y - mp.y, sunP.x - mp.x), tex, phaseFraction: moonPhase, brightness }) : false;
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
