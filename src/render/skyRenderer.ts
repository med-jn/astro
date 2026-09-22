import * as Astronomy from 'astronomy-engine';
import type { ObserverLocation, CelestialBodyState } from '../types/astro';
import type { LayerToggles } from '../state/store';
import {
  latLonToScreen,
  raDecToScreen,
  computeOuterRadiusPx,
  type PolarMapConfig,
  type ProjectedPoint2D,
} from '../core/projection';
import { getSubsolarPoint, drawNightShading } from '../core/terminator';
import { getAllLunarMansions, MANSION_SPAN_DEG } from '../core/mansions';
import { eclipticLongitudeToEquatorial, getMeanObliquityDeg } from '../core/eclipticTransform';
import {
  getGMSTDeg,
  getAllPlanetStates,
  getSunState,
  getMoonState,
  PLANET_COLORS,
  PLANET_LABELS_AR,
} from '../core/bodies';
import { getLoadedStars, getStarColor, getStarRadiusPx, getStarDisplayName } from '../core/starCatalog';
import { getLoadedZodiac, type ZodiacKey } from '../core/zodiac';
import { getEarthImage, isEarthImageLoaded, loadEarthImage } from '../core/earthImage';
import { fitPixelsPerColatitude, greenwichBearingDeg, type MapCalibration } from '../core/mapCalibration';
import { getContent, getContentId } from '../core/contentRegistry';

export interface RenderInput {
  date: Date;
  observer: ObserverLocation;
  zoomScale: number;
  layers: LayerToggles;
  /** الأبراج المُبرزة حالياً — مصفوفة فارغة تعني عدم وجود إبراز */
  selectedZodiacs: ZodiacKey[];
  /** فهارس المنازل القمرية المُبرزة (0..27) */
  selectedMansionIndices: number[];
  calibration: MapCalibration | null;
  sceneRotationDeg?: number;
  panX?: number;
  panY?: number;
}

export interface HitTarget {
  x: number;
  y: number;
  name: string;
  detail: string;
  description?: string;
  audioUrl?: string;
}

export interface RenderOutput {
  sun: CelestialBodyState;
  moon: CelestialBodyState;
  planets: { name: string; state: CelestialBodyState }[];
  gmstDeg: number;
  hitTargets: HitTarget[];
}

const TROPIC_OBLIQUITY = 23.4367;
const SPACE_COLOR = '#000000';

const ANGULAR_SIZE_VISUAL_BOOST = 16;
const FALLBACK_SUN_ANGULAR_DEG = 0.533;
const FALLBACK_MOON_ANGULAR_DEG = 0.518;

export function renderSky(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: RenderInput
): RenderOutput {
  const {
    date, observer, zoomScale, layers, selectedZodiacs, selectedMansionIndices, calibration,
    sceneRotationDeg = 0, panX = 0, panY = 0,
  } = input;
  const time = Astronomy.MakeTime(date);
  const gmstDeg = getGMSTDeg(time);
  const obliquityDeg = getMeanObliquityDeg(time);

  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadiusPx = computeOuterRadiusPx(width, height, zoomScale);
  const config: PolarMapConfig = { centerX, centerY, outerRadiusPx };
  const pxPerDeg = outerRadiusPx / 180;

  const panXpx = panX * outerRadiusPx;
  const panYpx = panY * outerRadiusPx;

  const sun = getSunState(time, observer);
  const moon = getMoonState(time, observer);
  const planets = getAllPlanetStates(time, observer);

  const sunGhaDeg = normalizeDeg(gmstDeg - sun.equatorial.rightAscensionHours * 15);
  const subsolar = getSubsolarPoint(sun.equatorial.declinationDeg, sunGhaDeg);

  const sunRadiusPx = Math.max(
    4,
    ((sun.angularSizeDeg ?? FALLBACK_SUN_ANGULAR_DEG) / 2) * pxPerDeg * ANGULAR_SIZE_VISUAL_BOOST
  );
  const moonRadiusPx = Math.max(
    4,
    ((moon.angularSizeDeg ?? FALLBACK_MOON_ANGULAR_DEG) / 2) * pxPerDeg * ANGULAR_SIZE_VISUAL_BOOST
  );

  const sunScreenP = raDecToScreen(sun.equatorial.rightAscensionHours, sun.equatorial.declinationDeg, gmstDeg, config);
  const moonScreenP = raDecToScreen(moon.equatorial.rightAscensionHours, moon.equatorial.declinationDeg, gmstDeg, config);

  ctx.fillStyle = SPACE_COLOR;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadiusPx, 0, Math.PI * 2);
  ctx.clip();

  ctx.save();
  ctx.translate(panXpx, panYpx);
  ctx.translate(centerX, centerY);
  ctx.rotate((sceneRotationDeg * Math.PI) / 180);
  ctx.translate(-centerX, -centerY);

  if (layers.land && calibration) {
    loadEarthImage();
    if (isEarthImageLoaded()) drawCalibratedEarthImage(ctx, calibration, config);
  }

  if (layers.terminator) {
    drawNightShading(ctx, subsolar.lat, subsolar.lon, config);
  }

  if (layers.tropics) drawTropics(ctx, config, layers.labels, zoomScale);
  if (layers.meridians) drawMeridians(ctx, config, layers.labels, zoomScale);
  if (layers.equatorialGrid) drawEquatorialGrid(ctx, gmstDeg, config, zoomScale);
  if (layers.ecliptic) drawEclipticLine(ctx, obliquityDeg, gmstDeg, config, zoomScale);

  if (layers.mansions) drawLunarMansions(ctx, obliquityDeg, gmstDeg, config, layers.labels, zoomScale);
  if (selectedMansionIndices.length) {
    drawSelectedMansions(ctx, obliquityDeg, gmstDeg, config, selectedMansionIndices, zoomScale);
  }

  if (layers.stars) drawStars(ctx, gmstDeg, config, layers.labels, zoomScale, selectedZodiacs.length > 0);
  if (selectedZodiacs.length) drawSelectedZodiacLines(ctx, selectedZodiacs, gmstDeg, config, zoomScale);

  if (layers.planets) drawPlanets(ctx, planets, gmstDeg, config, layers.labels, zoomScale);

  drawSun(ctx, sunScreenP, sunRadiusPx);
  drawMoon(ctx, moon, moonScreenP, sunScreenP, moonRadiusPx);

  if (layers.observerMarker) drawObserverMarker(ctx, observer, config, layers.labels, zoomScale);

  ctx.restore();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
  ctx.lineWidth = 3 * zoomScale;
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadiusPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const hitTargets = collectHitTargets(
    sun, sunScreenP, moon, moonScreenP, planets, gmstDeg, config, observer, layers.labels,
    sceneRotationDeg, panXpx, panYpx
  );

  return { sun, moon, planets, gmstDeg, hitTargets };
}

// ============================= طبقات الرسم =============================

function drawCalibratedEarthImage(ctx: CanvasRenderingContext2D, calibration: MapCalibration, config: PolarMapConfig) {
  const img = getEarthImage();
  if (!img) return;
  const imagePxPerColat = fitPixelsPerColatitude(calibration);
  const ourPxPerColat = config.outerRadiusPx / 180;
  const scale = ourPxPerColat / imagePxPerColat;
  const bearingDeg = greenwichBearingDeg(calibration) + calibration.rotationNudgeDeg + 180;
  ctx.save();
  ctx.translate(config.centerX, config.centerY);
  ctx.rotate((-bearingDeg * Math.PI) / 180);
  if (calibration.mirrored) ctx.scale(-1, 1);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -calibration.poleP.x, -calibration.poleP.y);
  ctx.restore();
}

const TROPIC_STYLES: { lat: number; color: string; label: string }[] = [
  { lat: TROPIC_OBLIQUITY, color: '#fb923c', label: 'مدار السرطان' },
  { lat: 0, color: '#f8fafc', label: 'خط الاستواء' },
  { lat: -TROPIC_OBLIQUITY, color: '#86efac', label: 'مدار الجدي' },
];

function drawTropics(ctx: CanvasRenderingContext2D, config: PolarMapConfig, showLabels: boolean, zoomScale: number) {
  ctx.save();
  ctx.lineWidth = 2.2 * zoomScale;
  TROPIC_STYLES.forEach(({ lat, color, label }) => {
    const r = ((90 - lat) / 180) * config.outerRadiusPx;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(config.centerX, config.centerY, r, 0, Math.PI * 2);
    ctx.stroke();
    if (showLabels) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.font = `bold ${9 * zoomScale}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(label, config.centerX + 4, config.centerY - r - 4);
    }
  });
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawMeridians(ctx: CanvasRenderingContext2D, config: PolarMapConfig, showLabels: boolean, zoomScale: number) {
  const count = 24;
  const path = new Path2D();
  const labels: { x: number; y: number; text: string }[] = [];
  for (let i = 0; i < count; i++) {
    const lon = (360 / count) * i;
    const edge = latLonToScreen(-90, lon, config);
    path.moveTo(config.centerX, config.centerY);
    path.lineTo(edge.x, edge.y);
    if (showLabels) {
      const labelPt = latLonToScreen(-80, lon, config);
      labels.push({ x: labelPt.x, y: labelPt.y, text: `${Math.round(lon)}°` });
    }
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.5)';
  ctx.lineWidth = 1.6 * zoomScale;
  ctx.stroke(path);
  if (showLabels) {
    ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
    ctx.font = `${9 * zoomScale}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    labels.forEach((l) => ctx.fillText(l.text, l.x, l.y));
  }
  ctx.restore();
}

function drawEquatorialGrid(ctx: CanvasRenderingContext2D, gmstDeg: number, config: PolarMapConfig, zoomScale: number) {
  const path = new Path2D();
  for (let raDeg = 0; raDeg < 360; raDeg += 1) {
    const raH = raDeg / 15;
    const edge = raDecToScreen(raH, -90, gmstDeg, config);
    path.moveTo(config.centerX, config.centerY);
    path.lineTo(edge.x, edge.y);
  }
  for (let dec = -89; dec <= 89; dec += 1) {
    const r = ((90 - dec) / 180) * config.outerRadiusPx;
    path.moveTo(config.centerX + r, config.centerY);
    path.arc(config.centerX, config.centerY, r, 0, Math.PI * 2);
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 0.5 * zoomScale;
  ctx.stroke(path);
  ctx.restore();
}

function drawEclipticLine(ctx: CanvasRenderingContext2D, obliquityDeg: number, gmstDeg: number, config: PolarMapConfig, zoomScale: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
  ctx.lineWidth = 1.5 * zoomScale;
  ctx.beginPath();
  for (let lon = 0; lon <= 360; lon += 3) {
    const { raHours, decDeg } = eclipticLongitudeToEquatorial(lon, obliquityDeg);
    const p = raDecToScreen(raHours, decDeg, gmstDeg, config);
    if (lon === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

const SEASON_COLORS: Record<string, string> = {
  spring: '#4ade80', summer: '#facc15', autumn: '#fb923c', winter: '#38bdf8',
};

function drawLunarMansions(
  ctx: CanvasRenderingContext2D, obliquityDeg: number, gmstDeg: number, config: PolarMapConfig,
  showLabels: boolean, zoomScale: number
) {
  if (!showLabels) return;
  const mansions = getAllLunarMansions();
  ctx.save();
  mansions.forEach((mansion) => {
    const midLon = mansion.startLongitudeDeg + MANSION_SPAN_DEG / 2;
    const mid = eclipticLongitudeToEquatorial(midLon, obliquityDeg);
    const p = raDecToScreen(mid.raHours, mid.decDeg, gmstDeg, config);
    ctx.fillStyle = SEASON_COLORS[mansion.season];
    ctx.font = `bold ${10 * zoomScale}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mansion.nameAr, p.x, p.y);
  });
  ctx.restore();
}

/** إبراز ذهبي لمنازل مُختارة: قوس مضيء يحدّد امتداد المنزلة على خط البروج + اسمها بارزاً */
function drawSelectedMansions(
  ctx: CanvasRenderingContext2D, obliquityDeg: number, gmstDeg: number, config: PolarMapConfig,
  selectedIndices: number[], zoomScale: number
) {
  const mansions = getAllLunarMansions();
  ctx.save();
  selectedIndices.forEach((idx) => {
    const mansion = mansions[idx];
    if (!mansion) return;

    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3 * zoomScale;
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 8 * zoomScale;
    ctx.beginPath();
    let started = false;
    for (let lon = mansion.startLongitudeDeg; lon <= mansion.endLongitudeDeg; lon += 1) {
      const { raHours, decDeg } = eclipticLongitudeToEquatorial(lon, obliquityDeg);
      const p = raDecToScreen(raHours, decDeg, gmstDeg, config);
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    const midLon = mansion.startLongitudeDeg + MANSION_SPAN_DEG / 2;
    const mid = eclipticLongitudeToEquatorial(midLon, obliquityDeg);
    const p = raDecToScreen(mid.raHours, mid.decDeg, gmstDeg, config);
    ctx.fillStyle = '#fde047';
    ctx.font = `bold ${12 * zoomScale}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mansion.nameAr, p.x, p.y - 12 * zoomScale);
  });
  ctx.restore();
}

function drawStars(
  ctx: CanvasRenderingContext2D, gmstDeg: number, config: PolarMapConfig,
  showLabels: boolean, zoomScale: number, hasZodiacSelection: boolean
) {
  const colorGroups = new Map<string, Path2D>();
  const labelTargets: { x: number; y: number; name: string }[] = [];

  for (const star of getLoadedStars()) {
    const p = raDecToScreen(star.ra, star.dec, gmstDeg, config);
    if (!p.visible) continue;
    const r = getStarRadiusPx(star.mag) * zoomScale;
    const color = getStarColor(star.spect);
    let path = colorGroups.get(color);
    if (!path) { path = new Path2D(); colorGroups.set(color, path); }
    path.moveTo(p.x + r, p.y);
    path.arc(p.x, p.y, r, 0, Math.PI * 2);

    if (!hasZodiacSelection && showLabels && zoomScale > 1.6 && star.mag < 1.8) {
      const name = getStarDisplayName(star);
      if (name) labelTargets.push({ x: p.x, y: p.y, name });
    }
  }

  ctx.save();
  ctx.globalAlpha = hasZodiacSelection ? 0.15 : 1;
  for (const [color, path] of colorGroups) {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;

  if (labelTargets.length) {
    ctx.font = `${10 * zoomScale}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
    labelTargets.forEach((t) => ctx.fillText(t.name, t.x + 6, t.y - 4));
  }
  ctx.restore();
}

function drawOneZodiac(ctx: CanvasRenderingContext2D, key: ZodiacKey, gmstDeg: number, config: PolarMapConfig, zoomScale: number) {
  const data = getLoadedZodiac()[key];
  if (!data) return;
  ctx.save();
  ctx.strokeStyle = '#facc15';
  ctx.fillStyle = '#fde047';
  ctx.lineWidth = 2 * zoomScale;
  ctx.shadowColor = '#facc15';
  ctx.shadowBlur = 6 * zoomScale;
  data.segments.forEach((seg) => {
    ctx.beginPath();
    let started = false;
    seg.forEach((pt) => {
      if (!pt) { started = false; return; }
      const p = raDecToScreen(pt[0], pt[1], gmstDeg, config);
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6 * zoomScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    ctx.stroke();
  });
  ctx.restore();
}

function drawSelectedZodiacLines(ctx: CanvasRenderingContext2D, keys: ZodiacKey[], gmstDeg: number, config: PolarMapConfig, zoomScale: number) {
  keys.forEach((key) => drawOneZodiac(ctx, key, gmstDeg, config, zoomScale));
}

function drawPlanets(
  ctx: CanvasRenderingContext2D, planets: { name: string; state: CelestialBodyState }[],
  gmstDeg: number, config: PolarMapConfig, showLabels: boolean, zoomScale: number
) {
  ctx.save();
  planets.forEach(({ name, state }) => {
    const p = raDecToScreen(state.equatorial.rightAscensionHours, state.equatorial.declinationDeg, gmstDeg, config);
    if (!p.visible) return;
    const color = PLANET_COLORS[name as keyof typeof PLANET_COLORS] ?? '#e2e8f0';
    const mag = state.magnitude ?? 2;
    const r = Math.max(1.8, 3.4 - mag * 0.25) * zoomScale;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6 * zoomScale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (showLabels) {
      ctx.font = `${10 * zoomScale}px system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(PLANET_LABELS_AR[name as keyof typeof PLANET_LABELS_AR] ?? name, p.x + 7, p.y - 4);
    }
  });
  ctx.restore();
}

function drawSun(ctx: CanvasRenderingContext2D, p: ProjectedPoint2D, radiusPx: number) {
  if (!p.visible) return;
  const glowRadius = radiusPx * 2.3;
  ctx.save();
  const grad = ctx.createRadialGradient(p.x, p.y, radiusPx * 0.3, p.x, p.y, glowRadius);
  grad.addColorStop(0, '#fffbeb');
  grad.addColorStop(0.3, '#fde047');
  grad.addColorStop(0.7, 'rgba(234, 179, 8, 0.3)');
  grad.addColorStop(1, 'rgba(234, 179, 8, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const MOON_MARIA: { dx: number; dy: number; r: number; alpha: number }[] = [
  { dx: -0.25, dy: -0.15, r: 0.32, alpha: 0.22 },
  { dx: 0.18, dy: -0.32, r: 0.22, alpha: 0.16 },
  { dx: -0.35, dy: 0.25, r: 0.28, alpha: 0.18 },
  { dx: 0.3, dy: 0.18, r: 0.2, alpha: 0.14 },
  { dx: 0.02, dy: 0.35, r: 0.18, alpha: 0.12 },
  { dx: -0.05, dy: -0.02, r: 0.14, alpha: 0.1 },
];

function drawMoon(ctx: CanvasRenderingContext2D, moon: CelestialBodyState, moonP: ProjectedPoint2D, sunP: ProjectedPoint2D, radiusPx: number) {
  if (!moonP.visible) return;
  const illum = moon.phaseFraction ?? 0.5;
  const ex = radiusPx * (2 * illum - 1);
  const sunDirAngle = Math.atan2(sunP.y - moonP.y, sunP.x - moonP.x);

  ctx.save();
  ctx.translate(moonP.x, moonP.y);
  ctx.rotate(sunDirAngle);

  ctx.beginPath();
  ctx.arc(0, 0, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = '#12121a';
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, -radiusPx);
  ctx.arc(0, 0, radiusPx, -Math.PI / 2, Math.PI / 2, false);
  ctx.ellipse(0, 0, Math.abs(ex), radiusPx, 0, Math.PI / 2, -Math.PI / 2, ex < 0);
  ctx.closePath();
  ctx.clip();

  const base = ctx.createRadialGradient(-radiusPx * 0.3, -radiusPx * 0.3, radiusPx * 0.05, 0, 0, radiusPx);
  base.addColorStop(0, '#f5f5f1');
  base.addColorStop(0.6, '#d6d6d1');
  base.addColorStop(1, '#98988f');
  ctx.beginPath();
  ctx.arc(0, 0, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = base;
  ctx.fill();

  MOON_MARIA.forEach((m) => {
    const mx = m.dx * radiusPx, my = m.dy * radiusPx, mr = m.r * radiusPx;
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
    g.addColorStop(0, `rgba(55, 60, 70, ${m.alpha})`);
    g.addColorStop(1, 'rgba(55, 60, 70, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, radiusPx, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
  ctx.lineWidth = Math.max(0.6, radiusPx * 0.05);
  ctx.stroke();

  ctx.restore();
}

function drawObserverMarker(ctx: CanvasRenderingContext2D, observer: ObserverLocation, config: PolarMapConfig, showLabels: boolean, zoomScale: number) {
  const p = latLonToScreen(observer.latitudeDeg, observer.longitudeDeg, config);
  if (!p.visible) return;
  ctx.save();
  ctx.fillStyle = '#f87171';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.2 * zoomScale;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 4 * zoomScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (showLabels) {
    ctx.font = `${10 * zoomScale}px system-ui, sans-serif`;
    ctx.fillStyle = '#fca5a5';
    ctx.fillText('موقعي', p.x + 7, p.y + 3);
  }
  ctx.restore();
}

// ============================= بطاقات التحويم =============================

function applySceneTransform(p: ProjectedPoint2D, cx: number, cy: number, rotationDeg: number, panXpx: number, panYpx: number) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return { x: cx + rx + panXpx, y: cy + ry + panYpx };
}

function collectHitTargets(
  sun: CelestialBodyState, sunP: ProjectedPoint2D, moon: CelestialBodyState, moonP: ProjectedPoint2D,
  planets: { name: string; state: CelestialBodyState }[], gmstDeg: number, config: PolarMapConfig,
  observer: ObserverLocation, showLabels: boolean, sceneRotationDeg: number, panXpx: number, panYpx: number
): HitTarget[] {
  const targets: HitTarget[] = [];
  if (!showLabels) return targets;

  const project = (p: ProjectedPoint2D) => applySceneTransform(p, config.centerX, config.centerY, sceneRotationDeg, panXpx, panYpx);

  if (sunP.visible) {
    const content = getContent(getContentId('sun', 'sun'));
    const screen = project(sunP);
    targets.push({
      x: screen.x, y: screen.y, name: content?.nameAr ?? 'الشمس',
      detail: `ميل ${sun.equatorial.declinationDeg.toFixed(1)}° · م.م ${sun.equatorial.rightAscensionHours.toFixed(2)}س`,
      description: content?.description, audioUrl: content?.audioUrl,
    });
  }
  if (moonP.visible) {
    const content = getContent(getContentId('moon', 'moon'));
    const screen = project(moonP);
    targets.push({
      x: screen.x, y: screen.y, name: content?.nameAr ?? 'القمر',
      detail: `إضاءة ${Math.round((moon.phaseFraction ?? 0) * 100)}% · ميل ${moon.equatorial.declinationDeg.toFixed(1)}°`,
      description: content?.description, audioUrl: content?.audioUrl,
    });
  }

  planets.forEach(({ name, state }) => {
    const p = raDecToScreen(state.equatorial.rightAscensionHours, state.equatorial.declinationDeg, gmstDeg, config);
    if (!p.visible) return;
    const nameAr = PLANET_LABELS_AR[name as keyof typeof PLANET_LABELS_AR] ?? name;
    const content = getContent(getContentId('planet', name));
    const screen = project(p);
    targets.push({
      x: screen.x, y: screen.y, name: content?.nameAr ?? nameAr,
      detail: `ميل ${state.equatorial.declinationDeg.toFixed(1)}° · م.م ${state.equatorial.rightAscensionHours.toFixed(2)}س`,
      description: content?.description, audioUrl: content?.audioUrl,
    });
  });

  for (const star of getLoadedStars()) {
    if (star.mag >= 1.8) continue;
    const name = getStarDisplayName(star);
    if (!name) continue;
    const p = raDecToScreen(star.ra, star.dec, gmstDeg, config);
    if (!p.visible) continue;
    const content = getContent(getContentId('star', name));
    const screen = project(p);
    targets.push({
      x: screen.x, y: screen.y, name: content?.nameAr ?? name,
      detail: `قدر ${star.mag.toFixed(1)} · ميل ${star.dec.toFixed(1)}°`,
      description: content?.description, audioUrl: content?.audioUrl,
    });
  }

  const obsP = latLonToScreen(observer.latitudeDeg, observer.longitudeDeg, config);
  if (obsP.visible) {
    const screen = project(obsP);
    targets.push({ x: screen.x, y: screen.y, name: 'موقعي', detail: `${observer.latitudeDeg.toFixed(2)}°, ${observer.longitudeDeg.toFixed(2)}°` });
  }

  return targets;
}

function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}
