/**
 * الشبكة الجغرافية وخطوط التوقيت.
 *
 *  - الافتراضي (ten): 36 خط طول (كل 10°) + دوائر العرض كل 10° من 80°ش حتى 80°ج،
 *    وتُضاف حافة القرص (90°ج) فيكتمل العدد 18 دائرة.
 *  - الشبكة الكاملة (full): كل درجة. تكيّفية: لا تُرسم خطوط أقرب من GRID_MIN_SPACING_PX
 *    على الشاشة، وإلا تحولت إلى بقعة بيضاء (360 خط طول تلتقي عند القطب). كلما كبّرت ظهرت
 *    الخطوط الأدق تدريجياً حتى تصل إلى كل درجة.
 *  - خطوط التوقيت الاسمية: 24 خط طول كل 15° (UTC±n).
 *
 * كل الأسماء تبقى أفقية مهما دار المشهد (fillTextUpright).
 */
import { GREENWICH_DOWN_OFFSET_DEG, type PolarMapConfig } from '../core/projection';
import { computeViewRect, type ViewportInfo } from '../core/vectorMap';
import { fillTextUpright } from './uprightText';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

/** أقل تباعد بالبكسل بين خطين متجاورين في الشبكة الكاملة */
export const GRID_MIN_SPACING_PX = 5;
/** أقل تباعد بين خطوط الـ10° قرب القطب (حتى لا تلتحم في بقعة عند المركز) */
const TEN_MIN_SPACING_PX = 3;
const TIMEZONE_MIN_SPACING_PX = 8;

export const TIMEZONE_COLOR = '#d4b688';

/** اتجاه خط الطول lon (بالدرجات) من مركز القرص بنفس معادلة latLonToScreen */
function meridianDir(lonDeg: number): { dx: number; dy: number } {
  const a = (lonDeg + GREENWICH_DOWN_OFFSET_DEG) * DEG;
  return { dx: -Math.sin(a), dy: -Math.cos(a) };
}

/** نصف القطر (بكسل) الذي يبدأ منه رسم خط طول ينتمي إلى مجموعة بخطوة step درجة */
function meridianInnerRadius(stepDeg: number, minSpacingPx: number): number {
  return ((360 / stepDeg) * minSpacingPx) / TWO_PI;
}

function lonLabel(lon: number): string {
  if (lon === 0 || lon === 180) return `${lon}°`;
  return lon < 180 ? `${lon}°ق` : `${360 - lon}°غ`;
}

export interface GridOptions {
  /** شبكة الـ10° (36 خط طول + دوائر العرض) */
  ten: boolean;
  /** الشبكة الكاملة كل درجة (تكيّفية) */
  full: boolean;
  labels: boolean;
}

export function drawGeoGrid(
  ctx: CanvasRenderingContext2D, config: PolarMapConfig, opts: GridOptions, uiScale: number
): void {
  const { centerX: cx, centerY: cy, outerRadiusPx: R } = config;
  const lw = Math.min(uiScale, 2.5);
  ctx.save();

  if (opts.full) {
    const pxPerDeg = R / 180;
    const latStep = [1, 2, 5, 10].find((s) => s * pxPerDeg >= GRID_MIN_SPACING_PX) ?? 10;
    const path = new Path2D();
    for (let lat = -89; lat <= 89; lat++) {
      if (lat % latStep !== 0) continue;
      if (opts.ten && lat % 10 === 0) continue; // ترسمها شبكة الـ10° بشكل أبرز
      const r = ((90 - lat) / 180) * R;
      path.moveTo(cx + r, cy);
      path.arc(cx, cy, r, 0, TWO_PI);
    }
    for (let lon = 0; lon < 360; lon++) {
      if (opts.ten && lon % 10 === 0) continue;
      const step = lon % 10 === 0 ? 10 : lon % 5 === 0 ? 5 : lon % 2 === 0 ? 2 : 1;
      const r0 = meridianInnerRadius(step, GRID_MIN_SPACING_PX);
      if (r0 >= R) continue;
      const { dx, dy } = meridianDir(lon);
      path.moveTo(cx + dx * r0, cy + dy * r0);
      path.lineTo(cx + dx * R, cy + dy * R);
    }
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.30)';
    ctx.lineWidth = 0.7 * lw;
    ctx.stroke(path);
  }

  if (opts.ten) {
    const path = new Path2D();
    const r0 = meridianInnerRadius(10, TEN_MIN_SPACING_PX);
    for (let lon = 0; lon < 360; lon += 10) {
      const { dx, dy } = meridianDir(lon);
      path.moveTo(cx + dx * r0, cy + dy * r0);
      path.lineTo(cx + dx * R, cy + dy * R);
    }
    for (let lat = 80; lat >= -80; lat -= 10) {
      const r = ((90 - lat) / 180) * R;
      path.moveTo(cx + r, cy);
      path.arc(cx, cy, r, 0, TWO_PI);
    }
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.5)';
    ctx.lineWidth = 1.3 * lw;
    ctx.stroke(path);

    if (opts.labels) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.font = `${9 * uiScale}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const rl = (170 / 180) * R; // عند خط العرض −80°
      for (let lon = 0; lon < 360; lon += 10) {
        const { dx, dy } = meridianDir(lon);
        fillTextUpright(ctx, lonLabel(lon), cx + dx * rl, cy + dy * rl);
      }
      // أسماء دوائر العرض على خط الطول 90°ش (يمين الشاشة قبل التدوير)
      ctx.textAlign = 'left';
      const { dx, dy } = meridianDir(90);
      for (let lat = 80; lat >= -80; lat -= 10) {
        if (lat === 0) continue; // خط الاستواء له اسمه في طبقة المدارات
        const r = ((90 - lat) / 180) * R;
        fillTextUpright(ctx, `${Math.abs(lat)}°${lat > 0 ? 'ش' : 'ج'}`, cx + dx * r, cy + dy * r, 6, -(4 + uiScale));
      }
    }
  }
  ctx.restore();
}

/** خطوط التوقيت الاسمية: 24 خط طول كل 15° مع اسم كل خط (UTC±n) في موضع مقروء داخل المشهد */
export function drawNominalTimeZones(
  ctx: CanvasRenderingContext2D, config: PolarMapConfig, vp: ViewportInfo, uiScale: number, showLabels: boolean
): void {
  const { centerX: cx, centerY: cy, outerRadiusPx: R } = config;
  const lw = Math.min(uiScale, 2.5);
  const view = computeViewRect(config, vp, 24);
  const vcx = (view.x0 + view.x1) / 2;
  const vcy = (view.y0 + view.y1) / 2;
  const r0 = meridianInnerRadius(24, TIMEZONE_MIN_SPACING_PX);

  ctx.save();
  ctx.strokeStyle = TIMEZONE_COLOR;
  ctx.fillStyle = TIMEZONE_COLOR;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.3 * lw;
  ctx.setLineDash([8 * lw, 6 * lw]);
  const path = new Path2D();
  for (let k = 0; k < 24; k++) {
    const { dx, dy } = meridianDir(15 * k);
    path.moveTo(cx + dx * r0, cy + dy * r0);
    path.lineTo(cx + dx * R, cy + dy * R);
  }
  ctx.stroke(path);
  ctx.setLineDash([]);

  ctx.globalAlpha = 1;
  ctx.font = `bold ${10 * uiScale}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  for (let k = 0; showLabels && k < 24; k++) {
    const offset = k <= 12 ? k : k - 24;
    const text = k === 0 ? 'UTC' : k === 12 ? 'UTC±12' : offset > 0 ? `UTC+${offset}` : `UTC${offset}`;
    const { dx, dy } = meridianDir(15 * k);
    // أقرب نقطة على الخط إلى مركز المشهد المرئي، محصورة بين 0.55R و0.97R كي لا تتكدس الأسماء
    const t = Math.min(0.97 * R, Math.max(0.55 * R, (vcx - cx) * dx + (vcy - cy) * dy));
    const x = cx + dx * t;
    const y = cy + dy * t;
    if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
    fillTextUpright(ctx, text, x, y, 0, -(6 + 2 * uiScale));
  }
  ctx.restore();
}