import type { Degrees } from '../types/astro';
import { latLonToScreen, type PolarMapConfig } from './projection';

const DEG2RAD = Math.PI / 180;

/** نقطة تحت الشمس مباشرة (Subsolar Point) على سطح الأرض، من الميل وزاوية غرينتش الساعية */
export function getSubsolarPoint(sunDecDeg: Degrees, sunGhaDeg: Degrees) {
  return { lat: sunDecDeg, lon: normalizeLon(-sunGhaDeg) };
}

function solarAltitudeDeg(
  latDeg: number,
  lonDeg: number,
  subsolarLat: Degrees,
  subsolarLon: Degrees
): number {
  const phi = latDeg * DEG2RAD;
  const delta = subsolarLat * DEG2RAD;
  const H = (lonDeg - subsolarLon) * DEG2RAD;
  const sinAlt = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG2RAD;
}

const NIGHT_MAX_ALPHA = 0.92;
const NIGHT_FULL_AT_DEG = -18;

function altitudeToAlpha(altDeg: number): number {
  if (altDeg >= 0) return 0;
  if (altDeg <= NIGHT_FULL_AT_DEG) return NIGHT_MAX_ALPHA;
  return (altDeg / NIGHT_FULL_AT_DEG) * NIGHT_MAX_ALPHA;
}

export function drawNightShading(
  ctx: CanvasRenderingContext2D,
  subsolarLat: Degrees,
  subsolarLon: Degrees,
  config: PolarMapConfig,
  resolution: { rings?: number; slices?: number } = {}
) {
  const RINGS = resolution.rings ?? 40;
  const SLICES = resolution.slices ?? 90;
  const colatStep = 180 / RINGS;
  const lonStep = 360 / SLICES;

  ctx.save();
  for (let i = 0; i < RINGS; i++) {
    const colat0 = i * colatStep;
    const colat1 = colat0 + colatStep;
    const midColat = (colat0 + colat1) / 2;
    const midLat = 90 - midColat;

    for (let j = 0; j < SLICES; j++) {
      const lon0 = -180 + j * lonStep;
      const lon1 = lon0 + lonStep;
      const midLon = (lon0 + lon1) / 2;

      const alt = solarAltitudeDeg(midLat, midLon, subsolarLat, subsolarLon);
      const alpha = altitudeToAlpha(alt);
      if (alpha <= 0.004) continue;

      const p1 = latLonToScreen(90 - colat0, lon0, config);
      const p2 = latLonToScreen(90 - colat0, lon1, config);
      const p3 = latLonToScreen(90 - colat1, lon1, config);
      const p4 = latLonToScreen(90 - colat1, lon0, config);

      ctx.fillStyle = `rgba(2, 6, 20, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function normalizeLon(lon: number): number {
  return (((lon + 180) % 360) + 360) % 360 - 180;
}