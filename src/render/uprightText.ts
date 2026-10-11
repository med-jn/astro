/**
 * نصوص تبقى أفقية (مستوية) مهما دار المشهد، مع الحفاظ على نقطة ارتكازها.
 *
 * الطبقات تُرسم داخل تحويل مدوَّر بزاوية sceneRotationDeg، فالنص العادي يدور معها وينقلب.
 * هنا نترجم إلى نقطة الارتكاز (ax, ay) ثم نلغي دوران المشهد، فيبقى النص أفقياً. الإزاحة (ox, oy)
 * تُطبَّق بعد إلغاء الدوران أي في إطار الشاشة، فيبقى الاسم دائماً يمين/فوق نقطته كما صُمّم.
 */
let sceneRotationRad = 0;

export function setSceneRotationRad(rad: number): void {
  sceneRotationRad = rad;
}

export function fillTextUpright(
  ctx: CanvasRenderingContext2D,
  text: string,
  ax: number,
  ay: number,
  ox = 0,
  oy = 0
): void {
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(-sceneRotationRad);
  ctx.fillText(text, ox, oy);
  ctx.restore();
}
