import { supabase } from './supabaseClient';

/**
 * احتياطي محلي فقط لحظة عدم اكتمال تحميل سوبابيز بعد أو تعذّر الوصول للشبكة كلياً —
 * ليس مصدر الحقيقة أبداً. مصدر الحقيقة الفعلي هو جدول zodiac_signs في سوبابيز
 * (idx, code, name_ar, start_lon_deg, end_lon_deg) عبر loadZodiacSigns أدناه.
 */
const FALLBACK_NAMES_AR: Record<string, string> = {
  Aries: 'الحمل', Taurus: 'الثور', Gemini: 'الجوزاء', Cancer: 'السرطان',
  Leo: 'الأسد', Virgo: 'السنبلة', Libra: 'الميزان', Scorpius: 'العقرب',
  Sagittarius: 'القوس', Capricornus: 'الجدي', Aquarius: 'الدلو', Pisces: 'الحوت',
};

export interface ZodiacSignRow {
  idx: number;
  code: string;
  nameAr: string;
  startLonDeg: number;
  endLonDeg: number;
}

let byIdx: Map<number, ZodiacSignRow> = new Map();
let byCode: Map<string, ZodiacSignRow> = new Map();
let loadPromise: Promise<void> | null = null;

/**
 * يحمّل جدول zodiac_signs الحقيقي من سوبابيز — بنفس نمط loadArabicEnrichment في
 * starCatalog.ts بالضبط: تحميل خلفي غير معطِّل (لا يحجب أي رسم أو بحث)، وفشل صامت
 * ومقصود يُبقي الاحتياطي المحلي فعّالاً دون كسر التطبيق. يجب استدعاؤها مرة واحدة عند
 * بدء التطبيق (مثل استدعاء loadArabicEnrichment في App.tsx حالياً).
 */
export function loadZodiacSigns(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('zodiac_signs')
        .select('idx, code, name_ar, start_lon_deg, end_lon_deg')
        .order('idx', { ascending: true });
      if (error) throw error;

      const idxMap = new Map<number, ZodiacSignRow>();
      const codeMap = new Map<string, ZodiacSignRow>();
      for (const row of data ?? []) {
        const entry: ZodiacSignRow = {
          idx: row.idx,
          code: row.code,
          nameAr: row.name_ar,
          startLonDeg: row.start_lon_deg,
          endLonDeg: row.end_lon_deg,
        };
        idxMap.set(row.idx, entry);
        codeMap.set(row.code.toLowerCase(), entry);
      }
      byIdx = idxMap;
      byCode = codeMap;
    } catch (err) {
      console.error('فشل تحميل جدول الأبراج (zodiac_signs) من سوبابيز:', err);
    }
  })();
  return loadPromise;
}

/**
 * الاسم العربي لبرج مُعطى: يُطابَق أولاً بعمود code في سوبابيز (بلا حساسية لحالة الأحرف)،
 * ثم بترتيبه الرقمي (orderIndex، أي موضعه في ZODIAC_ORDER) كاحتياطي إن اختلفت صياغة code
 * محلياً عن العمود، ثم القائمة الثابتة كملاذ أخير فقط عند تعذّر الشبكة كلياً.
 */
export function getZodiacNameAr(code: string, orderIndex: number): string {
  const byCodeMatch = byCode.get(code.toLowerCase());
  if (byCodeMatch) return byCodeMatch.nameAr;
  const byIdxMatch = byIdx.get(orderIndex);
  if (byIdxMatch) return byIdxMatch.nameAr;
  return FALLBACK_NAMES_AR[code] ?? code;
}

/**
 * حدود البرج الطولية الفلكية (بالدرجات على مسار الشمس الظاهري) من نفس جدول سوبابيز —
 * تُستخدم لحساب نقطة منتصف البرج فلكياً عند اختياره من نتائج البحث (بدل أي تقريب هندسي
 * من رسم خطوط الكوكبة). تُعيد null إن لم تكتمل قراءة سوبابيز بعد لهذا البرج تحديداً.
 */
export function getZodiacLongitudeRange(
  code: string,
  orderIndex: number
): { startLonDeg: number; endLonDeg: number } | null {
  const row = byCode.get(code.toLowerCase()) ?? byIdx.get(orderIndex) ?? null;
  if (!row) return null;
  return { startLonDeg: row.startLonDeg, endLonDeg: row.endLonDeg };
}

/** كل الصفوف المحمَّلة من سوبابيز دفعة واحدة، مرتّبة — مفيد لقوائم مثل ControlsPanel */
export function getAllLoadedZodiacSigns(): ZodiacSignRow[] {
  return [...byIdx.values()].sort((a, b) => a.idx - b.idx);
}