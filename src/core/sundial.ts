/**
 * هندسة الساعة الشمسية (مسلّة رأسية = «عمود الظل» gnomon) على أرض مستوية.
 *
 * كل الأطوال بوحدة ارتفاع العمود h (فيكون طول الظل = L/h = cot(ارتفاع الشمس) مباشرة، ويُضرب بـh لأي ارتفاع فعلي).
 * الإحداثيات (شرق E، شمال N) نسبةً إلى قاعدة العمود. اتجاه الظل = سمت الشمس + 180°.
 *
 * منحنى طرف الظل: لمستوى ميل ثابت δ (يوم معيّن) يرسم طرف الظل منحنى (قطعاً زائداً) يمرّ بالساعات الشمسية الظاهرية،
 * فيقرأ الناظر الزمن الشمسي الظاهري من موضع الطرف على المنحنى، ويبين قرب الانقلابين مدى تغيّر الظل بين الصيف والشتاء.
 */
const DEG = Math.PI / 180;

export interface ShadowVector {
  /** ارتفاع الشمس وسمتها بالدرجات */
  altDeg: number;
  azDeg: number;
  /** طول الظل بوحدة ارتفاع العمود = cot(ارتفاع) */
  length: number;
  /** سمت الظل = سمت الشمس + 180° */
  shadowAzDeg: number;
  /** موضع الطرف (E، N) */
  tipE: number;
  tipN: number;
}

/** أدنى ارتفاع يُعدّ ظلاً معرَّفاً (دون ذلك يصير الطول لانهائياً تقريباً) */
export const MIN_SHADOW_ALT_DEG = 0.5;

export function gnomonShadow(altDeg: number, azDeg: number): ShadowVector | null {
  if (!(altDeg > MIN_SHADOW_ALT_DEG)) return null;
  const length = 1 / Math.tan(altDeg * DEG);
  let shadowAz = (azDeg + 180) % 360; if (shadowAz < 0) shadowAz += 360;
  return { altDeg, azDeg, length, shadowAzDeg: shadowAz, tipE: length * Math.sin(shadowAz * DEG), tipN: length * Math.cos(shadowAz * DEG) };
}

/** ارتفاع وسمت جرم من خط العرض والميل والزاوية الساعية H (غرباً موجبة) — هندسي بلا انكسار */
export function altAzFromHourAngle(latDeg: number, decDeg: number, hourAngleDeg: number): { altDeg: number; azDeg: number } {
  const p = latDeg * DEG, d = decDeg * DEG, H = hourAngleDeg * DEG;
  const sinAlt = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H);
  const east = -Math.cos(d) * Math.sin(H);
  const north = Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(H);
  let az = Math.atan2(east, north) / DEG; if (az < 0) az += 360;
  return { altDeg: Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG, azDeg: az };
}

export interface TipPoint { hourAngleDeg: number; solarHour: number; e: number; n: number; length: number }

/**
 * منحنى طرف الظل ليوم بميل ثابت: مقاطع متصلة (ينقطع حيث تغيب الشمس أو يتجاوز الطول maxLength)، ونقاط الساعات الكاملة.
 * stepDeg: دقة العينات (1° من الزاوية الساعية = 4 دقائق).
 */
export function shadowTipCurve(latDeg: number, decDeg: number, maxLength: number, stepDeg = 1): { segments: TipPoint[][]; hours: TipPoint[] } {
  const segments: TipPoint[][] = [];
  const hours: TipPoint[] = [];
  let cur: TipPoint[] = [];
  const make = (H: number): TipPoint | null => {
    const { altDeg, azDeg } = altAzFromHourAngle(latDeg, decDeg, H);
    const s = gnomonShadow(altDeg, azDeg);
    if (!s || s.length > maxLength) return null;
    return { hourAngleDeg: H, solarHour: 12 + H / 15, e: s.tipE, n: s.tipN, length: s.length };
  };
  for (let H = -180; H <= 180.0001; H += stepDeg) {
    const p = make(H);
    if (p) cur.push(p); else if (cur.length) { segments.push(cur); cur = []; }
  }
  if (cur.length) segments.push(cur);
  for (let k = -12; k <= 12; k++) {
    const p = make(k * 15);
    if (p) hours.push(p);
  }
  return { segments, hours };
}

/** الزمن الشمسي الظاهري بالساعات (0..24) من الزاوية الساعية للشمس (غرباً موجبة): الظهر = 12 */
export function apparentSolarHour(hourAngleDeg: number): number {
  const h = (12 + hourAngleDeg / 15) % 24;
  return h < 0 ? h + 24 : h;
}

/** الزاوية الساعية للشمس من الزمن النجمي المحلي (درجات) والمطلع المستقيم (ساعات) → (−180..180] */
export function hourAngleDeg(lstDeg: number, raHours: number): number {
  let h = (lstDeg - raHours * 15) % 360;
  if (h > 180) h -= 360;
  if (h <= -180) h += 360;
  return h;
}

/** ميل الشمس الأقصى (الانقلاب) تقريباً للمنحنيين المرجعيين الخافتين */
export const SOLSTICE_DEC_DEG = 23.44;
