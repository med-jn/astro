import * as Astronomy from 'astronomy-engine';
import { getLoadedStars, getStarDisplayName, getStarArabicInfo, type CatalogStar } from './starCatalog';
import { computeOuterRadiusPx, raDecToScreen, type PolarMapConfig } from './projection';
import { ZODIAC_ORDER, type ZodiacKey } from './zodiac';
import { getZodiacNameAr, getZodiacLongitudeRange } from './zodiacNamesAr';
import { getAllLunarMansions, MANSION_SPAN_DEG } from './mansions';
import { eclipticLongitudeToEquatorial, getMeanObliquityDeg } from './eclipticTransform';
import { getAllLoadedGroups, computeGroupCenter } from './starGroups';

/** تبسيط عربي خفيف للمقارنة: إزالة التشكيل وتوحيد أشكال الألف/الياء/التاء المربوطة */
function normalizeArabic(input: string): string {
  return input
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .trim()
    .toLowerCase();
}

export type SearchResultKind = 'star' | 'zodiac' | 'mansion' | 'group';

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  /** النص المعروض في قائمة النتائج، يتضمن نوع العنصر بين قوسين لغير النجوم */
  label: string;
  centerRaHours: number;
  centerDecDeg: number;
  star?: CatalogStar;
  zodiacKey?: ZodiacKey;
  mansionIndex?: number;
  groupId?: number;
}

/** بحث في الكتالوج المحلي فقط (نجوم public/data/stars.json + إثراء سوبابيز إن كان محمَّلاً) */
function searchStars(query: string, limit: number): SearchResult[] {
  const q = normalizeArabic(query);
  const results: SearchResult[] = [];

  for (const star of getLoadedStars()) {
    const displayName = getStarDisplayName(star);
    if (!displayName) continue;

    const candidates: string[] = [displayName];
    if (star.name) candidates.push(star.name);
    if (star.bayer && star.con) candidates.push(`${star.bayer} ${star.con}`);
    const arInfo = getStarArabicInfo(star);
    if (arInfo) {
      candidates.push(arInfo.nameAr);
      arInfo.altNames.forEach((a) => candidates.push(a.name));
    }

    if (candidates.some((c) => normalizeArabic(c).includes(q))) {
      results.push({
        kind: 'star', id: `star:${star.id}`, label: displayName,
        centerRaHours: star.ra, centerDecDeg: star.dec, star,
      });
      if (results.length >= limit) break;
    }
  }

  return results.sort((a, b) => (a.star?.mag ?? 99) - (b.star?.mag ?? 99));
}

/** بحث في الأبراج — الاسم ومركز التوسيط كلاهما من جدول zodiac_signs في سوبابيز مباشرة */
function searchZodiacs(query: string, obliquityDeg: number): SearchResult[] {
  const q = normalizeArabic(query);
  const results: SearchResult[] = [];

  ZODIAC_ORDER.forEach((key: ZodiacKey, orderIndex: number) => {
    const nameAr = getZodiacNameAr(key, orderIndex);
    if (!normalizeArabic(nameAr).includes(q) && !normalizeArabic(key).includes(q)) return;

    const range = getZodiacLongitudeRange(key, orderIndex);
    if (!range) return; // لم يكتمل تحميل سوبابيز بعد لهذا البرج — لا مركز موثوق دون تخمين

    let { startLonDeg, endLonDeg } = range;
    if (endLonDeg < startLonDeg) endLonDeg += 360; // احتياط لو كان مدى البرج عابراً لحد 360/0
    const midLon = ((startLonDeg + endLonDeg) / 2) % 360;

    const { raHours, decDeg } = eclipticLongitudeToEquatorial(midLon, obliquityDeg);
    results.push({
      kind: 'zodiac', id: `zodiac:${key}`, label: `${nameAr} (برج)`,
      centerRaHours: raHours, centerDecDeg: decDeg, zodiacKey: key,
    });
  });

  return results;
}

/** بحث في المنازل القمرية — الاسم من mansions.ts المحلي (مطابق فعلاً لجدول lunar_mansions) */
function searchMansions(query: string, obliquityDeg: number): SearchResult[] {
  const q = normalizeArabic(query);
  const results: SearchResult[] = [];

  for (const m of getAllLunarMansions()) {
    if (!normalizeArabic(m.nameAr).includes(q)) continue;

    const midLon = m.startLongitudeDeg + MANSION_SPAN_DEG / 2;
    const { raHours, decDeg } = eclipticLongitudeToEquatorial(midLon, obliquityDeg);
    results.push({
      kind: 'mansion', id: `mansion:${m.index}`, label: `${m.nameAr} (منزلة)`,
      centerRaHours: raHours, centerDecDeg: decDeg, mansionIndex: m.index,
    });
  }

  return results;
}

/**
 * بحث في الكوكبات (groups) المحمَّلة من سوبابيز — الاسم والمركز كلاهما حقيقيان (متوسط
 * اتجاهي لمواضع النجوم الأعضاء الفعلية، انظر computeGroupCenter في starGroups.ts)،
 * لا أي تقريب محلي. تُعاد قائمة فارغة تلقائياً ما دامت جداول سوبابيز غير مُعبَّأة بعد.
 */
function searchGroups(query: string): SearchResult[] {
  const q = normalizeArabic(query);
  const results: SearchResult[] = [];

  for (const group of getAllLoadedGroups()) {
    const candidates = [group.nameAr, group.nameEn ?? '', group.iauCon ?? ''];
    if (!candidates.some((c) => normalizeArabic(c).includes(q))) continue;

    const center = computeGroupCenter(group.id);
    if (!center) continue; // لا نجوم أعضاء مطابقة في الكتالوج المحلي بعد — لا مركز موثوق

    results.push({
      kind: 'group', id: `group:${group.id}`, label: `${group.nameAr} (كوكبة)`,
      centerRaHours: center.raHours, centerDecDeg: center.decDeg, groupId: group.id,
    });
  }

  return results;
}

/**
 * بحث موحَّد فوري بلا أي استعلام شبكي (كل البيانات محمَّلة مسبقاً محلياً أو من ذاكرة تخزين
 * سوبابيز المؤقتة) — يغطي الأبراج والمنازل أولاً (قوائم قصيرة، مطابقات دقيقة غالباً) ثم النجوم.
 */
export function searchAll(query: string, date: Date, limit = 12): SearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const time = Astronomy.MakeTime(date);
  const obliquityDeg = getMeanObliquityDeg(time);

  const zodiacResults = searchZodiacs(q, obliquityDeg);
  const mansionResults = searchMansions(q, obliquityDeg);
  const groupResults = searchGroups(q);
  const starResults = searchStars(q, limit);

  return [...zodiacResults, ...mansionResults, ...groupResults, ...starResults].slice(0, limit);
}

export interface CenterPanDelta {
  panDeltaX: number;
  panDeltaY: number;
}

/**
 * يحسب فرق التحريك (Pan) الواجب تمريره إلى setPan (يجمع تراكمياً على القيمة الحالية — انظر
 * store.ts) لتوسيط إحداثي (RA/Dec) مُعطى في مركز القبة تماماً، على شاشة بالحجم المُعطى ومع
 * مراعاة زاوية دوران المشهد الحالية. يُعاد حساب gmstDeg هنا مستقلاً عبر astronomy-engine
 * مباشرة (Astronomy.SiderealTime) للتطابق التام مع لحظة الاستدعاء دون انتظار دورة الرسم التالية.
 */
export function computeCenterPanDelta(
  targetRaHours: number,
  targetDecDeg: number,
  date: Date,
  targetZoomScale: number,
  currentPanX: number,
  currentPanY: number,
  sceneRotationDeg: number,
  viewportWidth: number,
  viewportHeight: number
): CenterPanDelta {
  const time = Astronomy.MakeTime(date);
  const gmstDeg = Astronomy.SiderealTime(time) * 15;

  const outerRadiusPx = computeOuterRadiusPx(viewportWidth, viewportHeight, targetZoomScale);
  const centerX = viewportWidth / 2;
  const centerY = viewportHeight / 2;
  const config: PolarMapConfig = { centerX, centerY, outerRadiusPx };

  // نفس معادلة renderSky/applySceneTransform بالضبط: screen = center + R(theta)·(p-center) + pan
  const p = raDecToScreen(targetRaHours, targetDecDeg, gmstDeg, config);

  const rad = (sceneRotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - centerX;
  const dy = p.y - centerY;
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  // لتوسيط النقطة: center + R·(p-center) + panPx = center  =>  panPx = -R·(p-center)
  const targetPanXFraction = -rx / outerRadiusPx;
  const targetPanYFraction = -ry / outerRadiusPx;

  return {
    panDeltaX: targetPanXFraction - currentPanX,
    panDeltaY: targetPanYFraction - currentPanY,
  };
}