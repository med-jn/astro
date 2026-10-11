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
import { getLoadedStars, getStarColor, getStarRadiusPx, getStarDisplayName, getStarByIdMap } from '../core/starCatalog';
import { getLoadedZodiac, type ZodiacKey } from '../core/zodiac';
import { getGroupLines, getGroupById, computeGroupCenter } from '../core/starGroups';
import { getEarthImage, EARTH_IMAGE_MAX_RADIUS_PX } from '../core/earthImage';
import {
  drawEarthVectorSmart, drawTimeZoneBoundaries, ensureEarthVectorLoading, ensureTimeZonesLoading,
  isEarthVectorReady, type ViewportInfo,
} from '../core/vectorMap';
import { drawGeoGrid, drawNominalTimeZones, TIMEZONE_COLOR } from './geoGrid';
import { drawNightShadingSmooth } from './nightShade';
import { drawObserverDome, type DomeTarget } from './observerDome';
import { fillTextUpright, setSceneRotationRad } from './uprightText';
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
  /** معرّفات الكوكبات (groups) المُبرزة حالياً — تُرسَم بخطوطها الحقيقية بين نجومها */
  selectedGroupIds: number[];
  /** النجمة المحدَّدة من البحث (id داخلي) — تُحاط بعلامة تصويب رباعية */
  highlightedStarId?: number | null;
  sceneRotationDeg?: number;
  panX?: number;
  panY?: number;
  /** نوع خطوط التوقيت: اسمية (24 خطاً كل 15°) أو حدود المناطق الزمنية الفعلية للدول */
  timeZoneKind?: 'nominal' | 'legal';
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

/** أقصى تكبير تنمو معه أحجام الخطوط والنصوص والنقاط (يطابق السلوك السابق حتى 6x). فوقه تبقى
 *  الأحجام ثابتة، وإلا صار الخط 160px والشمس بحجم الشاشة عند 100x. الهندسة نفسها (القرص) تكبر بلا حد. */
const UI_ZOOM_CAP = 6;
/** الانتقال من الصورة إلى الرسم المتجهي يتحدد بدقة الصورة نفسها لا برقم تكبير ثابت:
 *  النسبة = (نصف قطر القرص بكسل الجهاز) ÷ (نصف قطر أكبر صورة). تحت ~0.85 الصورة كافية وأخف،
 *  وفوق ~1.25 تصبح مبكسلة فيحل المتجه محلها كلياً. وهكذا يبدأ المتجه متأخراً على الشاشات الكبيرة
 *  ومبكراً على الشاشات عالية الكثافة، ولا يُحمَّل شيء قبل أن يلزم. */
const VECTOR_LOAD_RATIO = 0.4;
const VECTOR_FADE_START_RATIO = 0.85;
const VECTOR_FADE_END_RATIO = 1.25;
/** 'smooth' = تظليل تحليلي ناعم يصلح لأي تكبير، 'legacy' = الخلايا القطبية القديمة (core/terminator) */
const NIGHT_SHADING_MODE: 'smooth' | 'legacy' = 'smooth';
const SPACE_COLOR = '#000000';

/** لون التمييز الوحيد للخطوط والإبرازات — برونز مطفأ، بلا تعدد ألوان صاخب */
const ACCENT_LINE = '#b08d57';
const ACCENT_LINE_BRIGHT = '#d4b688';

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
    date, observer, zoomScale, layers, selectedZodiacs, selectedMansionIndices, selectedGroupIds, highlightedStarId = null,
    sceneRotationDeg = 0, panX = 0, panY = 0, timeZoneKind = 'nominal',
  } = input;
  const time = Astronomy.MakeTime(date);
  const gmstDeg = getGMSTDeg(time);
  const obliquityDeg = getMeanObliquityDeg(time);

  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadiusPx = computeOuterRadiusPx(width, height, zoomScale);
  const config: PolarMapConfig = { centerX, centerY, outerRadiusPx };
  // الأحجام المرئية (خطوط/نصوص/نقاط/الشمس والقمر) تتبع uiScale المحدود، أما القرص فيتبع zoomScale
  const uiScale = Math.min(zoomScale, UI_ZOOM_CAP);
  const pxPerDeg = computeOuterRadiusPx(width, height, uiScale) / 180;
  setSceneRotationRad((sceneRotationDeg * Math.PI) / 180);

  const panXpx = panX * outerRadiusPx;
  const panYpx = panY * outerRadiusPx;
  // مركز القرص الفعلي على الشاشة (القطب الشمالي): ينزاح مع التحريك، فيتحرك القرص كله (الخريطة
  // + دائرة القص + إطار الحافة) معاً كما في Google Earth بدل أن تنزاح الخريطة تحت دائرة ثابتة.
  const discCenterX = centerX + panXpx;
  const discCenterY = centerY + panYpx;

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
  ctx.arc(discCenterX, discCenterY, outerRadiusPx, 0, Math.PI * 2);
  ctx.clip();

  ctx.save();
  ctx.translate(panXpx, panYpx);
  ctx.translate(centerX, centerY);
  ctx.rotate((sceneRotationDeg * Math.PI) / 180);
  ctx.translate(-centerX, -centerY);

  const viewport: ViewportInfo = { width, height, sceneRotationDeg, panXpx, panYpx };

  if (layers.land) drawLand(ctx, config, viewport);

  if (layers.terminator) {
    if (NIGHT_SHADING_MODE === 'smooth') drawNightShadingSmooth(ctx, subsolar.lat, subsolar.lon, config);
    else drawNightShading(ctx, subsolar.lat, subsolar.lon, config);
  }

  if (layers.meridians || layers.gridFull) {
    drawGeoGrid(ctx, config, { ten: layers.meridians, full: layers.gridFull, labels: layers.labels }, uiScale);
  }
  if (layers.tropics) drawTropics(ctx, config, layers.labels, uiScale);
  if (layers.timeZones) drawTimeZones(ctx, config, viewport, timeZoneKind, uiScale);
  if (layers.equatorialGrid) drawEquatorialGrid(ctx, gmstDeg, config, uiScale);
  if (layers.ecliptic) drawEclipticLine(ctx, obliquityDeg, gmstDeg, config, uiScale);

  if (layers.mansions) drawLunarMansions(ctx, obliquityDeg, gmstDeg, config, layers.labels, uiScale);
  if (selectedMansionIndices.length) {
    drawSelectedMansions(ctx, obliquityDeg, gmstDeg, config, selectedMansionIndices, uiScale);
  }

  if (layers.stars) drawStars(ctx, gmstDeg, config, layers.labels, uiScale, selectedZodiacs.length > 0);
  if (selectedZodiacs.length) drawSelectedZodiacLines(ctx, selectedZodiacs, gmstDeg, config, uiScale);
  if (selectedGroupIds.length) drawSelectedGroups(ctx, selectedGroupIds, gmstDeg, config, uiScale);

  if (highlightedStarId != null) drawStarReticle(ctx, highlightedStarId, gmstDeg, config, uiScale);

  if (layers.planets) drawPlanets(ctx, planets, gmstDeg, config, layers.labels, uiScale, time);

  drawSun(ctx, sunScreenP, sunRadiusPx);
  drawMoon(ctx, moon, moonScreenP, sunScreenP, moonRadiusPx);

  if (layers.observerMarker) drawObserverMarker(ctx, observer, config, layers.labels, uiScale);

  // قبة الراصد فوق كل شيء: سماؤه المحلية بكل الأجرام، وتدور مع المشهد (أسماؤها تبقى أفقية)
  let domeTargets: DomeTarget[] = [];
  if (layers.observerDome) {
    domeTargets = drawObserverDome(
      ctx, config,
      {
        observer, gmstDeg, obliquityDeg, sun, moon, planets,
        selectedZodiacs, selectedMansionIndices, selectedGroupIds, highlightedStarId,
        showEcliptic: layers.ecliptic, showMansionNames: layers.mansions && layers.labels, labels: layers.labels,
      },
      uiScale,
      { drawSun, drawMoon, drawPlanetDot }
    );
  }

  ctx.restore();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
  ctx.lineWidth = 3 * uiScale;
  ctx.beginPath();
  ctx.arc(discCenterX, discCenterY, outerRadiusPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const hitTargets = collectHitTargets(
    sun, sunScreenP, moon, moonScreenP, planets, gmstDeg, config, observer, layers.labels,
    sceneRotationDeg, panXpx, panYpx
  );

  if (layers.observerDome && layers.labels) {
    for (const t of domeTargets) {
      const s = applySceneTransform({ x: t.x, y: t.y, visible: true }, centerX, centerY, sceneRotationDeg, panXpx, panYpx);
      hitTargets.push({ x: s.x, y: s.y, name: t.name, detail: t.detail });
    }
  }

  return { sun, moon, planets, gmstDeg, hitTargets };
}

// ============================= طبقات الرسم =============================

/** صورة 8K عند التصغير، والرسم المتجهي (دقة غير محدودة) عند التقريب، مع انتقال تدريجي بينهما */
function drawLand(ctx: CanvasRenderingContext2D, config: PolarMapConfig, vp: ViewportInfo) {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const ratio = (config.outerRadiusPx * dpr) / EARTH_IMAGE_MAX_RADIUS_PX;
  if (ratio >= VECTOR_LOAD_RATIO) ensureEarthVectorLoading();
  const alpha = Math.min(1, Math.max(0, (ratio - VECTOR_FADE_START_RATIO) / (VECTOR_FADE_END_RATIO - VECTOR_FADE_START_RATIO)));
  if (alpha <= 0 || !isEarthVectorReady()) {
    drawEarthMap(ctx, config);
    return;
  }
  drawEarthVectorSmart(ctx, config, vp, alpha, () => drawEarthMap(ctx, config));
}

function drawTimeZones(
  ctx: CanvasRenderingContext2D, config: PolarMapConfig, vp: ViewportInfo,
  kind: 'nominal' | 'legal', uiScale: number
) {
  if (kind === 'legal') {
    ensureTimeZonesLoading();
    // أثناء تحميل البيانات (أو تعذره) نعرض الخطوط الاسمية بدل شاشة فارغة
    if (drawTimeZoneBoundaries(ctx, config, vp, TIMEZONE_COLOR, 1.3 * Math.min(uiScale, 2.5))) return;
  }
  drawNominalTimeZones(ctx, config, vp, uiScale);
}

/**
 * خريطة الأرض المولَّدة: مركزها مركز القبة ونصف قطرها outerRadiusPx، فتُرسم في مربع القبة مباشرة.
 * (التوليد في scripts/build-world-map.mjs بنفس معادلات latLonToScreen — لا معايرة ولا إزاحات.)
 */
function drawEarthMap(ctx: CanvasRenderingContext2D, config: PolarMapConfig) {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const img = getEarthImage(config.outerRadiusPx * 2 * dpr);
  if (!img) return;
  const r = config.outerRadiusPx;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, config.centerX - r, config.centerY - r, r * 2, r * 2);
  ctx.restore();
}

/** ثلاث درجات محايدة (فاتح/برونزي/رمادي فولاذي) بدل ثلاثة ألوان أساسية صاخبة — تمايز بالإضاءة لا بالصبغة */
const TROPIC_STYLES: { lat: number; color: string; label: string }[] = [
  { lat: TROPIC_OBLIQUITY, color: '#b08d57', label: 'مدار السرطان' },
  { lat: 0, color: '#d8dde3', label: 'خط الاستواء' },
  { lat: -TROPIC_OBLIQUITY, color: '#7c95a8', label: 'مدار الجدي' },
];

function drawTropics(ctx: CanvasRenderingContext2D, config: PolarMapConfig, showLabels: boolean, zoomScale: number) {
  ctx.save();
  ctx.lineWidth = 2.2 * zoomScale;
  TROPIC_STYLES.forEach(({ lat, color, label }) => {
    const r = ((90 - lat) / 180) * config.outerRadiusPx;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(config.centerX, config.centerY, r, 0, Math.PI * 2);
    ctx.stroke();
    if (showLabels) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.font = `bold ${9 * zoomScale}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      fillTextUpright(ctx, label, config.centerX, config.centerY - r, 4, -4);
    }
  });
  ctx.globalAlpha = 1;
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
  ctx.strokeStyle = 'rgba(176, 141, 87, 0.55)';
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

/** أربع درجات محايدة (لا أخضر/أصفر/برتقالي/أزرق صريحة) — التمايز الموسمي بالإضاءة والدفء لا بالصبغة الصارخة */
const SEASON_COLORS: Record<string, string> = {
  spring: '#8fa39b', summer: '#c9ac78', autumn: '#a8836a', winter: '#7f93a8',
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
    fillTextUpright(ctx, mansion.nameAr, p.x, p.y);
  });
  ctx.restore();
}

/** إبراز المنازل المختارة بلون التمييز الوحيد للتطبيق (برونز) بدل الأصفر الصريح */
function drawSelectedMansions(
  ctx: CanvasRenderingContext2D, obliquityDeg: number, gmstDeg: number, config: PolarMapConfig,
  selectedIndices: number[], zoomScale: number
) {
  const mansions = getAllLunarMansions();
  ctx.save();
  selectedIndices.forEach((idx) => {
    const mansion = mansions[idx];
    if (!mansion) return;

    ctx.strokeStyle = ACCENT_LINE;
    ctx.lineWidth = 3 * zoomScale;
    ctx.shadowColor = ACCENT_LINE;
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
    ctx.fillStyle = ACCENT_LINE_BRIGHT;
    ctx.font = `bold ${12 * zoomScale}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fillTextUpright(ctx, mansion.nameAr, p.x, p.y, 0, -12 * zoomScale);
  });
  ctx.restore();
}

/** حد أدنى لنصف قطر النجم على الشاشة بالبكسل — يمنع اختفاءه عند التصغير دون تكبيره فعلياً */
const MIN_STAR_SCREEN_RADIUS_PX = 0.6;
/** حد القدر الذي تُعتبر النجوم أعلى منه سطوعاً "ساطعة" فتُمنح وهجاً ناعماً إضافياً */
const BRIGHT_STAR_GLOW_MAG_THRESHOLD = 2.3;

function drawStars(
  ctx: CanvasRenderingContext2D, gmstDeg: number, config: PolarMapConfig,
  showLabels: boolean, zoomScale: number, hasZodiacSelection: boolean
) {
  const colorGroups = new Map<string, Path2D>();
  const labelTargets: { x: number; y: number; name: string }[] = [];
  const brightStars: { x: number; y: number; r: number; color: string }[] = [];

  for (const star of getLoadedStars()) {
    const p = raDecToScreen(star.ra, star.dec, gmstDeg, config);
    if (!p.visible) continue;
    const r = Math.max(MIN_STAR_SCREEN_RADIUS_PX, getStarRadiusPx(star.mag) * zoomScale);
    const color = getStarColor(star.spect);
    let path = colorGroups.get(color);
    if (!path) { path = new Path2D(); colorGroups.set(color, path); }
    path.moveTo(p.x + r, p.y);
    path.arc(p.x, p.y, r, 0, Math.PI * 2);

    if (star.mag < BRIGHT_STAR_GLOW_MAG_THRESHOLD) {
      brightStars.push({ x: p.x, y: p.y, r, color });
    }

    if (!hasZodiacSelection && showLabels && zoomScale > 1.6 && star.mag < 1.8) {
      const name = getStarDisplayName(star);
      if (name) labelTargets.push({ x: p.x, y: p.y, name });
    }
  }

  ctx.save();
  const alpha = hasZodiacSelection ? 0.15 : 1;

  // وهج ناعم خلف النجوم الساطعة فقط (تتلاشى تدريجياً بلا حافة) — يمنحها بريقاً واضحاً يحاكي
  // الرؤية الفعلية بالعين المجردة، دون أن يزيد القرص الصلب نفسه حجماً واحداً، فتبقى دائماً
  // أصغر من أي كوكب (انظر drawPlanetDot حيث الحد الأدنى لنصف قطر الكوكب أكبر من هذا دائماً)
  if (brightStars.length) {
    ctx.globalAlpha = alpha * 0.35;
    brightStars.forEach(({ x, y, r, color }) => {
      const glowR = r * 2.4;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, glowR);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.globalAlpha = alpha;
  for (const [color, path] of colorGroups) {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;

  if (labelTargets.length) {
    ctx.font = `${10 * zoomScale}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
    labelTargets.forEach((t) => fillTextUpright(ctx, t.name, t.x, t.y, 6, -4));
  }
  ctx.restore();
}

function drawOneZodiac(ctx: CanvasRenderingContext2D, key: ZodiacKey, gmstDeg: number, config: PolarMapConfig, zoomScale: number) {
  const data = getLoadedZodiac()[key];
  if (!data) return;
  ctx.save();
  ctx.strokeStyle = ACCENT_LINE;
  ctx.fillStyle = ACCENT_LINE_BRIGHT;
  ctx.lineWidth = 2 * zoomScale;
  ctx.shadowColor = ACCENT_LINE;
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
      ctx.arc(p.x, p.y, 1.1 * zoomScale, 0, Math.PI * 2);
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

/**
 * يرسم كوكبة واحدة مُختارة بخطوطها الحقيقية بين نجومها الفعلية (group_lines من سوبابيز،
 * تصل بين hip_from/hip_to حيث hip هنا هو نفس id الداخلي لكتالوج stars.json المحلي — انظر
 * التعليق التوضيحي في starGroups.ts). يُبنى فهرس بحث سريع (Map) من الكتالوج مرة واحدة لكل
 * كوكبة بدل بحث خطي متكرر لكل خط.
 */
function drawOneGroup(ctx: CanvasRenderingContext2D, groupId: number, gmstDeg: number, config: PolarMapConfig, zoomScale: number) {
  const lines = getGroupLines(groupId);
  if (lines.length === 0) return;

  const starById = getStarByIdMap(); // خريطة مخزّنة مرة واحدة، لا إعادة بناء كل إطار

  // خطوط رفيعة بيضاء شبه شفافة، مقصوصة عند طرفيها بفراغ صغير عن النجمة كي لا تغطيها،
  // وبلا نقاط ولا توهّج فوق النجوم نفسها
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = Math.min(1.3, 0.8 + 0.2 * zoomScale);
  ctx.lineCap = 'butt';
  const GAP_PX = 4 + 1.5 * zoomScale;
  const seen = new Set<string>();

  lines.forEach(({ hipFrom, hipTo }) => {
    if (hipFrom === hipTo) return;
    const key = hipFrom < hipTo ? `${hipFrom}-${hipTo}` : `${hipTo}-${hipFrom}`;
    if (seen.has(key)) return; // خط مكرر (أو معكوس) يُرسم مرة واحدة فقط
    seen.add(key);

    const starFrom = starById.get(hipFrom);
    const starTo = starById.get(hipTo);
    if (!starFrom || !starTo) return; // عضو غير موجود في الكتالوج المحلي — تجاهل هذا الخط بأمان

    const pFrom = raDecToScreen(starFrom.ra, starFrom.dec, gmstDeg, config);
    const pTo = raDecToScreen(starTo.ra, starTo.dec, gmstDeg, config);
    if (!pFrom.visible && !pTo.visible) return;

    const dx = pTo.x - pFrom.x;
    const dy = pTo.y - pFrom.y;
    const len = Math.hypot(dx, dy);
    if (len <= GAP_PX * 2 + 1) return; // أقصر من أن يتسع لفراغي الطرفين
    const ux = dx / len;
    const uy = dy / len;

    ctx.beginPath();
    ctx.moveTo(pFrom.x + ux * GAP_PX, pFrom.y + uy * GAP_PX);
    ctx.lineTo(pTo.x - ux * GAP_PX, pTo.y - uy * GAP_PX);
    ctx.stroke();
  });
  ctx.restore();

  const group = getGroupById(groupId);
  const center = computeGroupCenter(groupId);
  if (group && center) {
    const p = raDecToScreen(center.raHours, center.decDeg, gmstDeg, config);
    if (p.visible) {
      ctx.save();
      ctx.fillStyle = ACCENT_LINE_BRIGHT;
      ctx.font = `bold ${12 * zoomScale}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fillTextUpright(ctx, group.nameAr, p.x, p.y);
      ctx.restore();
    }
  }
}

/**
 * علامة تصويب على النجمة المحدَّدة (على طراز ستيلاريوم): أربعة أضلاع قصيرة متعامدة تحيط بها
 * وتترك فراغاً في الوسط، بلون التمييز، مع نبض خفيف يلفت النظر.
 */
function drawStarReticle(ctx: CanvasRenderingContext2D, starId: number, gmstDeg: number, config: PolarMapConfig, zoomScale: number) {
  const star = getStarByIdMap().get(starId);
  if (!star) return;
  const p = raDecToScreen(star.ra, star.dec, gmstDeg, config);
  if (!p.visible) return;

  // نبض بطيء (دورة ~4 ثوانٍ) على الفراغ والشفافية معاً
  const t = (Math.sin(Date.now() / 640) + 1) / 2; // 0..1
  const gap = 6 + 1.2 * zoomScale + 2 * t;
  const len = 5 + 0.8 * zoomScale;
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = 0.65 + 0.35 * (1 - t);
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(p.x - gap - len, p.y); ctx.lineTo(p.x - gap, p.y);
  ctx.moveTo(p.x + gap, p.y);       ctx.lineTo(p.x + gap + len, p.y);
  ctx.moveTo(p.x, p.y - gap - len); ctx.lineTo(p.x, p.y - gap);
  ctx.moveTo(p.x, p.y + gap);       ctx.lineTo(p.x, p.y + gap + len);
  ctx.stroke();
  ctx.restore();
}

function drawSelectedGroups(ctx: CanvasRenderingContext2D, groupIds: number[], gmstDeg: number, config: PolarMapConfig, zoomScale: number) {
  groupIds.forEach((id) => drawOneGroup(ctx, id, gmstDeg, config, zoomScale));
}

// ============================= الكواكب: الرسم الأساسي =============================

/** نقطة الكوكب البسيطة (كل الكواكب عدا زحل الذي له رسم خاص بالحلقات) */
function drawPlanetDot(ctx: CanvasRenderingContext2D, p: ProjectedPoint2D, r: number, color: string, zoomScale: number) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6 * zoomScale;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ============================= حلقات زحل (هندسة فلكية حقيقية) =============================

interface Vec3 { x: number; y: number; z: number; }

function vecLen(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function vecToRaDec(v: Vec3): { raHours: number; decDeg: number } {
  const len = vecLen(v);
  const raRad = Math.atan2(v.y, v.x);
  let raHours = (raRad * 12) / Math.PI;
  if (raHours < 0) raHours += 24;
  const decDeg = (Math.asin(Math.max(-1, Math.min(1, v.z / len))) * 180) / Math.PI;
  return { raHours, decDeg };
}

/**
 * يحسب من متجه وحدة أساسي (اتجاه الرصد نحو الجرم) نقطة قريبة زاوياً على القبة السماوية
 * باتجاه المركبة المماسية لمتجه ثانٍ (مثل محور دوران الكوكب) — تُستخدم لاحقاً لتحديد
 * اتجاه "الأعلى" الظاهري لذلك المحور على الشاشة عبر إسقاطه بنفس دالة raDecToScreen.
 */
function tangentialOffsetPoint(baseHat: Vec3, targetHat: Vec3, epsRad: number): { point: Vec3; dot: number } {
  const dot = baseHat.x * targetHat.x + baseHat.y * targetHat.y + baseHat.z * targetHat.z;
  let tx = targetHat.x - dot * baseHat.x;
  let ty = targetHat.y - dot * baseHat.y;
  let tz = targetHat.z - dot * baseHat.z;
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen > 1e-9) { tx /= tLen; ty /= tLen; tz /= tLen; }
  const cosE = Math.cos(epsRad);
  const sinE = Math.sin(epsRad);
  return {
    dot,
    point: {
      x: baseHat.x * cosE + tx * sinE,
      y: baseHat.y * cosE + ty * sinE,
      z: baseHat.z * cosE + tz * sinE,
    },
  };
}

interface SaturnRingParams {
  /** نسبة انضغاط الحلقة البيضاوية (0 = تُرى من حرفها كخط، 1 = تُرى من فوق القطب كدائرة كاملة) */
  openRatio: number;
  /** زاوية اتجاه محور الانضغاط (اتجاه القطب) على الشاشة، بالراديان */
  minorAxisAngleRad: number;
  /** هل القطب الشمالي هو المائل نحو الراصد؟ يحدد أي نصفي الحلقة يمر أمام قرص الكوكب */
  ringNorthTowardEarth: boolean;
}

/**
 * زاوية فتحة حلقات زحل واتجاهها الحقيقيان كما تُريان من الأرض في هذه اللحظة بالضبط،
 * محسوبتان من محور دوران زحل الفعلي (Astronomy.RotationAxis) لا من رقم ثابت مُقدَّر.
 * نستخدم فارق الزاوية (delta) بين حساباتنا المستقلة هنا وموضع الكوكب الرسمي المعروض
 * فعلياً على الشاشة، بدل الاعتماد على موضع مطلق، لتفادي أي فارق طفيف في إطار الإحداثيات.
 */
function computeSaturnRingParams(
  time: Astronomy.AstroTime,
  gmstDeg: number,
  config: PolarMapConfig,
  officialRaHours: number,
  officialDecDeg: number
): SaturnRingParams {
  const saturnGeo = Astronomy.GeoVector(Astronomy.Body.Saturn, time, true);
  const axis = Astronomy.RotationAxis(Astronomy.Body.Saturn, time);

  const sLen = vecLen(saturnGeo as unknown as Vec3);
  const sHat: Vec3 = { x: saturnGeo.x / sLen, y: saturnGeo.y / sLen, z: saturnGeo.z / sLen };
  const poleHat: Vec3 = { x: axis.north.x, y: axis.north.y, z: axis.north.z };

  const { dot, point: offsetPoint } = tangentialOffsetPoint(sHat, poleHat, 0.02);
  const sinOpeningAngle = -dot;
  const openRatio = Math.max(0.06, Math.min(1, Math.abs(sinOpeningAngle)));

  const baseRD = vecToRaDec(sHat);
  const poleRD = vecToRaDec(offsetPoint);
  const deltaRaDeg = (poleRD.raHours - baseRD.raHours) * 15;
  const deltaDecDeg = poleRD.decDeg - baseRD.decDeg;

  const matchedPoleRaHours = officialRaHours + deltaRaDeg / 15;
  const matchedPoleDecDeg = officialDecDeg + deltaDecDeg;

  const officialScreen = raDecToScreen(officialRaHours, officialDecDeg, gmstDeg, config);
  const poleScreen = raDecToScreen(matchedPoleRaHours, matchedPoleDecDeg, gmstDeg, config);

  const minorAxisAngleRad = Math.atan2(poleScreen.y - officialScreen.y, poleScreen.x - officialScreen.x);

  return { openRatio, minorAxisAngleRad, ringNorthTowardEarth: sinOpeningAngle > 0 };
}

function drawSaturnWithRings(
  ctx: CanvasRenderingContext2D, p: ProjectedPoint2D, r: number,
  ringParams: SaturnRingParams, color: string, zoomScale: number
) {
  const { openRatio, minorAxisAngleRad, ringNorthTowardEarth } = ringParams;
  const majorAxisAngle = minorAxisAngleRad + Math.PI / 2;

  const ringOuter = r * 2.35;
  const ringInner = r * 1.35;
  const ry = ringOuter * openRatio;
  const ryInner = ringInner * openRatio;

  // الجزء الخلفي من الحلقة (خلف قرص الكوكب)
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(majorAxisAngle);
  ctx.beginPath();
  ctx.ellipse(0, 0, ringOuter, ry, 0, 0, Math.PI * 2);
  ctx.ellipse(0, 0, ringInner, ryInner, 0, 0, Math.PI * 2);
  ctx.clip('evenodd');
  const backGrad = ctx.createLinearGradient(-ringOuter, 0, ringOuter, 0);
  backGrad.addColorStop(0, 'rgba(196,176,138,0.55)');
  backGrad.addColorStop(0.5, 'rgba(224,204,166,0.7)');
  backGrad.addColorStop(1, 'rgba(196,176,138,0.55)');
  ctx.fillStyle = backGrad;
  ctx.fillRect(-ringOuter, -ry, ringOuter * 2, ry * 2);
  ctx.restore();

  // قرص الكوكب نفسه فوق الجزء الخلفي من الحلقة
  drawPlanetDot(ctx, p, r, color, zoomScale);

  // الشريط الأمامي: النصف الأقرب للراصد يُعاد رسمه فوق قرص الكوكب لإيهام الإحاطة به
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(majorAxisAngle);
  ctx.beginPath();
  ctx.ellipse(0, 0, ringOuter, ry, 0, 0, Math.PI * 2);
  ctx.ellipse(0, 0, ringInner, ryInner, 0, 0, Math.PI * 2);
  ctx.clip('evenodd');
  ctx.beginPath();
  if (ringNorthTowardEarth) ctx.rect(-ringOuter, 0, ringOuter * 2, ry + 1);
  else ctx.rect(-ringOuter, -ry - 1, ringOuter * 2, ry + 1);
  ctx.clip();
  const frontGrad = ctx.createLinearGradient(-ringOuter, 0, ringOuter, 0);
  frontGrad.addColorStop(0, 'rgba(208,190,150,0.9)');
  frontGrad.addColorStop(0.5, 'rgba(238,222,184,1)');
  frontGrad.addColorStop(1, 'rgba(208,190,150,0.9)');
  ctx.fillStyle = frontGrad;
  ctx.fillRect(-ringOuter, -ry, ringOuter * 2, ry * 2);
  ctx.restore();
}

// ============================= أقمار المشتري الأربعة الكبرى =============================

/** قدر ظاهري تقريبي عند التقابل — تفاوت الأقمار الفعلي عادة أقل من نصف قدر فلا يغيّر نتيجة اختبار الرؤية بالعين المجردة */
const GALILEAN_MOONS: { key: 'io' | 'europa' | 'ganymede' | 'callisto'; nameAr: string; approxMag: number }[] = [
  { key: 'io', nameAr: 'آيو', approxMag: 5.0 },
  { key: 'europa', nameAr: 'أوروبا', approxMag: 5.3 },
  { key: 'ganymede', nameAr: 'غانيميد', approxMag: 4.6 },
  { key: 'callisto', nameAr: 'كاليستو', approxMag: 5.7 },
];

/** حد رؤية العين المجردة المُعتمَد في هذا التطبيق (مطابق لتصفية كتالوج النجوم نفسه: mag <= 6.5) */
const NAKED_EYE_LIMIT_MAG = 6.5;

/**
 * يرسم أقمار المشتري الأربعة الكبرى (غاليليو) إن كانت أقدارها الظاهرية التقريبية
 * ضمن حد رؤية العين المجردة. الإزاحة عن المشتري تُحسب فلكياً (Astronomy.JupiterMoons)
 * ثم تُضاف كفارق زاوية صغير فوق موضع المشتري الرسمي المعروض فعلاً، بدل استخدام موضع
 * مطلق مستقل، لضمان توسّط الأقمار حول نقطة المشتري تماماً دون أي انزياح.
 */
function drawJupiterMoons(
  ctx: CanvasRenderingContext2D, time: Astronomy.AstroTime,
  officialRaHours: number, officialDecDeg: number,
  gmstDeg: number, config: PolarMapConfig, zoomScale: number, showLabels: boolean
) {
  const jupGeo = Astronomy.GeoVector(Astronomy.Body.Jupiter, time, true);
  const jDist = vecLen(jupGeo as unknown as Vec3);
  const jRaRad = Math.atan2(jupGeo.y, jupGeo.x);
  let jRaHoursOwn = (jRaRad * 12) / Math.PI;
  if (jRaHoursOwn < 0) jRaHoursOwn += 24;
  const jDecDegOwn = (Math.asin(jupGeo.z / jDist) * 180) / Math.PI;

  const moons = Astronomy.JupiterMoons(time);

  ctx.save();
  GALILEAN_MOONS.forEach((m) => {
    if (m.approxMag > NAKED_EYE_LIMIT_MAG) return;

    const rel = moons[m.key];
    const gx = jupGeo.x + rel.x, gy = jupGeo.y + rel.y, gz = jupGeo.z + rel.z;
    const dist = Math.hypot(gx, gy, gz);
    const raRad = Math.atan2(gy, gx);
    let raHoursOwn = (raRad * 12) / Math.PI;
    if (raHoursOwn < 0) raHoursOwn += 24;
    const decDegOwn = (Math.asin(gz / dist) * 180) / Math.PI;

    const deltaRaDeg = (raHoursOwn - jRaHoursOwn) * 15;
    const deltaDecDeg = decDegOwn - jDecDegOwn;

    const finalRaHours = officialRaHours + deltaRaDeg / 15;
    const finalDecDeg = officialDecDeg + deltaDecDeg;

    const p = raDecToScreen(finalRaHours, finalDecDeg, gmstDeg, config);
    if (!p.visible) return;

    ctx.fillStyle = '#dcd6c6';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.9, 1.1 * zoomScale), 0, Math.PI * 2);
    ctx.fill();

    if (showLabels && zoomScale > 2.2) {
      ctx.font = `${8 * zoomScale}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(220,214,198,0.85)';
      ctx.textAlign = 'center';
      fillTextUpright(ctx, m.nameAr, p.x, p.y, 0, -6 * zoomScale);
    }
  });
  ctx.restore();
}

// ============================= الكواكب: التنسيق العام =============================

function drawPlanets(
  ctx: CanvasRenderingContext2D, planets: { name: string; state: CelestialBodyState }[],
  gmstDeg: number, config: PolarMapConfig, showLabels: boolean, zoomScale: number,
  time: Astronomy.AstroTime
) {
  ctx.save();
  planets.forEach(({ name, state }) => {
    const p = raDecToScreen(state.equatorial.rightAscensionHours, state.equatorial.declinationDeg, gmstDeg, config);
    if (!p.visible) return;

    const color = PLANET_COLORS[name as keyof typeof PLANET_COLORS] ?? '#e2e8f0';
    const mag = state.magnitude ?? 2;
    // أدنى نصف قطر هنا (2.0) أكبر عمداً من أقصى نصف قطر ممكن لأي نجم (انظر getStarRadiusPx)
    // بحيث يبقى الكوكب مميَّزاً بصرياً عن النجوم دائماً مهما خفت
    const r = Math.max(2.0, 3.6 - mag * 0.28) * zoomScale;

    if (name === 'Saturn') {
      const ringParams = computeSaturnRingParams(
        time, gmstDeg, config,
        state.equatorial.rightAscensionHours, state.equatorial.declinationDeg
      );
      drawSaturnWithRings(ctx, p, r, ringParams, color, zoomScale);
    } else {
      drawPlanetDot(ctx, p, r, color, zoomScale);
    }

    if (showLabels) {
      ctx.font = `${10 * zoomScale}px system-ui, sans-serif`;
      ctx.fillStyle = color;
      const labelOffsetX = name === 'Saturn' ? r * 2.6 : 7;
      fillTextUpright(ctx, PLANET_LABELS_AR[name as keyof typeof PLANET_LABELS_AR] ?? name, p.x, p.y, labelOffsetX, -4);
    }

    if (name === 'Jupiter') {
      drawJupiterMoons(ctx, time, state.equatorial.rightAscensionHours, state.equatorial.declinationDeg, gmstDeg, config, zoomScale, showLabels);
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
  ctx.fillStyle = '#c97b6f';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.2 * zoomScale;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 4 * zoomScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (showLabels) {
    ctx.font = `${10 * zoomScale}px system-ui, sans-serif`;
    ctx.fillStyle = '#d99b90';
    fillTextUpright(ctx, 'موقعي', p.x, p.y, 7, 3);
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
