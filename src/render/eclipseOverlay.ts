/**
 * طبقة الكسوف والخسوف على خريطة الأرض وخريطة السماء.
 *
 *  - الكسوف الشمسي: الشبه ظل والظل الحقيقيان على سطح الأرض في اللحظة الحالية (مقطع المخروط مع بيضاوية
 *    WGS84 لا دوائر مقرَّبة)، ومع تحديد كسوف في اللوحة: بصمات الشبه ظل المتراكمة (منطقة الكسوف الجزئي)،
 *    وشريط الكلية/الحلقية بحدّيه وخط وسطه وعلامات كل 10 دقائق.
 *  - الخسوف القمري: منطقة وجود القمر فوق الأفق المنكسر، ومنطقة وجود الشمس، وتقاطعهما (حيث يقع الخسوف الأفقي)،
 *    وظل الأرض وشبه ظلها على قرص القمر في خريطة السماء.
 *
 * تُرسم الأسطح في فضاء الشاشة بإسقاط الخريطة نفسه (latLonToScreen) فتبقى متسقة مع الدوران والإزاحة والتكبير.
 */
import type { PolarMapConfig } from '../core/projection';
import { latLonToScreen, raDecToScreen } from '../core/projection';
import {
  solarShadowAt, computeSolarPath, solarFootprints, visibilityCaps, lunarShadowOnSky,
  type LatLon, type Cap, type GroundOutline, type SolarPath, type SolarShadowState,
} from '../core/eclipses';
import { fillTextUpright } from './uprightText';

const DEG = Math.PI / 180;

export interface EclipseFocus {
  type: 'solar' | 'lunar';
  /** لحظة الذروة العالمية (ms) — تعرّف الحدث وتحدد ذاكرة التخزين المؤقت */
  peakMs: number;
}

// ============================= أدوات مساعدة =============================

type Pt = { x: number; y: number };

/** شريحة على الدائرة العظمى بين نقطتين بخطوة ≤ stepDeg، كي لا يقطع الإسقاط القطبي الخط المستقيم عبر القرص قرب القطبين */
function densify(pts: LatLon[], close: boolean, stepDeg = 1): LatLon[] {
  const vec = (p: LatLon) => {
    const la = p.latDeg * DEG, lo = p.lonDeg * DEG;
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  };
  const out: LatLon[] = [];
  const n = pts.length;
  if (n < 2) return pts.slice();
  const last = close ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const va = vec(a), vb = vec(b);
    const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
    const ang = Math.acos(dot) / DEG;
    out.push(a);
    const k = Math.floor(ang / stepDeg);
    if (k >= 1 && ang < 179) {
      const sA = Math.sin(Math.acos(dot));
      for (let j = 1; j <= k; j++) {
        const t = j / (k + 1);
        const w1 = Math.sin((1 - t) * Math.acos(dot)) / sA, w2 = Math.sin(t * Math.acos(dot)) / sA;
        const x = w1 * va[0] + w2 * vb[0], y = w1 * va[1] + w2 * vb[1], z = w1 * va[2] + w2 * vb[2];
        out.push({ latDeg: Math.asin(Math.max(-1, Math.min(1, z))) / DEG, lonDeg: Math.atan2(y, x) / DEG });
      }
    }
  }
  if (!close) out.push(pts[n - 1]);
  return out;
}

function projectAll(pts: LatLon[], config: PolarMapConfig, close = false): Pt[] {
  return densify(pts, close).map((p) => {
    const s = latLonToScreen(p.latDeg, p.lonDeg, config);
    return { x: s.x, y: s.y };
  });
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * مسار منطقة على الكرة محدّدة بحدّها وبنقطة داخلها. في الإسقاط القطبي، منطقة تحيط بقطب الجنوب تظهر حلقة
 * مغلقة حول المركز مع أن داخلها هو الخارج: نكتشف ذلك باختبار نقطة داخلية، ونضيف قرص الخريطة بقاعدة even-odd.
 */
function regionPath(config: PolarMapConfig, boundary: LatLon[], inner: LatLon | null): Path2D {
  const pts = projectAll(boundary, config, true);
  const path = new Path2D();
  pts.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
  path.closePath();
  if (!inner) return path; // الظل الصغير: لا يحيط بقطب فلا حاجة لاختبار الداخل
  const ref = latLonToScreen(inner.latDeg, inner.lonDeg, config);
  if (!pointInPolygon({ x: ref.x, y: ref.y }, pts)) {
    // الداخل هو المتمّم: قرص الخريطة ناقص الحلقة
    const inv = new Path2D();
    inv.arc(config.centerX, config.centerY, config.outerRadiusPx, 0, Math.PI * 2);
    inv.addPath(path);
    return inv;
  }
  return path;
}

function strokePolyline(ctx: CanvasRenderingContext2D, config: PolarMapConfig, pts: LatLon[]) {
  const s = projectAll(pts, config);
  ctx.beginPath();
  s.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

/** نقاط دائرة كروية (cap) بعدد معيّن، تُرجع إحداثيات جغرافية */
function capBoundary(c: Cap, n = 240): LatLon[] {
  const lat1 = c.latDeg * DEG, lon1 = c.lonDeg * DEG, d = c.radiusDeg * DEG;
  const out: LatLon[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(th));
    const lon2 = lon1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    out.push({ latDeg: lat2 / DEG, lonDeg: lon2 / DEG });
  }
  return out;
}

function pxPerKm(config: PolarMapConfig): number {
  return config.outerRadiusPx / (180 * 111.195);
}

function hhmmUTC(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function angSepDeg(ra1H: number, d1: number, ra2H: number, d2: number): number {
  const a1 = ra1H * 15 * DEG, a2 = ra2H * 15 * DEG;
  const c = Math.sin(d1 * DEG) * Math.sin(d2 * DEG) + Math.cos(d1 * DEG) * Math.cos(d2 * DEG) * Math.cos(a1 - a2);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

// ============================= الكسوف الشمسي على الأرض =============================

function fillOutline(
  ctx: CanvasRenderingContext2D, config: PolarMapConfig, o: GroundOutline, inner: LatLon | null, fill: string, stroke: string | null, lw: number
) {
  const path = regionPath(config, o.points, inner);
  ctx.fillStyle = fill;
  ctx.fill(path, 'evenodd');
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    strokePolyline(ctx, config, [...o.points, o.points[0]]);
  }
}

function drawSolarShadow(ctx: CanvasRenderingContext2D, config: PolarMapConfig, sh: SolarShadowState, uiScale: number) {
  const lw = Math.max(1, 1.1 * Math.min(uiScale, 3));
  ctx.save();
  ctx.lineJoin = 'round';
  if (sh.penumbra) {
    fillOutline(ctx, config, sh.penumbra, sh.nearest, 'rgba(0,0,0,0.26)', 'rgba(255,255,255,0.6)', lw);
  }
  if (sh.umbra) {
    fillOutline(ctx, config, sh.umbra, null, 'rgba(0,0,0,0.78)', 'rgba(255,255,255,0.9)', 1);
  }
  // على الخريطة العالمية يقلّ الظل عن بكسل: علامة مرئية دائماً (أبيض = كلي، ذهبي = حلقي)
  if (sh.axisHit && Number.isFinite(sh.umbraRadiusKm)) {
    const p = latLonToScreen(sh.axisHit.latDeg, sh.axisHit.lonDeg, config);
    const r = Math.max(2.5, Math.abs(sh.umbraRadiusKm) * pxPerKm(config));
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fill();
    ctx.strokeStyle = sh.umbraRadiusKm >= 0 ? '#ffffff' : '#f4c26b';
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }
  ctx.restore();
}

interface SolarCache { path: SolarPath; foot: ReturnType<typeof solarFootprints> }
const solarCache = new Map<number, SolarCache>();

function solarCacheFor(peakMs: number): SolarCache {
  let c = solarCache.get(peakMs);
  if (!c) {
    const peak = new Date(peakMs);
    c = { path: computeSolarPath(peak, 2), foot: solarFootprints(peak, 6) };
    solarCache.set(peakMs, c);
    if (solarCache.size > 6) solarCache.delete(solarCache.keys().next().value as number);
  }
  return c;
}

function drawSolarFocus(ctx: CanvasRenderingContext2D, config: PolarMapConfig, peakMs: number, uiScale: number, labels: boolean) {
  const { path, foot } = solarCacheFor(peakMs);
  ctx.save();
  ctx.lineJoin = 'round';

  // بصمات الشبه ظل المتراكمة: كل بصمة شفافية خفيفة جداً فتتجمّع كثافة مناطق الكسوف الجزئي
  for (const f of foot) {
    const path2 = regionPath(config, f.outline.points, f.nearest);
    ctx.fillStyle = 'rgba(255, 220, 140, 0.035)';
    ctx.fill(path2, 'evenodd');
  }
  // حدّ منطقة الكسوف الجزئي الكلية (أول/آخر تماس للشبه ظل)
  ctx.strokeStyle = 'rgba(255, 220, 140, 0.35)';
  ctx.lineWidth = 0.8;
  if (foot.length) {
    strokePolyline(ctx, config, [...foot[0].outline.points, foot[0].outline.points[0]]);
    const last = foot[foot.length - 1];
    strokePolyline(ctx, config, [...last.outline.points, last.outline.points[0]]);
  }

  // شريط الكلية/الحلقية
  if (path.northLimit.length > 1 && path.southLimit.length > 1) {
    const band = [...path.northLimit, ...[...path.southLimit].reverse()];
    const pts = projectAll(band, config);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(1, 0.9 * Math.min(uiScale, 3));
    strokePolyline(ctx, config, path.northLimit);
    strokePolyline(ctx, config, path.southLimit);
  }
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.lineWidth = Math.max(1, 0.9 * Math.min(uiScale, 3));
  strokePolyline(ctx, config, path.center);
  ctx.setLineDash([]);

  // علامات الزمن (UT) على خط الوسط
  for (const t of path.ticks) {
    const p = latLonToScreen(t.point.latDeg, t.point.lonDeg, config);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2 * Math.min(uiScale, 3), 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    if (labels && uiScale > 1.4) {
      ctx.font = `${9 * Math.min(uiScale, 3)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.textAlign = 'left';
      fillTextUpright(ctx, hhmmUTC(t.time), p.x, p.y, 5, -5);
    }
  }
  ctx.restore();
}

// ============================= الخسوف القمري على الأرض =============================

function drawLunarCaps(ctx: CanvasRenderingContext2D, config: PolarMapConfig, date: Date, uiScale: number) {
  const caps = visibilityCaps(date);
  const lw = Math.max(1, 1.1 * Math.min(uiScale, 3));
  const moonPath = regionPath(config, capBoundary(caps.moon), { latDeg: caps.moon.latDeg, lonDeg: caps.moon.lonDeg });
  const sunPath = regionPath(config, capBoundary(caps.sun), { latDeg: caps.sun.latDeg, lonDeg: caps.sun.lonDeg });

  ctx.save();
  ctx.lineJoin = 'round';
  // منطقة رؤية القمر
  ctx.fillStyle = 'rgba(130, 170, 255, 0.10)';
  ctx.fill(moonPath, 'evenodd');
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = 'rgba(170, 200, 255, 0.75)';
  ctx.lineWidth = lw;
  strokePolyline(ctx, config, [...capBoundary(caps.moon), capBoundary(caps.moon)[0]]);
  // حدّ منطقة وجود الشمس فوق الأفق
  ctx.strokeStyle = 'rgba(255, 215, 130, 0.6)';
  strokePolyline(ctx, config, [...capBoundary(caps.sun), capBoundary(caps.sun)[0]]);
  ctx.setLineDash([]);

  // التقاطع: القمر والشمس فوق الأفق معاً — منطقة الخسوف الأفقي (المقلوب)
  ctx.save();
  ctx.clip(moonPath, 'evenodd');
  ctx.fillStyle = 'rgba(255, 196, 80, 0.55)';
  ctx.fill(sunPath, 'evenodd');
  ctx.restore();
  ctx.restore();
}

// ============================= واجهة الرسم للمصيّر =============================

/**
 * يُستدعى من renderSky بعد تظليل الليل وقبل الشبكات. sepDeg البعد الزاوي المركزي بين الشمس والقمر:
 * قرب 0 كسوف شمسي ممكن، وقرب 180 خسوف قمري ممكن. التركيز (focus) يُظهر المسار الكامل للحدث المختار.
 */
export function drawEclipseGround(
  ctx: CanvasRenderingContext2D, config: PolarMapConfig, date: Date, sepDeg: number,
  focus: EclipseFocus | null, uiScale: number, labels: boolean
) {
  if (focus?.type === 'solar') drawSolarFocus(ctx, config, focus.peakMs, uiScale, labels);

  if (sepDeg < 2.6) {
    const sh = solarShadowAt(date);
    if (sh.active) drawSolarShadow(ctx, config, sh, uiScale);
  } else if (180 - sepDeg < 2.4) {
    drawLunarCaps(ctx, config, date, uiScale);
  }
}

// ============================= ظل الأرض على قرص القمر في خريطة السماء =============================

export function skyAxes(raH: number, decDeg: number, gmstDeg: number, config: PolarMapConfig) {
  const p0 = raDecToScreen(raH, decDeg, gmstDeg, config);
  const cosDec = Math.max(0.05, Math.cos(decDeg * DEG));
  const pe = raDecToScreen(raH + (0.05 / cosDec) / 15, decDeg, gmstDeg, config);
  const dn = decDeg > 85 ? -0.05 : 0.05;
  const pn = raDecToScreen(raH, decDeg + dn, gmstDeg, config);
  const norm = (dx: number, dy: number) => { const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
  const e = norm(pe.x - p0.x, pe.y - p0.y);
  const n = norm(pn.x - p0.x, pn.y - p0.y);
  return { e, n: dn < 0 ? { x: -n.x, y: -n.y } : n };
}

/**
 * يرسم ظل الأرض وشبه ظله فوق قرص القمر المرسوم على الخريطة (بعد drawMoon مباشرة).
 * الإزاحة وأنصاف الأقطار بوحدة نصف قطر القمر من eclipses.lunarShadowOnSky، فيتطابق الشكل مع الواقع بغض النظر
 * عن التكبير البصري لقرص القمر.
 */
export function drawEarthShadowOnMapMoon(
  ctx: CanvasRenderingContext2D, config: PolarMapConfig, gmstDeg: number, date: Date, sepDeg: number,
  moonRaH: number, moonDecDeg: number, moonP: { x: number; y: number; visible: boolean }, moonRadiusPx: number
) {
  if (!moonP.visible || 180 - sepDeg > 2.4) return;
  const s = lunarShadowOnSky(date);
  if (s.penumbralMagnitude <= 0) return;
  const ax = skyAxes(moonRaH, moonDecDeg, gmstDeg, config);
  const R = moonRadiusPx;
  const cx = moonP.x + R * (s.eastMoonRadii * ax.e.x + s.northMoonRadii * ax.n.x);
  const cy = moonP.y + R * (s.eastMoonRadii * ax.e.y + s.northMoonRadii * ax.n.y);

  paintEarthShadowDisc(ctx, moonP.x, moonP.y, R, cx, cy, s.umbra * R, s.penumbra * R);
}

/** يرسم الظل الكامل والشبه ظل (مركزهما cx,cy) مقصوصَين على قرص القمر (mx,my,R). مشترك بين الخريطة والقبة */
export function paintEarthShadowDisc(
  ctx: CanvasRenderingContext2D, mx: number, my: number, R: number, cx: number, cy: number, ur: number, pr: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(mx, my, R, 0, Math.PI * 2);
  ctx.clip();
  const pen = ctx.createRadialGradient(cx, cy, Math.max(0, ur * 0.9), cx, cy, pr);
  pen.addColorStop(0, 'rgba(20,10,6,0.55)');
  pen.addColorStop(0.55, 'rgba(20,10,6,0.22)');
  pen.addColorStop(1, 'rgba(20,10,6,0)');
  ctx.fillStyle = pen;
  ctx.beginPath(); ctx.arc(cx, cy, pr, 0, Math.PI * 2); ctx.fill();
  const um = ctx.createRadialGradient(cx, cy, 0, cx, cy, ur);
  um.addColorStop(0, 'rgba(58,14,8,0.9)');
  um.addColorStop(0.7, 'rgba(98,26,12,0.86)');
  um.addColorStop(0.93, 'rgba(150,56,24,0.8)');
  um.addColorStop(1, 'rgba(176,84,40,0.62)');
  ctx.fillStyle = um;
  ctx.beginPath(); ctx.arc(cx, cy, ur, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export { angSepDeg };

/**
 * اتجاه صورة القمر على الخريطة: يحوّل زاوية قطب القمر (من الشمال السماوي نحو الشرق) إلى دوران على الشاشة عند موضع
 * القمر، بمشتق الإسقاط نفسه (فيصح مع أي دوران للمشهد وأي موضع). mirror = true إن كان إطار الخريطة معكوس اليد (ينظر
 * من خارج الكرة السماوية)، فتُقلب الصورة أفقياً كي يبقى الشرق القمري في موضعه الصحيح.
 */
export function moonTextureOrientation(
  config: PolarMapConfig, gmstDeg: number, raH: number, decDeg: number, poleAngleDeg: number
): { rotRad: number; mirror: boolean } {
  return moonTexFromAxes(skyAxes(raH, decDeg, gmstDeg, config), poleAngleDeg);
}

/** نفس الحساب انطلاقاً من متجهي الشمال والشرق السماويين على الشاشة (وحدة) — تستعمله القبة أيضاً */
export function moonTexFromAxes(
  ax: { e: { x: number; y: number }; n: { x: number; y: number } }, poleAngleDeg: number
): { rotRad: number; mirror: boolean } {
  const th = poleAngleDeg * DEG;
  const ux = Math.cos(th) * ax.n.x + Math.sin(th) * ax.e.x;
  const uy = Math.cos(th) * ax.n.y + Math.sin(th) * ax.e.y;
  const det = ax.e.x * ax.n.y - ax.e.y * ax.n.x;
  return { rotRad: Math.atan2(ux, -uy), mirror: det < 0 };
}
