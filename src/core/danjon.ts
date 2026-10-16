/**
 * مظهر القمر أثناء الخسوف.
 *
 * مقياس دانجون (L0…L4) يصف سطوع القمر ولونه داخل منطقة الإظلام، وهو مُدخَل لا تنبؤ (لا يُحسب مسبقاً).
 * لذلك يُحسم المظهر هكذا، ويُطبَّق تلقائياً في كل موضع يُرسم فيه القمر متى وقع الخسوف:
 *   1) اختيار المستخدم من الإعدادات إن لم يكن «تلقائي»
 *   2) القيمة الموثّقة لذلك الخسوف إن وُجدت في OBSERVED_DANJON
 *   3) المظهر الأشيع L2 افتراضياً
 * المظاهر اللونية الأخرى (دموي، وردي، أزرق…) معاملات لونية فوق النموذج الضوئي نفسه.
 */
import { getSettings } from '../settings';

export type Rgb = [number, number, number];

export interface EclipseLookValue { L: number; tint: Rgb }
export interface LookDef extends EclipseLookValue { id: string; swatch: string }

export const LOOKS: LookDef[] = [
  { id: 'l0', L: 0, tint: [1, 1, 1], swatch: '#2a2a2c' },
  { id: 'l1', L: 1, tint: [1, 1, 1], swatch: '#5a4034' },
  { id: 'l2', L: 2, tint: [1, 1, 1], swatch: '#8a2a14' },
  { id: 'l3', L: 3, tint: [1, 1, 1], swatch: '#b8431f' },
  { id: 'l4', L: 4, tint: [1, 1, 1], swatch: '#e8762f' },
  { id: 'blood', L: 2, tint: [1.0, 0.55, 0.4], swatch: '#8f1410' },
  { id: 'orange', L: 3, tint: [1.0, 1.05, 0.75], swatch: '#f08a24' },
  { id: 'pink', L: 3.6, tint: [1.0, 0.9, 2.0], swatch: '#e58aa0' },
  { id: 'yellow', L: 3.4, tint: [1.0, 1.45, 0.75], swatch: '#e8c04a' },
  { id: 'teal', L: 4, tint: [0.7, 1.0, 1.4], swatch: '#3fb8c4' },
  { id: 'blue', L: 4, tint: [0.5, 0.9, 2.0], swatch: '#3a62c8' },
];

export const TYPICAL_L = 2;

/**
 * قيم دانجون الموثّقة بالرصد لأخساف بعينها. تبقى فارغة حتى تُملأ من مصدر منشور (لا تُكتب أرقام من الذاكرة).
 * peakUTC: ISO لحظة أعظم خسوف · L: 0..4 · source: المرجع
 */
export const OBSERVED_DANJON: { peakUTC: string; L: number; source: string }[] = [];

export function observedDanjon(date: Date): { L: number; source: string } | null {
  if (OBSERVED_DANJON.length === 0) return null;
  const t = date.getTime();
  for (const e of OBSERVED_DANJON) {
    if (Math.abs(Date.parse(e.peakUTC) - t) < 1.2 * 86_400_000) return { L: e.L, source: e.source };
  }
  return null;
}

export function resolveLook(date: Date, choice: string = getSettings().eclipseLook): EclipseLookValue {
  const picked = LOOKS.find((l) => l.id === choice);
  if (picked) return { L: picked.L, tint: picked.tint };
  const obs = observedDanjon(date);
  return { L: obs ? obs.L : TYPICAL_L, tint: [1, 1, 1] };
}
