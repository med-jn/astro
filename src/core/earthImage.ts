/**
 * خريطة الأرض المولَّدة بالسكريبت scripts/build-world-map.mjs بمستويات دقة متعددة (LOD).
 *
 * كل مستوى يغطي القرص كاملاً: مركز الصورة = مركز القبة، ونصف قطرها = outerRadiusPx بالضبط
 * (القطب الجنوبي على الحافة). لذلك تُرسم مباشرة في المربع [cx−R, cy−R, 2R, 2R] دون أي معايرة،
 * وتتطابق مع كل الطبقات الأخرى لأن السكريبت يقرأ إزاحة غرينتش من projection.ts نفسه.
 *
 * يُختار أصغر مستوى ≥ الحجم المطلوب على الشاشة؛ فلا تُصغَّر صورة 8K إلى ~1000px (ما يسبب وميض
 * الخطوط الرفيعة) ولا يُحمَّل المستوى الكبير أصلاً ما لم يحتجه التكبير.
 */
const LEVELS = [2048, 4096, 8192] as const;
type Level = (typeof LEVELS)[number];

/** نصف قطر أكبر صورة (بكسل) — فوق هذه الدقة تتحول الصورة إلى تكبير مبكسل ويحلّ الرسم المتجهي محلها */
export const EARTH_IMAGE_MAX_RADIUS_PX = LEVELS[LEVELS.length - 1] / 2;

const images = new Map<Level, HTMLImageElement>();
const ready = new Set<Level>();

function request(level: Level): void {
  if (images.has(level)) return;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => ready.add(level);
  img.src = `${import.meta.env.BASE_URL}images/world-map-${level}.png`;
  images.set(level, img);
}

/**
 * أنسب صورة جاهزة لقطر قرص بالبكسل الفعلي (مضروباً في devicePixelRatio).
 * أثناء تحميل المستوى المطلوب تُعاد أقرب نسخة جاهزة، وتُعاد null قبل جاهزية أي نسخة.
 */
export function getEarthImage(targetDiameterPx: number): HTMLImageElement | null {
  const want = LEVELS.find((l) => l >= targetDiameterPx) ?? LEVELS[LEVELS.length - 1];
  request(LEVELS[0]);
  request(want);
  if (ready.has(want)) return images.get(want) ?? null;

  let best: Level | null = null;
  for (const l of LEVELS) {
    if (ready.has(l) && (best === null || Math.abs(l - want) < Math.abs(best - want))) best = l;
  }
  return best === null ? null : images.get(best) ?? null;
}
