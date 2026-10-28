import { airmass, setExtinctionScale, setRefractionScale } from './skyModel';
import { directSunLight, extinctionTauGreen, extinctionTauGreenDefault, setSkyAtmosphere, skyAtmosphereVersion, DEFAULT_SKY_ATMOSPHERE } from './skyRadiance';

/**
 * محرك الغلاف الجوي. كل صيغة من مرجع جُلب وراجعتُه (روابط وملاحظات الدقة في docs/CALIBRATION.md):
 *  - الانكسار (Bennett 1982 للارتفاع الظاهري، Sæmundsson 1986 للحقيقي) بعامل الضغط والحرارة (P/1010)(283/(273+T)) [Meeus؛ Stellarium؛ Orekit].
 *  - معامل انكسار الهواء بالحرارة والضغط وبخار الماء والطول الموجي: Edlén 1966 [arXiv:2103.02273]. حد بخار الماء فيه خطأ صغير صحّحه Birch & Downs،
 *    وأثره على الانكسار المرئي < 0.05%؛ يحسن Ciddor 1996 لاحقاً.
 *  - الكتلة الهوائية: Kasten & Young 1989 (skyModel.airmass).
 *  - الانخماد والتشتت: رايلي (Hansen & Travis، ∝ P) + هباء أنغستروم (نمو بالرطوبة f(RH)) + أوزون، داخل نموذج السماء المشترك skyRadiance.
 * ضغط البخار المشبع: Magnus (Alduchov & Eskridge 1996) — الثوابت من الذاكرة ولم تُجلب بعد؛ أثرها هنا على حد بخار الماء في الانكسار فقط.
 */
export interface AtmosphereParams {
  temperatureC: number;
  /** ضغط مكافئ لمستوى البحر (hPa) */
  pressureHPa: number;
  relativeHumidityPct: number;
  /** العمق البصري للهباء عند 550 نم (جاف) */
  aod550: number;
  ozoneDU: number;
}
export const STANDARD_ATMOSPHERE: AtmosphereParams = { temperatureC: DEFAULT_SKY_ATMOSPHERE.temperatureC, pressureHPa: DEFAULT_SKY_ATMOSPHERE.pressureHPa, relativeHumidityPct: DEFAULT_SKY_ATMOSPHERE.relHumidityPct, aod550: DEFAULT_SKY_ATMOSPHERE.aod550, ozoneDU: DEFAULT_SKY_ATMOSPHERE.ozoneDU };

/** معايرات جاهزة توضيحية (ليست قياسات محطة): تُبدَّل بقيم حقيقية عبر إدخال المستخدم */
export const ATMOSPHERE_PRESETS: Record<string, AtmosphereParams> = {
  standard: STANDARD_ATMOSPHERE,
  hot_humid: { temperatureC: 35, pressureHPa: 1005, relativeHumidityPct: 80, aod550: 0.3, ozoneDU: 260 },
  cold_dry: { temperatureC: -5, pressureHPa: 1030, relativeHumidityPct: 30, aod550: 0.03, ozoneDU: 340 },
  dust: { temperatureC: 30, pressureHPa: 1008, relativeHumidityPct: 25, aod550: 0.8, ozoneDU: 280 },
  high_clear: { temperatureC: 2, pressureHPa: 800, relativeHumidityPct: 30, aod550: 0.02, ozoneDU: 300 },
};

// ───────────────────────── الانكسار ─────────────────────────
/** Bennett (ارتفاع ظاهري، درجات) → انكسار بالدرجات في الجو القياسي (1010 hPa، 10°م) */
export function refractionBennettDeg(apparentAltDeg: number): number {
  const h = Math.max(apparentAltDeg, -1);
  return 1 / Math.tan(((h + 7.31 / (h + 4.4)) * Math.PI) / 180) / 60;
}
/** Sæmundsson (ارتفاع حقيقي، درجات) → انكسار بالدرجات في الجو القياسي */
export function refractionSaemundssonDeg(trueAltDeg: number): number {
  const h = Math.max(trueAltDeg, -1);
  return 1.02 / Math.tan(((h + 10.3 / (h + 5.11)) * Math.PI) / 180) / 60;
}
/** عامل Meeus: (P/1010)(283/(273+T)) */
export const meeusFactor = (pressureHPa: number, tempC: number) => (pressureHPa / 1010) * (283 / (273 + tempC));

/** ضغط البخار المشبع (hPa) — Magnus */
export const saturationVapourHPa = (tempC: number) => 6.1094 * Math.exp((17.625 * tempC) / (tempC + 243.04));

/** (n−1) للهواء: Edlén 1966. λ بالميكرون، الضغط بـ hPa، البخار بـ hPa */
export function airRefractivity(lambdaUm: number, pressureHPa: number, tempC: number, vapourHPa = 0): number {
  const s2 = 1 / (lambdaUm * lambdaUm);
  const ns = (8342.13 + 2406030 / (130 - s2) + 15997 / (38.9 - s2)) * 1e-8;
  const pT = pressureHPa * 0.750062; // Torr
  const ntp = ((pT * ns) / 720.775) * ((1 + pT * (0.817 - 0.0133 * tempC) * 1e-6) / (1 + 0.003661 * tempC));
  return ntp - vapourHPa * 0.750062 * (5.722 - 0.0457 * s2) * 1e-8;
}
const REF_N = airRefractivity(0.57, 1010, 10, 0);
/** نسبة معامل الانكسار إلى القياسي (الذي تُعاير به صيغتا Bennett/Sæmundsson) عند الطول الموجي المعطى */
export function refractivityRatio(p: AtmosphereParams, lambdaUm = 0.57): number {
  const e = (p.relativeHumidityPct / 100) * saturationVapourHPa(p.temperatureC);
  return airRefractivity(lambdaUm, p.pressureHPa, p.temperatureC, e) / REF_N;
}
/** فرق الانكسار اللوني بين الأزرق (450 نم) والأحمر (650 نم) بالثواني القوسية عند ارتفاع ظاهري معيّن */
export function dispersionArcsec(apparentAltDeg: number, p: AtmosphereParams = STANDARD_ATMOSPHERE): number {
  return refractionBennettDeg(apparentAltDeg) * (refractivityRatio(p, 0.45) - refractivityRatio(p, 0.65)) * 3600;
}

/** يطبّق المعاملات على كل النظام: السماء (رايلي/هباء/أوزون/ارتفاع الغلاف) والانكسار */
export function applyAtmosphere(p: AtmosphereParams): void {
  setSkyAtmosphere({ pressureHPa: p.pressureHPa, temperatureC: p.temperatureC, aod550: p.aod550, ozoneDU: p.ozoneDU, relHumidityPct: p.relativeHumidityPct });
  setRefractionScale(refractivityRatio(p));
  setExtinctionScale(extinctionTauGreen() / extinctionTauGreenDefault()); // k = 1.086·τ(550 نم): مقاييس الانخماد للنجوم والكواكب
}

// ───────────────────────── أثر الغلاف الجوي على جرم قرب الأفق ─────────────────────────
export interface HorizonAtmosphere {
  /** الكتلة الهوائية (Kasten & Young 1989) */
  airmass: number;
  /** نفاذية الضوء المباشر (إضاءة) نسبةً إلى السمت، من جدول الانتقال الذي تُحسب به السماء نفسها */
  transmittance: number;
  /** نسبة الألوان (أكبرها 1) بالنسبة إلى السمت: يحمرّ الضوء قرب الأفق */
  rel: [number, number, number];
  /** سطوع مُدرَك: T^0.33 (قانون ستيفنز لسطوع هدف ممتد؛ العين تضغط الإضاءة) */
  perceptual: number;
  /** نعومة بصرية للحواف 0..0.8 — تمثيل بصري يتبع الكتلة الهوائية والهباء، لا معيار علمي */
  haze: number;
}
const lum = (r: number[]) => 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2];
let zVer = -1, Z: number[] = [1, 1, 1], ZLUM = 1;
export function horizonAtmosphere(altApparentDeg: number): HorizonAtmosphere {
  const v = skyAtmosphereVersion();
  if (v !== zVer) { zVer = v; Z = directSunLight(90).rgb; ZLUM = lum(Z); }
  const a = Math.max(altApparentDeg, -0.5);
  const X = airmass(a), rgb = directSunLight(a).rgb;
  const T = Math.min(1, Math.max(1e-6, lum(rgb) / ZLUM));
  const r = [rgb[0] / Z[0], rgb[1] / Z[1], rgb[2] / Z[2]], m = Math.max(r[0], r[1], r[2]) || 1;
  return { airmass: X, transmittance: T, rel: [r[0] / m, r[1] / m, r[2] / m], perceptual: Math.pow(T, 0.33), haze: Math.min(0.8, 1 - Math.exp(-0.03 * (X - 1))) };
}

/**
 * تصحيح سطوع السماء المضاءة بالقمر نسبةً إلى Krisciunas & Schaefer 1991 (PASP 103, 1033).
 * قِيس النموذج المشترك ضد صيغتهم (قمر كامل، 45°): النسبة نموذج/KS91 = 2.00 عند ρ=5°، 1.75 عند 10°، 1.14 عند 20°، 0.74 عند 40°.
 */
const KS_POINTS: [number, number][] = [[5, 0.5], [10, 0.571], [20, 0.877], [40, 1.35]];
export function moonSkyCorrection(rhoDeg: number): number {
  if (rhoDeg <= KS_POINTS[0][0]) return KS_POINTS[0][1];
  for (let i = 1; i < KS_POINTS.length; i++) {
    const [r0, c0] = KS_POINTS[i - 1], [r1, c1] = KS_POINTS[i];
    if (rhoDeg <= r1) return Math.exp(Math.log(c0) + ((Math.log(c1) - Math.log(c0)) * (rhoDeg - r0)) / (r1 - r0));
  }
  const t = Math.min(1, (rhoDeg - 40) / 50);
  return 1.35 + (1 - 1.35) * t;
}
