/**
 * حسابات القمر والشمس والكسوف/الخسوف فوق astronomy-engine (نفس مكتبة مشروعك).
 * كل الأوقات والمواضع مأخوذة من المكتبة مباشرة: دقة بالثواني القوسية، وأوقات التماس الرسمية.
 */
import * as A from 'astronomy-engine';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const AU_KM = 149_597_870.7;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

export const SYNODIC_MONTH = 29.530588853;

export const norm360 = (x: number) => ((x % 360) + 360) % 360;
export const norm180 = (x: number) => {
  const v = norm360(x);
  return v > 180 ? v - 360 : v;
};
const sin = (d: number) => Math.sin(d * RAD);
const cos = (d: number) => Math.cos(d * RAD);

/* ------------------------------------------------------------------ */
/*  الحالة اللحظية                                                      */
/* ------------------------------------------------------------------ */
export interface LunarState {
  sunLon: number;
  moonLon: number;
  moonLat: number;
  elongation: number;    // 0..360
  moonDistKm: number;
  sunDistAU: number;
  moonSemiDia: number;   // °
  sunSemiDia: number;    // °
  moonParallax: number;  // °
  sunParallax: number;   // °
}

export function lunarState(date: Date): LunarState {
  const t = A.MakeTime(date);
  const m = A.EclipticGeoMoon(t);
  const s = A.SunPosition(t);
  const sv = A.GeoVector(A.Body.Sun, t, true);
  const sunDistAU = Math.hypot(sv.x, sv.y, sv.z);
  const moonDistKm = m.dist * AU_KM;
  return {
    sunLon: s.elon,
    moonLon: m.lon,
    moonLat: m.lat,
    elongation: A.MoonPhase(t),
    moonDistKm,
    sunDistAU,
    moonSemiDia: Math.asin(1737.4 / moonDistKm) * DEG,
    sunSemiDia: Math.asin(696_000 / (sunDistAU * AU_KM)) * DEG,
    moonParallax: Math.asin(6378.14 / moonDistKm) * DEG,
    sunParallax: Math.asin(6378.14 / (sunDistAU * AU_KM)) * DEG,
  };
}

/* ------------------------------------------------------------------ */
/*  الأطوار                                                             */
/* ------------------------------------------------------------------ */
/** 0 محاق · 1 هلال متزايد · 2 تربيع أول · 3 أحدب متزايد · 4 بدر · 5 أحدب متناقص · 6 تربيع أخير · 7 هلال متناقص */
export function phaseIndex(elongation: number): number {
  return Math.floor(((norm360(elongation) + 22.5) % 360) / 45);
}

/** أول لحظة بعد `from` تبلغ فيها الاستطالة targetDeg (0 محاق، 90 تربيع أول، 180 بدر، 270 تربيع أخير). */
export function findPhase(from: Date, targetDeg: number): Date {
  const r = A.SearchMoonPhase(targetDeg, from, 40);
  return r ? r.date : new Date(from.getTime() + (norm360(targetDeg - A.MoonPhase(A.MakeTime(from))) / 12.19) * DAY_MS);
}

/** عمر القمر الحقيقي: الأيام منذ آخر محاق. */
export function moonAgeDays(date: Date): number {
  let last = A.SearchMoonPhase(0, new Date(date.getTime() - 32 * DAY_MS), 33);
  for (let i = 0; i < 3 && last; i++) {
    const nxt = A.SearchMoonPhase(0, new Date(last.date.getTime() + DAY_MS), 33);
    if (!nxt || nxt.date.getTime() > date.getTime()) break;
    last = nxt;
  }
  return last ? (date.getTime() - last.date.getTime()) / DAY_MS : 0;
}

/* ------------------------------------------------------------------ */
/*  أدوات إحداثية                                                       */
/* ------------------------------------------------------------------ */
interface Eq { ra: number; dec: number; distAU: number }   // ra بالدرجات
const eqOf = (body: A.Body, t: A.AstroTime, obs: A.Observer): Eq => {
  const e = A.Equator(body, t, obs, true, true);
  return { ra: e.ra * 15, dec: e.dec, distAU: e.dist };
};

/** الزاوية المتوازية: دوران القرص الظاهر بالنسبة للأفق (0 عند الزوال، 180 لراصد جنوبي ينظر شمالاً). */
function parallacticAngle(haDeg: number, decDeg: number, latDeg: number): number {
  return Math.atan2(sin(haDeg), Math.tan(latDeg * RAD) * cos(decDeg) - sin(decDeg) * cos(haDeg)) * DEG;
}
/** اتجاه نقطة (ra2,dec2) من نقطة (ra1,dec1): من الشمال نحو الشرق (°). */
function positionAngle(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const dA = ra2 - ra1;
  return norm360(Math.atan2(cos(dec2) * sin(dA), sin(dec2) * cos(dec1) - cos(dec2) * sin(dec1) * cos(dA)) * DEG);
}
function angSep(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const c = sin(dec1) * sin(dec2) + cos(dec1) * cos(dec2) * cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
}
const hourAngle = (t: A.AstroTime, lonDeg: number, raDeg: number) => A.SiderealTime(t) * 15 + lonDeg - raDeg;

/** زاوية قطب القمر الشمالي من الشمال السماوي نحو الشرق (°) — تتضمن التمايل الحقيقي. */
function lunarPolePA(t: A.AstroTime, moonRa: number, moonDec: number): number {
  const axis = A.RotationAxis(A.Body.Moon, t);
  const pole = A.RotateVector(A.Rotation_EQJ_EQD(t), axis.north);
  const eq = A.EquatorFromVector(pole);
  return positionAngle(moonRa, moonDec, eq.ra * 15, eq.dec);
}

/* ------------------------------------------------------------------ */
/*  مظهر القمر كما يراه الراصد                                          */
/* ------------------------------------------------------------------ */
export interface MoonAppearance {
  sepDeg: number;       // البعد الزاوي بين القمر والشمس (0 محاق … 180 بدر)
  pa: number;           // اتجاه الشمس من القمر: من الشمال نحو الشرق (°)
  q: number;            // دوران القرص ليكون سمت الرأس للأعلى (°، مع عقارب الساعة)
  poleAngle: number;    // اتجاه قطب القمر الشمالي من الشمال السماوي نحو الشرق (°)
  illumination: number; // 0..1
}

export function moonAppearance(date: Date, latDeg: number, lonDeg: number): MoonAppearance {
  const t = A.MakeTime(date);
  const obs = new A.Observer(latDeg, lonDeg, 0);
  const moon = eqOf(A.Body.Moon, t, obs);
  const sun = eqOf(A.Body.Sun, t, obs);
  return {
    sepDeg: angSep(moon.ra, moon.dec, sun.ra, sun.dec),
    pa: positionAngle(moon.ra, moon.dec, sun.ra, sun.dec),
    q: parallacticAngle(hourAngle(t, lonDeg, moon.ra), moon.dec, latDeg),
    poleAngle: lunarPolePA(t, moon.ra, moon.dec),
    illumination: A.Illumination(A.Body.Moon, t).phase_fraction,
  };
}

/** مظهر مبسّط من الاستطالة وحدها (للأيقونات وشرائط الأطوار). */
export function simpleAppearance(elongation: number, southern = false): MoonAppearance {
  const e = norm360(elongation);
  const sepDeg = e <= 180 ? e : 360 - e;
  return { sepDeg, pa: e <= 180 ? 270 : 90, q: southern ? 180 : 0, poleAngle: 0, illumination: (1 - cos(sepDeg)) / 2 };
}

/* ------------------------------------------------------------------ */
/*  كسوف الشمس: منظر مرصدي                                              */
/* ------------------------------------------------------------------ */
function overlapArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a + b - c;
}

export interface SolarView {
  x: number; y: number;     // مركز الجزء المظلم بالنسبة لمركز الشمس (°): x يمين = الغرب، y للأسفل = الجنوب
  sep: number;
  sunR: number; darkR: number;
  magnitude: number;        // جزء قطر الشمس المظلم (قد يتجاوز 1)
  obscuration: number;      // 0..1 جزء مساحة القرص المظلم
  sunAlt: number;           // ارتفاع الشمس (°)
  q: number;                // دوران المنظر ليكون سمت الرأس للأعلى (°)
}

export function solarViewAt(date: Date, latDeg: number, lonDeg: number): SolarView {
  const t = A.MakeTime(date);
  const obs = new A.Observer(latDeg, lonDeg, 0);
  const sun = eqOf(A.Body.Sun, t, obs);
  const moon = eqOf(A.Body.Moon, t, obs);
  const dx = norm180(moon.ra - sun.ra) * cos(sun.dec);
  const dy = moon.dec - sun.dec;
  const sep = Math.hypot(dx, dy);
  const sunR = Math.asin(696_000 / (sun.distAU * AU_KM)) * DEG;
  const darkR = Math.asin(1737.4 / (moon.distAU * AU_KM)) * DEG;
  const hor = A.Horizon(t, obs, sun.ra / 15, sun.dec, 'normal');
  return {
    x: -dx,
    y: -dy,
    sep,
    sunR,
    darkR,
    magnitude: Math.max(0, (sunR + darkR - sep) / (2 * sunR)),
    obscuration: overlapArea(sunR, darkR, sep) / (Math.PI * sunR * sunR),
    sunAlt: hor.altitude,
    q: parallacticAngle(hourAngle(t, lonDeg, sun.ra), sun.dec, latDeg),
  };
}

/* ------------------------------------------------------------------ */
/*  خسوف القمر: هندسة الظاهرة كما تُرصد على قرص القمر                    */
/* ------------------------------------------------------------------ */
export interface LunarView {
  /** مركز منطقة الإظلام بالنسبة لمركز القمر (بوحدة نصف قطر القمر): x يمين = الغرب، y أعلى = الشمال */
  cx: number; cy: number;
  sep: number;
  moonR: number;
  coreR: number;      // نصف قطر منطقة الإظلام العميق (°)
  haloR: number;      // نصف قطر منطقة الخفوت الخفيف (°)
  magnitude: number;
  dimMagnitude: number;
}

export function lunarViewAt(date: Date): LunarView {
  const t = A.MakeTime(date);
  const mv = A.GeoMoon(t);
  const sv = A.GeoVector(A.Body.Sun, t, true);
  const mEq = A.EquatorFromVector(mv);
  const sEq = A.EquatorFromVector(sv);
  const mRa = mEq.ra * 15, mDec = mEq.dec;
  const aRa = norm360(sEq.ra * 15 + 180), aDec = -sEq.dec; // النقطة المقابلة للشمس
  const sep = angSep(mRa, mDec, aRa, aDec);
  const east = norm180(mRa - aRa) * cos(mDec); // إزاحة القمر شرق مركز المنطقة
  const north = mDec - aDec;

  const moonDistKm = mEq.dist * AU_KM;
  const sunDistKm = sEq.dist * AU_KM;
  const moonR = Math.asin(1737.4 / moonDistKm) * DEG;
  const sunSemi = Math.asin(696_000 / sunDistKm) * DEG;
  const moonPar = Math.asin(6378.14 / moonDistKm) * DEG;
  const sunPar = Math.asin(6378.14 / sunDistKm) * DEG;
  const coreR = 1.02 * (moonPar + sunPar - sunSemi);
  const haloR = 1.02 * (moonPar + sunPar + sunSemi);
  return {
    cx: east / moonR,
    cy: -north / moonR,
    sep,
    moonR,
    coreR,
    haloR,
    magnitude: (coreR + moonR - sep) / (2 * moonR),
    dimMagnitude: (haloR + moonR - sep) / (2 * moonR),
  };
}

/* ------------------------------------------------------------------ */
/*  الأحداث القادمة وأوقات التماس                                       */
/* ------------------------------------------------------------------ */
export type EclipseKind = 'solar' | 'lunar';
export type EclipseType = 'total' | 'annular' | 'partial' | 'faint';

export interface EclipseEvent {
  kind: EclipseKind;
  type: EclipseType;
  time: Date;            // لحظة الذروة
  magnitude: number;
  /** للخسوف فقط: أنصاف المدد (بالدقائق) حتى بدء كل مرحلة */
  sdFaint?: number;
  sdPartial?: number;
  sdTotal?: number;
}

export function findEclipses(from: Date, count = 6): EclipseEvent[] {
  const out: EclipseEvent[] = [];
  const t0 = A.MakeTime(from);
  let l = A.SearchLunarEclipse(t0);
  let s = A.SearchGlobalSolarEclipse(t0);
  for (let i = 0; i < count; i++) {
    out.push({
      kind: 'lunar',
      type: l.kind === A.EclipseKind.Penumbral ? 'faint' : l.kind === A.EclipseKind.Partial ? 'partial' : 'total',
      time: l.peak.date,
      magnitude: l.obscuration,
      sdFaint: l.sd_penum,
      sdPartial: l.sd_partial,
      sdTotal: l.sd_total,
    });
    out.push({
      kind: 'solar',
      type: s.kind === A.EclipseKind.Annular ? 'annular' : s.kind === A.EclipseKind.Partial ? 'partial' : 'total',
      time: s.peak.date,
      magnitude: 0,
    });
    l = A.NextLunarEclipse(l.peak);
    s = A.NextGlobalSolarEclipse(s.peak);
  }
  return out.sort((a, b) => a.time.getTime() - b.time.getTime()).slice(0, count);
}

export type ContactKey =
  | 'faintStart' | 'partialStart' | 'totalStart' | 'max' | 'totalEnd' | 'partialEnd' | 'faintEnd'
  | 'solStart' | 'solCentralStart' | 'solMax' | 'solCentralEnd' | 'solEnd';

export interface Contact { key: ContactKey; time: Date; altitude?: number }

/** أوقات مراحل الخسوف (واحدة لكل الراصدين) من أنصاف المدد الرسمية. */
export function lunarContacts(ev: EclipseEvent): Contact[] {
  const m = ev.time.getTime();
  const at = (key: ContactKey, min: number): Contact => ({ key, time: new Date(m + min * MIN_MS) });
  const list: Contact[] = [];
  if (ev.sdFaint) list.push(at('faintStart', -ev.sdFaint));
  if (ev.sdPartial) list.push(at('partialStart', -ev.sdPartial));
  if (ev.sdTotal) list.push(at('totalStart', -ev.sdTotal));
  list.push(at('max', 0));
  if (ev.sdTotal) list.push(at('totalEnd', ev.sdTotal));
  if (ev.sdPartial) list.push(at('partialEnd', ev.sdPartial));
  if (ev.sdFaint) list.push(at('faintEnd', ev.sdFaint));
  return list;
}

export interface SolarLocal {
  type: EclipseType;
  obscuration: number;
  peak: Date;
  peakAlt: number;
  visible: boolean;       // الشمس فوق الأفق في لحظة ما أثناء الكسوف
  contacts: Contact[];
}

/** تفاصيل الكسوف عند موقع الراصد بأوقات التماس الرسمية، أو null إن لم يُرَ من موقعه أصلاً. */
export function solarLocalInfo(ev: EclipseEvent, latDeg: number, lonDeg: number): SolarLocal | null {
  if (ev.kind !== 'solar') return null;
  const obs = new A.Observer(latDeg, lonDeg, 0);
  let info: A.LocalSolarEclipseInfo;
  try {
    info = A.SearchLocalSolarEclipse(A.MakeTime(new Date(ev.time.getTime() - 3 * DAY_MS)), obs);
  } catch {
    return null;
  }
  if (Math.abs(info.peak.time.date.getTime() - ev.time.getTime()) > 2 * DAY_MS) return null;
  const c = (key: ContactKey, e: A.EclipseEvent | undefined): Contact[] =>
    e ? [{ key, time: e.time.date, altitude: e.altitude }] : [];
  const contacts = [
    ...c('solStart', info.partial_begin),
    ...c('solCentralStart', info.total_begin),
    ...c('solMax', info.peak),
    ...c('solCentralEnd', info.total_end),
    ...c('solEnd', info.partial_end),
  ];
  const type: EclipseType = info.kind === A.EclipseKind.Annular ? 'annular' : info.kind === A.EclipseKind.Partial ? 'partial' : 'total';
  return {
    type,
    obscuration: info.obscuration,
    peak: info.peak.time.date,
    peakAlt: info.peak.altitude,
    visible: [info.partial_begin, info.peak, info.partial_end].some((e) => e && e.altitude > 0),
    contacts,
  };
}
