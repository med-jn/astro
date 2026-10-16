/**
 * حسابات القمر العامة فوق astronomy-engine (الأطوار، العمر، الإضاءة، الإحداثيات الإكليبتيكية).
 * الكسوف والخسوف ومظهر القمر المحلي في core/eclipses.ts؛ هذا الملف لا يكرّرها.
 */
import * as A from 'astronomy-engine';

const DEG = 180 / Math.PI;
const AU_KM = 149_597_870.7;
const DAY_MS = 86_400_000;

export const norm360 = (x: number) => ((x % 360) + 360) % 360;

export interface LunarState {
  sunLon: number;
  moonLon: number;
  moonLat: number;
  elongation: number;   // 0..360
  moonDistKm: number;
  sunDistAU: number;
  moonSemiDia: number;  // °
}

export function lunarState(date: Date): LunarState {
  const t = A.MakeTime(date);
  const m = A.EclipticGeoMoon(t);
  const s = A.SunPosition(t);
  const sv = A.GeoVector(A.Body.Sun, t, true);
  const moonDistKm = m.dist * AU_KM;
  return {
    sunLon: s.elon,
    moonLon: m.lon,
    moonLat: m.lat,
    elongation: A.MoonPhase(t),
    moonDistKm,
    sunDistAU: Math.hypot(sv.x, sv.y, sv.z),
    moonSemiDia: Math.asin(1737.4 / moonDistKm) * DEG,
  };
}

/** 0 محاق · 1 هلال متزايد · 2 تربيع أول · 3 أحدب متزايد · 4 بدر · 5 أحدب متناقص · 6 تربيع أخير · 7 هلال متناقص */
export function phaseIndex(elongation: number): number {
  return Math.floor(((norm360(elongation) + 22.5) % 360) / 45);
}

/** نسبة المساحة المضاءة (0..1) */
export const moonIllumination = (date: Date): number => A.Illumination(A.Body.Moon, A.MakeTime(date)).phase_fraction;

/** أول لحظة بعد `from` تبلغ فيها الاستطالة targetDeg (0 محاق، 90 تربيع أول، 180 بدر، 270 تربيع أخير). */
export function findPhase(from: Date, targetDeg: number): Date {
  const r = A.SearchMoonPhase(targetDeg, from, 40);
  return r ? r.date : new Date(from.getTime() + (norm360(targetDeg - A.MoonPhase(A.MakeTime(from))) / 12.19) * DAY_MS);
}

/** عمر القمر: الأيام منذ آخر محاق. */
export function moonAgeDays(date: Date): number {
  let last = A.SearchMoonPhase(0, new Date(date.getTime() - 32 * DAY_MS), 33);
  for (let i = 0; i < 3 && last; i++) {
    const nxt = A.SearchMoonPhase(0, new Date(last.date.getTime() + DAY_MS), 33);
    if (!nxt || nxt.date.getTime() > date.getTime()) break;
    last = nxt;
  }
  return last ? (date.getTime() - last.date.getTime()) / DAY_MS : 0;
}
