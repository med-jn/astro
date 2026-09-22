import { supabase } from './supabaseClient';

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
let loadPromise: Promise<CatalogStar[]> | null = null;

export function loadStarCatalog(): Promise<CatalogStar[]> {
  if (loadPromise) return loadPromise;
  loadPromise = fetch(`${import.meta.env.BASE_URL}data/stars.json`)
    .then((res) => res.json())
    .then((data: CatalogStar[]) => {
      cachedCatalog = data;
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
      const [{ data: starsData, error: starsErr }, { data: aliasData, error: aliasErr }] =
        await Promise.all([
          supabase.from('stars').select('hip, name_ar').not('name_ar', 'is', null),
          supabase.from('star_aliases').select('hip, alias_ar, source').order('id', { ascending: true }),
        ]);

      if (starsErr) throw starsErr;
      if (aliasErr) throw aliasErr;

      const altByHip = new Map<number, ArabicAltName[]>();
      for (const row of aliasData ?? []) {
        const list = altByHip.get(row.hip) ?? [];
        list.push({ name: row.alias_ar, source: row.source });
        altByHip.set(row.hip, list);
      }

      // إحصاء تكرار كل اسم عربي لمعرفة أي الأسماء "جماعية" (تخص أكثر من نجم واحد)
      const nameCounts = new Map<string, number>();
      for (const row of starsData ?? []) {
        if (!row.name_ar) continue;
        nameCounts.set(row.name_ar, (nameCounts.get(row.name_ar) ?? 0) + 1);
      }

      const map = new Map<number, ArabicEnrichment>();
      for (const row of starsData ?? []) {
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

/** نصف قطر بصري منطقي للنجم على الشاشة بناءً على قدره الظاهري (الأكثر سطوعاً = أكبر حجماً) */
export function getStarRadiusPx(mag: number): number {
  const clamped = Math.max(-1.5, Math.min(6.5, mag));
  return Math.max(0.4, 2.6 - clamped * 0.36);
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
  if (star.bayer && star.con) return `${star.bayer} ${star.con}`;
  return null;
}