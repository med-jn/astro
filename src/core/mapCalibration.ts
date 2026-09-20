export interface PixelPoint {
  x: number;
  y: number;
}

export interface MapCalibration {
  imageNaturalWidth: number;
  imageNaturalHeight: number;
  poleP: PixelPoint;
  cancerP: PixelPoint;
  equatorP: PixelPoint;
  capricornP: PixelPoint;
  greenwichP: PixelPoint;
  mirrored: boolean;
  rotationNudgeDeg: number;
}

const STORAGE_KEY = 'astro-clock-map-calibration-v1';

/**
 * معايرة افتراضية مُضمَّنة في الكود نفسه (وليست في localStorage) — هي التي يراها كل زوار
 * الموقع الفعليين. مأخوذة من معايرة فعلية أجراها المطوّر عبر calibrate.html ونُسخت هنا.
 * لتحديثها لاحقاً: كرّر نفس خطوات المعايرة ثم زر النسخ 📋، والصق الناتج هنا من جديد.
 */
export const DEFAULT_CALIBRATION: MapCalibration | null = {
  imageNaturalWidth: 3099,
  imageNaturalHeight: 3095,
  poleP: { x: 1547.9074628823332, y: 1550.7252026244694 },
  cancerP: { x: 1547.9074628823332, y: 954.421072944809 },
  equatorP: { x: 1547.9074628823332, y: 748.0081049787727 },
  capricornP: { x: 1540.2625381428502, y: 537.772674642995 },
  greenwichP: { x: 1547.9074628823332, y: 2789.203010420687 },
  mirrored: false,
  rotationNudgeDeg: 0,
};

export function saveCalibration(cal: MapCalibration) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cal));
  } catch {
    /* تجاهل بيئات بلا localStorage */
  }
}

export function loadSavedCalibration(): MapCalibration | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MapCalibration;
  } catch {
    /* تجاهل */
  }
  return DEFAULT_CALIBRATION;
}

export function clearCalibration() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* تجاهل */
  }
}

function dist(a: PixelPoint, b: PixelPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const TROPIC_OBLIQUITY = 23.4367;

export function fitPixelsPerColatitude(cal: MapCalibration): number {
  const points: [number, number][] = [
    [90 - TROPIC_OBLIQUITY, dist(cal.poleP, cal.cancerP)],
    [90, dist(cal.poleP, cal.equatorP)],
    [90 + TROPIC_OBLIQUITY, dist(cal.poleP, cal.capricornP)],
  ];
  const num = points.reduce((s, [c, r]) => s + c * r, 0);
  const den = points.reduce((s, [c]) => s + c * c, 0);
  return den > 0 ? num / den : 1;
}

export function greenwichBearingDeg(cal: MapCalibration): number {
  const dx = cal.greenwichP.x - cal.poleP.x;
  const dy = cal.greenwichP.y - cal.poleP.y;
  const deg = Math.atan2(dx, -dy) * (180 / Math.PI);
  return ((deg % 360) + 360) % 360;
}

/** ينسخ بيانات المعايرة الحالية كنص JSON جاهز للصق مباشرة كقيمة DEFAULT_CALIBRATION أعلاه —
 * يُستخدم من زر "نسخ بيانات المعايرة" في MapCalibrator.tsx. */
export function exportCalibrationAsCode(cal: MapCalibration): string {
  return JSON.stringify(cal, null, 2);
}