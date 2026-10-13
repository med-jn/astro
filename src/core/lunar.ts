/**
 * حسابات القمر والشمس والكسوف/الخسوف — سلاسل مختصرة منخفضة الدقة
 * المرجع: Jean Meeus, "Astronomical Algorithms" (الفصول 25 و40 و47 و49 و54).
 *
 * الدقة التقريبية: موضع القمر ~0.1°، أي توقيت الأطوار والذروة خلال بضع دقائق إلى ~15 دقيقة.
 * مناسبة للعرض والمحاكاة، وليست بديلاً عن جداول ناسا للكسوف (Espenak) في الاستخدام العلمي الدقيق.
 * الملف مستقل تماماً: لا يعتمد على أي ملف آخر في المشروع.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DAY_MS = 86_400_000;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export const SYNODIC_MONTH = 29.530588853;
const MEAN_ELONG_RATE = 12.190749; // °/يوم (متوسط تباعد القمر عن الشمس)

export const norm360 = (x: number) => ((x % 360) + 360) % 360;
export const norm180 = (x: number) => {
  const v = norm360(x);
  return v > 180 ? v - 360 : v;
};
const sin = (d: number) => Math.sin(d * RAD);
const cos = (d: number) => Math.cos(d * RAD);

/* ------------------------------------------------------------------ */
/*  الحالة اللحظية للشمس والقمر                                          */
/* ------------------------------------------------------------------ */

export interface LunarState {
  sunLon: number;        // الطول الإكليبتيكي للشمس (°)
  moonLon: number;       // الطول الإكليبتيكي للقمر (°)
  moonLat: number;       // العرض الإكليبتيكي للقمر (°)
  elongation: number;    // 0..360 — استطالة القمر شرق الشمس
  moonDistKm: number;
  sunDistAU: number;
  moonSemiDia: number;   // نصف القطر الزاوي (°)
  sunSemiDia: number;
  moonParallax: number;  // اختلاف المنظر الأفقي الاستوائي (°)
  sunParallax: number;
  obliquity: number;
}

export function lunarState(date: Date): LunarState {
  const T = (date.getTime() - J2000_MS) / DAY_MS / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = 297.8501921 + 445267.1114034 * T;
  const M = 357.5291092 + 35999.0502909 * T;
  const Mp = 134.9633964 + 477198.8675055 * T;
  const F = 93.272095 + 483202.0175233 * T;
  const E = 1 - 0.002516 * T;

  const moonLon = norm360(
    Lp +
      6.288774 * sin(Mp) +
      1.274027 * sin(2 * D - Mp) +
      0.658314 * sin(2 * D) +
      0.213618 * sin(2 * Mp) -
      0.185116 * E * sin(M) -
      0.114332 * sin(2 * F) +
      0.058793 * sin(2 * D - 2 * Mp) +
      0.057066 * E * sin(2 * D - M - Mp) +
      0.053322 * sin(2 * D + Mp) +
      0.045758 * E * sin(2 * D - M),
  );

  const moonLat =
    5.128122 * sin(F) +
    0.280602 * sin(Mp + F) +
    0.277693 * sin(Mp - F) +
    0.173237 * sin(2 * D - F) +
    0.055413 * sin(2 * D - Mp + F) +
    0.046271 * sin(2 * D - Mp - F) +
    0.032573 * sin(2 * D + F) +
    0.017198 * sin(2 * Mp + F);

  const moonDistKm =
    385000.56 -
    20905.355 * cos(Mp) -
    3699.111 * cos(2 * D - Mp) -
    2955.968 * cos(2 * D) -
    569.925 * cos(2 * Mp) +
    48.888 * E * cos(M) -
    3.149 * cos(2 * F) +
    246.158 * cos(2 * D - 2 * Mp) -
    152.138 * E * cos(2 * D - M - Mp) -
    170.733 * cos(2 * D + Mp) -
    204.586 * E * cos(2 * D - M);

  const L0 = 280.46646 + 36000.76983 * T;
  const C =
    (1.914602 - 0.004817 * T) * sin(M) + 0.019993 * sin(2 * M) + 0.000289 * sin(3 * M);
  const sunLon = norm360(L0 + C);
  const e = 0.016708634 - 0.000042037 * T;
  const nu = M + C;
  const sunDistAU = (1.000001018 * (1 - e * e)) / (1 + e * cos(nu));

  return {
    sunLon,
    moonLon,
    moonLat,
    elongation: norm360(moonLon - sunLon),
    moonDistKm,
    sunDistAU,
    moonSemiDia: Math.asin(1737.4 / moonDistKm) * DEG,
    sunSemiDia: 0.266564 / sunDistAU,
    moonParallax: Math.asin(6378.14 / moonDistKm) * DEG,
    sunParallax: 0.0024428 / sunDistAU,
    obliquity: 23.439291 - 0.0130042 * T,
  };
}

/* ------------------------------------------------------------------ */
/*  الأطوار                                                             */
/* ------------------------------------------------------------------ */

/** 0 محاق · 1 هلال متزايد · 2 تربيع أول · 3 أحدب متزايد · 4 بدر · 5 أحدب متناقص · 6 تربيع أخير · 7 هلال متناقص */
export function phaseIndex(elongation: number): number {
  return Math.floor(((norm360(elongation) + 22.5) % 360) / 45);
}

export const illuminationFromElongation = (elong: number) => (1 - cos(elong)) / 2;
export const moonAgeDays = (elong: number) => (norm360(elong) / 360) * SYNODIC_MONTH;

/** أول لحظة بعد `from` تبلغ فيها الاستطالة `targetDeg` (0 محاق، 90 تربيع أول، 180 بدر، 270 تربيع أخير). */
export function findPhase(from: Date, targetDeg: number): Date {
  let t =
    from.getTime() +
    (norm360(targetDeg - lunarState(from).elongation) / MEAN_ELONG_RATE) * DAY_MS;
  for (let i = 0; i < 8; i++) {
    const err = norm180(targetDeg - lunarState(new Date(t)).elongation);
    t += (err / MEAN_ELONG_RATE) * DAY_MS;
    if (Math.abs(err) < 1e-4) break;
  }
  return new Date(t);
}

/**
 * مسار SVG للجزء المظلم من قرص القمر (نصف قطره R، المركز عند 0,0).
 * للأطوار المتناقصة (mirror=true) يُطبَّق scale(-1,1) على المسار.
 */
export function terminatorPath(elongation: number, R: number): { d: string; mirror: boolean } {
  const e = norm360(elongation);
  const waxing = e <= 180;
  const phi = waxing ? e : 360 - e;
  const rx = R * Math.cos(phi * RAD);
  const sweep = rx >= 0 ? 0 : 1;
  const d = `M 0 ${-R} A ${R} ${R} 0 0 0 0 ${R} A ${Math.abs(rx).toFixed(3)} ${R} 0 0 ${sweep} 0 ${-R} Z`;
  return { d, mirror: !waxing };
}

/* ------------------------------------------------------------------ */
/*  منظر مرصدي (Topocentric)                                            */
/* ------------------------------------------------------------------ */

function eclToEq(lon: number, lat: number, eps: number) {
  const ra = norm360(
    Math.atan2(sin(lon) * cos(eps) - Math.tan(lat * RAD) * sin(eps), cos(lon)) * DEG,
  );
  const dec = Math.asin(sin(lat) * cos(eps) + cos(lat) * sin(eps) * sin(lon)) * DEG;
  return { ra, dec };
}

function gmstDeg(date: Date): number {
  const jd = date.getTime() / DAY_MS + 2440587.5;
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0));
}

function toTopocentric(
  eq: { ra: number; dec: number },
  parallaxDeg: number,
  gmst: number,
  latDeg: number,
  lonDeg: number,
) {
  const u = Math.atan(0.99664719 * Math.tan(latDeg * RAD));
  const rhoSin = 0.99664719 * Math.sin(u);
  const rhoCos = Math.cos(u);
  const H = gmst + lonDeg - eq.ra;
  const sp = sin(parallaxDeg);
  const dRa = Math.atan2(-rhoCos * sp * sin(H), cos(eq.dec) - rhoCos * sp * cos(H));
  const dec = Math.atan2((sin(eq.dec) - rhoSin * sp) * Math.cos(dRa), cos(eq.dec) - rhoCos * sp * cos(H)) * DEG;
  const ra = eq.ra + dRa * DEG;
  const Hp = H - dRa * DEG;
  const alt = Math.asin(sin(latDeg) * sin(dec) + cos(latDeg) * cos(dec) * cos(Hp)) * DEG;
  return { ra, dec, alt };
}

function overlapArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a + b - c;
}

export interface SolarView {
  x: number; y: number;      // موضع مركز القمر بالنسبة للشمس (°) — الشمال للأعلى والشرق لليسار
  sep: number;
  sunR: number; moonR: number;
  magnitude: number;         // جزء قطر الشمس المحجوب (قد يتجاوز 1 في الكلي)
  obscuration: number;       // 0..1 جزء مساحة قرص الشمس المحجوب
  sunAlt: number;            // ارتفاع الشمس عن الأفق (°)
}

export function solarViewAt(date: Date, latDeg: number, lonDeg: number): SolarView {
  const s = lunarState(date);
  const g = gmstDeg(date);
  const sun = toTopocentric(eclToEq(s.sunLon, 0, s.obliquity), s.sunParallax, g, latDeg, lonDeg);
  const moon = toTopocentric(eclToEq(s.moonLon, s.moonLat, s.obliquity), s.moonParallax, g, latDeg, lonDeg);
  const dx = norm180(moon.ra - sun.ra) * cos(sun.dec);
  const dy = moon.dec - sun.dec;
  const sep = Math.hypot(dx, dy);
  const sunR = s.sunSemiDia;
  const moonR = s.moonSemiDia;
  return {
    x: -dx,
    y: -dy,
    sep,
    sunR,
    moonR,
    magnitude: Math.max(0, (sunR + moonR - sep) / (2 * sunR)),
    obscuration: overlapArea(sunR, moonR, sep) / (Math.PI * sunR * sunR),
    sunAlt: sun.alt,
  };
}

/** أقصى حجب عند موقع الراصد قرب لحظة `center` (±4 ساعات). */
export function solarLocalMax(center: Date, latDeg: number, lonDeg: number) {
  let best = { t: center.getTime(), v: solarViewAt(center, latDeg, lonDeg) };
  for (let m = -240; m <= 240; m += 3) {
    const t = center.getTime() + m * 60_000;
    const v = solarViewAt(new Date(t), latDeg, lonDeg);
    if (v.sep < best.v.sep) best = { t, v };
  }
  return { time: new Date(best.t), view: best.v };
}

/* ------------------------------------------------------------------ */
/*  الخسوف (منظر مركز الأرض — واحد لكل الراصدين)                        */
/* ------------------------------------------------------------------ */

export interface LunarView {
  x: number; y: number;        // موضع القمر بالنسبة لمركز ظل الأرض (°)
  sep: number;
  moonR: number;
  umbraR: number; penumbraR: number;
  umbralMag: number; penumbralMag: number;
}

export function lunarViewAt(date: Date): LunarView {
  const s = lunarState(date);
  const dl = norm180(s.moonLon - (s.sunLon + 180));
  const sep = Math.hypot(dl, s.moonLat);
  // نصفا قطر الظل والشبه ظل عند مسافة القمر، مع تكبير 1.02 لغلاف الأرض الجوي (Danjon)
  const umbraR = 1.02 * (s.moonParallax + s.sunParallax - s.sunSemiDia);
  const penumbraR = 1.02 * (s.moonParallax + s.sunParallax + s.sunSemiDia);
  return {
    x: -dl,
    y: -s.moonLat,
    sep,
    moonR: s.moonSemiDia,
    umbraR,
    penumbraR,
    umbralMag: (umbraR + s.moonSemiDia - sep) / (2 * s.moonSemiDia),
    penumbralMag: (penumbraR + s.moonSemiDia - sep) / (2 * s.moonSemiDia),
  };
}

/* ------------------------------------------------------------------ */
/*  البحث عن الكسوفات والخسوفات القادمة                                 */
/* ------------------------------------------------------------------ */

export type EclipseKind = 'solar' | 'lunar';
export type EclipseType = 'total' | 'annular' | 'partial' | 'penumbral';

export interface EclipseEvent {
  kind: EclipseKind;
  type: EclipseType;
  time: Date;          // لحظة الذروة (مركز الأرض)
  gamma?: number;      // للكسوف: أدنى بعد لمحور الظل عن مركز الأرض (بوحدة نصف قطر الأرض)
  magnitude: number;   // للخسوف: قدر الظل (أو شبه الظل) · للكسوف: غير مستخدم (0)
}

function minSeparation(
  around: Date,
  sepAt: (d: Date) => number,
): { t: number; sep: number } {
  let best = { t: around.getTime(), sep: Infinity };
  for (let m = -840; m <= 840; m += 20) {
    const t = around.getTime() + m * 60_000;
    const sep = sepAt(new Date(t));
    if (sep < best.sep) best = { t, sep };
  }
  // تحسين خطوتين: ±20 دقيقة بخطوة دقيقة
  const c = best.t;
  for (let m = -20; m <= 20; m += 1) {
    const t = c + m * 60_000;
    const sep = sepAt(new Date(t));
    if (sep < best.sep) best = { t, sep };
  }
  return best;
}

function evaluateSolar(newMoon: Date): EclipseEvent | null {
  const geo = (d: Date) => {
    const s = lunarState(d);
    return Math.hypot(norm180(s.moonLon - s.sunLon), s.moonLat);
  };
  const { t, sep } = minSeparation(newMoon, geo);
  const s = lunarState(new Date(t));
  const gamma = sep / s.moonParallax;
  if (gamma > 1.55) return null;
  const type: EclipseType =
    gamma < 0.9972 ? (s.moonSemiDia > s.sunSemiDia ? 'total' : 'annular') : 'partial';
  return { kind: 'solar', type, time: new Date(t), gamma, magnitude: 0 };
}

function evaluateLunar(fullMoon: Date): EclipseEvent | null {
  const { t } = minSeparation(fullMoon, (d) => lunarViewAt(d).sep);
  const v = lunarViewAt(new Date(t));
  let type: EclipseType;
  let magnitude: number;
  if (v.umbralMag >= 1) { type = 'total'; magnitude = v.umbralMag; }
  else if (v.umbralMag > 0) { type = 'partial'; magnitude = v.umbralMag; }
  else if (v.penumbralMag > 0) { type = 'penumbral'; magnitude = v.penumbralMag; }
  else return null;
  return { kind: 'lunar', type, time: new Date(t), magnitude };
}

/** الأحداث القادمة بعد `from` مرتبة زمنياً. */
export function findEclipses(from: Date, count = 6): EclipseEvent[] {
  const out: EclipseEvent[] = [];
  let cursor = from;
  for (let guard = 0; guard < 80 && out.length < count; guard++) {
    const nm = findPhase(cursor, 0);
    const fm = findPhase(cursor, 180);
    const sol = evaluateSolar(nm);
    const lun = evaluateLunar(fm);
    if (sol && sol.time.getTime() > from.getTime()) out.push(sol);
    if (lun && lun.time.getTime() > from.getTime()) out.push(lun);
    cursor = new Date(Math.max(nm.getTime(), fm.getTime()) + DAY_MS);
  }
  return out.sort((a, b) => a.time.getTime() - b.time.getTime()).slice(0, count);
}
