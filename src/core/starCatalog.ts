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

export function getStarDisplayName(star: CatalogStar): string | null {
  if (star.name) return star.name;
  if (star.bayer && star.con) return `${star.bayer} ${star.con}`;
  return null;
}
