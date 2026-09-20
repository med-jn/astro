import * as Astronomy from 'astronomy-engine';
import type {
  CelestialBodyState,
  ObserverLocation,
  PlanetName,
} from '../types/astro';
import { toAstronomyObserver } from './observer';

export const PLANET_NAMES: PlanetName[] = [
  'Mercury',
  'Venus',
  'Mars',
  'Jupiter',
  'Saturn',
  'Uranus',
  'Neptune',
];

// أسماء الكواكب بالعربية للعرض في الواجهة
export const PLANET_LABELS_AR: Record<PlanetName, string> = {
  Mercury: 'عطارد',
  Venus: 'الزهرة',
  Mars: 'المريخ',
  Jupiter: 'المشتري',
  Saturn: 'زحل',
  Uranus: 'أورانوس',
  Neptune: 'نبتون',
};

// ألوان تقريبية واقعية لكل جرم للرسم
export const PLANET_COLORS: Record<PlanetName, string> = {
  Mercury: '#b7b3ad',
  Venus: '#f5deb3',
  Mars: '#e2725b',
  Jupiter: '#e0c9a6',
  Saturn: '#d9c186',
  Uranus: '#9fd6e3',
  Neptune: '#5b7fe0',
};

/**
 * يحسب حالة جرم سماوي كاملة (استوائي + أفقي + بروجي + قدر ضوئي)
 * بدقة عالية (VSOP/DE-derived) عبر astronomy-engine بدلاً من صيغ Meeus المختصرة يدوياً.
 */
export function getBodyState(
  body: Astronomy.Body,
  time: Astronomy.AstroTime,
  observer: ObserverLocation
): CelestialBodyState {
  const astroObserver = toAstronomyObserver(observer);
  // ofdate=true, aberration=true لأقصى دقة ظاهرية (Apparent) لحظة الرصد
  const eq = Astronomy.Equator(body, time, astroObserver, true, true);
  const hor = Astronomy.Horizon(time, astroObserver, eq.ra, eq.dec, 'normal');
  const ecl = Astronomy.Ecliptic(eq.vec);

  let magnitude: number | undefined;
  let angularSizeDeg: number | undefined;
  let phaseFraction: number | undefined;
  let phaseAngleDeg: number | undefined;

  try {
    const illum = Astronomy.Illumination(body, time);
    magnitude = illum.mag;
    phaseFraction = illum.phase_fraction;
    phaseAngleDeg = illum.phase_angle;
  } catch {
    // بعض الأجرام (مثل الشمس نفسها كمرجع) قد لا تدعم الإضاءة النسبية
  }

  if (body === Astronomy.Body.Moon) {
    // القطر الزاوي للقمر يتغير محسوسًا بسبب مدار القمر الإهليلجي (~29.3' إلى 34.1')
    angularSizeDeg = (2 * Math.atan(1737.4 / (eq.dist * 149597870.7))) * (180 / Math.PI);
  } else if (body === Astronomy.Body.Sun) {
    angularSizeDeg = (2 * Math.atan(696000 / (eq.dist * 149597870.7))) * (180 / Math.PI);
  }

  return {
    name: body,
    equatorial: { rightAscensionHours: eq.ra, declinationDeg: eq.dec },
    horizontal: { azimuthDeg: hor.azimuth, altitudeDeg: hor.altitude },
    ecliptic: { longitudeDeg: ecl.elon, latitudeDeg: ecl.elat },
    magnitude,
    angularSizeDeg,
    phaseFraction,
    phaseAngleDeg,
  };
}

export function getSunState(time: Astronomy.AstroTime, observer: ObserverLocation) {
  return getBodyState(Astronomy.Body.Sun, time, observer);
}

export function getMoonState(time: Astronomy.AstroTime, observer: ObserverLocation) {
  return getBodyState(Astronomy.Body.Moon, time, observer);
}

export function getPlanetState(
  name: PlanetName,
  time: Astronomy.AstroTime,
  observer: ObserverLocation
) {
  return getBodyState(Astronomy.Body[name], time, observer);
}

export function getAllPlanetStates(time: Astronomy.AstroTime, observer: ObserverLocation) {
  return PLANET_NAMES.map((name) => ({ name, state: getPlanetState(name, time, observer) }));
}

/** أوقات الشروق والغروب والعبور لجرم معيّن حول تاريخ محدد */
export function getRiseTransitSet(
  body: Astronomy.Body,
  time: Astronomy.AstroTime,
  observer: ObserverLocation
) {
  const astroObserver = toAstronomyObserver(observer);
  const searchStart = Astronomy.MakeTime(new Date(time.date.getTime() - 12 * 3600 * 1000));
  const rise = Astronomy.SearchRiseSet(body, astroObserver, +1, searchStart, 2);
  const set = Astronomy.SearchRiseSet(body, astroObserver, -1, searchStart, 2);
  const transit = Astronomy.SearchHourAngle(body, astroObserver, 0, searchStart, +1);

  return {
    rise: rise ? rise.date : null,
    set: set ? set.date : null,
    transit: transit ? transit.time.date : null,
  };
}

/** الزمن النجمي المتوسط لغرينتش بالدرجات (0..360) لحظة معينة، بدقة IAU الكاملة */
export function getGMSTDeg(time: Astronomy.AstroTime): number {
  const gstHours = Astronomy.SiderealTime(time);
  return normalizeDeg(gstHours * 15);
}

/** الزمن النجمي المحلي بالدرجات لمراقب بخط طول معيّن */
export function getLMSTDeg(time: Astronomy.AstroTime, observerLongitudeDeg: number): number {
  return normalizeDeg(getGMSTDeg(time) + observerLongitudeDeg);
}

export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}
