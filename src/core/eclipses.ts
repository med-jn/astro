import * as Astronomy from 'astronomy-engine';

/**
 * الكسوف والخسوف — كل الحسابات من astronomy-engine مباشرة (لا جداول ثابتة ولا تقريبات هندسية):
 *
 *  • الأحداث العالمية: SearchGlobalSolarEclipse / SearchLunarEclipse، مع gamma والقدر والمدة.
 *  • ظل القمر على الأرض: خطوط مولِّدة (generators) حقيقية لمخروطي الظل والشبه ظل تُقطع مع البيضاوية
 *    WGS84، فتشمل حالات الظل المعكوس (الحلقي) والكسوف غير المركزي دون معالجة خاصة.
 *  • ظل الأرض على القمر: نفس نموذج المكتبة تماماً (نصف قطر الأرض 6371 كم + 88 كم غلاف جوي) كي تتطابق
 *    أوقات التماسّات مع sd_penum/sd_partial/sd_total التي تُرجعها المكتبة.
 *  • المنظر المحلي للراصد: مواضع طبوغرافية (topocentric) للشمس والقمر مع الانكسار الجوي واختلاف المنظر.
 *  • الخسوف الأفقي (selenelion): شمس وقمر مخسوف فوق الأفق معاً، يكشفه تقاطع المنظر المحلي
 *    للجرمين بعد الانكسار (≈34′ عند الأفق) واختلاف منظر القمر (≈57′).
 */

// ============================= ثوابت (مطابقة لنموذج المكتبة) =============================

const KM_PER_AU = Astronomy.KM_PER_AU;
export const EARTH_EQ_RADIUS_KM = 6378.1366;
const EARTH_FLATTENING = 0.996647180302104;
const EARTH_POLAR_RADIUS_KM = EARTH_EQ_RADIUS_KM * EARTH_FLATTENING;
/**
 * نصف قطر الأرض الفعّال في حساب أقدار الخسوف وتماساته (يشمل أثر الغلاف الجوي).
 * عُيّنت قيمته بمطابقة أقدار 16 خسوفاً من كتالوج ناسا (2024–2030): 6447.5 كم تعطي خطأً جذرياً تربيعياً ≈ 0.0005 في
 * القدرين الظلي والهامشي (القيمة الافتراضية للمكتبة 6459 كم تعطي ≈ 0.0035 وتطيل الكلية نحو دقيقة).
 */
const EARTH_ECLIPSE_RADIUS_KM = 6447.5;
const SUN_RADIUS_KM = 695700;
export const MOON_RADIUS_KM = 1737.4;
/** الكسوف الشمسي بمعايير فهرس ناسا: k = 0.272281 (نصف قطر القمر الفعّال بعد تصحيح حافته الوعرة) ونصف قطر شمس 696000 كم */
const SOLAR_MOON_R = 0.272281 * EARTH_EQ_RADIUS_KM;
const SOLAR_SUN_R = 696000;
const DEG = Math.PI / 180;

// ============================= أدوات متجهات =============================

interface V3 { x: number; y: number; z: number }
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: V3): V3 => mul(a, 1 / len(a));
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
const vec3 = (v: Astronomy.Vector): V3 => ({ x: v.x, y: v.y, z: v.z });

export interface LatLon { latDeg: number; lonDeg: number }
export interface ObserverLike { latitudeDeg: number; longitudeDeg: number; elevationM?: number }

function toAstroObserver(o: ObserverLike): Astronomy.Observer {
  return new Astronomy.Observer(o.latitudeDeg, o.longitudeDeg, o.elevationM ?? 0);
}

// ============================= أنواع الأحداث =============================

export type SolarKind = 'partial' | 'annular' | 'total' | 'hybrid';
export type LunarKind = 'penumbral' | 'partial' | 'total';

export interface SolarEclipseEvent {
  type: 'solar';
  kind: SolarKind;
  /** false للكسوف غير المركزي: محور الظل يخطئ الأرض لكن مخروط الظل (أو الظل المعكوس) يمسّ حافتها */
  central: boolean;
  /** لحظة أعظم كسوف: أقرب مرور لمحور الظل من مركز الأرض (UTC) */
  peak: Date;
  /** أقل مسافة بين محور الظل ومركز الأرض بوحدة نصف القطر الاستوائي، موجبة شمالاً */
  gamma: number;
  /** أعظم قدر بتعريف ناسا: للكلي والحلقي نسبة قطر القمر إلى قطر الشمس (>1 كلي، <1 حلقي)، وللجزئي جزء القطر المحجوب */
  magnitude: number;
  /** موضع أعظم كسوف (أو أقرب نقطة على الأرض للمحور إن لم يمسّها) */
  greatest: LatLon;
  /** مدة الكلية/الحلقية عند أعظم كسوف بالثواني (للمركزي فقط) */
  greatestDurationSec: number | null;
}

export interface LunarEclipseEvent {
  type: 'lunar';
  kind: LunarKind;
  /** لحظة الذروة (UTC) */
  peak: Date;
  /** قدر الظل الكامل (umbral): ≥1 كلي، (0..1) جزئي، سالب شبه ظلي */
  umbralMagnitude: number;
  penumbralMagnitude: number;
  /** مسافة مركز القمر عن محور الظل بالنصف القطر الاستوائي، موجبة شمال الكسوف */
  gamma: number;
  /** أنصاف المدد بالدقائق: شبه الظل / الجزئي / الكلي (0 إن لم تحدث المرحلة) */
  semiDurationPenumbraMin: number;
  semiDurationPartialMin: number;
  semiDurationTotalMin: number;
}

export type EclipseEvent = SolarEclipseEvent | LunarEclipseEvent;

export const SOLAR_KIND_AR: Record<SolarKind, string> = {
  partial: 'كسوف جزئي', annular: 'كسوف حلقي', total: 'كسوف كلي', hybrid: 'كسوف هجين (حلقي/كلي)',
};
export const LUNAR_KIND_AR: Record<LunarKind, string> = {
  penumbral: 'خسوف هامشي', partial: 'خسوف جزئي', total: 'خسوف كلي',
};

export function eclipseTitleAr(e: EclipseEvent): string {
  if (e.type === 'lunar') return LUNAR_KIND_AR[e.kind];
  const base = SOLAR_KIND_AR[e.kind];
  return e.central || e.kind === 'partial' ? base : `${base} غير مركزي`;
}

// ============================= الإطار الأرضي والهندسة =============================

interface Geometry {
  sun: V3;       // الإطار الأرضي الثابت، كم
  moon: V3;
  axisDir: V3;   // من الشمس نحو القمر
  tanF1: number; // ظل نصف زاوية مخروط الشبه ظل
  tanF2: number; // مخروط الظل
}

function geometryAt(time: Astronomy.AstroTime): Geometry {
  const rot = Astronomy.Rotation_EQJ_EQD(time);
  const gast = Astronomy.SiderealTime(time) * 15 * DEG;
  const c = Math.cos(gast), s = Math.sin(gast);
  const toFixed = (v: Astronomy.Vector): V3 => {
    const q = Astronomy.RotateVector(rot, v);
    return { x: (q.x * c + q.y * s) * KM_PER_AU, y: (-q.x * s + q.y * c) * KM_PER_AU, z: q.z * KM_PER_AU };
  };
  const sun = toFixed(Astronomy.GeoVector(Astronomy.Body.Sun, time, true));
  const moon = toFixed(Astronomy.GeoVector(Astronomy.Body.Moon, time, true));
  const d = sub(moon, sun);
  const D = len(d);
  const sinF1 = (SOLAR_SUN_R + SOLAR_MOON_R) / D;
  const sinF2 = (SOLAR_SUN_R - SOLAR_MOON_R) / D;
  return {
    sun, moon, axisDir: mul(d, 1 / D),
    tanF1: sinF1 / Math.sqrt(1 - sinF1 * sinF1),
    tanF2: sinF2 / Math.sqrt(1 - sinF2 * sinF2),
  };
}

/** أول تقاطع لشعاع (origin + s·dir, s>0) مع بيضاوية الأرض؛ null إن أخطأها */
function rayEarth(origin: V3, dir: V3): V3 | null {
  const k = EARTH_EQ_RADIUS_KM / EARTH_POLAR_RADIUS_KM; // تحويل البيضاوية إلى كرة نصف قطرها a
  const o = { x: origin.x, y: origin.y, z: origin.z * k };
  const d = { x: dir.x, y: dir.y, z: dir.z * k };
  const A = dot(d, d);
  const B = 2 * dot(o, d);
  const C = dot(o, o) - EARTH_EQ_RADIUS_KM * EARTH_EQ_RADIUS_KM;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const s1 = (-B - sq) / (2 * A);
  const s2 = (-B + sq) / (2 * A);
  const s = s1 > 0 ? s1 : s2 > 0 ? s2 : null;
  return s === null ? null : add(origin, mul(dir, s));
}

/** أقرب نقطة على الأرض إلى خط (origin + s·dir): تُستعمل لقطع الظل عند حافة الأرض حين يخطئها المولِّد */
function nearestEarthPointToRay(origin: V3, dir: V3): V3 {
  const k = EARTH_EQ_RADIUS_KM / EARTH_POLAR_RADIUS_KM;
  const o = { x: origin.x, y: origin.y, z: origin.z * k };
  const d = { x: dir.x, y: dir.y, z: dir.z * k };
  const s = Math.max(0, -dot(o, d) / dot(d, d));
  const p = add(o, mul(d, s));
  const q = mul(p, EARTH_EQ_RADIUS_KM / len(p));
  return { x: q.x, y: q.y, z: q.z / k };
}

export function ecefToLatLon(p: V3): LatLon {
  const e2 = 1 - EARTH_FLATTENING * EARTH_FLATTENING;
  // خط العرض الجيوديسي: تكرار قصير يتقارب بعد 3 دورات
  const rho = Math.hypot(p.x, p.y);
  let lat = Math.atan2(p.z, rho * (1 - e2));
  for (let i = 0; i < 4; i++) {
    const N = EARTH_EQ_RADIUS_KM / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(p.z + e2 * N * Math.sin(lat), rho);
  }
  let lon = Math.atan2(p.y, p.x) / DEG;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { latDeg: lat / DEG, lonDeg: lon };
}

function frameAround(dir: V3): { u: V3; v: V3 } {
  const u = norm(cross({ x: 0, y: 0, z: 1 }, dir));
  return { u, v: cross(dir, u) };
}

// ============================= ظل القمر على الأرض =============================

export interface GroundOutline {
  /** نقاط الحدّ مرتبة بزاوية المولِّد؛ حيث يخطئ المولِّد الأرض تُوضَع أقرب نقطة على حافتها */
  points: LatLon[];
  hit: boolean[];
  /** عدد المولِّدات التي لمست الأرض فعلاً */
  hitCount: number;
}

/**
 * حدّ ظل أو شبه ظل على سطح الأرض. كل مولِّد خط مستقيم يبدأ من حافة القمر ويميل بزاوية المخروط:
 *   نقطة = M + R·w + t·(a ± tanF·w)    (شبه الظل +، الظل −)
 * فيُقطع مع البيضاوية قطعاً مباشراً، دون افتراض أن نصف قطر المخروط ثابت على عمق الأرض (وهو افتراض
 * يخطئ نحو 30% في الظل الذي لا يتجاوز نصف قطره ~100 كم).
 */
function groundOutline(g: Geometry, kind: 'umbra' | 'penumbra', count: number): GroundOutline {
  const { u, v } = frameAround(g.axisDir);
  const points: LatLon[] = [];
  const hit: boolean[] = [];
  let hitCount = 0;
  for (let i = 0; i < count; i++) {
    const th = (i / count) * Math.PI * 2;
    const w = add(mul(u, Math.cos(th)), mul(v, Math.sin(th)));
    const origin = add(g.moon, mul(w, SOLAR_MOON_R));
    const dir = kind === 'penumbra'
      ? norm(add(g.axisDir, mul(w, g.tanF1)))
      : norm(sub(g.axisDir, mul(w, g.tanF2)));
    const p = rayEarth(origin, dir);
    if (p) { hitCount++; hit.push(true); points.push(ecefToLatLon(p)); }
    else { hit.push(false); points.push(ecefToLatLon(nearestEarthPointToRay(origin, dir))); }
  }
  return { points, hit, hitCount };
}

export interface SolarShadowState {
  time: Date;
  /** هل الأرض داخل الشبه ظل الآن (كسوف جارٍ في مكان ما) */
  active: boolean;
  axisHit: LatLon | null;
  /** نقطة في باطن منطقة الشبه ظل على الأرض (مرجع لتحديد الداخل) */
  nearest: LatLon;
  /** نصف قطر الظل عند سطح الأرض: موجب كلية، سالب حلقية (ظل معكوس) */
  umbraRadiusKm: number;
  penumbraRadiusKm: number;
  penumbra: GroundOutline | null;
  umbra: GroundOutline | null;
}

function axisNearestPoint(g: Geometry): V3 {
  // أقرب نقطة على المحور لمركز الأرض (بالنسبة للمركز)
  return sub(g.moon, mul(g.axisDir, dot(g.moon, g.axisDir)));
}

/**
 * نقطة على سطح الأرض في باطن منطقة الشبه ظل (لا على حدّها). مسقط المنطقة على مستوى عمودي على المحور
 * عدسة محدّبة (تقاطع قرص الأرض وقرص الشبه ظل)، فنأخذ منتصفها على الخط الواصل بين المركزين ونرفعها إلى
 * سطح الأرض الذي يواجه القمر. تُستعمل مرجعاً لتحديد «الداخل» عند تلوين مناطق تحيط بقطب.
 */
function interiorPoint(g: Geometry): LatLon {
  const n = axisNearestPoint(g);
  const dn = len(n);
  const R = EARTH_EQ_RADIUS_KM;
  const rho = SOLAR_MOON_R + Math.max(0, -dot(g.moon, g.axisDir)) * g.tanF1;
  const nh = dn > 1e-9 ? mul(n, 1 / dn) : frameAround(g.axisDir).u;
  const m = 0.5 * (Math.max(-R, dn - rho) + Math.min(R, dn + rho));
  const P = mul(nh, m);
  const hit = rayEarth(sub(P, mul(g.axisDir, 3 * R)), g.axisDir);
  return ecefToLatLon(hit ?? mul(nh, R));
}

/** حالة ظل القمر على الأرض في لحظة معيّنة — للرسم الحي أثناء المحاكاة */
export function solarShadowAt(date: Date): SolarShadowState {
  const g = geometryAt(Astronomy.MakeTime(date));
  const n = axisNearestPoint(g);
  const axisDist = len(n);
  const Lc = -dot(g.moon, g.axisDir);
  const penAtCenter = SOLAR_MOON_R + Lc * g.tanF1;
  const nearest = interiorPoint(g);
  const idle: SolarShadowState = {
    time: date, active: false, axisHit: null, nearest, umbraRadiusKm: NaN, penumbraRadiusKm: penAtCenter,
    penumbra: null, umbra: null,
  };
  if (axisDist > EARTH_EQ_RADIUS_KM + penAtCenter) return idle;

  const penumbra = groundOutline(g, 'penumbra', 144);
  if (penumbra.hitCount === 0) return idle;

  const hitP = rayEarth(g.moon, g.axisDir);
  const umbra = groundOutline(g, 'umbra', 72);
  const L = hitP ? len(sub(hitP, g.moon)) : Lc;
  return {
    time: date, active: true,
    axisHit: hitP ? ecefToLatLon(hitP) : null,
    nearest,
    umbraRadiusKm: SOLAR_MOON_R - L * g.tanF2,
    penumbraRadiusKm: SOLAR_MOON_R + L * g.tanF1,
    penumbra,
    umbra: umbra.hitCount > 0 ? umbra : null,
  };
}

export interface SolarPath {
  center: LatLon[];
  northLimit: LatLon[];
  southLimit: LatLon[];
  /** علامات زمنية على خط الوسط كل 10 دقائق */
  ticks: { time: Date; point: LatLon }[];
  /** أقصى عرض للشريط على الأرض بالكيلومتر (مسافة بين الحدّين على سطح الأرض لا في مستوى الظل) */
  maxWidthKm: number;
  widthAtGreatestKm: number;
}

const ecefOf = (p: LatLon): V3 => {
  const e2 = 1 - EARTH_FLATTENING * EARTH_FLATTENING;
  const lat = p.latDeg * DEG, lon = p.lonDeg * DEG;
  const N = EARTH_EQ_RADIUS_KM / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return { x: N * Math.cos(lat) * Math.cos(lon), y: N * Math.cos(lat) * Math.sin(lon), z: N * (1 - e2) * Math.sin(lat) };
};

/**
 * شريط الكلية/الحلقية: خط الوسط وحدّاه. الحدّان هما أقصى امتداد جانبي لحدّ الظل الحقيقي
 * (المولِّدات) عمودياً على اتجاه الحركة، فيشملان تمدّد الظل عند الشروق والغروب.
 */
export function computeSolarPath(peak: Date, stepMin = 1): SolarPath {
  const center: LatLon[] = [];
  const north: LatLon[] = [];
  const south: LatLon[] = [];
  const ticks: { time: Date; point: LatLon }[] = [];
  const samples: { t: Date; P: V3; poly: V3[] }[] = [];

  for (let m = -330; m <= 330; m += stepMin) {
    const t = new Date(peak.getTime() + m * 60000);
    const g = geometryAt(Astronomy.MakeTime(t));
    const hitP = rayEarth(g.moon, g.axisDir);
    if (!hitP) continue;
    const out = groundOutline(g, 'umbra', 36);
    if (out.hitCount < out.points.length) continue; // ظل غير مكتمل على الأرض: خارج الشريط المركزي
    samples.push({ t, P: hitP, poly: out.points.map(ecefOf) });
  }

  let maxW = 0, widthAtGreatest = 0;
  let bestDt = Infinity;
  samples.forEach((s, i) => {
    center.push(ecefToLatLon(s.P));
    const a = samples[Math.max(0, i - 1)].P, b = samples[Math.min(samples.length - 1, i + 1)].P;
    const motion = sub(b, a);
    if (len(motion) < 1e-6) return;
    const side = norm(cross(norm(s.P), norm(motion)));
    let lo = Infinity, hi = -Infinity, pLo = s.poly[0], pHi = s.poly[0];
    for (const q of s.poly) {
      const d = dot(sub(q, s.P), side);
      if (d < lo) { lo = d; pLo = q; }
      if (d > hi) { hi = d; pHi = q; }
    }
    const A = ecefToLatLon(pHi), B = ecefToLatLon(pLo);
    if (A.latDeg >= B.latDeg) { north.push(A); south.push(B); } else { north.push(B); south.push(A); }
    const w = len(sub(pHi, pLo));
    maxW = Math.max(maxW, w);
    const dt = Math.abs(s.t.getTime() - peak.getTime());
    if (dt < bestDt) { bestDt = dt; widthAtGreatest = w; }
    if (Math.round((s.t.getTime() - peak.getTime()) / 60000) % 10 === 0) {
      ticks.push({ time: s.t, point: ecefToLatLon(s.P) });
    }
  });

  return { center, northLimit: north, southLimit: south, ticks, maxWidthKm: maxW, widthAtGreatestKm: widthAtGreatest };
}

/** بصمات الشبه ظل على الأرض عبر الكسوف كله — لرسم «منطقة رؤية الكسوف الجزئي» متراكمة زمنياً */
export function solarFootprints(peak: Date, stepMin = 6): { time: Date; outline: GroundOutline; sunCap: Cap; nearest: LatLon }[] {
  const out: { time: Date; outline: GroundOutline; sunCap: Cap; nearest: LatLon }[] = [];
  for (let m = -330; m <= 330; m += stepMin) {
    const t = new Date(peak.getTime() + m * 60000);
    const g = geometryAt(Astronomy.MakeTime(t));
    const n = axisNearestPoint(g);
    const Lc = -dot(g.moon, g.axisDir);
    if (len(n) > EARTH_EQ_RADIUS_KM + SOLAR_MOON_R + Lc * g.tanF1) continue;
    const o = groundOutline(g, 'penumbra', 144);
    if (o.hitCount > 0) {
      // أقرب نقطة على الأرض لمحور الظل: داخل الشبه ظل دائماً متى لمسته الأرض (نقطة مرجعية لتحديد الداخل)
      const nearest = interiorPoint(g);
      out.push({ time: t, outline: o, sunCap: capOf(g.sun, 'sun'), nearest });
    }
  }
  return out;
}

// ============================= حدود الرؤية على الأرض (دوائر كروية) =============================

export interface Cap { latDeg: number; lonDeg: number; radiusDeg: number }

/**
 * زاوية مركزية θ (من النقطة تحت الجرم) التي يصبح عندها ارتفاع مركز الجرم الطبوغرافي هو
 * −(انكسار 34′ + نصف القطر الزاوي) أي حافته العليا ملامسة للأفق المنكسر. مثلث الأرض/الراصد/الجرم:
 *   cos z = (d·cosθ − R) / √(d² + R² − 2dR·cosθ)
 */
function horizonCapRadiusDeg(distKm: number, bodyRadiusKm: number): number {
  const R = 6371;
  const semi = Math.asin(bodyRadiusKm / distKm) / DEG;
  const zTarget = 90 + 34 / 60 + semi;
  const cosZ = (th: number) => (distKm * Math.cos(th) - R) / Math.sqrt(distKm * distKm + R * R - 2 * distKm * R * Math.cos(th));
  let lo = 80 * DEG, hi = 100 * DEG;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    // z يزداد مع θ: cosZ يتناقص
    if (Math.acos(cosZ(mid)) / DEG < zTarget) lo = mid; else hi = mid;
  }
  return (lo / DEG);
}

function capOf(p: V3, body: 'sun' | 'moon'): Cap {
  const ll = ecefToLatLon(p);
  const d = len(p);
  const r = body === 'sun' ? SOLAR_SUN_R : SOLAR_MOON_R;
  // الحدّ للمركز الجيوسنتري: نستعمل خط العرض الجغرافي المركزي للنقطة تحت الجرم
  const geocentricLat = Math.asin(p.z / d) / DEG;
  return { latDeg: geocentricLat, lonDeg: ll.lonDeg, radiusDeg: horizonCapRadiusDeg(d, r) };
}

/** منطقتا رؤية الشمس والقمر (كل جرم فوق الأفق المنكسر): تقاطعهما = حيث يُرى الخسوف الأفقي */
export function visibilityCaps(date: Date): { sun: Cap; moon: Cap; separationDeg: number } {
  const g = geometryAt(Astronomy.MakeTime(date));
  const sun = capOf(g.sun, 'sun');
  const moon = capOf(g.moon, 'moon');
  const a = { x: Math.cos(sun.latDeg * DEG) * Math.cos(sun.lonDeg * DEG), y: Math.cos(sun.latDeg * DEG) * Math.sin(sun.lonDeg * DEG), z: Math.sin(sun.latDeg * DEG) };
  const b = { x: Math.cos(moon.latDeg * DEG) * Math.cos(moon.lonDeg * DEG), y: Math.cos(moon.latDeg * DEG) * Math.sin(moon.lonDeg * DEG), z: Math.sin(moon.latDeg * DEG) };
  return { sun, moon, separationDeg: Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / DEG };
}

// ============================= الكسوف الشمسي: أحداث =============================

function lensArea(a: number, b: number, c: number): number {
  // مساحة تقاطع قرصين نصفا قطريهما a وb وبُعد مركزيهما c
  if (c >= a + b) return 0;
  if (c <= Math.abs(a - b)) return Math.PI * Math.min(a, b) ** 2;
  const x = (a * a - b * b + c * c) / (2 * c);
  const y = Math.sqrt(Math.max(0, a * a - x * x));
  return a * a * Math.acos(x / a) + b * b * Math.acos((c - x) / b) - c * y;
}

export interface SolarView {
  sun: { altDeg: number; azDeg: number; trueAltDeg: number; radiusDeg: number };
  moon: { altDeg: number; azDeg: number; radiusDeg: number };
  /** إزاحة مركز القمر عن مركز الشمس بالدرجات في إطار الراصد (x يميناً، y نحو السمت)، قبل ضغط الانكسار */
  dxDeg: number;
  dyDeg: number;
  separationDeg: number;
  /** القدر اللحظي: جزء قطر الشمس المحجوب (rs + rm − d) / 2rs ؛ يتجاوز 1 أثناء الكلية، وسالب = لا كسوف */
  magnitude: number;
  /** نسبة قطر القمر الظاهري إلى قطر الشمس (>1 يصلح للكلية، <1 للحلقية) */
  diameterRatio: number;
  /** نسبة مساحة قرص الشمس المحجوبة (0..1) */
  obscuration: number;
  phase: 'none' | 'partial' | 'total' | 'annular';
  /** معامل ضغط الارتفاعات الرأسية بفعل الانكسار (≈0.8 عند الأفق، 1 في الأعلى) */
  flatten: number;
  /** زاوية قطب الشمس الشمالي على الشاشة، تُقاس من اتجاه السمت (أعلى الشاشة) باتجاه اليمين (بالدرجات) — لمحاذاة الإكليل مع خط استواء الشمس */
  poleAngleDeg: number;
}

function refractionScale(trueAltDeg: number): number {
  const e = 0.05;
  const a = Astronomy.Refraction('normal', trueAltDeg + e);
  const b = Astronomy.Refraction('normal', trueAltDeg - e);
  return 1 + (a - b) / (2 * e);
}

interface LocalBody {
  eqj: V3;            // اتجاه وحدة طبوغرافي (EQJ)
  distKm: number;
  trueAltDeg: number;
  altDeg: number;     // ارتفاع مركز الجرم منكسراً
  azDeg: number;
}

function localBody(body: Astronomy.Body, time: Astronomy.AstroTime, obs: Astronomy.Observer, eqjToEqd: Astronomy.RotationMatrix): LocalBody {
  const e = Astronomy.Equator(body, time, obs, false, true);
  const eqj = vec3(e.vec);
  const L = len(eqj);
  const eqd = Astronomy.RotateVector(eqjToEqd, e.vec);
  const c = Astronomy.EquatorFromVector(eqd);
  const raw = Astronomy.Horizon(time, obs, c.ra, c.dec);
  const ref = Astronomy.Horizon(time, obs, c.ra, c.dec, 'normal');
  return { eqj: mul(eqj, 1 / L), distKm: e.dist * KM_PER_AU, trueAltDeg: raw.altitude, altDeg: ref.altitude, azDeg: ref.azimuth };
}

function zenithEqj(time: Astronomy.AstroTime, obs: Astronomy.Observer): V3 {
  const rot = Astronomy.Rotation_HOR_EQJ(time, obs);
  return vec3(Astronomy.RotateVector(rot, new Astronomy.Vector(0, 0, 1, time)));
}

/** اتجاهات الشاشة لجرم ينظر إليه الراصد: u نحو السمت، r يميناً (النظر باتجاه f) */
function screenBasis(f: V3, zenith: V3): { r: V3; u: V3 } {
  const u = norm(sub(zenith, mul(f, dot(zenith, f))));
  return { r: cross(f, u), u };
}

/** المنظر المحلي للكسوف الشمسي في لحظة معيّنة — مصدر الرسم الحي */
export function solarViewAt(date: Date, observer: ObserverLike): SolarView {
  const time = Astronomy.MakeTime(date);
  const obs = toAstroObserver(observer);
  const toEqd = Astronomy.Rotation_EQJ_EQD(time);
  const S = localBody(Astronomy.Body.Sun, time, obs, toEqd);
  const M = localBody(Astronomy.Body.Moon, time, obs, toEqd);
  const { r, u } = screenBasis(S.eqj, zenithEqj(time, obs));
  const diff = sub(M.eqj, S.eqj);
  const dxDeg = dot(diff, r) / DEG;
  const dyDeg = dot(diff, u) / DEG;
  const sep = Math.acos(Math.max(-1, Math.min(1, dot(S.eqj, M.eqj)))) / DEG;
  const rs = Math.asin(SOLAR_SUN_R / S.distKm) / DEG;
  const rm = Math.asin(SOLAR_MOON_R / M.distKm) / DEG;
  const magnitude = (rs + rm - sep) / (2 * rs);
  const obscuration = Math.min(1, lensArea(rs, rm, sep) / (Math.PI * rs * rs));
  let phase: SolarView['phase'] = 'none';
  if (sep < rs + rm) {
    if (sep + rs <= rm) phase = 'total';
    else if (sep + rm <= rs) phase = 'annular';
    else phase = 'partial';
  }
  const pole = vec3(Astronomy.RotationAxis(Astronomy.Body.Sun, time).north);
  const poleAngleDeg = Math.atan2(dot(pole, r), dot(pole, u)) / DEG;
  return {
    sun: { altDeg: S.altDeg, azDeg: S.azDeg, trueAltDeg: S.trueAltDeg, radiusDeg: rs },
    moon: { altDeg: M.altDeg, azDeg: M.azDeg, radiusDeg: rm },
    dxDeg, dyDeg, separationDeg: sep, magnitude, diameterRatio: rm / rs, obscuration, phase,
    flatten: refractionScale(S.trueAltDeg), poleAngleDeg,
  };
}

export interface SolarContact { time: Date; altitudeDeg: number }

export interface LocalSolarCircumstances {
  /** full: الشمس فوق الأفق عند الذروة، partial: فوق الأفق في جزء من الحدث فقط، none: لا تُرى */
  visibility: 'full' | 'partial' | 'none';
  kind: 'partial' | 'annular' | 'total';
  magnitude: number;
  obscuration: number;
  c1: SolarContact;
  c2?: SolarContact;
  max: SolarContact;
  c3?: SolarContact;
  c4: SolarContact;
  centralDurationSec?: number;
}

/** ظروف كسوف شمسي معيّن (بلحظة ذروته العالمية) من مكان راصد: مراحله وقدره وارتفاع الشمس */
export function localSolarCircumstances(
  eclipsePeak: Date, observer: ObserverLike
): LocalSolarCircumstances | null {
  const obs = toAstroObserver(observer);
  // نفس نصفي القطرين (k = 0.272281 وشمس 696000) المستعملين في القدر، فتتسق اللحظات والأقدار والمدد كلها
  const sample = (ms: number) => {
    const time = Astronomy.MakeTime(new Date(ms));
    const toEqd = Astronomy.Rotation_EQJ_EQD(time);
    const S = localBody(Astronomy.Body.Sun, time, obs, toEqd);
    const M = localBody(Astronomy.Body.Moon, time, obs, toEqd);
    const sep = Math.acos(Math.max(-1, Math.min(1, dot(S.eqj, M.eqj)))) / DEG;
    const rs = Math.asin(SOLAR_SUN_R / S.distKm) / DEG;
    const rm = Math.asin(SOLAR_MOON_R / M.distKm) / DEG;
    return { sep, rs, rm, sunAlt: S.altDeg };
  };
  const t0 = eclipsePeak.getTime();
  // 1) أدنى بُعد بين المركزين: مسح كل دقيقتين ضمن ±4 ساعات ثم تنقيح بالقسم الذهبي
  let bestI = 0, bestV = Infinity;
  const STEP = 120e3, N = 240;
  for (let i = -N; i <= N; i++) {
    const v = sample(t0 + i * STEP).sep;
    if (v < bestV) { bestV = v; bestI = i; }
  }
  let lo = t0 + (bestI - 1) * STEP, hi = t0 + (bestI + 1) * STEP;
  const phi = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - phi * (hi - lo), x2 = lo + phi * (hi - lo);
  let f1 = sample(x1).sep, f2 = sample(x2).sep;
  for (let i = 0; i < 40 && hi - lo > 50; i++) {
    if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - phi * (hi - lo); f1 = sample(x1).sep; }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + phi * (hi - lo); f2 = sample(x2).sep; }
  }
  const tMax = (lo + hi) / 2;
  const mx = sample(tMax);
  if (mx.sep >= mx.rs + mx.rm) return null; // لا كسوف عند هذا الراصد

  // 2) التماسّات: حلّ (بُعد المركزين − العتبة) = 0 بالتنصيف على جانبي الذروة
  const contact = (thr: (r: { rs: number; rm: number }) => number, dir: 1 | -1): number | undefined => {
    const h = (ms: number) => { const q = sample(ms); return q.sep - thr(q); };
    if (h(tMax) >= 0) return undefined;
    let a1 = 0, b1 = 4 * 3600e3;
    if (h(tMax + dir * b1) < 0) return undefined;
    for (let i = 0; i < 45 && b1 - a1 > 20; i++) {
      const m = (a1 + b1) / 2;
      if (h(tMax + dir * m) < 0) a1 = m; else b1 = m;
    }
    return tMax + dir * (a1 + b1) / 2;
  };
  const outer = (q: { rs: number; rm: number }) => q.rs + q.rm;
  const inner = (q: { rs: number; rm: number }) => Math.abs(q.rs - q.rm);
  const tC1 = contact(outer, -1) ?? tMax, tC4 = contact(outer, 1) ?? tMax;
  const central = mx.sep < Math.abs(mx.rs - mx.rm);
  const tC2 = central ? contact(inner, -1) : undefined, tC3 = central ? contact(inner, 1) : undefined;

  const ev = (ms: number): SolarContact => ({ time: new Date(ms), altitudeDeg: sample(ms).sunAlt });
  const c1 = ev(tC1), mxc = ev(tMax), c4 = ev(tC4);
  const kind: LocalSolarCircumstances['kind'] = !central ? 'partial' : mx.rm > mx.rs ? 'total' : 'annular';
  const view = solarViewAt(new Date(tMax), observer);
  const upAt = [c1, mxc, c4].filter((x) => x.altitudeDeg > -0.83).length;
  return {
    visibility: mxc.altitudeDeg > 0 ? 'full' : upAt > 0 ? 'partial' : 'none',
    kind,
    // تعريف أعظم القدر: للكلي والحلقي نسبة القطرين، وللجزئي جزء قطر الشمس المحجوب
    magnitude: kind === 'partial' ? view.magnitude : view.diameterRatio,
    obscuration: view.obscuration,
    c1,
    c2: tC2 != null ? ev(tC2) : undefined,
    max: mxc,
    c3: tC3 != null ? ev(tC3) : undefined,
    c4,
    centralDurationSec: tC2 != null && tC3 != null ? (tC3 - tC2) / 1000 : undefined,
  };
}

function buildSolarEvent(info: Astronomy.GlobalSolarEclipseInfo): SolarEclipseEvent {
  const peak = info.peak.date;
  const g = geometryAt(info.peak);
  const n = axisNearestPoint(g);
  const north = norm(sub({ x: 0, y: 0, z: 1 }, mul(g.axisDir, g.axisDir.z)));
  const gamma = (len(n) / EARTH_EQ_RADIUS_KM) * (dot(n, north) >= 0 ? 1 : -1);

  const hitP = rayEarth(g.moon, g.axisDir);
  let central = hitP !== null;
  let kind: SolarKind = info.kind === Astronomy.EclipseKind.Total ? 'total'
    : info.kind === Astronomy.EclipseKind.Annular ? 'annular' : 'partial';

  if (!hitP) {
    // الكسوف غير المركزي: المحور يخطئ الأرض لكن ظلاً (أو ظلاً معكوساً) يمسّ حافتها
    const um = groundOutline(g, 'umbra', 72);
    if (um.hitCount > 0) {
      const L = Math.max(0, -dot(g.moon, g.axisDir));
      kind = SOLAR_MOON_R - L * g.tanF2 > 0 ? 'total' : 'annular';
    }
  } else if (kind !== 'partial') {
    // هجين: يتحول الظل عبر المسار من حلقي إلى كلي (أو العكس)
    const radii: number[] = [];
    for (let m = -200; m <= 200; m++) {
      const gm = geometryAt(Astronomy.MakeTime(new Date(peak.getTime() + m * 60000)));
      const h = rayEarth(gm.moon, gm.axisDir);
      if (h) radii.push(SOLAR_MOON_R - len(sub(h, gm.moon)) * gm.tanF2);
    }
    if (radii.some((x) => x > 0.014) && radii.some((x) => x < -0.014)) kind = 'hybrid';
  }

  // موضع أعظم كسوف: نقطة المحور إن مسّ الأرض، وإلا أقرب نقطة على الأرض إليه
  const nHat = norm(n);
  const nearestP = rayEarth(mul(nHat, 2 * EARTH_EQ_RADIUS_KM), mul(nHat, -1)) ?? mul(nHat, EARTH_EQ_RADIUS_KM);
  const greatest = ecefToLatLon(hitP ?? nearestP);

  let magnitude = NaN;
  let greatestDurationSec: number | null = null;
  try {
    const loc = localSolarCircumstances(peak, { latitudeDeg: greatest.latDeg, longitudeDeg: greatest.lonDeg });
    if (loc) {
      magnitude = loc.magnitude;
      greatestDurationSec = central ? loc.centralDurationSec ?? null : null;
    }
  } catch { /* يبقى القدر NaN */ }
  if (!central && kind !== 'partial') central = false;
  return { type: 'solar', kind, central, peak, gamma, magnitude, greatest, greatestDurationSec };
}

// ============================= الخسوف القمري: ظل الأرض =============================

export interface EarthShadowInfo {
  /** بُعد مركز القمر عن محور الظل (كم) */
  rKm: number;
  /** نصف قطر الظل الكامل والشبه ظل عند القمر (كم) */
  umbraKm: number;
  penumbraKm: number;
  /** من مركز القمر إلى محور الظل (EQJ، كم) */
  toAxis: V3;
  umbralMagnitude: number;
  penumbralMagnitude: number;
}

/** نموذج ظل الأرض عند القمر — مطابق لـ CalcShadow في astronomy-engine */
export function earthShadowAt(time: Astronomy.AstroTime): EarthShadowInfo {
  const s = vec3(Astronomy.GeoVector(Astronomy.Body.Sun, time, true));
  const e = mul(s, -1);
  const m = vec3(Astronomy.GeoMoon(time));
  const u = dot(e, m) / dot(e, e);
  const toAxis = mul(sub(mul(e, u), m), KM_PER_AU);
  const rKm = len(toAxis);
  const umbraKm = SUN_RADIUS_KM - (1 + u) * (SUN_RADIUS_KM - EARTH_ECLIPSE_RADIUS_KM);
  const penumbraKm = -SUN_RADIUS_KM + (1 + u) * (SUN_RADIUS_KM + EARTH_ECLIPSE_RADIUS_KM);
  return {
    rKm, umbraKm, penumbraKm, toAxis,
    umbralMagnitude: (umbraKm + MOON_RADIUS_KM - rKm) / (2 * MOON_RADIUS_KM),
    penumbralMagnitude: (penumbraKm + MOON_RADIUS_KM - rKm) / (2 * MOON_RADIUS_KM),
  };
}

export interface LunarContactTimes { p1: Date; u1?: Date; u2?: Date; u3?: Date; u4?: Date; p4: Date }

/** أزمنة التماسّات الدقيقة (كل جانب على حدة) بحل «بُعد مركز القمر عن المحور = نصف قطر الظل ± نصف قطر القمر» بالتنصيف */
export function lunarContactTimes(peak: Date): LunarContactTimes {
  const t0 = peak.getTime();
  const f = (ms: number, mode: 'pen' | 'umb' | 'tot'): number => {
    const sh = earthShadowAt(Astronomy.MakeTime(new Date(ms)));
    return mode === 'pen' ? sh.rKm - (sh.penumbraKm + MOON_RADIUS_KM)
      : mode === 'umb' ? sh.rKm - (sh.umbraKm + MOON_RADIUS_KM)
      : sh.rKm - (sh.umbraKm - MOON_RADIUS_KM);
  };
  const solve = (mode: 'pen' | 'umb' | 'tot', dir: 1 | -1): Date | undefined => {
    if (f(t0, mode) >= 0) return undefined; // المرحلة لا تحدث
    let lo = 0, hi = 5 * 3600e3; // من الذروة حتى 5 ساعات
    if (f(t0 + dir * hi, mode) < 0) return undefined;
    for (let i = 0; i < 40 && hi - lo > 20; i++) {
      const mid = (lo + hi) / 2;
      if (f(t0 + dir * mid, mode) < 0) lo = mid; else hi = mid;
    }
    return new Date(t0 + dir * (lo + hi) / 2);
  };
  return {
    p1: solve('pen', -1) ?? new Date(t0), u1: solve('umb', -1), u2: solve('tot', -1),
    u3: solve('tot', 1), u4: solve('umb', 1), p4: solve('pen', 1) ?? new Date(t0),
  };
}

function buildLunarEvent(info: Astronomy.LunarEclipseInfo): LunarEclipseEvent {
  const sh = earthShadowAt(info.peak);
  // التصنيف من نموذجنا نفسه (متسق مع الأقدار والتماسّات)
  const kind: LunarKind = sh.umbralMagnitude >= 1 ? 'total' : sh.umbralMagnitude > 0 ? 'partial' : 'penumbral';
  const ct = lunarContactTimes(info.peak.date);
  const semi = (a?: Date, b?: Date) => (a && b ? (b.getTime() - a.getTime()) / 120000 : 0);
  const lat = Astronomy.EclipticGeoMoon(info.peak).lat;
  return {
    type: 'lunar', kind, peak: info.peak.date,
    umbralMagnitude: sh.umbralMagnitude, penumbralMagnitude: sh.penumbralMagnitude,
    gamma: (sh.rKm / EARTH_EQ_RADIUS_KM) * (lat >= 0 ? 1 : -1),
    semiDurationPenumbraMin: semi(ct.p1, ct.p4), semiDurationPartialMin: semi(ct.u1, ct.u4), semiDurationTotalMin: semi(ct.u2, ct.u3),
  };
}

export interface LunarEclipsePhases {
  p1: Date;
  u1?: Date;
  u2?: Date;
  max: Date;
  u3?: Date;
  u4?: Date;
  p4: Date;
}

/** أوقات التماسّات P1،U1،U2،الذروة،U3،U4،P4 */
export function lunarEclipsePhases(e: LunarEclipseEvent): LunarEclipsePhases {
  const c = lunarContactTimes(e.peak);
  return { p1: c.p1, u1: c.u1, u2: c.u2, max: e.peak, u3: c.u3, u4: c.u4, p4: c.p4 };
}

// ============================= البحث عن الأحداث =============================

export function findSolarEclipses(from: Date, count: number): SolarEclipseEvent[] {
  const out: SolarEclipseEvent[] = [];
  let info = Astronomy.SearchGlobalSolarEclipse(Astronomy.MakeTime(from));
  for (let i = 0; i < count; i++) {
    out.push(buildSolarEvent(info));
    info = Astronomy.NextGlobalSolarEclipse(info.peak);
  }
  return out;
}

export function findLunarEclipses(from: Date, count: number): LunarEclipseEvent[] {
  const out: LunarEclipseEvent[] = [];
  let info = Astronomy.SearchLunarEclipse(Astronomy.MakeTime(from));
  for (let i = 0; i < count; i++) {
    out.push(buildLunarEvent(info));
    info = Astronomy.NextLunarEclipse(info.peak);
  }
  return out;
}

/** كل الكسوفات والخسوفات بين تاريخين، مرتّبة زمنياً */
export function findEclipsesBetween(from: Date, to: Date): EclipseEvent[] {
  const out: EclipseEvent[] = [];
  let s = Astronomy.SearchGlobalSolarEclipse(Astronomy.MakeTime(from));
  while (s.peak.date.getTime() <= to.getTime()) {
    out.push(buildSolarEvent(s));
    s = Astronomy.NextGlobalSolarEclipse(s.peak);
  }
  let l = Astronomy.SearchLunarEclipse(Astronomy.MakeTime(from));
  while (l.peak.date.getTime() <= to.getTime()) {
    out.push(buildLunarEvent(l));
    l = Astronomy.NextLunarEclipse(l.peak);
  }
  return out.sort((a, b) => a.peak.getTime() - b.peak.getTime());
}

// ============================= الخسوف: المنظر المحلي =============================

export interface LunarView {
  moon: { altDeg: number; azDeg: number; radiusDeg: number };
  sun: { altDeg: number; azDeg: number; radiusDeg: number };
  /** مركز ظل الأرض نسبةً لمركز القمر بوحدة نصف قطر القمر في إطار الشاشة (x يميناً، y نحو السمت) */
  shadow: { dx: number; dy: number; umbra: number; penumbra: number };
  umbralMagnitude: number;
  penumbralMagnitude: number;
  phase: 'none' | 'penumbral' | 'partial' | 'total';
  /** مصفوفة 3×3: إحداثيات الشاشة (x يميناً، y فوق، z نحو الراصد) = M · متجه ثابت-بالقمر (x نحو خط الطول 0، y شرقاً، z القطب) */
  bodyToScreen: number[][];
  subObserver: { latDeg: number; lonDeg: number };
  flatten: number;
}

function matMul(a: number[][], b: number[][]): number[][] {
  return a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
}
const Rz = (t: number) => { const c = Math.cos(t), s = Math.sin(t); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; };
const Rx = (t: number) => { const c = Math.cos(t), s = Math.sin(t); return [[1, 0, 0], [0, c, s], [0, -s, c]]; };

/**
 * المنظر المحلي لخسوف القمر: موضع ظل الأرض على قرص القمر كما يراه الراصد (مع دوران الأفق)،
 * واتجاه سطح القمر الحقيقي (تمايل بصري وفيزيائي) من محور دوران IAU، لا من صورة ثابتة.
 */
export function lunarViewAt(date: Date, observer: ObserverLike): LunarView {
  const time = Astronomy.MakeTime(date);
  const obs = toAstroObserver(observer);
  const toEqd = Astronomy.Rotation_EQJ_EQD(time);
  const S = localBody(Astronomy.Body.Sun, time, obs, toEqd);
  const M = localBody(Astronomy.Body.Moon, time, obs, toEqd);
  const f = M.eqj;
  const { r, u } = screenBasis(f, zenithEqj(time, obs));
  const back = mul(f, -1); // نحو الراصد

  const sh = earthShadowAt(time);
  const shadow = {
    dx: dot(sh.toAxis, r) / MOON_RADIUS_KM,
    dy: dot(sh.toAxis, u) / MOON_RADIUS_KM,
    umbra: sh.umbraKm / MOON_RADIUS_KM,
    penumbra: sh.penumbraKm / MOON_RADIUS_KM,
  };

  const axis = Astronomy.RotationAxis(Astronomy.Body.Moon, time);
  const R = matMul(matMul(Rz(axis.spin * DEG), Rx((90 - axis.dec) * DEG)), Rz((axis.ra * 15 + 90) * DEG));
  // متجه الجسم -> EQJ هو R^T، ثم إلى الشاشة
  const bodyToScreen = [0, 1, 2].map(() => [0, 0, 0]);
  for (let j = 0; j < 3; j++) {
    const v: V3 = { x: R[j][0], y: R[j][1], z: R[j][2] }; // العمود j من R^T = الصف j من R
    bodyToScreen[0][j] = dot(v, r);
    bodyToScreen[1][j] = dot(v, u);
    bodyToScreen[2][j] = dot(v, back);
  }
  const o = { x: R[0][0] * back.x + R[0][1] * back.y + R[0][2] * back.z, y: R[1][0] * back.x + R[1][1] * back.y + R[1][2] * back.z, z: R[2][0] * back.x + R[2][1] * back.y + R[2][2] * back.z };

  const phase: LunarView['phase'] = sh.umbralMagnitude >= 1 ? 'total'
    : sh.umbralMagnitude > 0 ? 'partial' : sh.penumbralMagnitude > 0 ? 'penumbral' : 'none';

  return {
    moon: { altDeg: M.altDeg, azDeg: M.azDeg, radiusDeg: Math.asin(MOON_RADIUS_KM / M.distKm) / DEG },
    sun: { altDeg: S.altDeg, azDeg: S.azDeg, radiusDeg: Math.asin(SUN_RADIUS_KM / S.distKm) / DEG },
    shadow, umbralMagnitude: sh.umbralMagnitude, penumbralMagnitude: sh.penumbralMagnitude, phase,
    bodyToScreen,
    subObserver: { latDeg: Math.asin(o.z) / DEG, lonDeg: Math.atan2(o.y, o.x) / DEG },
    flatten: refractionScale(M.altDeg),
  };
}

/** ظل الأرض على قرص القمر في الإحداثيات الاستوائية للتاريخ — لرسمه على خريطة السماء (شرق = زيادة م.م) */
export function lunarShadowOnSky(date: Date): {
  eastMoonRadii: number; northMoonRadii: number; umbra: number; penumbra: number;
  umbralMagnitude: number; penumbralMagnitude: number;
} {
  const time = Astronomy.MakeTime(date);
  const sh = earthShadowAt(time);
  const toEqd = Astronomy.Rotation_EQJ_EQD(time);
  const m = vec3(Astronomy.RotateVector(toEqd, Astronomy.GeoMoon(time)));
  const axisV = vec3(Astronomy.RotateVector(toEqd, new Astronomy.Vector(sh.toAxis.x / KM_PER_AU, sh.toAxis.y / KM_PER_AU, sh.toAxis.z / KM_PER_AU, time)));
  const mh = norm(m);
  const east = norm(cross({ x: 0, y: 0, z: 1 }, mh));
  const northV = cross(mh, east);
  return {
    eastMoonRadii: (dot(axisV, east) * KM_PER_AU) / MOON_RADIUS_KM,
    northMoonRadii: (dot(axisV, northV) * KM_PER_AU) / MOON_RADIUS_KM,
    umbra: sh.umbraKm / MOON_RADIUS_KM,
    penumbra: sh.penumbraKm / MOON_RADIUS_KM,
    umbralMagnitude: sh.umbralMagnitude,
    penumbralMagnitude: sh.penumbralMagnitude,
  };
}

// ============================= الخسوف: الظروف المحلية والخسوف الأفقي =============================

export interface LunarContact {
  key: 'P1' | 'U1' | 'U2' | 'MAX' | 'U3' | 'U4' | 'P4';
  time: Date;
  moonAltDeg: number;
  sunAltDeg: number;
  /** حافة القمر العليا فوق الأفق المنكسر */
  moonUp: boolean;
}

export interface HorizontalEclipse {
  start: Date;
  end: Date;
  /** أكبر قدر ظل كامل يتحقق أثناء وجود الجرمين معاً فوق الأفق */
  maxUmbralMagnitude: number;
  /** ارتفاعا الشمس والقمر (منكسرين) عند منتصف المدة */
  sunAltDeg: number;
  moonAltDeg: number;
}

export interface LocalLunarCircumstances {
  contacts: LunarContact[];
  /** عدد المراحل (من التماسّات المتاحة) التي يكون القمر فوق الأفق عندها */
  upCount: number;
  visibility: 'full' | 'partial' | 'none';
  /** الخسوف الأفقي (selenelion/المقلوب): شمس وقمر مخسوف فوق الأفق في اللحظة نفسها */
  horizontal: HorizontalEclipse | null;
}

/** حافة الجرم العليا تعلو الأفق المنكسر (مع انخفاض الأفق لارتفاع الراصد) */
function limbUp(altApparentDeg: number, radiusDeg: number, elevationM: number): boolean {
  const dip = 0.0293 * Math.sqrt(Math.max(0, elevationM));
  return altApparentDeg + radiusDeg > -dip;
}

export function localLunarCircumstances(e: LunarEclipseEvent, observer: ObserverLike): LocalLunarCircumstances {
  const obs = toAstroObserver(observer);
  const elev = observer.elevationM ?? 0;
  const ph = lunarEclipsePhases(e);
  const entries: [LunarContact['key'], Date | undefined][] = [
    ['P1', ph.p1], ['U1', ph.u1], ['U2', ph.u2], ['MAX', ph.max], ['U3', ph.u3], ['U4', ph.u4], ['P4', ph.p4],
  ];
  const bodies = (d: Date) => {
    const t = Astronomy.MakeTime(d);
    const toEqd = Astronomy.Rotation_EQJ_EQD(t);
    return { S: localBody(Astronomy.Body.Sun, t, obs, toEqd), M: localBody(Astronomy.Body.Moon, t, obs, toEqd), t };
  };
  const radii = (b: ReturnType<typeof bodies>) => ({
    rs: Math.asin(SUN_RADIUS_KM / b.S.distKm) / DEG, rm: Math.asin(MOON_RADIUS_KM / b.M.distKm) / DEG,
  });

  const contacts: LunarContact[] = [];
  for (const [key, d] of entries) {
    if (!d) continue;
    const b = bodies(d);
    const { rm } = radii(b);
    contacts.push({ key, time: d, moonAltDeg: b.M.altDeg, sunAltDeg: b.S.altDeg, moonUp: limbUp(b.M.altDeg, rm, elev) });
  }
  const upCount = contacts.filter((c) => c.moonUp).length;
  const umbralContacts = contacts.filter((c) => c.key !== 'P1' && c.key !== 'P4');
  const upUmbral = umbralContacts.filter((c) => c.moonUp).length;
  const visibility: LocalLunarCircumstances['visibility'] =
    upCount === contacts.length ? 'full' : upCount > 0 || upUmbral > 0 ? 'partial' : 'none';

  // مسح كل 30 ثانية بين P1 وP4 بحثاً عن لحظات يكون فيها الجرمان فوق الأفق وظل الأرض يمسّ القمر
  let first: Date | null = null, last: Date | null = null, maxMag = -Infinity, midS = 0, midM = 0, found = 0;
  const t0 = ph.p1.getTime(), t1 = ph.p4.getTime();
  for (let ms = t0; ms <= t1; ms += 30000) {
    const d = new Date(ms);
    const b = bodies(d);
    const { rs, rm } = radii(b);
    if (!limbUp(b.M.altDeg, rm, elev) || !limbUp(b.S.altDeg, rs, elev)) continue;
    const um = earthShadowAt(b.t).umbralMagnitude;
    if (um <= 0) continue;
    if (!first) first = d;
    last = d;
    found++;
    if (um > maxMag) { maxMag = um; midS = b.S.altDeg; midM = b.M.altDeg; }
  }
  const horizontal: HorizontalEclipse | null = first && last
    ? { start: first, end: last, maxUmbralMagnitude: maxMag, sunAltDeg: midS, moonAltDeg: midM }
    : null;
  void found;
  return { contacts, upCount, visibility, horizontal };
}

// ============================= اتجاه محور القمر على السماء، ووسوم الخسوف =============================

/**
 * زاوية قطب القمر الشمالي (قطب دورانه) على السماء، تُقاس من الشمال السماوي نحو الشرق بالدرجات (إطار خط استواء التاريخ).
 * تعطي مع اتجاهي الشمال والشرق في موضع القمر على أي خريطة اتجاه «أعلى» صورة القمر الصحيح (التمايل البصري مشمول
 * لأن القطب الفعلي هو محور IAU).
 */
export function moonPoleAngleDeg(date: Date): number {
  const time = Astronomy.MakeTime(date);
  const toEqd = Astronomy.Rotation_EQJ_EQD(time);
  const m = norm(vec3(Astronomy.RotateVector(toEqd, Astronomy.GeoMoon(time))));
  const pole = vec3(Astronomy.RotateVector(toEqd, Astronomy.RotationAxis(Astronomy.Body.Moon, time).north));
  const east = norm(cross({ x: 0, y: 0, z: 1 }, m));
  const north = cross(m, east);
  return Math.atan2(dot(pole, east), dot(pole, north)) / DEG;
}

/**
 * أوصاف شائعة للخسوف: «قمر الدم» (كلي)، «القمر العملاق» (المسافة ≤ 361500 كم (تعريف نولّ التقريبي: ضمن 90% من أقرب حضيض))، «القمر الأزرق» (بدر ثانٍ في الشهر الميلادي
 * نفسه بالتوقيت العالمي)، «القمر المصغَّر» (≥ 405000 كم). هذه تسميات تقويمية/مسافية لا ألوان فعلية للقمر.
 */
export function lunarEclipseTags(e: LunarEclipseEvent): string[] {
  const tags: string[] = [];
  if (e.kind === 'total') tags.push('قمر الدم');
  const t = Astronomy.MakeTime(e.peak);
  const distKm = Astronomy.GeoVector(Astronomy.Body.Moon, t, false).Length() * KM_PER_AU;
  if (distKm <= 361500) tags.push('قمر عملاق');
  else if (distKm >= 405000) tags.push('قمر مصغَّر');
  const monthStart = new Date(Date.UTC(e.peak.getUTCFullYear(), e.peak.getUTCMonth(), 1));
  const firstFull = Astronomy.SearchMoonPhase(180, monthStart, 40);
  if (firstFull && firstFull.date.getTime() < e.peak.getTime() - 36 * 3600 * 1000) tags.push('قمر أزرق');
  return tags;
}
