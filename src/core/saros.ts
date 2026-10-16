/**
 * رقم سلسلة ساروس لكسوف أو خسوف.
 *
 * ساروس دورة قدرها 223 شهراً قمرياً (نحو 6585.32 يوماً) تتكرر بعدها هندسة الكسوف تقريباً،
 * فتنتظم الأحداث في «سلاسل» مرقَّمة. وهي معلومة تصنيفية، أما لحظة كل حدث فتُحسب مباشرة من مواضع الشمس
 * والقمر (core/eclipses.ts) وليست مستمدة من ساروس.
 *
 * الترقيم المعتمد في الكتالوجات تاريخي، لكنه يتبع علاقة ثابتة: كل زيادة قدرها 1 في رقم السلسلة
 * تقابل 135 شهراً قمرياً (بالمقياس 223). نعايرها بحدث واحد لكل نوع ثم نتحقق بعدد من الأحداث الأخرى (tests/saros.test.ts).
 */
const SYNODIC_MS = 29.530588853 * 86_400_000;
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const CYCLE = 223;
const STEP = 135;

function modInverse(a: number, m: number): number {
  for (let x = 1; x < m; x++) if ((a * x) % m === 1) return x;
  throw new Error('no inverse');
}
const INV = modInverse(STEP, CYCLE);

/** حدث مرجعي لكل نوع */
const ANCHOR = {
  solar: { peak: Date.UTC(2024, 3, 8, 18, 17), series: 139 },
  lunar: { peak: Date.UTC(2025, 2, 14, 6, 58), series: 123 },
} as const;

const lunation = (peakMs: number, kind: 'solar' | 'lunar') =>
  Math.round((peakMs - REF_NEW_MOON) / SYNODIC_MS - (kind === 'lunar' ? 0.5 : 0));

export function sarosSeries(peak: Date, kind: 'solar' | 'lunar'): number {
  const a = ANCHOR[kind];
  const d = lunation(peak.getTime(), kind) - lunation(a.peak, kind);
  return ((((a.series + INV * d) % CYCLE) + CYCLE) % CYCLE) || CYCLE;
}

/** اللحظة التقريبية للعضو التالي في السلسلة نفسها (تُصقل بالحساب الدقيق عند الحاجة) */
export const nextInSeriesApprox = (peak: Date): Date => new Date(peak.getTime() + CYCLE * SYNODIC_MS);
