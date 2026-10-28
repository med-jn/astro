import type { ProjectionKind, Projector } from '../core/camera';

/**
 * مقياس التكبير الحقيقي لعين الراصد.
 * تعريف CSS للبكسل المرجعي (CSS Values and Units): زاوية رؤية البكسل على جهاز بكثافة 96 نقطة/بوصة من مسافة ذراع
 * (28 بوصة تقريباً) ≈ 0.0213°. فإذا كان للمشهد على الشاشة px/° عند مركزه، فالتكبير الزاوي بالنسبة للعين المجرّدة:
 *     M = (px/°) × 0.0213°
 * M = 1 → الأجرام بحجمها الزاوي الحقيقي تماماً كما تُرى في السماء عند النظر إلى الشاشة من مسافة القراءة المرجعية؛
 * M < 1 → مجال أوسع من الواقع (كعدسة واسعة)، M > 1 → تكبير (كمنظار/تيليسكوب).
 */
export const CSS_PX_DEG = 0.0213;
const DEG = Math.PI / 180;

/** التكبير عند مركز الإطار */
export function magnificationAt(P: Projector): number {
  return P.scaleAt(P.basis.fwd) * DEG * CSS_PX_DEG;
}

/** المجال الرأسي (بالدرجات) الذي يعطي التكبير M لإطار ارتفاعه hCss بكسل (مغلق الصيغة لكل إسقاط) */
export function fovForMagnification(projection: ProjectionKind, hCss: number, mag: number): number {
  const f = (mag / CSS_PX_DEG) / DEG; // بكسل لكل راديان عند المركز
  if (projection === 'perspective') return (2 * Math.atan(hCss / (2 * f))) / DEG;
  if (projection === 'stereographic') return (4 * Math.atan(hCss / (4 * f))) / DEG;
  return (hCss / f) / DEG; // متساوي المسافة
}
