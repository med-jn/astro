/**
 * قبة الراصد: السماء المحلية فوق موقع الراصد، مرسومة على الخريطة كقرص بنصف قطر الأرض
 * (6371 كم بمقياس الخريطة، أي نصف قطر القرص ÷ π).
 *
 * الإسقاط متعامد كما يُرى القبة من الأعلى: نصف القطر = cos(الارتفاع)، فالسمت (zenith) في المركز
 * والأفق على الحافة. والاتجاهات مطابقة للخريطة نفسها: الشمال نحو القطب (مركز القرص) والشرق
 * عكس عقارب الساعة حول القطب، فيكون الشرق يمين الراصد عندما يكون الشمال أعلى — تماماً كالخريطة.
 *
 * تُرسم عليها كل أجرام التطبيق: الشمس والقمر (بطوره) والكواكب والنجوم (تظهر تدريجياً مع حلول
 * الليل) وخطوط الكوكبات المختارة وحدود الأبراج المختارة والمنازل المختارة وخط البروج.
 * ارتفاع/سمت الشمس والقمر والكواكب يأتي مباشرة من astronomy-engine (مراقب فعلي)، أما النجوم
 * فتُحسب من مطلعها المستقيم وميلها بنفس إحداثيات الخريطة تماماً حتى تتطابق مع طبقة النجوم.
 */
import type { CelestialBodyState, ObserverLocation } from '../types/astro';
import { GREENWICH_DOWN_OFFSET_DEG, latLonToScreen, type PolarMapConfig } from '../core/projection';
import { getLoadedStars, getStarColor, getStarRadiusPx, getStarDisplayName, getStarByIdMap } from '../core/starCatalog';
import { getGroupLines } from '../core/starGroups';
import { getLoadedZodiac, type ZodiacKey } from '../core/zodiac';
import { getAllLunarMansions, MANSION_SPAN_DEG } from '../core/mansions';
import { eclipticLongitudeToEquatorial } from '../core/eclipticTransform';
import { PLANET_COLORS, PLANET_LABELS_AR } from '../core/bodies';
import { fillTextUpright } from './uprightText';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** نصف قطر الأرض ÷ (نصف محيط الأرض): R_map يمثل π·6371 كم، فقبة الأرض = R_map ÷ π */
export const DOME_RADIUS_FRACTION = 1 / Math.PI;

const ACCENT_LINE = '#b08d57';
const ACCENT_LINE_BRIGHT = '#d4b688';

// ───────────────────────────── الفلك ─────────────────────────────
/** ارتفاع وسمت (من الشمال نحو الشرق) لجرم بمطلعه المستقيم (ساعات) وميله (درجات) */
export function equatorialToHorizontal(
  raHours: number, decDeg: number, lstDeg: number, latDeg: number
): { altDeg: number; azDeg: number } {
  const H = (lstDeg - raHours * 15) * DEG;
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const altDeg = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
  const north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H);
  const east = -Math.cos(dec) * Math.sin(H);
  let azDeg = Math.atan2(east, north) / DEG;
  if (azDeg < 0) azDeg += 360;
  return { altDeg, azDeg };
}

// ───────────────────────────── الهندسة على الخريطة ─────────────────────────────
export interface DomeFrame {
  /** مركز القبة (موقع الراصد) بإحداثيات الرسم */
  px: number;
  py: number;
  radius: number;
  /** متجها الشمال والشرق المحليين على الشاشة (وحدة) */
  nx: number; ny: number;
  ex: number; ey: number;
}

export function computeDomeFrame(config: PolarMapConfig, observer: ObserverLocation): DomeFrame {
  const p = latLonToScreen(observer.latitudeDeg, observer.longitudeDeg, config);
  // اتجاه الراصد من المركز: (−sin a, −cos a)؛ الشمال عكسه (نحو القطب)، والشرق مماس الدائرة (باتجاه زيادة الطول)
  const a = (observer.longitudeDeg + GREENWICH_DOWN_OFFSET_DEG) * DEG;
  return {
    px: p.x, py: p.y, radius: config.outerRadiusPx * DOME_RADIUS_FRACTION,
    nx: Math.sin(a), ny: Math.cos(a),
    ex: -Math.cos(a), ey: Math.sin(a),
  };
}

/** نقطة على القبة. ما تحت الأفق يُوضَع خارج القرص (فيُقصّ) بدل أن ينعكس فوق الأفق */
export function domePoint(f: DomeFrame, altDeg: number, azDeg: number): { x: number; y: number } {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const rho = alt >= 0 ? Math.cos(alt) : 1 - Math.sin(alt);
  const dx = Math.cos(az) * f.nx + Math.sin(az) * f.ex;
  const dy = Math.cos(az) * f.ny + Math.sin(az) * f.ey;
  return { x: f.px + f.radius * rho * dx, y: f.py + f.radius * rho * dy };
}

// ───────────────────────────── لون السماء ─────────────────────────────
/** (ارتفاع الشمس بالدرجات → لون السماء): نهار، غروب، شفق مدني/ملاحي/فلكي، ليل.
 *  الألوان معتمة تماماً: القبة نافذة على السماء المحلية، فلا يجوز أن تظهر من خلفها نجوم طبقة
 *  الخريطة (وهي تُرى نهاراً من خلف سماء شفافة). */
const SKY_STOPS: [number, [number, number, number, number]][] = [
  [20, [86, 152, 226, 1]],
  [6, [112, 164, 218, 1]],
  [0, [232, 146, 92, 1]],
  [-6, [58, 68, 124, 1]],
  [-12, [16, 24, 60, 1]],
  [-18, [4, 8, 24, 1]],
];

export function skyColor(sunAltDeg: number): string {
  const s = SKY_STOPS;
  if (sunAltDeg >= s[0][0]) return rgba(s[0][1]);
  if (sunAltDeg <= s[s.length - 1][0]) return rgba(s[s.length - 1][1]);
  for (let i = 1; i < s.length; i++) {
    if (sunAltDeg >= s[i][0]) {
      const t = (s[i - 1][0] - sunAltDeg) / (s[i - 1][0] - s[i][0]);
      const a = s[i - 1][1], b = s[i][1];
      return rgba([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
    }
  }
  return rgba(s[s.length - 1][1]);
}

function rgba([r, g, b, a]: [number, number, number, number]): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(3)})`;
}

/** رؤية النجوم: تظهر عند غروب الشمس (−3°) وتكتمل عند الشفق الملاحي (−12°) */
export function starVisibility(sunAltDeg: number): number {
  return Math.max(0, Math.min(1, (-sunAltDeg - 3) / 9));
}

// ───────────────────────────── الرسم ─────────────────────────────
interface ScreenPoint { x: number; y: number; visible: boolean }

/** دوال الرسم الموجودة في skyRenderer نفسها (تُمرَّر كي تبقى الشمس/القمر/الكواكب بنفس مظهرها) */
export interface DomeHelpers {
  drawSun: (ctx: CanvasRenderingContext2D, p: ScreenPoint, radiusPx: number) => void;
  drawMoon: (ctx: CanvasRenderingContext2D, moon: CelestialBodyState, moonP: ScreenPoint, sunP: ScreenPoint, radiusPx: number) => void;
  drawPlanetDot: (ctx: CanvasRenderingContext2D, p: ScreenPoint, r: number, color: string, zoomScale: number) => void;
}

export interface DomeInput {
  observer: ObserverLocation;
  gmstDeg: number;
  obliquityDeg: number;
  sun: CelestialBodyState;
  moon: CelestialBodyState;
  planets: { name: string; state: CelestialBodyState }[];
  selectedZodiacs: ZodiacKey[];
  selectedMansionIndices: number[];
  selectedGroupIds: number[];
  highlightedStarId: number | null;
  showEcliptic: boolean;
  /** إظهار أسماء كل المنازل (layers.mansions + layers.labels) */
  showMansionNames: boolean;
  labels: boolean;
}

/** هدف تحويم على القبة بإحداثيات الرسم (قبل تحويل المشهد) */
export interface DomeTarget {
  x: number;
  y: number;
  name: string;
  detail: string;
}

const MAX_STAR_NAME_MAG = 1.8;

export function drawObserverDome(
  ctx: CanvasRenderingContext2D, config: PolarMapConfig, input: DomeInput,
  uiScale: number, helpers: DomeHelpers
): DomeTarget[] {
  const targets: DomeTarget[] = [];
  const f = computeDomeFrame(config, input.observer);
  const lat = input.observer.latitudeDeg;
  const lst = input.gmstDeg + input.observer.longitudeDeg;
  const sunAlt = input.sun.horizontal.altitudeDeg;
  const lw = Math.min(uiScale, 2.5);

  const toDome = (raHours: number, decDeg: number) => {
    const h = equatorialToHorizontal(raHours, decDeg, lst, lat);
    return { ...domePoint(f, h.altDeg, h.azDeg), altDeg: h.altDeg, azDeg: h.azDeg };
  };
  const detailOf = (alt: number, az: number) => `على القبة · ارتفاع ${alt.toFixed(1)}° · سمت ${az.toFixed(1)}°`;

  ctx.save();

  // السماء + قصّ كل ما بعدها داخل الأفق
  ctx.beginPath();
  ctx.arc(f.px, f.py, f.radius, 0, TAU);
  ctx.fillStyle = skyColor(sunAlt);
  ctx.fill();
  ctx.clip();

  // دوائر الارتفاع 30° و60° وخطا الشمال–الجنوب والشرق–الغرب
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.16)';
  ctx.lineWidth = 0.8 * lw;
  ctx.beginPath();
  for (const alt of [30, 60]) {
    const r = f.radius * Math.cos(alt * DEG);
    ctx.moveTo(f.px + r, f.py);
    ctx.arc(f.px, f.py, r, 0, TAU);
  }
  ctx.moveTo(f.px - f.nx * f.radius, f.py - f.ny * f.radius);
  ctx.lineTo(f.px + f.nx * f.radius, f.py + f.ny * f.radius);
  ctx.moveTo(f.px - f.ex * f.radius, f.py - f.ey * f.radius);
  ctx.lineTo(f.px + f.ex * f.radius, f.py + f.ey * f.radius);
  ctx.stroke();

  // خط البروج
  if (input.showEcliptic) {
    ctx.strokeStyle = 'rgba(176, 141, 87, 0.6)';
    ctx.lineWidth = 1.3 * lw;
    ctx.beginPath();
    for (let lon = 0; lon <= 360; lon += 3) {
      const { raHours, decDeg } = eclipticLongitudeToEquatorial(lon, input.obliquityDeg);
      const p = toDome(raHours, decDeg);
      if (lon === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // النجوم: تظهر تدريجياً مع حلول الليل
  const visibility = starVisibility(sunAlt);
  const hasSelection = input.selectedZodiacs.length > 0 || input.selectedGroupIds.length > 0;
  if (visibility > 0) {
    const colorGroups = new Map<string, Path2D>();
    const named: { x: number; y: number; name: string; alt: number; az: number }[] = [];
    for (const star of getLoadedStars()) {
      const p = toDome(star.ra, star.dec);
      if (p.altDeg < -1) continue;
      const r = Math.max(0.55, getStarRadiusPx(star.mag) * uiScale * 0.9);
      const color = getStarColor(star.spect);
      let path = colorGroups.get(color);
      if (!path) { path = new Path2D(); colorGroups.set(color, path); }
      path.moveTo(p.x + r, p.y);
      path.arc(p.x, p.y, r, 0, TAU);
      if (star.mag < MAX_STAR_NAME_MAG) {
        const name = getStarDisplayName(star);
        if (name) named.push({ x: p.x, y: p.y, name, alt: p.altDeg, az: p.azDeg });
      }
    }
    ctx.globalAlpha = visibility * (hasSelection ? 0.35 : 1);
    for (const [color, path] of colorGroups) {
      ctx.fillStyle = color;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;

    if (input.labels && uiScale > 1.6) {
      ctx.font = `${10 * uiScale}px system-ui, sans-serif`;
      ctx.fillStyle = `rgba(226, 232, 240, ${0.85 * visibility})`;
      ctx.textAlign = 'left';
      named.forEach((n) => fillTextUpright(ctx, n.name, n.x, n.y, 6, -4));
    }
    for (const n of named) {
      if (n.alt > 0) targets.push({ x: n.x, y: n.y, name: n.name, detail: detailOf(n.alt, n.az) });
    }
  }

  // خطوط الكوكبات المختارة
  if (input.selectedGroupIds.length) {
    const starById = getStarByIdMap();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = Math.min(1.3, 0.8 + 0.2 * uiScale);
    ctx.beginPath();
    for (const groupId of input.selectedGroupIds) {
      for (const { hipFrom, hipTo } of getGroupLines(groupId)) {
        const a = starById.get(hipFrom);
        const b = starById.get(hipTo);
        if (!a || !b) continue;
        const pa = toDome(a.ra, a.dec);
        const pb = toDome(b.ra, b.dec);
        if (pa.altDeg < -5 && pb.altDeg < -5) continue;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
    }
    ctx.stroke();
  }

  // حدود الأبراج المختارة
  if (input.selectedZodiacs.length) {
    ctx.strokeStyle = ACCENT_LINE;
    ctx.lineWidth = 1.8 * lw;
    ctx.beginPath();
    for (const key of input.selectedZodiacs) {
      const data = getLoadedZodiac()[key];
      if (!data) continue;
      for (const seg of data.segments) {
        let started = false;
        for (const pt of seg) {
          if (!pt) { started = false; continue; }
          const p = toDome(pt[0], pt[1]);
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        }
      }
    }
    ctx.stroke();
  }

  // المنازل القمرية: المختارة بإبراز، وأسماء الكل إن طُلبت
  const mansions = getAllLunarMansions();
  if (input.selectedMansionIndices.length) {
    ctx.strokeStyle = ACCENT_LINE;
    ctx.lineWidth = 2.4 * lw;
    ctx.beginPath();
    for (const idx of input.selectedMansionIndices) {
      const m = mansions[idx];
      if (!m) continue;
      let started = false;
      for (let lon = m.startLongitudeDeg; lon <= m.endLongitudeDeg; lon += 1) {
        const { raHours, decDeg } = eclipticLongitudeToEquatorial(lon, input.obliquityDeg);
        const p = toDome(raHours, decDeg);
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  }
  const nameMansion = (m: (typeof mansions)[number], bright: boolean) => {
    const midLon = m.startLongitudeDeg + MANSION_SPAN_DEG / 2;
    const { raHours, decDeg } = eclipticLongitudeToEquatorial(midLon, input.obliquityDeg);
    const p = toDome(raHours, decDeg);
    if (p.altDeg < 0) return;
    ctx.fillStyle = bright ? ACCENT_LINE_BRIGHT : 'rgba(201, 172, 120, 0.9)';
    ctx.font = `bold ${(bright ? 11 : 9) * uiScale}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    fillTextUpright(ctx, m.nameAr, p.x, p.y, 0, bright ? -10 * uiScale : 0);
  };
  if (input.showMansionNames) mansions.forEach((m) => nameMansion(m, false));
  input.selectedMansionIndices.forEach((idx) => { if (mansions[idx]) nameMansion(mansions[idx], true); });

  // علامة تصويب النجمة المحدَّدة
  if (input.highlightedStarId != null) {
    const star = getStarByIdMap().get(input.highlightedStarId);
    if (star) {
      const p = toDome(star.ra, star.dec);
      if (p.altDeg > 0) {
        const t = (Math.sin(Date.now() / 640) + 1) / 2;
        const gap = 6 + 1.2 * uiScale + 2 * t;
        const len = 5 + 0.8 * uiScale;
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.65 + 0.35 * (1 - t);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x - gap - len, p.y); ctx.lineTo(p.x - gap, p.y);
        ctx.moveTo(p.x + gap, p.y); ctx.lineTo(p.x + gap + len, p.y);
        ctx.moveTo(p.x, p.y - gap - len); ctx.lineTo(p.x, p.y - gap);
        ctx.moveTo(p.x, p.y + gap); ctx.lineTo(p.x, p.y + gap + len);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // الكواكب
  for (const { name, state } of input.planets) {
    const { altitudeDeg, azimuthDeg } = state.horizontal;
    if (altitudeDeg < -1) continue;
    const p = domePoint(f, altitudeDeg, azimuthDeg);
    const color = PLANET_COLORS[name as keyof typeof PLANET_COLORS] ?? '#e2e8f0';
    const mag = state.magnitude ?? 2;
    const r = Math.max(2.0, 3.6 - mag * 0.28) * uiScale * 0.85;
    helpers.drawPlanetDot(ctx, { x: p.x, y: p.y, visible: true }, r, color, uiScale);
    const nameAr = PLANET_LABELS_AR[name as keyof typeof PLANET_LABELS_AR] ?? name;
    if (input.labels) {
      ctx.font = `${10 * uiScale}px system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      fillTextUpright(ctx, nameAr, p.x, p.y, r + 4, -4);
    }
    if (altitudeDeg > 0) targets.push({ x: p.x, y: p.y, name: nameAr, detail: detailOf(altitudeDeg, azimuthDeg) });
  }

  // الشمس والقمر (فوق الجميع)
  const sunP = domePoint(f, sunAlt, input.sun.horizontal.azimuthDeg);
  const moonP = domePoint(f, input.moon.horizontal.altitudeDeg, input.moon.horizontal.azimuthDeg);
  const bodyRadius = 7 * uiScale;
  helpers.drawSun(ctx, { x: sunP.x, y: sunP.y, visible: true }, bodyRadius);
  helpers.drawMoon(ctx, input.moon, { x: moonP.x, y: moonP.y, visible: true }, { x: sunP.x, y: sunP.y, visible: true }, bodyRadius);
  if (input.labels) {
    ctx.font = `${10 * uiScale}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fde68a';
    fillTextUpright(ctx, 'الشمس', sunP.x, sunP.y, bodyRadius + 4, -4);
    ctx.fillStyle = '#e2e8f0';
    fillTextUpright(ctx, 'القمر', moonP.x, moonP.y, bodyRadius + 4, -4);
  }
  if (sunAlt > -1) {
    targets.push({ x: sunP.x, y: sunP.y, name: 'الشمس', detail: detailOf(sunAlt, input.sun.horizontal.azimuthDeg) });
  }
  if (input.moon.horizontal.altitudeDeg > -1) {
    targets.push({
      x: moonP.x, y: moonP.y, name: 'القمر',
      detail: detailOf(input.moon.horizontal.altitudeDeg, input.moon.horizontal.azimuthDeg),
    });
  }

  ctx.restore();

  // إطار الأفق + نقطة السمت + الاتجاهات الأربعة (أفقية دائماً)
  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.8)';
  ctx.lineWidth = 1.6 * lw;
  ctx.beginPath();
  ctx.arc(f.px, f.py, f.radius, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(226, 232, 240, 0.6)';
  ctx.beginPath();
  ctx.arc(f.px, f.py, 1.6 * lw, 0, TAU);
  ctx.fill();

  ctx.font = `bold ${11 * uiScale}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  const cardinals: { text: string; dx: number; dy: number; color: string }[] = [
    { text: 'شمال', dx: f.nx, dy: f.ny, color: ACCENT_LINE_BRIGHT },
    { text: 'جنوب', dx: -f.nx, dy: -f.ny, color: '#e2e8f0' },
    { text: 'شرق', dx: f.ex, dy: f.ey, color: '#e2e8f0' },
    { text: 'غرب', dx: -f.ex, dy: -f.ey, color: '#e2e8f0' },
  ];
  for (const c of cardinals) {
    ctx.fillStyle = c.color;
    fillTextUpright(ctx, c.text, f.px + c.dx * f.radius * 1.12, f.py + c.dy * f.radius * 1.12, 0, 4 * uiScale);
  }
  ctx.restore();

  return targets;
}