import type { Degrees } from '../types/astro';

/**
 * إسقاط سمتي تساوي البعد (Azimuthal Equidistant)، مركزه القطب الشمالي/نجم الشمال،
 * كما لو كان الناظر معلّقاً في الفضاء فوق القطب مباشرة ينظر إلى الكرة بأكملها.
 * نصف القطر يتناسب خطياً مع البعد القطبي (Colatitude): r = (colatitude/180) × outerRadius.
 */
export interface PolarMapConfig {
  centerX: number;
  centerY: number;
  outerRadiusPx: number;
}

export interface ProjectedPoint2D {
  x: number;
  y: number;
  visible: boolean;
}

const DEG2RAD = Math.PI / 180;

/**
 * بطلب صريح: خط غرينتش (0°) يشير الآن إلى الأسفل بدل الأعلى — تماماً كالساعة السادسة على
 * ساعة حائط بدل الثانية عشرة. هذه إزاحة زاوية ثابتة واحدة تُطبَّق هنا فقط، فتنعكس تلقائياً
 * على كل الطبقات التي تمر من هذه الدالة (القارات، المدارات، خطوط الطول، الشبكة، النجوم
 * والكواكب عبر raDecToScreen) دفعة واحدة ومتّسقة. الصورة المعايَرة (drawCalibratedEarthImage)
 * تتبع نفس الإزاحة عبر تعديل مطابق منفصل في skyRenderer.ts لأنها لا تمر من هذه الدالة.
 */
const GREENWICH_DOWN_OFFSET_DEG = 180;

/** نسبة نصف قطر "قبة السماء" إلى أصغر بُعدَي الكانفس عند التكبير 1x — ثابت تصميم واحد يُستخدم
 * هنا (عبر computeOuterRadiusPx) وفي skyRenderer.ts معاً، حتى لا يتكرر الرقم السحري 0.46
 * في مكانين قد ينحرفان عن بعضهما مستقبلاً وتختل معه دقة حساب مناطق اللمس (حافة/داخل). */
export const BASE_RADIUS_FRACTION = 0.46;

/**
 * نصف قطر القبة الفعلي بالبكسل لحجم كانفس ومستوى تكبير مُعطى — نفس الصيغة المستخدمة في
 * renderSky بالضبط. مصدر واحد للحقيقة يستخدمه أيضاً SkyCanvas.tsx عند تحديد ما إذا كانت
 * نقطة اللمس داخل "منطقة الحافة" (تدوير المشهد) أو "المنطقة الداخلية" (سحب الزمن)، دون أي
 * تأثير على دقة الإسقاط الفلكي نفسه — هذه الدالة لا تُستخدم في حساب موضع أي جرم سماوي.
 */
export function computeOuterRadiusPx(width: number, height: number, zoomScale: number): number {
  return Math.min(width, height) * BASE_RADIUS_FRACTION * zoomScale;
}

/**
 * إسقاط (خط عرض، خط طول جغرافي) إلى نقطة شاشة — للقارات والمدارات وخطوط الطول الثابتة
 * والشمس والقمر والنجوم (عبر raDecToScreen) — كل الطبقات تمر من هنا فتبقى متطابقة دائماً.
 */
export function latLonToScreen(
  latDeg: Degrees,
  lonDeg: Degrees,
  config: PolarMapConfig
): ProjectedPoint2D {
  const colatitudeDeg = 90 - latDeg;
  const r = (colatitudeDeg / 180) * config.outerRadiusPx;
  const lonRad = (lonDeg + GREENWICH_DOWN_OFFSET_DEG) * DEG2RAD;
  const x = config.centerX - r * Math.sin(lonRad);
  const y = config.centerY - r * Math.cos(lonRad);
  return { x, y, visible: r <= config.outerRadiusPx * 1.001 };
}

/**
 * إسقاط جرم سماوي بإحداثياته الاستوائية (RA بالساعات، Dec) — يُستخدم بنفس صيغة latLonToScreen
 * تماماً، لكن "خط الطول" هنا هو زاوية غرينتش الساعية (GHA) بدل خط الطول الجغرافي الثابت،
 * فتدور الأجرام حول القطب مع دوران الأرض الحقيقي (GMST) بينما تبقى القارات ثابتة.
 */
export function raDecToScreen(
  raHours: number,
  decDeg: Degrees,
  gmstDeg: Degrees,
  config: PolarMapConfig
): ProjectedPoint2D {
  const ghaDeg = normalizeDeg(gmstDeg - raHours * 15);
  const subPointLonDeg = normalizeDeg(-ghaDeg);
  return latLonToScreen(decDeg, subPointLonDeg, config);
}

function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}