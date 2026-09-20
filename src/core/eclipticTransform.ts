import * as Astronomy from 'astronomy-engine';
import type { Degrees } from '../types/astro';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** ميل دائرة البروج المتوسط (Mean Obliquity) بالدرجات، صيغة IAU المختصرة (Meeus 22.2) */
export function getMeanObliquityDeg(time: Astronomy.AstroTime): Degrees {
  const T = time.tt / 36525.0; // قرون جوليانية منذ J2000.0 (tt = أيام منذ J2000 بالزمن الأرضي)
  const eps0Seconds =
    84381.448 - 46.815 * T - 0.00059 * Math.pow(T, 2) + 0.001813 * Math.pow(T, 3);
  return eps0Seconds / 3600.0;
}

/** تحويل (لامدا بروجي، بيتا=0) إلى (RA بالساعات، Dec بالدرجات) لرسم خط البروج والمنازل */
export function eclipticLongitudeToEquatorial(
  longitudeDeg: Degrees,
  obliquityDeg: Degrees
): { raHours: number; decDeg: Degrees } {
  const lambda = longitudeDeg * DEG2RAD;
  const eps = obliquityDeg * DEG2RAD;

  const sinDec = Math.sin(eps) * Math.sin(lambda);
  const decRad = Math.asin(sinDec);

  const y = Math.sin(lambda) * Math.cos(eps);
  const x = Math.cos(lambda);
  let raRad = Math.atan2(y, x);
  if (raRad < 0) raRad += 2 * Math.PI;

  return { raHours: (raRad * RAD2DEG) / 15, decDeg: decRad * RAD2DEG };
}
