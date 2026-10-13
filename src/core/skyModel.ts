/**
 * نموذج السماء المشترك بين قبة الراصد (منظر علوي) وعين الراصد (واجهة ملء الشاشة).
 *
 * مصدر واحد للحقيقة: كل جرم يمرّ من هنا، فلا يمكن أن يختلف موضع نجمة بين العرضين.
 *
 *  • الكتالوج (نجوم/كوكبات/حدود أبراج) بإحداثيات J2000 → إحداثيات اليوم عبر مصفوفة المبادرة والنوتيشن
 *    من astronomy-engine (Rotation_EQJ_EQD) → أفقي محلي مع الزمن النجمي الظاهري (GAST) نفسه الذي تستعمله
 *    المكتبة للشمس والقمر والكواكب، ثم انكسار الجو بمعادلة المكتبة نفسها (Saemundsson مع اقتطاعها).
 *  • مصفوفة واحدة 3×3 لكل إطار (J2000 → شرق/شمال/علو) تُطبَّق على آلاف النجوم بلا استدعاء مكتبة لكل نجمة.
 *  • الرؤية الفعلية: قدر محدِّد يتبع ارتفاع الشمس (الشفق) وضوء القمر، وإخماد قرب الأفق (الكتلة الهوائية).
 *
 * غير مطبَّق (وهو أصغر من دقيقة قوسية لمعظم النجوم): الحركة الذاتية وزيغ الضوء السنوي (≤20″) واختلاف منظر النجوم.
 */
import * as Astronomy from 'astronomy-engine';

const DEG = Math.PI / 180;

export interface SkyObserver {
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface SkyFrame {
  time: Astronomy.AstroTime;
  latDeg: number;
  lonDeg: number;
  /** الزمن النجمي الظاهري لغرينتش بالدرجات */
  gastDeg: number;
  /** صفوف مصفوفة 3×3 (صفاً بصف) تحوّل متجه J2000 الاستوائي إلى (شرق، شمال، علو) */
  m: Float64Array;
}

/** متجه وحدة استوائي (J2000) من مطلع مستقيم بالساعات وميل بالدرجات */
export function vecFromRaDec(raHours: number, decDeg: number): [number, number, number] {
  const ra = raHours * 15 * DEG;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

export function makeSkyFrame(time: Astronomy.AstroTime, observer: SkyObserver): SkyFrame {
  const rot = Astronomy.Rotation_EQJ_EQD(time);
  const ex = Astronomy.RotateVector(rot, new Astronomy.Vector(1, 0, 0, time));
  const ey = Astronomy.RotateVector(rot, new Astronomy.Vector(0, 1, 0, time));
  const ez = Astronomy.RotateVector(rot, new Astronomy.Vector(0, 0, 1, time));
  // P: أعمدتها صور المحاور الثلاثة (J2000 → اليوم)
  const P = [
    ex.x, ey.x, ez.x,
    ex.y, ey.y, ez.y,
    ex.z, ey.z, ez.z,
  ];
  const gastDeg = Astronomy.SiderealTime(time) * 15;
  const L = (gastDeg + observer.longitudeDeg) * DEG;
  const phi = observer.latitudeDeg * DEG;
  const sL = Math.sin(L), cL = Math.cos(L), sP = Math.sin(phi), cP = Math.cos(phi);
  // الاستوائي-لليوم → أفقي: شرق = −x·sinL + y·cosL ؛ شمال = −sinφ(x cosL + y sinL) + cosφ·z ؛ علو = cosφ(x cosL + y sinL) + sinφ·z
  const H = [
    -sL, cL, 0,
    -sP * cL, -sP * sL, cP,
    cP * cL, cP * sL, sP,
  ];
  const m = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m[r * 3 + c] = H[r * 3] * P[c] + H[r * 3 + 1] * P[3 + c] + H[r * 3 + 2] * P[6 + c];
    }
  }
  return { time, latDeg: observer.latitudeDeg, lonDeg: observer.longitudeDeg, gastDeg, m };
}

/** انكسار الجو بالدرجات لارتفاع حقيقي (هندسي) — مطابق حرفياً لـ Astronomy.Refraction('normal') */
export function refractionDeg(trueAltDeg: number): number {
  if (trueAltDeg < -90 || trueAltDeg > 90) return 0;
  const hd = trueAltDeg < -1 ? -1 : trueAltDeg;
  let r = 1.02 / Math.tan((hd + 10.3 / (hd + 5.11)) * DEG) / 60;
  if (trueAltDeg < -1) r *= (trueAltDeg + 90) / 89;
  return r;
}

/** يحوّل متجه J2000 إلى ارتفاع ظاهري (بعد الانكسار) وسمت (من الشمال نحو الشرق) */
export function placeJ2000(frame: SkyFrame, v: ArrayLike<number>, i = 0): { altDeg: number; azDeg: number; altGeomDeg: number } {
  const m = frame.m;
  const x = v[i], y = v[i + 1], z = v[i + 2];
  const e = m[0] * x + m[1] * y + m[2] * z;
  const n = m[3] * x + m[4] * y + m[5] * z;
  const u = m[6] * x + m[7] * y + m[8] * z;
  const altGeomDeg = Math.asin(Math.max(-1, Math.min(1, u))) / DEG;
  let azDeg = Math.atan2(e, n) / DEG;
  if (azDeg < 0) azDeg += 360;
  return { altDeg: altGeomDeg + refractionDeg(altGeomDeg), azDeg, altGeomDeg };
}

export function placeRaDecJ2000(frame: SkyFrame, raHours: number, decDeg: number) {
  return placeJ2000(frame, vecFromRaDec(raHours, decDeg));
}

/**
 * حقل نجوم: يحسب مواضع آلاف النجوم دفعة واحدة لكل إطار بمصفوفة واحدة (لا مكتبة لكل نجمة).
 * المخرجات: altDeg (ظاهري بعد الانكسار) وazDeg، كمصفوفات Float32 تُعاد استعمالها.
 */
export class StarField {
  readonly count: number;
  readonly altDeg: Float32Array;
  readonly azDeg: Float32Array;
  private readonly vec: Float64Array;

  constructor(stars: ReadonlyArray<{ ra: number; dec: number }>) {
    this.count = stars.length;
    this.vec = new Float64Array(stars.length * 3);
    this.altDeg = new Float32Array(stars.length);
    this.azDeg = new Float32Array(stars.length);
    for (let i = 0; i < stars.length; i++) {
      const v = vecFromRaDec(stars[i].ra, stars[i].dec);
      this.vec[3 * i] = v[0];
      this.vec[3 * i + 1] = v[1];
      this.vec[3 * i + 2] = v[2];
    }
  }

  update(frame: SkyFrame): void {
    const m = frame.m, v = this.vec;
    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7], m8 = m[8];
    for (let i = 0; i < this.count; i++) {
      const x = v[3 * i], y = v[3 * i + 1], z = v[3 * i + 2];
      const e = m0 * x + m1 * y + m2 * z;
      const n = m3 * x + m4 * y + m5 * z;
      const u = m6 * x + m7 * y + m8 * z;
      const alt = Math.asin(u > 1 ? 1 : u < -1 ? -1 : u) / DEG;
      let az = Math.atan2(e, n) / DEG;
      if (az < 0) az += 360;
      this.altDeg[i] = alt + refractionDeg(alt);
      this.azDeg[i] = az;
    }
  }
}

// ───────────────────────────── الرؤية: شفق، قمر، أفق ─────────────────────────────

/** كتلة هوائية (Kasten–Young) عند ارتفاع ظاهري */
export function airmass(altDeg: number): number {
  const a = Math.max(altDeg, -0.5);
  return 1 / (Math.sin(a * DEG) + 0.50572 * Math.pow(a + 6.07995, -1.6364));
}

/** نقاط (ارتفاع الشمس → أخفت قدر يُرى بالعين المجردة في سماء صافية) */
const LIMIT_STOPS: [number, number][] = [
  [0, -4.0], [-3, -2.0], [-6, 0.5], [-9, 2.5], [-12, 4.0], [-15, 5.2], [-18, 6.2],
];

/**
 * أخفت قدر مرئي: يتبع ارتفاع الشمس (الشفق المدني/الملاحي/الفلكي) ويُخفَّض بضوء القمر
 * (حتى ~1.6 قدر عند البدر العالي). ليلة داكنة تماماً ≈ 6.2.
 */
export function limitingMagnitude(sunAltDeg: number, moon?: { altDeg: number; phaseFraction: number }): number {
  let lim: number;
  if (sunAltDeg >= LIMIT_STOPS[0][0]) lim = LIMIT_STOPS[0][1];
  else if (sunAltDeg <= LIMIT_STOPS[LIMIT_STOPS.length - 1][0]) lim = LIMIT_STOPS[LIMIT_STOPS.length - 1][1];
  else {
    lim = LIMIT_STOPS[LIMIT_STOPS.length - 1][1];
    for (let i = 1; i < LIMIT_STOPS.length; i++) {
      if (sunAltDeg >= LIMIT_STOPS[i][0]) {
        const t = (LIMIT_STOPS[i - 1][0] - sunAltDeg) / (LIMIT_STOPS[i - 1][0] - LIMIT_STOPS[i][0]);
        lim = LIMIT_STOPS[i - 1][1] + t * (LIMIT_STOPS[i][1] - LIMIT_STOPS[i - 1][1]);
        break;
      }
    }
  }
  if (moon && moon.altDeg > 0) {
    const up = Math.sin(Math.min(moon.altDeg, 60) * DEG) / Math.sin(60 * DEG);
    lim -= 1.6 * Math.pow(Math.max(0, moon.phaseFraction), 0.8) * Math.min(1, up);
  }
  return lim;
}

/** شفافية نجمة (0..1) من قدرها وارتفاعها الظاهري والقدر المحدِّد: تخفت قرب الأفق (إخماد ~0.2 قدر لكل كتلة هوائية) */
export function starAlpha(mag: number, altApparentDeg: number, limitMag: number): number {
  if (altApparentDeg < -0.6) return 0;
  const eff = mag + 0.2 * (airmass(altApparentDeg) - 1);
  const a = (limitMag - eff + 0.6) / 1.6;
  return a <= 0 ? 0 : a >= 1 ? 1 : a;
}

// ───────────────────────────── المجرة ─────────────────────────────

/** J2000 الاستوائي → إحداثيات مجرية (صفوف: x نحو المركز المجري، y نحو l=90°، z نحو القطب الشمالي المجري) */
export const GALACTIC_FROM_EQJ: readonly number[] = [
  -0.0548755604, -0.8734370902, -0.4838350155,
  +0.4941094279, -0.4448296300, +0.7469822445,
  -0.8676661490, -0.1980763734, +0.4559837762,
];

export function galacticOfJ2000(v: ArrayLike<number>): { lDeg: number; bDeg: number } {
  const g = GALACTIC_FROM_EQJ;
  const x = g[0] * v[0] + g[1] * v[1] + g[2] * v[2];
  const y = g[3] * v[0] + g[4] * v[1] + g[5] * v[2];
  const z = g[6] * v[0] + g[7] * v[1] + g[8] * v[2];
  let l = Math.atan2(y, x) / DEG;
  if (l < 0) l += 360;
  return { lDeg: l, bDeg: Math.asin(Math.max(-1, Math.min(1, z))) / DEG };
}

/** عكس مصفوفة الإطار (متعامدة): متجه محلي (شرق/شمال/علو) → J2000 الاستوائي */
export function localToJ2000(frame: SkyFrame, e: number, n: number, u: number): [number, number, number] {
  const m = frame.m;
  return [
    m[0] * e + m[3] * n + m[6] * u,
    m[1] * e + m[4] * n + m[7] * u,
    m[2] * e + m[5] * n + m[8] * u,
  ];
}
