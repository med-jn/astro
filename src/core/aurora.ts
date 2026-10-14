/**
 * الشفق القطبي الشمالي: بيضة الشفق (نموذج فيلدشتاين–ستاركوف) ثم هندسة ما يراه الراصد منها.
 *
 * المصدر: Sigernes et al., «Real time aurora oval forecasting – SvalTrackII», Opt. Pura Apl. 44(4), 2011 (المعادلات 1–7، الجدول 1)،
 * وأصلها Starkov (1994). تعطي حدّي البيضة (القطبي والاستوائي) بإحداثيات خط عرض مغناطيسي مصحَّح كدالة في Kp والزمن المحلي المغناطيسي.
 *
 *   AL = 18 − 12.3·Kp + 27.2·Kp² − 2·Kp³
 *   Aᵢ أو αᵢ = b₀ + b₁·L + b₂·L² + b₃·L³ ,  L = log₁₀|AL|
 *   θ(t) = A₀ + A₁cos[15(t+α₁)] + A₂cos[15(2t+α₂)] + A₃cos[15(3t+α₃)]    (θ: خط عرض مغناطيسي تتمّمي بالدرجات، t: ساعة محلية مغناطيسية، 0 = منتصف الليل)
 *
 * ملاحظة: خانة A₂ للحد القطبي مطبوعة في الورقة «‎−4-44» وتُقرأ −4.44 (خطأ طباعي).
 *
 * الهندسة (بلا انكسار): الانبعاث على ارتفاع ~100–300 كم فوق نقطة القدم على البيضة؛ يُحسب اتجاهه من الراصد (سمت/ارتفاع)
 * في الإحداثيات الكارتيزية لمركز الأرض، فتظهر انحناءة الأرض (أفق الشفق) تلقائياً: لا يُرى شفق فوق الأفق إلا إن كان ضمن ~1200 كم.
 * الأشعة عمودية (ميل المجال المغناطيسي عند هذه العروض ≈ 80°).
 */
const DEG = Math.PI / 180;
const R_E = 6371;

type Row = [number, number, number, number];
interface Boundary { A0: Row; A1: Row; A2: Row; A3: Row; a1: Row; a2: Row; a3: Row }

const POLEWARD: Boundary = {
  A0: [-0.07, 24.54, -12.53, 2.15], A1: [-10.06, 19.83, -9.33, 1.24], A2: [-4.44, 7.47, -3.01, 0.25], A3: [-3.77, 7.9, -4.73, 0.91],
  a1: [-6.61, 10.17, -5.8, 1.19], a2: [6.37, -1.1, 0.34, -0.38], a3: [-4.48, 10.16, -5.87, 0.98],
};
const EQUATORWARD: Boundary = {
  A0: [1.61, 23.21, -10.97, 2.03], A1: [-9.59, 17.78, -7.2, 0.96], A2: [-12.07, 17.49, -7.96, 1.15], A3: [-6.56, 11.44, -6.73, 1.31],
  a1: [-2.22, 1.5, -0.58, 0.08], a2: [-23.98, 42.79, -26.96, 5.56], a3: [-20.07, 36.67, -24.2, 5.11],
};

const poly = (r: Row, L: number) => r[0] + r[1] * L + r[2] * L * L + r[3] * L * L * L;

function boundaryColat(b: Boundary, L: number, t: number): number {
  const A0 = poly(b.A0, L), A1 = poly(b.A1, L), A2 = poly(b.A2, L), A3 = poly(b.A3, L);
  const p1 = poly(b.a1, L), p2 = poly(b.a2, L), p3 = poly(b.a3, L);
  return A0 + A1 * Math.cos(15 * (t + p1) * DEG) + A2 * Math.cos(15 * (2 * t + p2) * DEG) + A3 * Math.cos(15 * (3 * t + p3) * DEG);
}

/** حدّا البيضة (خط عرض مغناطيسي تتمّمي، درجات) عند زمن محلي مغناطيسي t وقيمة Kp */
export function ovalColatitudes(kp: number, mlt: number): { poleward: number; equatorward: number } {
  const k = Math.max(0, Math.min(9, kp));
  const AL = 18 - 12.3 * k + 27.2 * k * k - 2 * k * k * k;
  const L = Math.log10(Math.max(1, Math.abs(AL)));
  const p = boundaryColat(POLEWARD, L, mlt);
  const e = boundaryColat(EQUATORWARD, L, mlt);
  return { poleward: Math.max(2, Math.min(p, e)), equatorward: Math.max(3, Math.max(p, e)) };
}

// ───────────────────────── الإطار المغناطيسي ─────────────────────────
/** القطب المغناطيسي الشمالي الثابت (الورقة: 82.42°N، 82.86°W) */
const POLE_LAT = 82.42;
const POLE_LON = -82.86;

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const fromLatLon = (lat: number, lon: number): V3 => [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)];

const Z_M = fromLatLon(POLE_LAT, POLE_LON);
const X_M = norm([0 - dot([0, 0, 1], Z_M) * Z_M[0], 0 - dot([0, 0, 1], Z_M) * Z_M[1], 1 - dot([0, 0, 1], Z_M) * Z_M[2]]);
const Y_M = cross(Z_M, X_M);

const magLon = (v: V3) => Math.atan2(dot(v, Y_M), dot(v, X_M)) / DEG;

/** خط الطول المغناطيسي لنقطة تحت الشمس (القبة تُوجَّه بحيث الظهيرة المغناطيسية نحو الشمس) */
function subsolarMagneticLon(sunRaHours: number, sunDecDeg: number, gmstDeg: number): number {
  return magLon(fromLatLon(sunDecDeg, sunRaHours * 15 - gmstDeg));
}

/** الزمن المحلي المغناطيسي (ساعات، 12 = ظهيرة مغناطيسية) لنقطة جغرافية — للتحقق وللعرض */
export function magneticLocalTime(latDeg: number, lonDeg: number, sunRaHours: number, sunDecDeg: number, gmstDeg: number): number {
  let d = magLon(fromLatLon(latDeg, lonDeg)) - subsolarMagneticLon(sunRaHours, sunDecDeg, gmstDeg);
  d = ((d + 540) % 360) - 180;
  return (12 + d / 15 + 24) % 24;
}

// ───────────────────────── ما يراه الراصد ─────────────────────────
export interface AuroraSample {
  /** شدة نسبية 0..1 على امتداد القوس */
  intensity: number;
  bottom: { alt: number; az: number };
  top: { alt: number; az: number };
}
export interface AuroraArc { weight: number; samples: AuroraSample[] }

export interface AuroraInput {
  kp: number;
  latDeg: number;
  lonDeg: number;
  sunRaHours: number;
  sunDecDeg: number;
  gmstDeg: number;
  /** ثانية عشوائية للحركة (طيّات الستارة) */
  timeSec: number;
}

const BOTTOM_KM = 95;
const TOP_KM = 300;
/** الشدة حول الليل المغناطيسي: ذروة قبل منتصف الليل (بدء العواصف الفرعية) وعودة أضعف قبل الفجر */
function mltIntensity(t: number): number {
  const g = (c: number, s: number) => { let d = Math.abs(t - c); if (d > 12) d = 24 - d; return Math.exp(-((d / s) ** 2)); };
  return 0.18 + 0.82 * Math.max(g(23, 3.2), 0.55 * g(3.5, 2.6));
}

function direction(obs: V3, east: V3, north: V3, up: V3, footLat: V3, hKm: number): { alt: number; az: number } {
  const p: V3 = [footLat[0] * (R_E + hKm), footLat[1] * (R_E + hKm), footLat[2] * (R_E + hKm)];
  const d: V3 = [p[0] - obs[0] * R_E, p[1] - obs[1] * R_E, p[2] - obs[2] * R_E];
  const len = Math.hypot(d[0], d[1], d[2]);
  return { alt: Math.asin(dot(d, up) / len) / DEG, az: ((Math.atan2(dot(d, east), dot(d, north)) / DEG) + 360) % 360 };
}

/** الأقواس الشفقية (ليلية) كما تُرى من الراصد، مع إسقاط كل ما تحت الأفق لاحقاً عند الرسم */
export function computeAuroraArcs(inp: AuroraInput): AuroraArc[] {
  const obs = fromLatLon(inp.latDeg, inp.lonDeg);
  const lon = inp.lonDeg * DEG, lat = inp.latDeg * DEG;
  const east: V3 = [-Math.sin(lon), Math.cos(lon), 0];
  const north: V3 = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const up = obs;
  const lamSun = subsolarMagneticLon(inp.sunRaHours, inp.sunDecDeg, inp.gmstDeg);

  const fractions = [{ f: 0.14, w: 1.0 }, { f: 0.5, w: 0.72 }, { f: 0.86, w: 0.5 }]; // من الحافة الاستوائية نحو القطبية
  const arcs: AuroraArc[] = [];
  const STEP = 0.1;
  for (const { f, w } of fractions) {
    const samples: AuroraSample[] = [];
    // الجانب الليلي فقط: 16h → 24h ثم 0h → 8h (النهار لا يُرى)
    for (let k = 0; k <= 160; k++) {
      const t = (16 + k * STEP) % 24;
      const { poleward, equatorward } = ovalColatitudes(inp.kp, t);
      // طيّات الستارة: إزاحة بطيئة متحركة بالزمن في خط العرض
      const fold = 0.55 * Math.sin(t * 2.7 + inp.timeSec * 0.11 + f * 9) + 0.3 * Math.sin(t * 6.1 - inp.timeSec * 0.17);
      const theta = equatorward + f * (poleward - equatorward) + fold * (equatorward - poleward) * 0.12;
      const phi = (lamSun + 15 * (t - 12)) * DEG;
      const th = theta * DEG;
      const v: V3 = [
        Math.sin(th) * Math.cos(phi) * X_M[0] + Math.sin(th) * Math.sin(phi) * Y_M[0] + Math.cos(th) * Z_M[0],
        Math.sin(th) * Math.cos(phi) * X_M[1] + Math.sin(th) * Math.sin(phi) * Y_M[1] + Math.cos(th) * Z_M[1],
        Math.sin(th) * Math.cos(phi) * X_M[2] + Math.sin(th) * Math.sin(phi) * Y_M[2] + Math.cos(th) * Z_M[2],
      ];
      // أشعة رأسية وتلألؤ (خطوط عمودية) يتحرك مع الزمن
      const ray = 0.72 + 0.28 * Math.sin(k * 0.9 + inp.timeSec * 0.5 + f * 5) * Math.sin(k * 0.37 - inp.timeSec * 0.25);
      samples.push({
        intensity: mltIntensity(t) * ray,
        bottom: direction(obs, east, north, up, v, BOTTOM_KM),
        top: direction(obs, east, north, up, v, TOP_KM),
      });
    }
    arcs.push({ weight: w, samples });
  }
  return arcs;
}

/** سطوع الشفق العام من Kp (النشاط الأعلى أسطع وأوسع) */
export function auroraBrightness(kp: number): number {
  return 0.3 + 0.7 * Math.pow(Math.max(0, Math.min(9, kp)) / 9, 0.6);
}
