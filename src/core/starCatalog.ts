import { fetchAllRows } from './supabaseClient';
import { arabicBayerLabel } from './conNames';

export interface CatalogStar {
  id: number;
  ra: number; // ساعات، حقبة J2000
  dec: number; // درجات، حقبة J2000
  mag: number; // القدر الظاهري المرئي
  name: string | null;
  bayer: string | null;
  flam: string | null;
  con: string | null; // اختصار الكوكبة (3 أحرف)
  spect: string | null; // الحرف الأول من الصنف الطيفي (O,B,A,F,G,K,M...)
}

// مصدر البيانات: قاعدة HYG (Hipparcos-Yale-Gliese)، مُصفّاة للنجوم المرئية بالعين المجردة (mag <= 6.5)
// تُحمَّل بشكل غير متزامن (fetch) من public/data بدل تضمينها في حزمة JS الرئيسية،
// لتفادي إبطاء أول تحميل خصوصاً على الشبكات الخلوية/الموبايل.
// ملاحظة: حقل id هنا هو المعرّف الداخلي لقاعدة HYG، وليس رقم Hipparcos الحقيقي —
// جدول stars في Supabase مربوط بنفس أرقام id هذه (رغم تسمية عموده "hip" تاريخياً).
let cachedCatalog: CatalogStar[] = [];
let starByIdMap: Map<number, CatalogStar> = new Map();
let loadPromise: Promise<CatalogStar[]> | null = null;

export function loadStarCatalog(): Promise<CatalogStar[]> {
  if (loadPromise) return loadPromise;
  loadPromise = fetch(`${import.meta.env.BASE_URL}data/stars.json`)
    .then((res) => res.json())
    .then((data: CatalogStar[]) => {
      cachedCatalog = data;
      starByIdMap = new Map(data.map((s) => [s.id, s]));
      return data;
    })
    .catch((err) => {
      console.error('فشل تحميل كتالوج النجوم:', err);
      return [];
    });
  return loadPromise;
}

export function getLoadedStars(): CatalogStar[] {
  return cachedCatalog;
}

/** فهرس id → نجم، يُبنى مرة واحدة عند تحميل الكتالوج (بدل إعادة بنائه كل إطار رسم) */
export function getStarByIdMap(): Map<number, CatalogStar> {
  return starByIdMap;
}

export function getStarById(id: number): CatalogStar | undefined {
  return starByIdMap.get(id);
}

// ===================== الإثراء العربي (Supabase) =====================
// طبقة اختيارية غير معطِّلة: تُحمَّل بالخلفية بعد الكتالوج المحلي، ولا تُبطئ
// أو تُعطّل الرسم/البحث الأساسي إن فشلت أو تأخرت الشبكة.

export interface ArabicAltName {
  name: string;
  source: string;
}

export interface ArabicEnrichment {
  nameAr: string;
  /** true إن كان هذا الاسم العربي مشتركاً بين أكثر من نجم واحد في الكتالوج (اسم مجموعة/منزلة) */
  isSharedGroupName: boolean;
  altNames: ArabicAltName[];
}

let arabicEnrichment: Map<number, ArabicEnrichment> = new Map();
let arabicLoadPromise: Promise<void> | null = null;

export function loadArabicEnrichment(): Promise<void> {
  if (arabicLoadPromise) return arabicLoadPromise;
  arabicLoadPromise = (async () => {
    try {
      const [starsData, aliasData] = await Promise.all([
        fetchAllRows<{ hip: number; name_ar: string | null }>('stars', 'hip, name_ar', ['hip'], { notNull: 'name_ar' }),
        fetchAllRows<{ hip: number; alias_ar: string; source: string }>('star_aliases', 'hip, alias_ar, source', ['id']),
      ]);

      const altByHip = new Map<number, ArabicAltName[]>();
      for (const row of aliasData) {
        const list = altByHip.get(row.hip) ?? [];
        list.push({ name: row.alias_ar, source: row.source });
        altByHip.set(row.hip, list);
      }

      // إحصاء تكرار كل اسم عربي لمعرفة أي الأسماء "جماعية" (تخص أكثر من نجم واحد)
      const nameCounts = new Map<string, number>();
      for (const row of starsData) {
        if (!row.name_ar) continue;
        nameCounts.set(row.name_ar, (nameCounts.get(row.name_ar) ?? 0) + 1);
      }

      const map = new Map<number, ArabicEnrichment>();
      for (const row of starsData) {
        if (!row.name_ar) continue;
        map.set(row.hip, {
          nameAr: row.name_ar,
          isSharedGroupName: (nameCounts.get(row.name_ar) ?? 0) > 1,
          altNames: (altByHip.get(row.hip) ?? []).filter((a) => a.name !== row.name_ar),
        });
      }
      arabicEnrichment = map;
    } catch (err) {
      // فشل صامت ومقصود: التطبيق يستمر بالأسماء الإنجليزية/Bayer دون أي كسر
      console.error('فشل تحميل الإثراء العربي من Supabase:', err);
    }
  })();
  return arabicLoadPromise;
}

/** يعيد الإثراء العربي الكامل للنجم (اسم رسمي + بدائل تاريخية) إن وُجد، وإلا null */
export function getStarArabicInfo(star: CatalogStar): ArabicEnrichment | null {
  return arabicEnrichment.get(star.id) ?? null;
}

// ===================== نهاية طبقة الإثراء العربي =====================

// ألوان واقعية تقريبية حسب درجة حرارة النجم (الصنف الطيفي) — من الأزرق الساخن إلى الأحمر البارد
const SPECTRAL_COLORS: Record<string, string> = {
  O: '#9bb0ff',
  B: '#aabfff',
  A: '#cad7ff',
  F: '#f8f7ff',
  G: '#fff4ea',
  K: '#ffd2a1',
  M: '#ffb56c',
};

export function getStarColor(spect: string | null): string {
  if (!spect) return '#ffffff';
  return SPECTRAL_COLORS[spect.toUpperCase()] ?? '#ffffff';
}

/**
 * نصف قطر بصري للنجم بالبكسل — مُصغَّر عمداً ليبقى النجم "نقطة" واضحة لا "بقعة"،
 * وليظل دائماً أصغر من أي كوكب مهما سطع (انظر drawPlanets في skyRenderer.ts حيث
 * أدنى نصف قطر لأي كوكب أكبر من أقصى نصف قطر ممكن هنا، فلا يلتبس النجم بكوكب أبداً).
 * أسطع نجم ممكن (قدر -1.5 تقريباً كنجم الشعرى) → ~1.5px، وأخفت نجم مرئي (قدر 6.5) → 0.3px.
 */
export function getStarRadiusPx(mag: number): number {
  const clamped = Math.max(-1.5, Math.min(6.5, mag));
  return Math.max(0.3, 1.275 - clamped * 0.15);
}

/**
 * اسم العرض النهائي للنجم: يُفضَّل الاسم العربي الرسمي من Supabase إن كان محمّلاً،
 * ثم الاسم الإنجليزي المُضمَّن في الكتالوج المحلي، ثم تركيبة Bayer+الكوكبة، وإلا null.
 */
export function getStarDisplayName(star: CatalogStar): string | null {
  const ar = arabicEnrichment.get(star.id);
  if (ar) {
    // إن كان الاسم العربي جماعياً (يخص أكثر من نجم)، أضف مُميّزاً فرعياً بالإنجليزية
    // حتى يميّز المستخدم أي نجم بالتحديد يشاهد داخل المجموعة/المنزلة
    if (ar.isSharedGroupName && star.name) {
      return `${ar.nameAr} (${star.name})`;
    }
    return ar.nameAr;
  }
  if (star.name) return star.name;
  // نجم بلا اسم خاص: «ألفا العقرب» / «12 الدب الأكبر» ديناميكياً من bayer/flam + اسم الكوكبة (بلا تخزين)
  const arLabel = arabicBayerLabel(star.bayer, star.flam, star.con);
  if (arLabel) return arLabel;
  if (star.bayer && star.con) return `${star.bayer} ${star.con}`;
  return null;
}